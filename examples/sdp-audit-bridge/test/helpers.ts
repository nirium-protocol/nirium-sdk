import { Networks } from '@stellar/stellar-sdk';

export const SOURCE = 'GCAXBKU3AKYJPLQ6PEJ6L47KOATCYCBJ2NFRGAK7FUUA2DCEUC265SU2';
export const RECIPIENT_A = 'GC2QCKFI3DOBEYVBONPVNA2PMLU225IKKI6XPENMWR2CTWSFBAOU7T34';
export const RECIPIENT_B = 'GCRGHKY6RBFVQLF2JCHB7TK7A5BIABITFKVIEOXK4BPEIDE446OEFYXZ';
export const ISSUER = 'GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD';
export const TX_A = 'a'.repeat(64);
export const TX_B = 'b'.repeat(64);

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function rootResponse(passphrase = Networks.TESTNET): Record<string, unknown> {
  return { network_passphrase: passphrase };
}

export function transactionResponse(hash: string, successful = true): Record<string, unknown> {
  return { hash, successful };
}

export function paymentOperation(
  hash: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `${hash.slice(0, 8)}-1`,
    paging_token: '1',
    transaction_hash: hash,
    transaction_successful: true,
    source_account: SOURCE,
    type: 'payment',
    created_at: '2026-08-26T12:00:00.000Z',
    asset_type: 'native',
    from: SOURCE,
    to: RECIPIENT_A,
    amount: '1.0000000',
    ...overrides,
  };
}

export function horizonPage(
  records: unknown[],
  nextHref: string,
): Record<string, unknown> {
  return {
    _embedded: { records },
    _links: { next: { href: nextHref } },
  };
}

export function urlOf(input: string | URL | Request): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
}

export function singlePaymentHorizonFetch(
  hash: string,
  operation = paymentOperation(hash),
): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = urlOf(input);
    if (url.pathname === '/') {
      return jsonResponse(rootResponse());
    }
    if (url.pathname === `/transactions/${hash}`) {
      return jsonResponse(transactionResponse(hash));
    }
    if (url.pathname === `/transactions/${hash}/payments`) {
      const records = url.searchParams.has('cursor') ? [] : [operation];
      const next = `https://horizon.test/transactions/${hash}/payments?order=asc&limit=200&include_failed=false&cursor=end`;
      return jsonResponse(horizonPage(records, next));
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
}
