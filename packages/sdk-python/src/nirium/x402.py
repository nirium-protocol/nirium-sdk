"""Framework adapters for protecting Python routes with x402 payments."""

from __future__ import annotations

import asyncio
import inspect
import os
from functools import wraps
from typing import Any, Callable, Mapping, Optional, Protocol, TypeVar, cast

import aiohttp

F = TypeVar("F", bound=Callable[..., Any])


class PaymentVerifier(Protocol):
    """A verifier that confirms and settles an x402 payment signature."""

    async def verify_and_settle(self, signature: str, *, price: str, pay_to: str) -> bool:
        """Return true only after the facilitator verifies and settles payment."""


class FacilitatorVerifier:
    """Verify and settle x402 signatures through an HTTP facilitator."""

    def __init__(self, url: str = "https://facilitator.x402.org") -> None:
        self.url = url.rstrip("/")

    async def verify_and_settle(self, signature: str, *, price: str, pay_to: str) -> bool:
        payload = {
            "paymentPayload": signature,
            "paymentRequirements": {
                "scheme": "exact",
                "price": price,
                "network": "stellar:testnet",
                "payTo": pay_to,
            },
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self.url}/verify", json=payload) as response:
                if response.status != 200 or not (await response.json()).get("isValid", False):
                    return False
            async with session.post(f"{self.url}/settle", json=payload) as response:
                if response.status != 200:
                    return False
                result = await response.json()
                return bool(result.get("success") or result.get("transaction"))


def _request_from_call(args: tuple[Any, ...], kwargs: Mapping[str, Any]) -> Any:
    request = kwargs.get("request")
    if request is not None:
        return request
    for value in args:
        if hasattr(value, "headers"):
            return value
    try:
        from flask import request as flask_request

        return flask_request
    except (ImportError, RuntimeError):
        return None


def _signature(request: Any) -> Optional[str]:
    if request is None:
        return None
    headers = getattr(request, "headers", {})
    return headers.get("X-402-Signature") or headers.get("x-402-signature")


def _payment_required(request: Any) -> Any:
    payload = {"error": "Payment Required"}
    module = request.__class__.__module__ if request is not None else ""
    if module.startswith(("fastapi", "starlette")):
        from starlette.responses import JSONResponse

        return JSONResponse(payload, status_code=402)
    try:
        from flask import jsonify

        return jsonify(payload), 402
    except (ImportError, RuntimeError):
        return payload, 402


def x402_required(
    *,
    price: str,
    pay_to: Optional[str] = None,
    verifier: Optional[PaymentVerifier] = None,
) -> Callable[[F], F]:
    """Require a settled x402 payment before running a FastAPI or Flask route.

    ``pay_to`` defaults to ``NIRIUM_X402_PAY_TO`` so the concise
    ``@x402_required(price="0.02")`` form can keep payout configuration out of
    application source code.
    """

    try:
        numeric_price = float(price)
    except (TypeError, ValueError) as error:
        raise ValueError("price must be a positive decimal string") from error
    if numeric_price <= 0:
        raise ValueError("price must be a positive decimal string")

    settlement_address = pay_to or os.getenv("NIRIUM_X402_PAY_TO", "")
    payment_verifier = verifier or FacilitatorVerifier()

    def decorator(func: F) -> F:
        async def authorize(args: tuple[Any, ...], kwargs: Mapping[str, Any]) -> tuple[bool, Any]:
            request = _request_from_call(args, kwargs)
            signature = _signature(request)
            if not signature or not settlement_address:
                return False, request
            valid = await payment_verifier.verify_and_settle(
                signature,
                price=price,
                pay_to=settlement_address,
            )
            return valid, request

        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                valid, request = await authorize(args, kwargs)
                if not valid:
                    return _payment_required(request)
                return await func(*args, **kwargs)

            return cast(F, async_wrapper)

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            valid, request = asyncio.run(authorize(args, kwargs))
            if not valid:
                return _payment_required(request)
            return func(*args, **kwargs)

        return cast(F, sync_wrapper)

    return decorator
