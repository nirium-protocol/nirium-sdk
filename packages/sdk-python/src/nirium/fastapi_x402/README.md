# Nirium FastAPI / Flask x402 Decorator

A small, single-decorator gate for monetizing FastAPI or Flask routes via x402
micropayments on Stellar Mainnet / Testnet.

## Install

```bash
pip install nirium
```

Requires Python ≥ 3.10. FastAPI and Flask are optional install-time
extras (`pip install nirium[fastapi]` / `nirium[flask]`).

## Use

```python
from fastapi import FastAPI, Request
from nirium.fastapi_x402 import x402_required

app = FastAPI()

@app.get("/premium")
@x402_required(price="0.02", pay_to="GXXXX_STELLAR_ADDRESS")
async def premium(request: Request):
    return {"data": "paid-only content"}
```

Flask:

```python
from flask import Flask, request
from nirium.fastapi_x402 import x402_required

app = Flask(__name__)

@app.route("/premium")
@x402_required(price="0.02", pay_to="GXXXX_STELLAR_ADDRESS")
def premium():
    return {"data": "paid-only content"}
```

## Behavior

- Inspects `X-402-Signature` header on every call.
- When missing or invalid, returns HTTP 402 with a structured body and
  `X-402-Price`, `X-402-Currency`, `X-402-Network`, `X-402-PayTo`,
  `X-402-Reason` headers so the caller knows exactly what to pay.
- Validates the signature against the configured nirium settlement URL
  (default `https://settlement.nirium.io/v1/verify`).
- Bounded: never opens bank rails, never mutates external state. The
  decorator validates; it never spends on behalf of the caller.

## Tests

```bash
python -m pytest packages/sdk-python/tests/test_fastapi_x402.py -v
```

## License

MIT — see the repository `LICENSE` file.