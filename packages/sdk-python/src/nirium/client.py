# ═══════════════════════════════════════════════════════════════
# Nirium Python SDK v0.6.1 — Official Client (x402 + MPP)
# Synced with backend API (real Horizon data, Soroban execution)
# ═══════════════════════════════════════════════════════════════
import asyncio
import json
import logging
import aiohttp  # type: ignore
import websockets  # type: ignore
from typing import Callable, Dict, Any, List, Optional
from stellar_sdk import Keypair, Network, Server, TransactionBuilder, Asset  # type: ignore

logger = logging.getLogger("nirium.client")


class Agent:
    """
    Nirium Agent — Full API + WebSocket client for the Nirium autonomous agent.

    Usage:
        agent = Agent(api_url="http://localhost:3001", api_key="nrm_your_key")
        market = await agent.get_market()
        print(f"XLM Price: ${market['xlmPrice']:.4f}")
    """

    def __init__(self, api_url: str = "http://localhost:3001", api_key: Optional[str] = None, token: Optional[str] = None):
        self.api_url = api_url.rstrip('/')
        self.ws_url = self.api_url.replace("http", "ws") + "/ws/signals"
        self.api_key = api_key
        self.token = token

        api_key_local = self.api_key
        token_local = self.token

        self.headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key_local is not None:
            self.headers["x-api-key"] = api_key_local
        elif token_local is not None:
            self.headers["Authorization"] = f"Bearer {token_local}"

        self.callbacks: Dict[str, List[Callable]] = {"signal": [], "log": [], "connected": []}

    # ─── Decorators ────────────────────────────────────────────

    def on(self, event_type: str):
        """Decorator to register event callbacks."""
        def decorator(func: Callable):
            if event_type not in self.callbacks:
                self.callbacks[event_type] = []
            self.callbacks[event_type].append(func)
            return func
        return decorator

    async def _emit(self, event_type: str, data: Any):
        for callback in self.callbacks.get(event_type, []):
            if asyncio.iscoroutinefunction(callback):
                await callback(data)
            else:
                callback(data)

    # ─── HTTP Helpers ─────────────────────────────────────────

    async def _get(self, path: str, extra_headers: Optional[Dict[str, str]] = None) -> Any:
        headers = {**self.headers, **(extra_headers or {})}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(f"{self.api_url}{path}") as resp:
                resp.raise_for_status()
                return await resp.json()

    async def _post(self, path: str, payload: Optional[Dict[str, Any]] = None, extra_headers: Optional[Dict[str, str]] = None) -> Any:
        headers = {**self.headers, **(extra_headers or {})}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.post(f"{self.api_url}{path}", json=payload or {}) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def _delete(self, path: str) -> Any:
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.delete(f"{self.api_url}{path}") as resp:
                resp.raise_for_status()
                return await resp.json()

    # ─── Health ───────────────────────────────────────────────

    async def ping(self) -> bool:
        """Check if the agent is reachable."""
        try:
            data = await self._get("/health")
            return data.get("status") in ("operational", "online")
        except Exception:
            return False

    async def health(self) -> Dict[str, Any]:
        """Get detailed health info."""
        return await self._get("/health")

    async def system_health(self) -> Dict[str, Any]:
        """Get full system health (Horizon, Soroban, WebSocket, IPFS, LLM)."""
        return await self._get("/api/system/health")

    # ─── Market Data ─────────────────────────────────────────

    async def get_tickers(self) -> Dict[str, Any]:
        """Get asset price tickers (XLM, USDC) from Stellar Horizon."""
        return await self._get("/api/tickers")

    async def get_market(self) -> Dict[str, Any]:
        """Fetch real market state from Horizon (XLM price, SDEX spread, fees, paths)."""
        return await self._get("/api/market")

    async def get_stats(self) -> Dict[str, Any]:
        """Get global protocol statistics."""
        return await self._get("/api/stats/global")

    async def get_loop_status(self) -> Dict[str, Any]:
        """Get autonomous loop status."""
        return await self._get("/api/loop/status")

    async def start_loop(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Start the autonomous scanning loop."""
        return await self._post("/api/loop/start", {"config": config or {}})

    async def stop_loop(self) -> Dict[str, Any]:
        """Stop the autonomous scanning loop."""
        return await self._post("/api/loop/stop")

    async def trigger_scan(self) -> Dict[str, Any]:
        """Trigger a manual market scan."""
        return await self._post("/api/loop/scan")

    # ─── Execution ───────────────────────────────────────────

    async def execute(
        self,
        strategy: str,
        asset: str,
        params: Optional[Dict[str, Any]] = None,
        stellar_account: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a strategy via real Soroban contract transaction on Stellar.

        Strategies: flash-loan-arb, path-arbitrage, cross-dex, blend-yield, soroswap-swap

        Args:
            strategy: Strategy name (maps to a NiriumVault contract function)
            asset: Base asset symbol (e.g. 'XLM')
            params: Optional dict — supports 'amount' in stroops (default 1000)
            stellar_account: Your Stellar wallet address. Required for legal consent verification.
        """
        extra: Dict[str, str] = {}
        if stellar_account:
            extra["x-stellar-account"] = stellar_account
        payload: Dict[str, Any] = {"strategy": strategy, "asset": asset}
        if params:
            payload.update(params)
        return await self._post("/api/execute", payload, extra_headers=extra)

    async def execute_demo(self, strategy: str, asset: str) -> Dict[str, Any]:
        """Execute a strategy in demo mode (Soroban dry-run, no TX submitted).

        Returns a professional market assessment message.
        Response keys: success, simulated_profit, gas_consumed, message
        """
        return await self._post("/api/execute-demo", {
            "strategy": strategy,
            "asset": asset,
        })

    # ─── Signals ─────────────────────────────────────────────

    async def get_recent_signals(self, count: int = 20) -> Any:
        """Get recent market signals."""
        return await self._get(f"/api/signals/recent?count={count}")

    async def create_subscription(self, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a signal subscription with optional filters."""
        return await self._post("/api/subscriptions", {"filters": filters or {}})

    async def get_subscriptions(self) -> Dict[str, Any]:
        """List all active subscriptions for the current user."""
        return await self._get("/api/subscriptions")

    async def delete_subscription(self, subscription_id: str) -> Dict[str, Any]:
        """Delete a subscription by ID."""
        return await self._delete(f"/api/subscriptions/{subscription_id}")

    async def get_subscription_stats(self) -> Dict[str, Any]:
        """Get subscription stats (total, connected clients, recent signals)."""
        return await self._get("/api/subscriptions/stats")

    async def get_strategies(self) -> Dict[str, Any]:
        """List available strategies from loaded skills."""
        return await self._get("/api/strategies")

    # ─── Skills ──────────────────────────────────────────────

    async def get_skills(self) -> Any:
        """List all loaded skills (built-in + user-installed)."""
        return await self._get("/api/skills")

    async def install_skill(self, source: str) -> Dict[str, Any]:
        """Install a skill by slug."""
        return await self._post("/api/skills/install", {"source": source})

    async def uninstall_skill(self, slug: str) -> Dict[str, Any]:
        """Uninstall a user-installed skill by slug."""
        return await self._delete(f"/api/skills/{slug}")

    async def get_skill_marketplace(self) -> Dict[str, Any]:
        """List skills available in the marketplace."""
        return await self._get("/api/skills/marketplace")

    async def execute_skill_action(
        self,
        slug: str,
        action: str,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute a custom action on an installed skill."""
        return await self._post(f"/api/skills/{slug}/actions/{action}", {"params": params or {}, "context": context or {}})

    # ─── Auth Management ─────────────────────────────────────

    async def get_auth_token(self, wallet_address: str) -> Dict[str, Any]:
        """Get a JWT token for a Stellar wallet address."""
        return await self._post("/api/auth/token", {"walletAddress": wallet_address})

    async def create_auth_key(self, name: str, tier: Optional[str] = None) -> Dict[str, Any]:
        """Create a new API key. Requires auth."""
        payload: Dict[str, Any] = {"name": name}
        if tier:
            payload["tier"] = tier
        return await self._post("/api/auth/keys", payload)

    async def get_auth_keys(self) -> Dict[str, Any]:
        """List API keys for the current user. Requires auth."""
        return await self._get("/api/auth/keys")

    async def revoke_auth_key(self, key_id: str) -> Dict[str, Any]:
        """Revoke an API key by ID. Requires auth."""
        return await self._delete(f"/api/auth/keys/{key_id}")

    # ─── Revenue & Info ──────────────────────────────────────

    async def get_revenue(self) -> Dict[str, Any]:
        """Get x402/MPP revenue stats and payment feed."""
        return await self._get("/api/revenue")

    async def get_info(self) -> Dict[str, Any]:
        """Get protocol info (endpoints, LLM provider, version)."""
        return await self._get("/api/info")

    # ─── Admin ───────────────────────────────────────────────

    async def configure_llm(
        self,
        provider: str,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        ollama_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update the active LLM provider (admin only)."""
        payload: Dict[str, Any] = {"provider": provider}
        if model:
            payload["model"] = model
        if api_key:
            payload["apiKey"] = api_key
        if ollama_url:
            payload["ollamaUrl"] = ollama_url
        return await self._post("/api/config/llm", payload)

    # ─── Webhooks ────────────────────────────────────────────

    async def register_webhook(self, url: str, events: List[str], secret: Optional[str] = None) -> Dict[str, Any]:
        """Register a webhook endpoint with HMAC signing."""
        return await self._post("/api/webhooks", {"url": url, "events": events, "secret": secret})

    async def get_webhooks(self) -> List[Dict[str, Any]]:
        """List all registered webhooks."""
        return await self._get("/api/webhooks")

    async def delete_webhook(self, webhook_id: str) -> Dict[str, Any]:
        """Delete a webhook by ID."""
        return await self._delete(f"/api/webhooks/{webhook_id}")

    async def test_webhook(self, webhook_id: str) -> Dict[str, Any]:
        """Send a test event to a webhook."""
        return await self._post(f"/api/webhooks/{webhook_id}/test")

    # ─── x402 Protocol ───────────────────────────────────────

    def init_x402(self, secret_key: str, network: str = "stellar:testnet"):
        """
        Initialize x402 pay-per-request client.

        Python SDK implements the x402 HTTP flow directly:
        1. GET resource -> receive 402 + payment requirements
        2. Build Soroban SAC USDC transfer auth entry
        3. Retry with X-PAYMENT header containing signed auth entry

        Args:
            secret_key: Stellar secret key (S...) for signing
            network: CAIP-2 network ID ('stellar:testnet' or 'stellar:pubnet')
        """
        self._x402_keypair = Keypair.from_secret(secret_key)
        self._x402_network = network
        self._x402_passphrase = (
            Network.TESTNET_NETWORK_PASSPHRASE if "testnet" in network
            else Network.PUBLIC_NETWORK_PASSPHRASE
        )
        self._x402_horizon = Server(
            "https://horizon-testnet.stellar.org" if "testnet" in network
            else "https://horizon.stellar.org"
        )

    async def x402_fetch(self, url: str, method: str = "GET") -> Dict[str, Any]:
        """
        Fetch a paid resource via x402 protocol.

        Sends the initial request, receives 402 with payment requirements,
        builds and signs a USDC payment, retries with the payment proof.

        Returns the JSON payload from the paid resource.
        """
        if not hasattr(self, "_x402_keypair"):
            raise RuntimeError("x402 client not initialized. Call agent.init_x402() first.")

        async with aiohttp.ClientSession() as session:
            # Step 1: Initial request — expect 402
            async with session.request(method, url) as resp:
                if resp.status != 402:
                    return await resp.json()

                requirements = await resp.json()

            # Step 2: Build USDC payment from requirements
            pay_req = requirements.get("paymentRequirements", [{}])[0]
            dest = pay_req.get("receiver") or pay_req.get("destination", "")
            amount = pay_req.get("maxAmountRequired") or pay_req.get("amount", "0.01")
            usdc_issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
            usdc_asset = Asset("USDC", usdc_issuer)

            account = self._x402_horizon.load_account(self._x402_keypair.public_key)
            tx = (
                TransactionBuilder(
                    source_account=account,
                    network_passphrase=self._x402_passphrase,
                    base_fee=100,
                )
                .append_payment_op(dest, usdc_asset, str(amount))
                .set_timeout(30)
                .build()
            )
            tx.sign(self._x402_keypair)
            xdr = tx.to_xdr()

            # Step 3: Retry with payment proof
            payment_header = json.dumps({"transaction": xdr})
            headers = {"X-PAYMENT": payment_header, "Content-Type": "application/json"}
            async with session.request(method, url, headers=headers) as resp:
                resp.raise_for_status()
                return await resp.json()

    # ─── MPP Protocol (Charge Mode) ─────────────────────────

    def init_mpp(self, secret_key: str, network: str = "stellar:testnet"):
        """
        Initialize MPP Charge client for per-request Soroban SAC payments.

        Python SDK implements the MPP charge flow directly:
        1. GET resource -> receive 402 + charge challenge
        2. Sign Soroban auth entries for SAC USDC transfer
        3. Retry with signed auth in X-PAYMENT header

        Args:
            secret_key: Stellar secret key (S...) for signing
            network: CAIP-2 network ID ('stellar:testnet' or 'stellar:pubnet')
        """
        self._mpp_keypair = Keypair.from_secret(secret_key)
        self._mpp_network = network
        self._mpp_passphrase = (
            Network.TESTNET_NETWORK_PASSPHRASE if "testnet" in network
            else Network.PUBLIC_NETWORK_PASSPHRASE
        )
        self._mpp_horizon = Server(
            "https://horizon-testnet.stellar.org" if "testnet" in network
            else "https://horizon.stellar.org"
        )

    async def mpp_fetch(self, url: str, method: str = "GET") -> Dict[str, Any]:
        """
        Fetch a paid resource via MPP Charge protocol.

        Sends the initial request, receives 402 with charge challenge,
        builds and signs a USDC payment, retries with payment proof.
        In pull mode, the server assembles and broadcasts the Soroban tx.

        Returns the JSON payload from the paid resource.
        """
        if not hasattr(self, "_mpp_keypair"):
            raise RuntimeError("MPP client not initialized. Call agent.init_mpp() first.")

        async with aiohttp.ClientSession() as session:
            # Step 1: Initial request — expect 402
            async with session.request(method, url) as resp:
                if resp.status != 402:
                    return await resp.json()

                challenge = await resp.json()

            # Step 2: Build USDC payment from challenge
            pay_req = challenge.get("paymentRequirements", [{}])[0]
            dest = pay_req.get("receiver") or pay_req.get("destination", "")
            amount = pay_req.get("maxAmountRequired") or pay_req.get("amount", "0.01")
            usdc_issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
            usdc_asset = Asset("USDC", usdc_issuer)

            account = self._mpp_horizon.load_account(self._mpp_keypair.public_key)
            tx = (
                TransactionBuilder(
                    source_account=account,
                    network_passphrase=self._mpp_passphrase,
                    base_fee=100,
                )
                .append_payment_op(dest, usdc_asset, str(amount))
                .set_timeout(30)
                .build()
            )
            tx.sign(self._mpp_keypair)
            xdr = tx.to_xdr()

            # Step 3: Retry with payment proof
            payment_header = json.dumps({"transaction": xdr, "mode": "pull"})
            headers = {"X-PAYMENT": payment_header, "Content-Type": "application/json"}
            async with session.request(method, url, headers=headers) as resp:
                resp.raise_for_status()
                return await resp.json()

    # ─── WebSocket ───────────────────────────────────────────

    async def subscribe(self, callback: Optional[Callable] = None):
        """Start real-time WebSocket connection for signals."""
        if callback:
            self.callbacks.setdefault("signal", []).append(callback)

        auth_query = f"?token={self.token}" if self.token else ""
        url = f"{self.ws_url}{auth_query}"

        while True:
            try:
                async with websockets.connect(url) as ws:
                    logger.info("Connected to Nirium Signal Stream")
                    await self._emit("connected", None)

                    async for message in ws:
                        data = json.loads(message)
                        event = data.get("type")
                        if event in self.callbacks:
                            await self._emit(event, data)
            except Exception as e:
                logger.error(f"WS Disconnected: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)
