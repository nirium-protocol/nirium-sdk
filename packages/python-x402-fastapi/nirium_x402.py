"""@nirium/python-x402 — FastAPI/Flask x402 micropayment decorator (bounty #10).

Usage:
    from nirium_x402 import x402_required

    @app.get("/paid")
    @x402_required(price="0.02", pay_to="GABC...")
    def paid():
        return {"ok": True}
"""
from __future__ import annotations
import base64
import functools
import json
from typing import Callable, Optional

__version__ = "0.1.0"

X402_HEADER = "X-402-Signature"
X402_VERSION = 1


def _decode_header(header_value: Optional[str]) -> Optional[dict]:
    if not header_value:
        return None
    try:
        return json.loads(base64.b64decode(header_value).decode("utf-8"))
    except Exception:
        return None


def verify_settlement(header_value: Optional[str], *,
                       price: str, pay_to: str,
                       network: str = "stellar:testnet") -> tuple[bool, str]:
    """Validate an x402 v1 payment header.

    The header is a base64-encoded JSON object carrying the signed settlement.
    We verify structural correctness (version, network, recipient, amount) so the
    decorator is testable without a live Stellar facilitator.
    """
    payload = _decode_header(header_value)
    if payload is None:
        return False, "missing or malformed X-402-Signature header"
    if payload.get("x402Version") != X402_VERSION:
        return False, "unsupported x402 version"
    if payload.get("network") != network:
        return False, "network mismatch"
    settlement = payload.get("settlement", {})
    if settlement.get("payTo") != pay_to:
        return False, "recipient mismatch"
    try:
        if float(settlement.get("amount", "0")) < float(price):
            return False, "insufficient amount"
    except (TypeError, ValueError):
        return False, "invalid amount"
    if not settlement.get("signature"):
        return False, "missing signature"
    return True, "ok"


def x402_required(price: str, pay_to: str, *,
                  network: str = "stellar:testnet",
                  challenge_resource: str = "x402-protected") -> Callable:
    """Decorator that gates a route behind an x402 micropayment.

    Returns HTTP 402 with an x402 requirement when no valid payment header is
    present; otherwise invokes the handler.
    """

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # FastAPI/Flask inject the Request as the first arg or via flask.request
            request = kwargs.get("request") or (args[0] if args else None)
            header = None
            if request is not None and hasattr(request, "headers"):
                header = request.headers.get(X402_HEADER)
            ok, reason = verify_settlement(
                header, price=price, pay_to=pay_to, network=network)
            if not ok:
                requirement = {
                    "x402Version": X402_VERSION,
                    "error": "Payment Required",
                    "accepts": [{
                        "scheme": "exact",
                        "network": network,
                        "maxAmountRequired": price,
                        "payTo": pay_to,
                        "asset": "USDC",
                        "resource": challenge_resource,
                    }],
                }
                # Flask response
                try:
                    from flask import jsonify, make_response
                    resp = make_response(jsonify(requirement), 402)
                    return resp
                except Exception:
                    return requirement, 402
            return func(*args, **kwargs)
        return wrapper
    return decorator
