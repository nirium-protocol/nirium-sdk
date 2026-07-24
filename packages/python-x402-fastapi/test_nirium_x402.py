import base64
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__) + "/..")

from nirium_x402 import x402_required, verify_settlement, X402_HEADER, X402_VERSION

PAY_TO = "GABC123DEF456TESTSTELLARADDRESSNO_REAL_FUNDS_9XQ2"
OPTS = dict(price="0.02", pay_to=PAY_TO, network="stellar:testnet")


def make_header(amount="0.02", pay_to=PAY_TO, network="stellar:testnet", sig="SIG"):
    payload = base64.b64encode(json.dumps({
        "x402Version": X402_VERSION, "network": network,
        "settlement": {"payTo": pay_to, "amount": amount, "signature": sig},
    }).encode()).decode()
    return payload


class FakeReq:
    def __init__(self, header=None):
        self.headers = {X402_HEADER: header} if header else {}


def test_verify_missing_header():
    ok, reason = verify_settlement(None, **OPTS)
    assert ok is False
    assert "missing" in reason


def test_verify_valid():
    ok, reason = verify_settlement(make_header(), **OPTS)
    assert ok is True


def test_verify_wrong_amount():
    ok, _ = verify_settlement(make_header(amount="0.01"), **OPTS)
    assert ok is False


def test_verify_wrong_recipient():
    ok, _ = verify_settlement(make_header(pay_to="GOTHER"), **OPTS)
    assert ok is False


def test_decorator_blocks_without_payment():
    @x402_required(**OPTS)
    def handler(request):
        return {"ok": True}
    result = handler(FakeReq())
    # Flask make_response path not available -> returns (dict, 402)
    status = result[1] if isinstance(result, tuple) else 200
    assert status == 402


def test_decorator_allows_with_payment():
    @x402_required(**OPTS)
    def handler(request):
        return {"ok": True}
    result = handler(FakeReq(make_header()))
    assert result == {"ok": True}
