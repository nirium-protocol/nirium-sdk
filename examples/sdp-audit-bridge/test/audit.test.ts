import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  anchorDisbursementBatch,
  parseNiriumAnchorResponse,
  verifyAuditCid,
} from '../src/audit.js';
import {
  buildAuditRecord,
  hashAuditRecord,
  type SdpAuditRecord,
  type VerifiedPayment,
} from '../src/record.js';
import {
  RECIPIENT_A,
  SOURCE,
  TX_A,
  horizonPage,
  jsonResponse,
  paymentOperation,
  rootResponse,
  singlePaymentHorizonFetch,
  transactionResponse,
  urlOf,
} from './helpers.js';

const CID = `Qm${'a'.repeat(44)}`;

function evidence(): VerifiedPayment {
  return {
    txHash: TX_A,
    operationId: '1',
    from: SOURCE,
    to: RECIPIENT_A,
    amountStroops: 10_000_000n,
    asset: { type: 'native' },
    createdAt: '2026-08-26T12:00:00.000Z',
  };
}

function record(selection: SdpAuditRecord['selection'] = { type: 'tx_hashes' }): SdpAuditRecord {
  return buildAuditRecord([evidence()], selection, [TX_A]);
}

function auditFetch(
  document: Record<string, unknown>,
  operation = paymentOperation(TX_A),
  onUrl?: (url: URL) => void,
): typeof fetch {
  return async (input): Promise<Response> => {
    const url = urlOf(input);
    onUrl?.(url);
    if (url.origin === 'https://gateway.test' && url.pathname === `/ipfs/${CID}`) {
      return jsonResponse(document);
    }
    if (url.origin !== 'https://horizon.test') {
      throw new Error(`Unexpected mock origin: ${url.origin}`);
    }
    if (url.pathname === '/') return jsonResponse(rootResponse());
    if (url.pathname === `/transactions/${TX_A}`) {
      return jsonResponse(transactionResponse(TX_A));
    }
    if (url.pathname === `/transactions/${TX_A}/payments`) {
      const records = url.searchParams.has('cursor') ? [] : [operation];
      const next = `https://horizon.test/transactions/${TX_A}/payments?order=asc&limit=200&include_failed=false&cursor=end`;
      return jsonResponse(horizonPage(records, next));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
}

test('CID verifier recomputes the hash and Horizon aggregate for every cited transaction', async () => {
  const anchoredRecord = record();
  const document = {
    content_sha256: hashAuditRecord(anchoredRecord),
    record: anchoredRecord,
  };
  const result = await verifyAuditCid({
    cid: CID,
    gatewayUrl: 'https://gateway.test',
    horizonUrl: 'https://horizon.test',
    fetchFn: auditFetch(document),
    maxRetries: 0,
  });
  assert.equal(result.signatureStatus, 'absent');
  assert.deepEqual(result.checkedTxHashes, [TX_A]);
  assert.equal(result.paymentOperationCount, 1);
});

test('valid Ed25519 attestation signs the recomputed domain-separated statement', async () => {
  const anchoredRecord = record();
  const contentSha256 = hashAuditRecord(anchoredRecord);
  const signer = Keypair.random();
  const statement = `nirium-audit-v1:${contentSha256}`;
  const document = {
    content_sha256: contentSha256,
    record: anchoredRecord,
    agent: {
      key: signer.publicKey(),
      signature: signer.sign(Buffer.from(statement)).toString('base64'),
      statement,
    },
  };
  const result = await verifyAuditCid({
    cid: CID,
    gatewayUrl: 'https://gateway.test',
    horizonUrl: 'https://horizon.test',
    fetchFn: auditFetch(document),
    maxRetries: 0,
  });
  assert.equal(result.signatureStatus, 'valid');
  assert.equal(result.signerKey, signer.publicKey());
});

test('anchoring signs the locally recomputed record hash when a key is configured', async () => {
  const signer = Keypair.random();
  let requestChecked = false;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/api/audit/log');
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        record: SdpAuditRecord;
        agent: { key: string; signature: string };
      };
      const contentSha256 = hashAuditRecord(body.record);
      const statement = `nirium-audit-v1:${contentSha256}`;
      assert.equal(body.agent.key, signer.publicKey());
      assert.equal(
        signer.verify(Buffer.from(statement), Buffer.from(body.agent.signature, 'base64')),
        true,
      );
      requestChecked = true;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        cid: CID,
        contentSha256,
        anchoredAt: '2026-08-26T22:35:35.343Z',
        attestedBy: signer.publicKey(),
      }));
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    if (address === null || typeof address !== 'object') {
      throw new Error('Test server did not expose a TCP address');
    }
    const anchored = await anchorDisbursementBatch({
      descriptor: { txHashes: [TX_A] },
      horizonUrl: 'https://horizon.test',
      fetchFn: singlePaymentHorizonFetch(TX_A),
      maxRetries: 0,
      niriumApiUrl: `http://127.0.0.1:${address.port}`,
      agentSecretKey: signer.secret(),
    });
    assert.equal(requestChecked, true);
    assert.equal(anchored.contentSha256, hashAuditRecord(anchored.record));
    assert.equal(anchored.attestedBy, signer.publicKey());
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('statement-substitution attack is rejected even when the declared hash matches tampered content', async () => {
  const original = record();
  const originalHash = hashAuditRecord(original);
  const signer = Keypair.random();
  const signature = signer
    .sign(Buffer.from(`nirium-audit-v1:${originalHash}`))
    .toString('base64');
  const tampered = { ...original, totalAmount: '999.0000000' };
  const document = {
    content_sha256: hashAuditRecord(tampered),
    record: tampered,
    agent: {
      key: signer.publicKey(),
      signature,
      statement: `nirium-audit-v1:${originalHash}`,
    },
  };
  await assert.rejects(
    () => verifyAuditCid({
      cid: CID,
      gatewayUrl: 'https://gateway.test',
      horizonUrl: 'https://horizon.test',
      fetchFn: auditFetch(document),
      maxRetries: 0,
    }),
    /signature is invalid for the recomputed audit statement/,
  );
});

