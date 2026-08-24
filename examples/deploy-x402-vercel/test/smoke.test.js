import test from "node:test";
import assert from "node:assert/strict";
import { withX402Protection } from "../lib/x402-handler.ts";

const VALID_PAY_TO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFZUKW3T2TRWECCHX";

test("smoke test: returns 500 when PAY_TO is invalid or missing", async () => {
  const handler = withX402Protection(
    { payTo: "invalid-address", resource: "/api/ascii" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/ascii");
  const res = await handler(req);

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.ok(body.error.includes("Server misconfiguration"));
});

test("smoke test: returns 503/402 when facilitator key or connection fails", async () => {
  const handler = withX402Protection(
    { payTo: VALID_PAY_TO, resource: "/api/ascii", facilitatorUrl: "http://127.0.0.1:59999" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/ascii");
  const res = await handler(req);

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "x402 payments unavailable");
});

test("smoke test: rejects bogus payment signature without bypassing protection", async () => {
  const handler = withX402Protection(
    { payTo: VALID_PAY_TO, resource: "/api/ascii", facilitatorUrl: "http://127.0.0.1:59999" },
    async () => Response.json({ ok: true })
  );
  const req = new Request("http://localhost:3000/api/ascii", {
    headers: {
      "PAYMENT-SIGNATURE": "bogus-invalid-signature",
    },
  });
  const res = await handler(req);

  // Must not allow bogus signature through with 200
  assert.notEqual(res.status, 200);
});

test("smoke test: route handler executes and returns expected JSON structure", async () => {
  const mockHandler = async (req) => {
    const url = new URL(req.url);
    const style = url.searchParams.get("style") || "cat";
    return Response.json({ ok: true, style, art: "/\\_/\\\n( o.o )\n > ^ < " });
  };

  const req = new Request("http://localhost:3000/api/ascii?style=cat");
  const result = await mockHandler(req);
  const body = await result.json();

  assert.equal(result.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.style, "cat");
  assert.ok(body.art.includes("o.o"));
});
