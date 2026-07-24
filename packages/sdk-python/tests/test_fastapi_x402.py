"""Unit tests for nirium.fastapi_x402 decorator.

These tests use the FastAPI TestClient so the full middleware path is
exercised. They do not require a real settlement endpoint — the decorator
falls back to a bounded `pending_remote_verify_no_network` reason when
the settlement URL is unreachable, which is the desired behavior in
offline CI.
"""
import os
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from nirium.fastapi_x402 import x402_required, X402Config


@pytest.fixture
def app():
    app = FastAPI()

    @app.get("/premium")
    @x402_required(price="0.02", pay_to="GXXXX_STELLAR_ADDRESS", timeout_seconds=1.0)
    async def premium(request: Request, x402_validation=None):
        return {"ok": True, "validation": getattr(x402_validation, "valid", None)}

    @app.get("/free")
    async def free_endpoint():
        return {"ok": True}

    return app


def test_missing_signature_returns_402(app):
    client = TestClient(app)
    resp = client.get("/premium")
    assert resp.status_code == 402
    body = resp.json()
    assert body["error"] == "payment_required"
    assert body["price"] == "0.02"
    assert body["currency"] == "USDC"
    assert body["network"] == "stellar-mainnet"
    assert body["pay_to"] == "GXXXX_STELLAR_ADDRESS"
    assert resp.headers.get("X-402-Price") == "0.02"
    assert resp.headers.get("X-402-Currency") == "USDC"
    assert "X402" in resp.headers.get("WWW-Authenticate", "") or "X-402" in resp.headers.get("WWW-Authenticate", "")


def test_short_signature_returns_402(app):
    client = TestClient(app)
    resp = client.get("/premium", headers={"X-402-Signature": "short"})
    assert resp.status_code == 402
    assert resp.json()["reason"] in ("signature_missing_or_too_short", "pending_remote_verify_no_network")


def test_long_signature_runs_verify(app):
    client = TestClient(app)
    long_sig = "a" * 64
    resp = client.get("/premium", headers={"X-402-Signature": long_sig})
    # Without a real settlement endpoint, the bounded fallback returns 402.
    assert resp.status_code == 402
    body = resp.json()
    # Either we attempted network and got unreachable, or we skipped to a
    # bounded fallback. Both indicate the decorator correctly refused.
    assert body["reason"] in ("pending_remote_verify_no_network", "settlement_unreachable", "settlement_timeout")


def test_undecorated_route_works(app):
    client = TestClient(app)
    resp = client.get("/free")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_x402_config_dataclass_defaults():
    cfg = X402Config()
    assert cfg.price == "0.02"
    assert cfg.currency == "USDC"
    assert cfg.network == "stellar-mainnet"