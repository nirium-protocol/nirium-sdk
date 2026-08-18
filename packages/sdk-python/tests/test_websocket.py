import asyncio
import json
import pytest
import websockets
from nirium import Agent, WebSocketMaxRetriesExceeded, WebSocketStatus


@pytest.mark.asyncio
async def test_websocket_status_and_signal_events():
    """Test standard connection, receiving signals, and status events."""
    messages_sent = [
        {"type": "signal", "id": "sig-1", "pair": "XLM/USDC", "profit": 1.25},
        {"type": "signal", "id": "sig-2", "pair": "EURC/USDC", "profit": 0.85},
    ]

    async def mock_handler(websocket):
        for msg in messages_sent:
            await websocket.send(json.dumps(msg))
            await asyncio.sleep(0.01)
        # Keep connection open for a short time
        await asyncio.sleep(0.2)

    async with websockets.serve(mock_handler, "127.0.0.1", 18765):
        agent = Agent(api_url="http://127.0.0.1:18765")
        agent.ws_url = "ws://127.0.0.1:18765"

        received_signals = []
        status_transitions = []

        @agent.on("signal")
        def on_signal(sig):
            received_signals.append(sig)

        @agent.on("status")
        def on_status(st):
            status_transitions.append(st)

        # Run subscribe in background task
        sub_task = asyncio.create_task(agent.subscribe())
        await asyncio.sleep(0.1)

        await agent.close()
        try:
            await asyncio.wait_for(sub_task, timeout=0.5)
        except asyncio.TimeoutError:
            sub_task.cancel()

        assert len(received_signals) == 2
        assert received_signals[0]["id"] == "sig-1"
        assert received_signals[1]["id"] == "sig-2"
        assert WebSocketStatus.CONNECTING in status_transitions
        assert WebSocketStatus.CONNECTED in status_transitions
        assert WebSocketStatus.CLOSED in status_transitions


@pytest.mark.asyncio
async def test_websocket_deduplication():
    """Test that burst of duplicate signals after reconnect is properly filtered."""
    duplicate_burst = [
        {"type": "signal", "id": "sig-dup", "pair": "XLM/USDC"},
        {"type": "signal", "id": "sig-dup", "pair": "XLM/USDC"},
        {"type": "signal", "id": "sig-dup", "pair": "XLM/USDC"},
        {"type": "signal", "id": "sig-unique", "pair": "XLM/USDC"},
    ]

    async def mock_handler(websocket):
        for msg in duplicate_burst:
            await websocket.send(json.dumps(msg))
        await asyncio.sleep(0.2)

    async with websockets.serve(mock_handler, "127.0.0.1", 18766):
        agent = Agent(api_url="http://127.0.0.1:18766")
        agent.ws_url = "ws://127.0.0.1:18766"

        received_signals = []

        @agent.on("signal")
        def on_signal(sig):
            received_signals.append(sig)

        sub_task = asyncio.create_task(agent.subscribe())
        await asyncio.sleep(0.1)
        await agent.close()
        try:
            await asyncio.wait_for(sub_task, timeout=0.5)
        except asyncio.TimeoutError:
            sub_task.cancel()

        assert len(received_signals) == 2
        assert received_signals[0]["id"] == "sig-dup"
        assert received_signals[1]["id"] == "sig-unique"


@pytest.mark.asyncio
async def test_websocket_reconnection_and_error_channel():
    """Test that forced disconnect triggers reconnect and error events."""
    connection_attempts = 0

    async def mock_handler(websocket):
        nonlocal connection_attempts
        connection_attempts += 1
        if connection_attempts == 1:
            # Drop connection immediately
            await websocket.close(1001, "Simulated network failure")
        else:
            await websocket.send(json.dumps({"type": "signal", "id": "sig-recovered"}))
            await asyncio.sleep(0.2)

    async with websockets.serve(mock_handler, "127.0.0.1", 18767):
        agent = Agent(api_url="http://127.0.0.1:18767")
        agent.ws_url = "ws://127.0.0.1:18767"

        received_errors = []
        statuses = []
        signals = []

        @agent.on("error")
        def on_err(e):
            received_errors.append(e)

        @agent.on("status")
        def on_st(st):
            statuses.append(st)

        @agent.on("signal")
        def on_sig(s):
            signals.append(s)

        sub_task = asyncio.create_task(
            agent.subscribe(initial_delay=0.05, max_delay=0.1, max_retries=5)
        )
        await asyncio.sleep(0.3)
        await agent.close()

        try:
            await asyncio.wait_for(sub_task, timeout=0.5)
        except asyncio.TimeoutError:
            sub_task.cancel()

        assert connection_attempts >= 2
        assert len(received_errors) >= 1
        assert "attempt" in received_errors[0]
        assert WebSocketStatus.DISCONNECTED in statuses
        assert len(signals) == 1
        assert signals[0]["id"] == "sig-recovered"


@pytest.mark.asyncio
async def test_websocket_max_retries_exceeded():
    """Test that subscribe raises WebSocketMaxRetriesExceeded when target is unreachable."""
    agent = Agent(api_url="http://127.0.0.1:19999")  # Unreachable port
    agent.ws_url = "ws://127.0.0.1:19999"

    errors = []

    @agent.on("error")
    def on_err(e):
        errors.append(e)

    with pytest.raises(WebSocketMaxRetriesExceeded):
        await agent.subscribe(
            max_retries=3,
            initial_delay=0.05,
            max_delay=0.1,
            backoff_factor=1.5,
        )

    assert len(errors) == 3
    assert errors[-1]["attempt"] == 3


@pytest.mark.asyncio
async def test_legacy_subscribe_callback():
    """Test that the legacy subscribe(callback) parameter continues to function."""
    async def mock_handler(websocket):
        await websocket.send(json.dumps({"type": "signal", "id": "sig-legacy"}))
        await asyncio.sleep(0.1)

    async with websockets.serve(mock_handler, "127.0.0.1", 18768):
        agent = Agent(api_url="http://127.0.0.1:18768")
        agent.ws_url = "ws://127.0.0.1:18768"

        legacy_signals = []

        def legacy_cb(sig):
            legacy_signals.append(sig)

        sub_task = asyncio.create_task(agent.subscribe(callback=legacy_cb))
        await asyncio.sleep(0.15)
        await agent.close()
        try:
            await asyncio.wait_for(sub_task, timeout=0.5)
        except asyncio.TimeoutError:
            sub_task.cancel()

        assert len(legacy_signals) == 1
        assert legacy_signals[0]["id"] == "sig-legacy"
