import { describe, expect, it, vi } from "vitest";
import { PaymentGate } from "./payment.js";

const config = {
  facilitatorUrl: "https://facilitator.example",
  payTo: "GDESTINATION",
  price: "0.02",
} as const;

describe("PaymentGate", () => {
  it("creates a Stellar x402 challenge", () => {
    expect(new PaymentGate(config).challenge()).toEqual({
      x402Version: 2,
      accepts: [{ scheme: "exact", price: "0.02", network: "stellar:testnet", payTo: "GDESTINATION" }],
    });
  });

  it("rejects a missing signature without calling the facilitator", async () => {
    const request = vi.fn();
    expect(await new PaymentGate(config, request).verifyAndSettle(" ")).toEqual({ settled: false });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a signature that does not verify", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ isValid: false }), { status: 200 }));
    expect(await new PaymentGate(config, request).verifyAndSettle("bad")).toEqual({ settled: false });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("settles a verified payment before allowing the answer", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ isValid: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, transaction: "tx-123" }), { status: 200 }));
    expect(await new PaymentGate(config, request).verifyAndSettle("signed")).toEqual({ settled: true, transaction: "tx-123" });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
