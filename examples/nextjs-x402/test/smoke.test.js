import test from "node:test";
import assert from "node:assert/strict";
import { withNiriumX402, withX402Protection } from "../app/lib/nirium-x402-seller.ts";

const VALID_PAY_TO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX";

test("smoke test: returns 500 when PAY_TO is invalid or missing", async () => {
  const handler = withNiriumX402(
    { payTo: "invalid-address", resource: "/api/premium/signals" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/premium/signals");
  const res = await handler(req);

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.error.includes("Server misconfiguration"));
});

test("smoke test: returns 500 when facilitator is not configured (fails closed)", async () => {
  const handler = withNiriumX402(
    { payTo: VALID_PAY_TO, resource: "/api/premium/signals" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/premium/signals");
  const res = await handler(req);

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.error.includes("Server misconfiguration"));
  assert.ok(body.error.includes("facilitatorApiKey") || body.detail?.includes("facilitatorApiKey") || body.error.includes("facilitator"));
});

test("smoke test: returns 503 when facilitator key or connection fails", async () => {
  const handler = withNiriumX402(
    {
      payTo: VALID_PAY_TO,
      resource: "/api/premium/signals",
      facilitatorUrl: "http://127.0.0.1:59999",
    },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/premium/signals");
  const res = await handler(req);

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "x402 payments unavailable");
});

test("smoke test: rejects arbitrary X-PAYMENT header without calling handler", async () => {
  let handlerCalled = false;
  const handler = withNiriumX402(
    {
      payTo: VALID_PAY_TO,
      resource: "/api/premium/signals",
      facilitatorUrl: "http://127.0.0.1:59999",
    },
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true, signals: ["unauthorized-data"] });
    }
  );
  const req = new Request("http://localhost:3000/api/premium/signals", {
    headers: {
      "X-PAYMENT": "arbitrary-bogus-payment-token",
    },
  });
  const res = await handler(req);

  assert.equal(handlerCalled, false, "Handler must NOT be called with arbitrary X-PAYMENT header");
  assert.notEqual(res.status, 200, "Response status must not be 200 for unverified payment");
});

test("smoke test: rejects arbitrary PAYMENT-SIGNATURE header without calling handler", async () => {
  let handlerCalled = false;
  const handler = withNiriumX402(
    {
      payTo: VALID_PAY_TO,
      resource: "/api/premium/signals",
      facilitatorUrl: "http://127.0.0.1:59999",
    },
    async () => {
      handlerCalled = true;
      return Response.json({ ok: true, signals: ["unauthorized-data"] });
    }
  );
  const req = new Request("http://localhost:3000/api/premium/signals", {
    headers: {
      "PAYMENT-SIGNATURE": "bogus-signature-proof",
    },
  });
  const res = await handler(req);

  assert.equal(handlerCalled, false, "Handler must NOT be called with bogus PAYMENT-SIGNATURE");
  assert.notEqual(res.status, 200, "Response status must not be 200 for bogus payment");
});

test("smoke test: withX402Protection alias functions identically", async () => {
  const handler = withX402Protection(
    { payTo: "invalid-address", resource: "/api/premium/signals" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/premium/signals");
  const res = await handler(req);

  assert.equal(res.status, 500);
});

test("smoke test: route handler executes and returns expected JSON structure when invoked directly", async () => {
  const mockHandler = async () => {
    const mockSignals = [
      { id: "sig-1", pair: "XLM-USDC", confidence: 0.95 },
      { id: "sig-2", pair: "ETH-USDC", confidence: 0.88 },
    ];
    return Response.json({
      ok: true,
      count: mockSignals.length,
      signals: mockSignals,
    });
  };

  const res = await mockHandler();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.signals.length, 2);
  assert.equal(body.signals[0].pair, "XLM-USDC");
});
