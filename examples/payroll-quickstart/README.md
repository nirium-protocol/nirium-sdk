# Nirium payroll quickstart

This example runs one non-custodial payroll flow on Stellar testnet. It onboards one recipient with a sponsored USDC trustline, creates one payout run, signs the returned XDRs locally, submits both transactions, and prints the Stellar Expert links and IPFS receipt CID.

The recipient does not need to hold XLM to receive the first payment because the sponsor covers the trustline reserve. Nirium builds unsigned XDRs and never receives either private key. The sponsor key signs the onboarding transaction. The payer key signs the payout transaction. The recipient never signs a transaction.

## Requirements

Use Node.js 18 or newer. Use a Nirium testnet API key and two Stellar testnet secret keys. The sponsor and payer accounts need the testnet funds required by the onboarding and payout transactions. Use a fresh testnet recipient account for a first-run trustline demonstration.

The script rejects any network other than `stellar:testnet`. It never supports mainnet payroll.

## Configuration

Export the required values in your shell or load them through your preferred secret manager. Do not commit a `.env` file or paste secret keys into source code.

| Variable | Required | Description |
| --- | --- | --- |
| `NIRIUM_API_KEY` | Yes | Nirium API key for the testnet node. |
| `NIRIUM_BASE_URL` | Yes | Base URL for the Nirium testnet API. |
| `NIRIUM_NETWORK` | No | Must be `stellar:testnet`. Defaults to `stellar:testnet`. |
| `PAYER_SECRET_KEY` | Yes | Testnet secret key for signing the payout batch. |
| `SPONSOR_SECRET_KEY` | Yes | Testnet secret key for signing the sponsored trustline transaction. |
| `SPONSOR_PUBLIC_KEY` | No | Sponsor G-address. The script derives it from `SPONSOR_SECRET_KEY` when omitted. |
| `RECIPIENT_PUBLIC_KEY` | Yes | Testnet G-address receiving the payout. |
| `PAYOUT_AMOUNT` | No | Amount for the single recipient. Defaults to `1.00`. |
| `PAYOUT_ASSET` | No | Asset code. Defaults to `USDC`. |

## Run

Install the example dependencies and verify the TypeScript contract:

```bash
npm install
npm run build
```

Run the testnet flow:

```bash
export NIRIUM_NETWORK=stellar:testnet
export NIRIUM_API_KEY='nrm_testnet_key'
export NIRIUM_BASE_URL='https://your-testnet-nirium-node.example'
export PAYER_SECRET_KEY='SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
export SPONSOR_SECRET_KEY='SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
export RECIPIENT_PUBLIC_KEY='GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
export PAYOUT_AMOUNT='1.00'
export PAYOUT_ASSET='USDC'

npm start
```

The script performs these operations in order:

1. Calls `onboardPayoutRecipient()` with the recipient, asset, and sponsor address.
2. Signs the returned onboarding XDR with the sponsor key and calls `submitPayoutOnboard()`.
3. Calls `createPayoutRun()` with `acknowledgeTerms: true`.
4. Signs the returned payout XDR with the payer key and calls `submitPayout()`.
5. Calls `getPayoutRuns()` and selects the completed run.
6. Prints resolvable testnet Stellar Expert links for both transactions and the IPFS receipt CID.

The output has this shape:

```text
Onboarding transaction: https://stellar.expert/explorer/testnet/tx/<onboarding-hash>
Payout transaction: https://stellar.expert/explorer/testnet/tx/<payout-hash>
IPFS receipt CID: <receipt-cid>
```

For a pull request using this example, run the flow on testnet and include the two resulting Stellar Expert links and the receipt CID in the PR description. Do not include API keys, secret keys, or recipient personal data.

## Terms and scope

`acknowledgeTerms: true` is mandatory on both testnet and mainnet. This example deliberately supports testnet only. Mainnet payroll access is invite-only and is outside the example scope. Review the current payout terms with `agent.getPayoutTerms()` before adapting the example for an independent contractor, freelancer, or business-to-business payment.

The example does not build a UI, store keys, broadcast from the recipient, or support employee-salary workflows. Keep all secrets in the execution environment and rotate testnet keys after experimentation.
