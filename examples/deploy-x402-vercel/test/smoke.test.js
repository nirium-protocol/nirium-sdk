import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/ascii/route.ts";

test("smoke test: /api/ascii returns 402 without payment header", async () => {
  const req = new Request("http://localhost:3000/api/ascii");
  const res = await GET(req);

  assert.equal(res.status, 402);
  assert.equal(res.headers.get("X-Accept-Payment"), "x402");

  const body = await res.json();
  assert.equal(body.error, "Payment required via x402 protocol");
  assert.equal(body.x402Version, 1);
  assert.ok(Array.isArray(body.accepts));
  assert.equal(body.accepts[0].scheme, "exact");
});

test("smoke test: /api/ascii returns 200 with valid payment header", async () => {
  const req = new Request("http://localhost:3000/api/ascii?style=cat", {
    headers: {
      "x-payment": "test-valid-payment-proof-header",
    },
  });
  const res = await GET(req);

  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.style, "cat");
  assert.ok(typeof body.art === "string");
  assert.ok(body.art.includes("o.o"));
});
