# Go x402 client (Stellar testnet)

This small module implements the **x402 v2 HTTP negotiation**: it makes the
first request, decodes `payment-required`, selects `exact` on
`stellar:testnet`, and retries with `PAYMENT-SIGNATURE` (not the obsolete v1
`X-PAYMENT` header). The secret is read only from `STELLAR_SECRET_KEY` and is
never logged.

## Run checks

```bash
cd examples/go-x402
go test ./...
go vet ./...
```

## Using a signer

`Client` intentionally takes a `TransactionSigner`. This separates safe HTTP
retry logic from a deployment's Soroban RPC policy. Use `NewStellarSigner` to
validate the `S...` secret with the official `github.com/stellar/go` SDK, and
provide its `Build` callback with code that:

1. builds the USDC SAC `transfer` invocation for the requirement's `asset`,
   `payTo`, and integer `amount`;
2. simulates it against a testnet Soroban RPC endpoint;
3. signs the returned address-credential auth entry with the payer key; and
4. re-simulates after signing and returns the final base64 transaction XDR.

The payment requirements, rather than configuration, are authoritative for
amount and destination. The testnet USDC SAC is
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`; the usual
facilitator is `channels.openzeppelin.com/x402/testnet`.

Set `X402_URL` and `STELLAR_SECRET_KEY` only in your shell or secret manager;
do not place a secret in a source file or commit it. After a real payment,
record the returned/settled hash as
`https://stellar.expert/explorer/testnet/tx/<hash>`.
