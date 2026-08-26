import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAuditCid } from './audit.js';

interface VerifyCliOptions {
  cid: string;
  gatewayUrl?: string;
  horizonUrl?: string;
}

const usage = `Usage:
  npm run verify -- <cid> [--gateway <url>] [--horizon <url>]

The verifier fetches the CID, recomputes its record hash and optional agent
signature, then rebuilds the aggregate from every cited Testnet transaction.
`;

function nextValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseVerifyArguments(args: readonly string[]): VerifyCliOptions | null {
  let cid: string | undefined;
  let gatewayUrl: string | undefined;
  let horizonUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      return null;
    }
    if (argument === '--gateway') {
      if (gatewayUrl !== undefined) {
        throw new Error('--gateway may only be provided once');
      }
      gatewayUrl = nextValue(args, index, '--gateway');
      index += 1;
    } else if (argument === '--horizon') {
      if (horizonUrl !== undefined) {
        throw new Error('--horizon may only be provided once');
      }
      horizonUrl = nextValue(args, index, '--horizon');
      index += 1;
    } else if (argument?.startsWith('--')) {
      throw new Error(`Unknown argument: ${argument}`);
    } else if (cid === undefined && argument !== undefined) {
      cid = argument;
    } else {
      throw new Error(`Unexpected positional argument: ${String(argument)}`);
    }
  }

  if (!cid) {
    throw new Error('A CID is required');
  }
  return {
    cid,
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(horizonUrl ? { horizonUrl } : {}),
  };
}

export async function runVerifyCli(args: readonly string[]): Promise<void> {
  const cli = parseVerifyArguments(args);
  if (!cli) {
    process.stdout.write(usage);
    return;
  }
  const gatewayUrl = cli.gatewayUrl ?? process.env.IPFS_GATEWAY_URL;
  const horizonUrl = cli.horizonUrl ?? process.env.HORIZON_URL;
  const verified = await verifyAuditCid({
    cid: cli.cid,
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(horizonUrl ? { horizonUrl } : {}),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    cid: verified.cid,
    contentSha256: verified.contentSha256,
    signature: verified.signatureStatus,
    signerKey: verified.signerKey,
    checkedTxHashes: verified.checkedTxHashes,
    paymentOperationCount: verified.paymentOperationCount,
    aggregate: {
      recipientCount: verified.record.recipientCount,
      totalAmount: verified.record.totalAmount,
      asset: verified.record.asset,
    },
  }, null, 2)}\n`);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined
    && resolve(entryPoint) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runVerifyCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sdp-audit-verify: ${message}\n`);
    process.exitCode = 1;
  });
}