test('tampered content hash fails before Horizon is queried', async () => {
  const anchoredRecord = record();
  const document = {
    content_sha256: '0'.repeat(64),
    record: anchoredRecord,
  };
  let horizonCalls = 0;
  await assert.rejects(
    () => verifyAuditCid({
      cid: CID,
      gatewayUrl: 'https://gateway.test',
      horizonUrl: 'https://horizon.test',
      fetchFn: auditFetch(document, paymentOperation(TX_A), (url) => {
        if (url.origin === 'https://horizon.test') horizonCalls += 1;
      }),
      maxRetries: 0,
    }),
    /content hash mismatch/,
  );
  assert.equal(horizonCalls, 0);
});

test('a self-consistent but false aggregate fails independent Horizon reconstruction', async () => {
  const falseRecord = { ...record(), totalAmount: '2.0000000' };
  const document = {
    content_sha256: hashAuditRecord(falseRecord),
    record: falseRecord,
  };
  await assert.rejects(
    () => verifyAuditCid({
      cid: CID,
      gatewayUrl: 'https://gateway.test',
      horizonUrl: 'https://horizon.test',
      fetchFn: auditFetch(document),
      maxRetries: 0,
    }),
    /does not match the anchored aggregate record/,
  );
});

test('source-window verification checks cited hashes without re-enumerating the account', async () => {
  const selection = {
    type: 'source_time_window' as const,
    sourceAccount: SOURCE,
    from: '2026-08-26T12:00:00.000Z',
    to: '2026-08-26T13:00:00.000Z',
  };
  const anchoredRecord = record(selection);
  const document = {
    content_sha256: hashAuditRecord(anchoredRecord),
    record: anchoredRecord,
  };
  let accountEnumerationCalls = 0;
  const result = await verifyAuditCid({
    cid: CID,
    gatewayUrl: 'https://gateway.test',
    horizonUrl: 'https://horizon.test',
    fetchFn: auditFetch(document, paymentOperation(TX_A), (url) => {
      if (url.pathname.startsWith('/accounts/')) accountEnumerationCalls += 1;
    }),
    maxRetries: 0,
  });
  assert.equal(result.paymentOperationCount, 1);
  assert.equal(accountEnumerationCalls, 0);
});

test('oversized and malformed gateway documents are rejected', async () => {
  const huge = { payload: 'x'.repeat(70 * 1024) };
  const fetchFn: typeof fetch = async () => jsonResponse(huge);
  await assert.rejects(
    () => verifyAuditCid({
      cid: CID,
      gatewayUrl: 'https://gateway.test',
      horizonUrl: 'https://horizon.test',
      fetchFn,
      maxRetries: 0,
    }),
    /exceeds 65536 bytes/,
  );
});

test('Nirium live snake_case content hash is normalized and still checked', () => {
  const parsed = parseNiriumAnchorResponse({
    cid: CID,
    content_sha256: 'A'.repeat(64),
    anchoredAt: '2026-08-26T16:42:38.751Z',
    gatewayUrl: `https://gateway.test/ipfs/${CID}`,
  });
  assert.equal(parsed.contentSha256, 'a'.repeat(64));
  assert.equal(parsed.cid, CID);
  assert.throws(
    () => parseNiriumAnchorResponse({ cid: CID, anchoredAt: 'now' }),
    /invalid content hash/,
  );
});
