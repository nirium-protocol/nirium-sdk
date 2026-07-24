import base64, json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import bot

PAY_TO = "GABC123DEF456TESTSTELLARADDRESSNO_REAL_FUNDS_9XQ2"

def hdr(amount="0.02", pay_to=PAY_TO, network="stellar:testnet", sig="SIG"):
    return base64.b64encode(json.dumps({
        "x402Version": 1, "network": network,
        "settlement": {"payTo": pay_to, "amount": amount, "signature": sig},
    }).encode()).decode()

def test_no_payment_blocks():
    r = bot.handle_query("How do I cut my tooling costs by half?", None)
    assert r["status"] == 402
    assert "accepts" in r["challenge"]

def test_paid_answers():
    r = bot.handle_query("How do I cut my tooling costs by half?", hdr())
    assert r["status"] == 200
    assert "paid answer" in r["answer"]

def test_wrong_amount_blocks():
    r = bot.handle_query("x", hdr(amount="0.01"))
    assert r["status"] == 402

def test_wrong_network_blocks():
    r = bot.handle_query("x", hdr(network="stellar:mainnet"))
    assert r["status"] == 402

def test_challenge_shape():
    c = bot.build_challenge()
    assert c["x402Version"] == 1
    assert c["accepts"][0]["asset"] == "USDC"
