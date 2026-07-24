"""FastAPI / Flask x402 decorator implementation.

Design goals:
- Single decorator works on FastAPI and Flask routes.
- Inspects `X-402-Signature` header and validates it through the
  nirium settlement service (x402 protocol, Stellar Mainnet/Testnet).
- Returns clean HTTP 402 Payment Required with structured payload when
  no valid signature is provided.
- Bounded: never opens bank rails, never issues credits, never mutates
  external state.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
from dataclasses import dataclass, asdict
from functools import wraps
from typing import Any, Callable, Optional

logger = logging.getLogger("nirium.fastapi_x402")


@dataclass
class X402Config:
    """Per-route x402 configuration."""
    price: str = "0.02"
    pay_to: str = ""
    currency: str = "USDC"
    network: str = "stellar-mainnet"
    settlement_url: str = "https://settlement.nirium.io/v1/verify"
    timeout_seconds: float = 8.0


@dataclass
class X402ValidationResult:
    """Result of signature validation."""
    valid: bool
    signature: Optional[str] = None
    payer: Optional[str] = None
    settlement_ref: Optional[str] = None
    reason: Optional[str] = None


def _verify_signature_sync(
    signature: str,
    config: X402Config,
    timeout: float,
) -> X402ValidationResult:
    """Synchronous verify fallback (no aiohttp available)."""
    # Bounded validation: signature must look like a base64-ish string.
    if not signature or len(signature) < 16:
        return X402ValidationResult(valid=False, reason="signature_missing_or_too_short")
    # Without network access, we cannot call settlement. Mark as
    # `pending_remote_verify` so callers can decide policy.
    return X402ValidationResult(
        valid=False,
        signature=signature,
        reason="pending_remote_verify_no_network",
    )


async def _verify_signature_async(
    signature: str,
    config: X402Config,
    timeout: float,
) -> X402ValidationResult:
    """Async verify via aiohttp if available, else fallback."""
    if not signature or len(signature) < 16:
        return X402ValidationResult(valid=False, reason="signature_missing_or_too_short")
    try:
        import aiohttp  # type: ignore
    except ImportError:
        return _verify_signature_sync(signature, config, timeout)

    payload = {
        "signature": signature,
        "price": config.price,
        "pay_to": config.pay_to,
        "currency": config.currency,
        "network": config.network,
    }
    try:
        timeout_obj = aiohttp.ClientTimeout(total=timeout)
        async with aiohttp.ClientSession(timeout=timeout_obj) as session:
            async with session.post(config.settlement_url, json=payload) as resp:
                if resp.status != 200:
                    return X402ValidationResult(
                        valid=False,
                        signature=signature,
                        reason=f"settlement_http_{resp.status}",
                    )
                data = await resp.json()
                return X402ValidationResult(
                    valid=bool(data.get("valid")),
                    signature=signature,
                    payer=data.get("payer"),
                    settlement_ref=data.get("settlement_ref"),
                    reason=data.get("reason"),
                )
    except asyncio.TimeoutError:
        return X402ValidationResult(valid=False, signature=signature, reason="settlement_timeout")
    except Exception as e:  # pragma: no cover
        logger.warning("x402 verify error: %s", e)
        return X402ValidationResult(valid=False, signature=signature, reason="settlement_unreachable")


def _build_402_response(config: X402Config, reason: str) -> dict[str, Any]:
    """Standard 402 Payment Required payload for FastAPI / Flask.

    Returns a dict shaped so the framework can either return it as a
    JSON body (Flask) or convert to a Response object with headers
    (FastAPI). The wrapper layers handle the framework-specific return
    format.
    """
    return {
        "status_code": 402,
        "headers": {
            "X-402-Price": config.price,
            "X-402-Currency": config.currency,
            "X-402-Network": config.network,
            "X-402-PayTo": config.pay_to,
            "X-402-Reason": reason,
            "WWW-Authenticate": f'X402 realm="nirium", price="{config.price}", currency="{config.currency}"',
        },
        "body": {
            "error": "payment_required",
            "price": config.price,
            "currency": config.currency,
            "network": config.network,
            "pay_to": config.pay_to,
            "reason": reason,
        },
    }


def _build_fastapi_402(payload: dict[str, Any]):
    """Convert a 402 payload to a FastAPI Response object."""
    try:
        from fastapi.responses import JSONResponse  # type: ignore
    except ImportError as e:
        raise RuntimeError("FastAPI is not installed; install fastapi to use async x402 routes") from e
    return JSONResponse(status_code=402, content=payload["body"], headers=payload["headers"])


def _build_flask_402(payload: dict[str, Any]):
    """Convert a 402 payload to a Flask (body, status, headers) tuple."""
    try:
        from flask import jsonify  # type: ignore
    except ImportError as e:
        raise RuntimeError("Flask is not installed; install flask to use sync x402 routes") from e
    response = jsonify(payload["body"])
    response.status_code = 402
    for k, v in payload["headers"].items():
        response.headers[k] = v
    return response


def x402_required(
    price: str = "0.02",
    pay_to: str = "",
    currency: str = "USDC",
    network: str = "stellar-mainnet",
    settlement_url: str = "https://settlement.nirium.io/v1/verify",
    timeout_seconds: float = 8.0,
) -> Callable:
    """Decorator factory: gate a FastAPI / Flask route behind an x402 payment."""
    config = X402Config(
        price=price,
        pay_to=pay_to,
        currency=currency,
        network=network,
        settlement_url=settlement_url,
        timeout_seconds=timeout_seconds,
    )

    def decorator(route_handler: Callable) -> Callable:
        # FastAPI path: async def route_handler(...)
        if inspect.iscoroutinefunction(route_handler):
            @wraps(route_handler)
            async def async_wrapper(*args: Any, **kwargs: Any):
                request = _extract_request(args, kwargs)
                if request is None:
                    # No request object found; pass through.
                    return await route_handler(*args, **kwargs)
                signature = _extract_signature(request)
                if not signature:
                    return _build_fastapi_402(_build_402_response(config, "missing_x402_signature"))
                result = await _verify_signature_async(signature, config, timeout_seconds)
                if not result.valid:
                    return _build_fastapi_402(_build_402_response(config, result.reason or "signature_invalid"))
                kwargs["x402_validation"] = result
                return await route_handler(*args, **kwargs)
            return async_wrapper

        # Flask path: sync def route_handler(...)
        @wraps(route_handler)
        def sync_wrapper(*args: Any, **kwargs: Any):
            request = _extract_request(args, kwargs)
            if request is None:
                return route_handler(*args, **kwargs)
            signature = _extract_signature(request)
            if not signature:
                return _build_flask_402(_build_402_response(config, "missing_x402_signature"))
            # For Flask sync context, fall back to sync verify.
            result = _verify_signature_sync(signature, config, timeout_seconds)
            if not result.valid:
                return _build_flask_402(_build_402_response(config, result.reason or "signature_invalid"))
            kwargs["x402_validation"] = result
            return route_handler(*args, **kwargs)
        return sync_wrapper

    return decorator


def _extract_request(args: tuple, kwargs: dict) -> Any:
    """Find the FastAPI / Flask Request object from args/kwargs."""
    # FastAPI injects Request via positional args (most common) OR kwarg.
    for a in args:
        cls_name = type(a).__name__
        if cls_name == "Request" and hasattr(a, "headers"):
            return a
    # Fallback: any kwarg that has headers.
    for v in kwargs.values():
        cls_name = type(v).__name__
        if cls_name == "Request" and hasattr(v, "headers"):
            return v
    return None


def _extract_signature(request: Any) -> str:
    """Pull X-402-Signature header from request."""
    try:
        sig = request.headers.get("X-402-Signature") or request.headers.get("x-402-signature")
        return sig.strip() if isinstance(sig, str) else ""
    except Exception:
        return ""