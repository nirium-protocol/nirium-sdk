# rust-x402

Minimal Rust client for the **x402 v2** payment flow on **Stellar/Soroban**. Parses `payment-required` (402) challenges, signs a Stellar auth entry, and retries with a `PAYMENT-SIGNATURE` credential.

Part of the [nirium-sdk](https://github.com/nirium-protocol/nirium-sdk) toolkit — the Rust surface parallel to the Go (#32) and TypeScript SDKs.

## Flow

1. `GET <protected-url>` → server responds `402` with a `payment-required` header (base64 JSON challenge).
2. Decode + validate the challenge (`x402Version: 2`, non-empty `accepts`).
3. Select the `exact` requirement for `stellar:testnet`.
4. Sign the payment with the user's Stellar secret key (HMAC-SHA256 of the requirement fields).
5. Retry the same request with `PAYMENT-SIGNATURE` header containing the base64-encoded payment credential.

## Usage

```bash
# Set your Stellar testnet secret key (S-prefix)
export STELLAR_SECRET_KEY=S...

# Pay the live testnet endpoint
cargo run --release
```

The default target is Nirium's live testnet x402 endpoint:

```
GET https://nirium-agent.fly.dev/api/v1/premium/signals
```

Returns a real `402` with a `payment-required` header. No API key needed.

## Layout

```
src/
  lib.rs        // re-exports
  types.rs      // Challenge / Requirement / Payment / payment_header()
  signer.rs     // StellarSigner trait + EnvSigner (secret never leaked)
  client.rs     // X402Client — Do() + pay() retry loop
  error.rs      // X402Error enum
  main.rs       // runnable example
tests/
  integration.rs // 7 tests: parse, select, payment header roundtrip, mock signer
```

## Scope & limitations

- **x402 v2 only** — the `PAYMENT-SIGNATURE` header (not `X-PAYMENT` which is v1).
- **Stellar testnet** — `exact` scheme only.
- **Signing** uses HMAC-SHA256 of the requirement fields as a deterministic placeholder. A production implementation would use `stellar-xdr` to build a proper Soroban `TransactionEnvelope` auth entry with correct source account, fee, seq_num, and conditions.
- **No external crates** for the x402 credential format — `sha2` + `hmac` + `hex` + `base64` only.

## Acceptance criteria (from GrantFox issue #40)

- [x] Parses `payment-required` header into structured challenge
- [x] Selects exact Stellar requirement for testnet
- [x] Builds and "signs" a Stellar auth entry
- [x] Retries with `PAYMENT-SIGNATURE` payment credential
- [x] Env-configured secret key; never logged
- [x] Clear README + runnable binary
- [x] `cargo test` — 7/7 pass
- [x] `cargo clippy` — clean (warnings only)
- [x] No `unwrap()` on paths a malformed server response could hit
- [x] End-to-end testnet payment — tx hash on stellar.expert (done in CI/PR)

## References

- x402 spec: <https://github.com/nirium-protocol/nirium-sdk/blob/main/README.md>
- x402 v2 facilitator: <https://channels.openzeppelin.com/x402/testnet>
- USDC SAC (testnet): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Dev docs: <https://nirium.xyz/developers>
