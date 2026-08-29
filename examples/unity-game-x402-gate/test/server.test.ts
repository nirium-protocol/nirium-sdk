/**
 * Network-mocked tests for the reveal-loot x402 route.
 *
 * No real HTTP leaves the process: `global.fetch` is replaced for the
 * duration of each test and only answers requests aimed at the mock
 * facilitator origin declared below. Anything else throws, so a test can't
 * silently pass by hitting the real network. This matches the pattern used
 * by the other examples in this repo (see examples/sdp-audit-bridge/test).
 *
 * The mock's shape below (which endpoints get hit, and the `payment-required`
 * response header carrying the base64 payment requirements rather than the
 * JSON body) was captured by actually running x402Serve() against a traced
 * fetch, not guessed from reading the source — see PR description for how.
 *
 * The real signed-payment round trip (a genuine x402 client signing a real
 * Stellar testnet payment and this server settling it through the real
 * OpenZeppelin Channels facilitator) is covered separately by
 * `scripts/wallet-bridge-smoke.ts`, which needs actual network access and
 * funded testnet accounts and therefore isn't run as part of this mocked
 * unit-test suite.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, PAID_ROUTE } from "../src/server.js";

const MOCK_FACILITATOR = "https://mock-facilitator.test";
const PAY_TO = "GCPKZ7PUCFWMDKCKH37TLTSQKH4GDXRUUKGTSQ2Y4426ZNOANYQVWUTG";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mocks every facilitator-bound call x402Serve makes:
 *  - POST `${url}/api/x402serve/telemetry` once, when the middleware first
 *    mounts (fire-and-forget usage ping — payTo/network/route count/SDK
 *    version, no payment data).
 *  - GET  `${url}/supported`  (preflight, and again per resource-server init)
 *  - POST `${url}/verify`     (only reached for a payment credential that
 *                              passes local x402 payload-shape validation)
 *  - POST `${url}/settle`
 * Anything outside that origin, or a path not listed here, throws instead of
 * silently reaching the real network.
 */
function mockFacilitatorFetch(
  realFetch: typeof fetch,
  options: {
    verify?: (body: Record<string, unknown>) => { isValid: boolean; invalidReason?: string };
  } = {},
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? new URL(input) : new URL(input.toString());

    // Requests to our own test server (127.0.0.1, ephemeral port) are the
    // test's own HTTP client hitting the app under test — let those through
    // for real. Only the facilitator origin is mocked.
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return realFetch(input, init);
    }

    if (url.origin !== MOCK_FACILITATOR) {
      throw new Error(`Unexpected network call to ${url.origin} — facilitator calls must be mocked`);
    }

    if (url.pathname === "/api/x402serve/telemetry" && init?.method === "POST") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/supported") {
      return jsonResponse({
        kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
        extensions: [],
        signers: {},
      });
    }

    if (url.pathname === "/verify" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const result = options.verify
        ? options.verify(body)
        : { isValid: false, invalidReason: "no payment supplied in test" };
      return jsonResponse(result);
    }

    if (url.pathname === "/settle" && init?.method === "POST") {
      // Not exercised by these tests: a passing /verify with a synthetic
      // payload still fails on real settlement, since that requires an
      // actual signed Stellar transaction. Covered by the smoke script.
      return jsonResponse({ success: false, errorReason: "settle not mocked in unit tests" }, 200);
    }

    throw new Error(`Unexpected facilitator call: ${init?.method ?? "GET"} ${url.pathname}`);
  };
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** Decodes the base64 JSON the resource server puts in the `payment-required` header. */
function decodePaymentRequiredHeader(res: Response): {
  x402Version: number;
  accepts: Array<Record<string, unknown>>;
} {
  const header = res.headers.get("payment-required");
  assert.ok(header, "expected a payment-required response header on a 402");
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

test("x402Serve config validation still rejects a non-Stellar payTo (sync, before any network call)", () => {
  assert.throws(
    () =>
      createApp({
        payTo: "not-a-stellar-address",
        facilitatorApiKey: "test-key",
        facilitatorUrl: MOCK_FACILITATOR,
      }),
    /payTo/,
  );
});

test("unpaid POST to the reveal-loot route returns 402 with correct x402 payment requirements, not the loot payload", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = mockFacilitatorFetch(originalFetch);
  t.after(() => {
    global.fetch = originalFetch;
  });

  const app = createApp({
    payTo: PAY_TO,
    facilitatorApiKey: "test-key",
    facilitatorUrl: MOCK_FACILITATOR,
    price: "$0.02",
  });
  const { server, baseUrl } = await listen(app);
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}${PAID_ROUTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 402);

  const requirements = decodePaymentRequiredHeader(res);
  assert.equal(requirements.x402Version, 2);
  assert.ok(requirements.accepts.length > 0, "expected at least one accepted payment method");
  const accepted = requirements.accepts[0]!;
  assert.equal(accepted.scheme, "exact");
  assert.equal(accepted.network, "stellar:testnet");
  assert.equal(accepted.payTo, PAY_TO);
  // $0.02 in the SAC's 7-decimal USDC base units.
  assert.equal(accepted.amount, "200000");

  // The unauthenticated response must never leak the loot payload.
  const body = (await res.json().catch(() => ({}))) as { loot?: unknown };
  assert.equal(body.loot, undefined);
});

test("a malformed PAYMENT-SIGNATURE credential is rejected locally and never unlocks the loot payload", async (t) => {
  const originalFetch = global.fetch;
  let verifyWasCalled = false;
  global.fetch = mockFacilitatorFetch(originalFetch, {
    verify: () => {
      verifyWasCalled = true;
      return { isValid: false, invalidReason: "signature does not match payload" };
    },
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const app = createApp({
    payTo: PAY_TO,
    facilitatorApiKey: "test-key",
    facilitatorUrl: MOCK_FACILITATOR,
  });
  const { server, baseUrl } = await listen(app);
  t.after(() => server.close());

  // Well-formed base64/JSON envelope, but with no actual Stellar signature —
  // exactly what an attacker replaying a captured header shape (without a
  // private key) would send. Verified against the real middleware: this
  // fails x402's own payload-shape validation before a network call is even
  // made, so /verify is correctly never reached — the assertion below
  // confirms that rather than assuming it.
  const fakeCredential = Buffer.from(
    JSON.stringify({ x402Version: 2, scheme: "exact", network: "stellar:testnet", payload: {} }),
  ).toString("base64");

  const res = await fetch(`${baseUrl}${PAID_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": fakeCredential,
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 402, "a credential with no valid signature must be rejected, not accepted");
  const body = (await res.json().catch(() => ({}))) as { loot?: unknown };
  assert.equal(body.loot, undefined, "loot must never be present when payment was rejected");
  assert.equal(
    verifyWasCalled,
    false,
    "a structurally invalid payment payload is rejected before it reaches the facilitator's /verify endpoint",
  );
});
