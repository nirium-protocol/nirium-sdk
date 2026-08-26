"""Minimal LangChain agent that pays a real Nirium x402 testnet endpoint.

The default path uses a scripted ReAct-style chat model so the example can
prove the tool works inside a standard LangChain agent loop without spending
an LLM call. Set OPENAI_API_KEY to swap in a real model.

The Stellar secret is read from the environment and never printed.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, HumanMessage

from nirium import NiriumX402Tool
from nirium.langchain_tools import extract_settlement_tx
from nirium.langchain_tools import extract_settlement_tx

DEFAULT_URL = "https://nirium-agent.fly.dev/api/v1/premium/signals"


def _load_tool() -> NiriumX402Tool:
    load_dotenv()
    if not (
        os.getenv("STELLAR_SECRET_KEY")
        or os.getenv("STELLAR_TESTNET_SECRET_KEY")
        or os.getenv("NIRIUM_STELLAR_SECRET")
    ):
        raise SystemExit(
            "Set STELLAR_SECRET_KEY to a funded Stellar testnet secret before running."
        )
    return NiriumX402Tool(network=os.getenv("NIRIUM_X402_NETWORK") or "stellar:testnet")


def _premium_url() -> str:
    return os.getenv("NIRIUM_PREMIUM_URL") or DEFAULT_URL


def _scripted_model(url: str):
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel

    class ScriptedToolModel(FakeMessagesListChatModel):
        """Minimal chat model that still binds tools for create_agent."""

        def bind_tools(self, tools, **kwargs):  # noqa: ARG002
            return self

    return ScriptedToolModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "nirium_x402_fetch",
                        "args": {"url": url, "method": "GET"},
                        "id": "call_nirium_x402_1",
                    }
                ],
            ),
            AIMessage(
                content=(
                    "Paid the Nirium x402 testnet endpoint and received the "
                    "protected response body."
                )
            ),
        ]
    )


def _live_model():
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(model=os.getenv("OPENAI_MODEL") or "gpt-4o-mini", temperature=0)


def _run_tool_loop(model: Any, tool: NiriumX402Tool, prompt: str) -> dict[str, Any]:
    """Fallback ReAct-style tool loop if create_agent is unavailable."""
    from langchain_core.messages import ToolMessage

    messages: list[Any] = [HumanMessage(content=prompt)]
    for _ in range(6):
        ai = model.invoke(messages)
        messages.append(ai)
        calls = getattr(ai, "tool_calls", None) or []
        if not calls:
            return {"messages": messages}
        for call in calls:
            content = tool.invoke(call.get("args") or {})
            messages.append(
                ToolMessage(content=str(content), tool_call_id=call.get("id", "call"))
            )
    return {"messages": messages}


def _build_agent(model: Any, tool: NiriumX402Tool):
    try:
        from langchain.agents import create_agent

        return create_agent(model=model, tools=[tool])
    except ImportError:
        try:
            from langgraph.prebuilt import create_react_agent

            return create_react_agent(model, [tool])
        except ImportError:
            return None


def _print_safe_result(result: Any, tool: NiriumX402Tool) -> None:
    messages = result.get("messages") if isinstance(result, dict) else None
    if messages:
        last = messages[-1]
        content = getattr(last, "content", last)
        print(content)
        for message in messages:
            name = getattr(message, "name", None)
            if name == tool.name:
                print("\n--- tool result ---")
                print(getattr(message, "content", message))
    else:
        print(result)

    settlement = tool.last_settlement
    if settlement:
        print("\n--- x402 settlement ---")
        print(json.dumps(settlement, default=str, indent=2))
        tx_hash = extract_settlement_tx(settlement)
        if tx_hash:
            print(
                f"\nstellar.expert: https://stellar.expert/explorer/testnet/tx/{tx_hash}"
            )


def main() -> int:
    tool = _load_tool()
    url = _premium_url()
    model = _live_model() if os.getenv("OPENAI_API_KEY") else _scripted_model(url)
    prompt = (
        "Call the Nirium x402 tool and fetch the protected resource at "
        f"{url}. Summarize the paid response."
    )
    agent = _build_agent(model, tool)
    if agent is None:
        result = _run_tool_loop(model, tool, prompt)
    else:
        result = agent.invoke({"messages": [HumanMessage(content=prompt)]})
    _print_safe_result(result, tool)
    return 0


if __name__ == "__main__":
    sys.exit(main())
