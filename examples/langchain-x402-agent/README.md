# LangChain x402 agent

Minimal LangChain agent that pays a real Nirium x402 endpoint on Stellar testnet through `NiriumX402Tool`.

The tool wraps `Agent.init_x402` / `Agent.x402_fetch`. It does not implement a second payment client. The credential header is `PAYMENT-SIGNATURE` (x402 v2).

## Setup

```bash
cd examples/langchain-x402-agent
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e "../../packages/sdk-python[langchain]"
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and set `STELLAR_SECRET_KEY` to a **funded testnet** secret. Use a throwaway account. Do not use a mainnet key.

Optional: set `OPENAI_API_KEY` to run the same loop with a real chat model. Without it, the example uses a scripted ReAct-style model that still goes through a standard LangChain agent executor and still pays the live endpoint.

## Run

```bash
python agent.py
```

Expected result: the agent calls `nirium_x402_fetch`, the SDK completes the 402 flow, and the protected JSON body is printed. If the facilitator returns a settlement hash, the script prints a `stellar.expert` testnet link.

## Verify the payment

1. Copy the printed `x402_settlement_tx` value, or look up the paid response / facilitator receipt.
2. Open `https://stellar.expert/explorer/testnet/tx/<TRANSACTION_HASH>`.
3. Confirm the destination and amount match the premium route (`/api/v1/premium/signals` is $0.02 USDC on the public Nirium testnet agent).

This example was paid end-to-end against the public Nirium testnet endpoint on 23 August 2026. Settlement hash:

[`40b8e24bb4335382d7834364347198db912151bc0826b0eae8b50ff52f2db040`](https://stellar.expert/explorer/testnet/tx/40b8e24bb4335382d7834364347198db912151bc0826b0eae8b50ff52f2db040)

## Security

- The Stellar secret is read from the environment or the tool constructor.
- It is never included in the tool name, description, or args schema.
- Errors returned to the model are redacted (seeds, `PAYMENT-SIGNATURE`, `secret_key=...`).
- Do not commit `.env`.
