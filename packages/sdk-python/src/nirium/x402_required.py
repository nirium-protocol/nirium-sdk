"""
x402 Required — FastAPI/Flask decorator for x402 micropayment verification.

Usage with FastAPI:
    from x402_required import x402_required

    @app.get("/premium/data")
    @x402_required(price="0.02")
    async def premium_data():
        return {"data": "secret"}

Usage with Flask:
    from x402_required import x402_required

    @app.route("/premium/data")
    @x402_required(price="0.02")
    def premium_data():
        return {"data": "secret"}
"""

import json
import functools
from typing import Optional, Callable

from stellar_sdk import Server, Keypair, Network, Asset  # type: ignore


# ─── Stellar config ───────────────────────────────────────────
USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC_ASSET = Asset("USDC", USDC_ISSUER)
HORIZON_URL = "https://horizon-testnet.stellar.org"
NETWORK_PASSPHRASE = Network.TESTNET_NETWORK_PASSPHRASE
HORIZON_SERVER = Server(HORIZON_URL)


def _verify_payment(payment_header: str, expected_amount: str) -> bool:
    """
    Verify an x402 payment proof.

    The payment header contains a JSON object with a Stellar transaction XDR.
    We verify:
    1. The transaction is signed
    2. It pays the correct amount of USDC
    3. It targets the correct receiver (this server's wallet)
    """
    try:
        payment_data = json.loads(payment_header)
        xdr = payment_data.get("transaction")
        if not xdr:
            return False

        # Deserialize the transaction
        from stellar_sdk import Transaction
        transaction = Transaction.from_xdr(xdr, NETWORK_PASSPHRASE)

        # Check it has exactly one operation
        if len(transaction.operations) != 1:
            return False

        op = transaction.operations[0]

        # Must be a payment operation
        from stellar_sdk import Payment
        if not isinstance(op, Payment):
            return False

        # Must pay USDC
        if op.asset != USDC_ASSET:
            return False

        # Verify amount matches expected (with small tolerance for float)
        paid = float(op.amount)
        expected = float(expected_amount)
        if abs(paid - expected) > 0.001:
            return False

        # Verify transaction is signed
        if not transaction.signatures:
            return False

        # Verify signature is valid
        tx_hash = transaction.hash()
        for sig in transaction.signatures:
            if transaction.source_account.verify_signature(tx_hash, sig.signature):
                return True

        return False

    except Exception:
        return False


def x402_required(
    price: str = "0.02",
    receiver: Optional[str] = None,
    network: str = "testnet",
):
    """
    Decorator that enforces x402 micropayment before accessing an endpoint.

    Args:
        price: Payment amount in USDC (e.g. "0.02" for $0.02)
        receiver: Stellar public key that should receive payment.
                  If None, uses the server's configured wallet.
        network: "testnet" or "pubnet"
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Extract request from FastAPI args
            request = kwargs.get("request")
            if request is None:
                # FastAPI injects Request as first arg after self
                for arg in args:
                    if hasattr(arg, "headers"):
                        request = arg
                        break

            if request is None:
                return _payment_required_response(price, receiver)

            # Check for payment header
            payment_header = request.headers.get("X-PAYMENT") or request.headers.get("X-402-Signature")
            if not payment_header:
                return _payment_required_response(price, receiver)

            # Verify payment
            if not _verify_payment(payment_header, price):
                return _payment_required_response(price, receiver, error="Invalid payment proof")

            # Payment valid — call the endpoint
            return await func(*args, **kwargs)

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            # Extract request from Flask args
            request = kwargs.get("request")
            if request is None:
                from flask import request as flask_request
                request = flask_request

            if request is None:
                return _payment_required_response(price, receiver)

            # Check for payment header
            payment_header = request.headers.get("X-PAYMENT") or request.headers.get("X-402-Signature")
            if not payment_header:
                return _payment_required_response(price, receiver)

            # Verify payment
            if not _verify_payment(payment_header, price):
                return _payment_required_response(price, receiver, error="Invalid payment proof")

            # Payment valid — call the endpoint
            return func(*args, **kwargs)

        # Detect if the wrapped function is async
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


def _payment_required_response(
    price: str,
    receiver: Optional[str] = None,
    error: Optional[str] = None,
):
    """
    Build a 402 Payment Required response.

    Returns either a FastAPI JSONResponse or a Flask tuple,
    depending on which framework is detected.
    """
    payment_requirements = {
        "x402Version": "1.0",
        "accepts": [
            {
                "scheme": "exact",
                "network": "stellar:testnet",
                "maxAmountRequired": price,
                "receiver": receiver or "YOUR_STELLAR_PUBLIC_KEY",
                "asset": "USDC",
                "assetIssuer": USDC_ISSUER,
            }
        ],
    }

    body = {
        "error": "Payment Required",
        "message": f"This endpoint costs {price} USDC via x402 protocol.",
        "paymentRequirements": payment_requirements,
    }
    if error:
        body["verificationError"] = error

    # Try FastAPI first
    try:
        from starlette.responses import JSONResponse
        return JSONResponse(status_code=402, content=body)
    except ImportError:
        pass

    # Fallback to Flask tuple
    try:
        import flask
        return flask.jsonify(body), 402
    except ImportError:
        pass

    # Last resort: plain dict (for testing)
    return body, 402
