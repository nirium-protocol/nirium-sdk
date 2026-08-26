"""LangChain-facing tests for NiriumX402Tool.

The underlying x402 client is mocked. These tests assert the tool schema, the
values returned to an agent, and that secret material never reaches the LLM.
"""

from __future__ import annotations

import json
from typing import Any, Optional

import pytest

from nirium.langchain_tools import (
    DEFAULT_TOOL_DESCRIPTION,
    DEFAULT_TOOL_NAME,
    NiriumX402Input,
    NiriumX402Tool,
    create_nirium_x402_tool,
    extract_settlement_tx,
    normalize_network,
    redact_secrets,
)

LEAKED_SECRET = "S" + "A" * 55


class FakeX402Agent:
    def __init__(self, payload: Optional[dict[str, Any]] = None, error: Optional[Exception] = None):
        self.payload = payload or {"ok": True, "signals": ["alpha"]}
        self.error = error
        self.calls: list[dict[str, Any]] = []
        self.last_x402_settlement: Optional[dict[str, Any]] = {
            "transaction": "abc123settlement"
        }

    async def x402_fetch(self, url: str, method: str = "GET", body: Any = None) -> dict[str, Any]:
        self.calls.append({"url": url, "method": method, "body": body})
        if self.error:
            raise self.error
        return {**self.payload, "url": url, "method": method, "echo": body}


def _public_text(tool: NiriumX402Tool) -> str:
    schema = tool.args_schema.model_json_schema()
    dumped = tool.model_dump() if hasattr(tool, "model_dump") else {}
    return " ".join(
        [
            tool.name,
            tool.description,
            repr(tool),
            json.dumps(schema, default=str),
            json.dumps(dumped, default=str),
            json.dumps(getattr(tool, "args", {}), default=str),
        ]
    )


def test_redact_secrets_strips_seed_and_payment_header() -> None:
    raw = (
        f"failed for {LEAKED_SECRET} with PAYMENT-SIGNATURE: abc.def "
        "and secret_key=super-secret"
    )
    cleaned = redact_secrets(raw)
    assert LEAKED_SECRET not in cleaned
    assert "abc.def" not in cleaned
    assert "super-secret" not in cleaned
    assert "[REDACTED]" in cleaned


def test_tool_name_description_and_schema() -> None:
    tool = NiriumX402Tool(agent=FakeX402Agent())
    assert tool.name == DEFAULT_TOOL_NAME
    assert tool.description == DEFAULT_TOOL_DESCRIPTION

    schema = NiriumX402Input.model_json_schema()
    assert schema["properties"]["url"]["type"] == "string"
    assert "url" in schema.get("required", [])
    assert set(schema["properties"]) == {"url", "method", "body"}
    assert tool.args_schema is NiriumX402Input


def test_schema_has_no_secret_fields() -> None:
    tool = NiriumX402Tool(agent=FakeX402Agent())
    public = _public_text(tool).lower()
    assert "secret" not in public
    assert "seed" not in public
    assert LEAKED_SECRET not in public
    assert "payment-signature" not in public


def test_invoke_returns_body_and_forwards_args() -> None:
    agent = FakeX402Agent(payload={"signals": ["beta"]})
    tool = create_nirium_x402_tool(agent=agent)

    result = tool.invoke(
        {
            "url": "https://nirium-agent.fly.dev/api/v1/premium/signals",
            "method": "POST",
            "body": '{"limit": 2}',
        }
    )

    assert isinstance(result, str)
    assert LEAKED_SECRET not in result
    assert "beta" in result
    assert "abc123settlement" in result
    assert agent.calls == [
        {
            "url": "https://nirium-agent.fly.dev/api/v1/premium/signals",
            "method": "POST",
            "body": {"limit": 2},
        }
    ]


@pytest.mark.asyncio
async def test_arun_returns_json_body() -> None:
    tool = NiriumX402Tool(agent=FakeX402Agent(payload={"market": {"xlm": 0.1}}))
    result = await tool._arun(url="https://example.test/premium")
    data, _, settlement = result.partition("\n\nx402_settlement_tx: ")
    payload = json.loads(data)
    assert payload["market"]["xlm"] == 0.1
    assert settlement == "abc123settlement"


def test_invoke_sanitizes_errors_for_the_llm() -> None:
    agent = FakeX402Agent(
        error=RuntimeError(
            f"x402 payment rejected for {LEAKED_SECRET} "
            "PAYMENT-SIGNATURE: header-value"
        )
    )
    tool = NiriumX402Tool(agent=agent)
    result = tool.invoke({"url": "https://example.test/premium"})
    assert isinstance(result, str)
    assert LEAKED_SECRET not in result
    assert "header-value" not in result
    assert "x402 request failed" in result
    assert "[REDACTED]" in result


def test_repr_and_model_dump_hide_client_and_secret() -> None:
    tool = NiriumX402Tool(agent=FakeX402Agent(), network="stellar:testnet")
    dumped = json.dumps(tool.model_dump(), default=str)
    assert LEAKED_SECRET not in dumped
    assert "_client" not in dumped
    assert "secret" not in dumped.lower()
    assert "NiriumX402Tool(name='nirium_x402_fetch'" in repr(tool)


def test_missing_secret_raises_safe_error(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "STELLAR_SECRET_KEY",
        "STELLAR_TESTNET_SECRET_KEY",
        "NIRIUM_STELLAR_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(ValueError, match="Stellar secret is required"):
        NiriumX402Tool()


def test_factory_returns_configured_tool() -> None:
    agent = FakeX402Agent()
    tool = create_nirium_x402_tool(agent=agent, network="stellar:testnet")
    assert isinstance(tool, NiriumX402Tool)
    assert tool.name == "nirium_x402_fetch"
    assert tool.last_settlement == {"transaction": "abc123settlement"}


def test_constructor_wraps_existing_x402_client(monkeypatch: pytest.MonkeyPatch) -> None:
    created: dict[str, Any] = {}

    class DummyAgent:
        def __init__(self, api_url: str = "") -> None:
            created["agent"] = self
            created["api_url"] = api_url
            self.inits: list[tuple[str, str, str]] = []

        def init_x402(self, secret_key: str, network: str = "stellar:testnet", rpc_url: str = "") -> None:
            self.inits.append((secret_key, network, rpc_url))

    monkeypatch.setattr("nirium.langchain_tools.Agent", DummyAgent)
    tool = NiriumX402Tool(secret_key=LEAKED_SECRET, network="testnet")
    assert created["agent"].inits == [(LEAKED_SECRET, "stellar:testnet", "")]
    assert LEAKED_SECRET not in _public_text(tool)
    assert "stellar:testnet" in repr(tool)


def test_invalid_url_is_sanitized_for_the_llm() -> None:
    tool = NiriumX402Tool(agent=FakeX402Agent())
    result = tool.invoke({"url": "not-a-url"})
    assert isinstance(result, str)
    assert "x402 request failed" in result
    assert "http(s) URL" in result


def test_extract_settlement_tx_reads_nested_payload() -> None:
    assert extract_settlement_tx({"settleResponse": {"transaction": "deadbeef"}}) == "deadbeef"
    assert normalize_network("testnet") == "stellar:testnet"
    assert normalize_network("mainnet") == "stellar:pubnet"
