import asyncio
from dataclasses import dataclass

import pytest
from fastapi import FastAPI, Request as FastAPIRequest
from fastapi.testclient import TestClient
from flask import Flask

from nirium import x402_required


@dataclass
class Request:
    headers: dict[str, str]


class Verifier:
    def __init__(self, result: bool) -> None:
        self.result = result
        self.calls: list[tuple[str, str, str]] = []

    async def verify_and_settle(self, signature: str, *, price: str, pay_to: str) -> bool:
        self.calls.append((signature, price, pay_to))
        return self.result


def test_missing_signature_returns_402() -> None:
    verifier = Verifier(True)

    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    async def endpoint(request: Request) -> dict[str, bool]:
        return {"ok": True}

    response = asyncio.run(endpoint(Request(headers={})))
    assert response == ({"error": "Payment Required"}, 402)
    assert verifier.calls == []


def test_invalid_signature_returns_402() -> None:
    verifier = Verifier(False)

    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    async def endpoint(request: Request) -> dict[str, bool]:
        return {"ok": True}

    response = asyncio.run(endpoint(Request(headers={"X-402-Signature": "invalid"})))
    assert response == ({"error": "Payment Required"}, 402)
    assert verifier.calls == [("invalid", "0.02", "GDESTINATION")]


def test_settled_signature_runs_fastapi_style_async_endpoint() -> None:
    verifier = Verifier(True)

    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    async def endpoint(request: Request) -> dict[str, bool]:
        return {"ok": True}

    response = asyncio.run(endpoint(request=Request(headers={"x-402-signature": "signed"})))
    assert response == {"ok": True}


def test_settled_signature_runs_flask_style_sync_endpoint() -> None:
    verifier = Verifier(True)

    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    def endpoint(request: Request) -> dict[str, bool]:
        return {"ok": True}

    assert endpoint(Request(headers={"X-402-Signature": "signed"})) == {"ok": True}


def test_fastapi_integration_returns_402_then_allows_settled_payment() -> None:
    verifier = Verifier(True)
    app = FastAPI()

    @app.get("/premium")
    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    async def premium(request: FastAPIRequest) -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/premium").status_code == 402
    paid = client.get("/premium", headers={"X-402-Signature": "signed"})
    assert paid.status_code == 200
    assert paid.json() == {"ok": True}


def test_flask_integration_returns_402_then_allows_settled_payment() -> None:
    verifier = Verifier(True)
    app = Flask(__name__)

    @app.get("/premium")
    @x402_required(price="0.02", pay_to="GDESTINATION", verifier=verifier)
    def premium() -> dict[str, bool]:
        return {"ok": True}

    client = app.test_client()
    assert client.get("/premium").status_code == 402
    paid = client.get("/premium", headers={"X-402-Signature": "signed"})
    assert paid.status_code == 200
    assert paid.get_json() == {"ok": True}


@pytest.mark.parametrize("price", ["0", "-1", "not-a-number"])
def test_invalid_price_is_rejected(price: str) -> None:
    with pytest.raises(ValueError):
        x402_required(price=price)
