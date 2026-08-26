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


@pytest.mark.asyncio
async def test_websocket_flapping_connection_triggers_max_retries():
    """Test that immediate connect-and-drop flapping without messages properly increments retry counter and raises."""
    connection_attempts = 0

    async def flapping_handler(websocket):
        nonlocal connection_attempts
        connection_attempts += 1
        # Accept connection and immediately drop before sending any message
        await websocket.close(1000, "Normal closure / dead backend drop")

    async with websockets.serve(flapping_handler, "127.0.0.1", 18769):
        agent = Agent(api_url="http://127.0.0.1:18769")
        agent.ws_url = "ws://127.0.0.1:18769"

        errors = []

        @agent.on("error")
        def on_err(e):
            errors.append(e)

        with pytest.raises(WebSocketMaxRetriesExceeded):
            await agent.subscribe(
                max_retries=3,
                initial_delay=0.01,
                max_delay=0.05,
                backoff_factor=1.5,
            )

        assert connection_attempts == 3
        assert len(errors) == 3
        assert errors[-1]["attempt"] == 3


@pytest.mark.asyncio
async def test_websocket_close_cancels_inflight_backoff_sleep():
    """Test that close() promptly cancels an in-flight backoff sleep rather than blocking for max_delay."""
    async def immediate_drop_handler(websocket):
        await websocket.close(1001, "Instant drop")

    async with websockets.serve(immediate_drop_handler, "127.0.0.1", 18771):
        agent = Agent(api_url="http://127.0.0.1:18771")
        agent.ws_url = "ws://127.0.0.1:18771"

        statuses = []

        @agent.on("status")
        def on_st(st):
            statuses.append(st)

        # Initial delay 30s (would hang if not cancelled)
        sub_task = asyncio.create_task(
            agent.subscribe(initial_delay=30.0, max_delay=30.0, max_retries=5)
        )

        # Wait for the first connection attempt to drop and enter backoff sleep
        await asyncio.sleep(0.1)
        assert WebSocketStatus.DISCONNECTED in statuses

        t0 = asyncio.get_event_loop().time()
        await agent.close()
        await asyncio.wait_for(sub_task, timeout=1.0)
        elapsed = asyncio.get_event_loop().time() - t0

        # Must finish in <0.5s instead of hanging for 30s
        assert elapsed < 0.5
        assert WebSocketStatus.CLOSED in statuses
        assert sub_task.done()


@pytest.mark.asyncio
async def test_websocket_non_signal_deduplication_isolation():
    """Test that non-signal events with identical IDs/payloads are not dropped by the signal dedup filter."""
    log_messages = [
        {"type": "log", "id": "log-entry-1", "message": "heartbeat ping"},
        {"type": "log", "id": "log-entry-1", "message": "heartbeat ping"},
        {"type": "log", "id": "log-entry-1", "message": "heartbeat ping"},
    ]

    async def mock_handler(websocket):
        for msg in log_messages:
            await websocket.send(json.dumps(msg))
        await asyncio.sleep(0.1)

    async with websockets.serve(mock_handler, "127.0.0.1", 18770):
        agent = Agent(api_url="http://127.0.0.1:18770")
        agent.ws_url = "ws://127.0.0.1:18770"

        received_logs = []

        @agent.on("log")
        def on_log(log_item):
            received_logs.append(log_item)

        sub_task = asyncio.create_task(agent.subscribe())
        await asyncio.sleep(0.15)
        await agent.close()
        try:
            await asyncio.wait_for(sub_task, timeout=0.5)
        except asyncio.TimeoutError:
            sub_task.cancel()

        # All 3 non-signal messages should be received
        assert len(received_logs) == 3

