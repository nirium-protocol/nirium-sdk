export interface PaymentGateConfig {
  facilitatorUrl: string;
  payTo: string;
  price: string;
  network?: "stellar:testnet" | "stellar:pubnet";
}

export interface PaymentResult {
  settled: boolean;
  transaction?: string;
}

export class PaymentGate {
  constructor(
    private readonly config: PaymentGateConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  challenge(): Record<string, unknown> {
    return {
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        price: this.config.price,
        network: this.config.network ?? "stellar:testnet",
        payTo: this.config.payTo,
      }],
    };
  }

  async verifyAndSettle(signature: string): Promise<PaymentResult> {
    if (!signature.trim()) return { settled: false };

    const payload = {
      paymentPayload: signature,
      paymentRequirements: this.challenge(),
    };
    const verify = await this.request(`${this.config.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!verify.ok || !(await verify.json() as { isValid?: boolean }).isValid) {
      return { settled: false };
    }

    const settle = await this.request(`${this.config.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!settle.ok) return { settled: false };
    const result = await settle.json() as { success?: boolean; transaction?: string };
    return { settled: Boolean(result.success || result.transaction), transaction: result.transaction };
  }
}
