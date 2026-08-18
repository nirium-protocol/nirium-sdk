# ═══════════════════════════════════════════════════════════════
# Nirium Python SDK — Official Client (x402 + MPP)
# Versión: solo en pyproject.toml / setup.py / __init__.__version__ (no aquí:
# un número en un comentario se desincroniza y ya mintió antes).
# Synced with backend API (real Horizon data, Soroban execution)
# ═══════════════════════════════════════════════════════════════
import asyncio
import collections
import hashlib
import json
import logging
import random
import aiohttp  # type: ignore
import websockets  # type: ignore
from typing import Callable, Dict, Any, List, Optional
from stellar_sdk import Keypair, Network, Server, TransactionBuilder, Asset  # type: ignore
from stellar_sdk import Account, Address, SorobanServer, scval  # type: ignore
from stellar_sdk.xdr import SorobanTransactionData  # type: ignore
from stellar_sdk.auth import authorize_entry  # type: ignore
import base64 as _b64
import math as _math

# Cuenta nula: la transacción de pago es una plantilla y el facilitador la
# re-emite con su propia cuenta y secuencia al pagar el fee de red.
_X402_NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

logger = logging.getLogger("nirium.client")


class WebSocketMaxRetriesExceeded(Exception):
    """Raised when consecutive WebSocket reconnection retries exceed the configured limit."""
    pass


class WebSocketStatus:
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    DISCONNECTED = "disconnected"
    CLOSED = "closed"


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

        self.callbacks: Dict[str, List[Callable]] = {
            "signal": [],
            "log": [],
            "connected": [],
            "status": [],
            "error": [],
        }
        self._active_ws: Optional[Any] = None
        self._ws_running: bool = False
        self._ws_close_requested: bool = False

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

    async def _get(
        self,
        path: str,
        extra_headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        headers = {**self.headers, **(extra_headers or {})}
        query = {k: str(v) for k, v in (params or {}).items() if v is not None}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(f"{self.api_url}{path}", params=query or None) as resp:
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

    # ─── Execution Nodes ─────────────────────────────────────

    async def get_nodes(self) -> Dict[str, Any]:
        """List execution nodes with live status, custody model and network."""
        return await self._get("/api/nodes")

    # ─── Payouts / Disbursements ─────────────────────────────
    #
    # Non-custodial by construction: the node builds an unsigned XDR, you sign
    # it with your own wallet and broadcast it via submit_payout. Nirium never
    # holds funds and never sees your keys.
    #
    # Licensed for independent service payments only (contractors, freelancers,
    # B2B) — never for subordinate-employee salary. See get_payout_terms().

    async def create_payout_run(
        self,
        recipients: List[Dict[str, Any]],
        acknowledge_terms: bool,
        asset: Optional[str] = None,
        memo: Optional[str] = None,
        run_id: Optional[str] = None,
        treasury: Optional[str] = None,
        client_info: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Build a batch payout (up to 100 recipients) and get back an unsigned XDR.

        ``acknowledge_terms`` must be True on every network — the node replies 403
        without it. On mainnet the node is invite-only (institutional tier) and
        additionally requires ``client_info`` with legalName, taxId and repName.
        """
        payload: Dict[str, Any] = {
            "recipients": recipients,
            "acknowledgeTerms": acknowledge_terms,
        }
        for key, value in (
            ("asset", asset), ("memo", memo), ("runId", run_id),
            ("treasury", treasury), ("clientInfo", client_info),
        ):
            if value is not None:
                payload[key] = value
        return await self._post("/api/payroll/run", payload)

    async def submit_payout(self, run_id: str, signed_xdr: str) -> Dict[str, Any]:
        """Broadcast the payout XDR after signing it with your own wallet."""
        return await self._post("/api/payroll/submit", {"runId": run_id, "signedXdr": signed_xdr})

    async def onboard_payout_recipient(
        self,
        employee: str,
        asset: Optional[str] = None,
        sponsor: Optional[str] = None,
        limit: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a self-signed USDC trustline so a new recipient can receive payouts."""
        payload: Dict[str, Any] = {"employee": employee}
        for key, value in (("asset", asset), ("sponsor", sponsor), ("limit", limit)):
            if value is not None:
                payload[key] = value
        return await self._post("/api/payroll/onboard", payload)

    async def submit_payout_onboard(self, signed_xdr: str) -> Dict[str, Any]:
        """Broadcast the signed trustline XDR from onboard_payout_recipient."""
        return await self._post("/api/payroll/onboard/submit", {"signedXdr": signed_xdr})

    async def get_payout_runs(self) -> Dict[str, Any]:
        """Payout history for the current network, with tx hashes and IPFS receipt CIDs."""
        return await self._get("/api/payroll/runs")

    async def get_payout_terms(self) -> Dict[str, Any]:
        """Payouts Terms v1.0 — the text ``acknowledge_terms`` accepts."""
        return await self._get("/api/payroll/terms")

    async def get_payout_info(self) -> Dict[str, Any]:
        """Payouts node metadata: pricing tiers, mainnet access, legal notice."""
        return await self._get("/api/payroll/info")

    # ─── Audit Trail ─────────────────────────────────────────

    async def anchor_audit_record(
        self,
        hash: Optional[str] = None,
        record: Optional[Dict[str, Any]] = None,
        tx_hash: Optional[str] = None,
        network: Optional[str] = None,
        tag: Optional[str] = None,
        agent: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Anchor evidence to IPFS and get back a CID.

        This is an integrity seal, not notarization and not legal proof of content.
        Anchor a ``hash`` of your data rather than the data itself: IPFS content
        cannot be deleted, so raw personal data would outlive any erasure request.

        Pass ``agent`` as ``{"key": "G...", "signature": "<base64>", "id": "..."}``
        to attest *who* produced the evidence: sign the exact string
        ``nirium-audit-v1:<content_sha256>`` with that ed25519 key. An invalid
        signature is rejected with 400 and nothing is anchored.
        """
        if hash is None and record is None:
            raise ValueError("provide `hash` (sha-256 of your evidence) or `record` (JSON object)")
        payload: Dict[str, Any] = {}
        for key, value in (
            ("hash", hash), ("record", record), ("txHash", tx_hash),
            ("network", network), ("tag", tag), ("agent", agent),
        ):
            if value is not None:
                payload[key] = value
        return await self._post("/api/audit/log", payload)

    async def get_audit_info(self) -> Dict[str, Any]:
        """Audit Trail node metadata: limits, pricing and disclaimer."""
        return await self._get("/api/audit/info")

    # ─── Reporting ───────────────────────────────────────────

    async def get_reporting_summary(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        network: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Institutional-format summary of payouts, x402/MPP receipts and anchors.

        Not certified regulatory reporting — what you file remains your responsibility.
        """
        return await self._get(
            "/api/reporting/summary",
            params={"from": from_date, "to": to_date, "network": network},
        )

    async def get_reporting_export(
        self,
        type: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        network: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Export rows as JSON. ``type`` is one of: payroll | payments | anchors."""
        return await self._get(
            "/api/reporting/export",
            params={
                "type": type, "format": "json", "from": from_date,
                "to": to_date, "network": network, "limit": limit,
            },
        )

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

    def init_x402(self, secret_key: str, network: str = "stellar:testnet", rpc_url: str = ""):
        """
        Initialize the x402 pay-per-request client (protocol v2).

        The payer signs a Soroban auth entry; the facilitator submits the
        transaction and sponsors the network fee, so the payer needs no XLM.

        Args:
            secret_key: Stellar secret key (S...) used to sign the auth entry.
            network: CAIP-2 network ID ('stellar:testnet' or 'stellar:pubnet').
            rpc_url: Soroban RPC override. Defaults per network.
        """
        is_testnet = "testnet" in network
        self._x402_keypair = Keypair.from_secret(secret_key)
        self._x402_network = network
        self._x402_passphrase = (
            Network.TESTNET_NETWORK_PASSPHRASE if is_testnet
            else Network.PUBLIC_NETWORK_PASSPHRASE
        )
        self._x402_rpc_url = rpc_url or (
            "https://soroban-testnet.stellar.org" if is_testnet
            # El SDF no corre RPC público de mainnet; gateway.fm es el mismo
            # default que usan el SDK de TypeScript y @stellar/mpp.
            else "https://soroban-rpc.mainnet.stellar.gateway.fm"
        )

    def _x402_build_transaction(self, accepted: Dict[str, Any]) -> str:
        """
        Build the signed payment transaction for one payment requirement.

        Mirrors the canonical @x402/stellar client. Three details are what make
        it settle, each verified against a TypeScript-generated reference:

        1. The source account is the NULL account, not the payer. The
           facilitator replaces it with its own when it submits and pays the
           fee. Using the payer's account makes the simulator emit
           source-account credentials, which the facilitator cannot honour.
        2. The auth entry must therefore carry ADDRESS credentials, signed with
           an expiration ledger.
        3. The transaction must be re-simulated AFTER signing: the signature
           adds bytes, and the resource fee computed before it is too low.
        """
        extra = accepted.get("extra") or {}
        if not extra.get("areFeesSponsored"):
            raise RuntimeError("x402 exact scheme requires areFeesSponsored to be true")

        soroban = SorobanServer(self._x402_rpc_url)
        timeout = int(accepted.get("maxTimeoutSeconds", 300))
        # ~5 s por ledger, el mismo supuesto del cliente canónico.
        max_ledger = soroban.get_latest_ledger().sequence + _math.ceil(timeout / 5)

        tx = (
            TransactionBuilder(
                source_account=Account(_X402_NULL_ACCOUNT, 0),
                network_passphrase=self._x402_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=accepted["asset"],
                function_name="transfer",
                parameters=[
                    Address(self._x402_keypair.public_key).to_xdr_sc_val(),  # from
                    Address(accepted["payTo"]).to_xdr_sc_val(),              # to
                    scval.to_int128(int(accepted["amount"])),                # amount
                ],
            )
            .set_timeout(timeout)
            .build()
        )

        prepared = soroban.prepare_transaction(tx)
        op = prepared.transaction.operations[0]
        op.auth = [
            authorize_entry(e, self._x402_keypair, max_ledger, self._x402_passphrase)
            for e in (op.auth or [])
        ]

        sim = soroban.simulate_transaction(prepared)
        if getattr(sim, "error", None):
            raise RuntimeError(f"x402 payment simulation failed: {sim.error}")
        data = sim.transaction_data
        prepared.transaction.soroban_data = (
            SorobanTransactionData.from_xdr(data) if isinstance(data, str) else data
        )
        prepared.transaction.fee = 100 + int(sim.min_resource_fee)
        return prepared.to_xdr()

    async def x402_fetch(self, url: str, method: str = "GET") -> Dict[str, Any]:
        """
        Fetch a paid resource via x402 (protocol v2).

        Reads the payment requirements from the ``payment-required`` response
        header, signs a Soroban auth entry for the exact amount, and retries
        with the ``PAYMENT-SIGNATURE`` header.

        Returns the JSON payload from the paid resource.
        """
        if not hasattr(self, "_x402_keypair"):
            raise RuntimeError("x402 client not initialized. Call agent.init_x402() first.")

        async with aiohttp.ClientSession() as session:
            async with session.request(method, url) as resp:
                if resp.status != 402:
                    return await resp.json()
                # v2 entrega los requirements en un header base64; el body va vacío.
                raw = resp.headers.get("payment-required")

            if not raw:
                raise RuntimeError(
                    "402 response carried no `payment-required` header — the server "
                    "may not be an x402 v2 endpoint."
                )

            challenge = json.loads(_b64.b64decode(raw).decode("utf-8"))
            accepts = challenge.get("accepts") or []
            if not accepts:
                raise RuntimeError("x402 challenge listed no acceptable payment methods")

            accepted = next(
                (a for a in accepts if a.get("network") == self._x402_network), accepts[0]
            )
            if accepted.get("scheme") != "exact":
                raise RuntimeError(f"unsupported x402 scheme: {accepted.get('scheme')}")

            payment = {
                "x402Version": challenge.get("x402Version", 2),
                "accepted": accepted,
                "payload": {"transaction": self._x402_build_transaction(accepted)},
            }
            header = _b64.b64encode(json.dumps(payment).encode("utf-8")).decode("ascii")

            # v2 usa PAYMENT-SIGNATURE. X-PAYMENT es de v1: mandarlo hace que el
            # servidor ignore el pago por completo y reemita el 402 sin explicar.
            async with session.request(
                method, url, headers={"PAYMENT-SIGNATURE": header}
            ) as paid:
                if paid.status >= 400:
                    body = await paid.text()
                    raise RuntimeError(
                        f"x402 payment rejected (HTTP {paid.status}): {body[:300]}"
                    )
                return await paid.json()

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

    async def close(self):
        """
        Gracefully close active WebSocket connection and stop subscriptions.
        """
        self._ws_close_requested = True
        self._ws_running = False
        if self._active_ws is not None:
            try:
                await self._active_ws.close()
            except Exception:
                pass
            self._active_ws = None
        await self._emit("status", WebSocketStatus.CLOSED)

    async def subscribe(
        self,
        callback: Optional[Callable] = None,
        max_retries: Optional[int] = None,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_factor: float = 2.0,
        jitter: float = 0.2,
        dedupe_size: int = 1000,
    ):
        """
        Start real-time WebSocket connection for signals with resilient exponential backoff,
        jitter, retry capping, deduplication, and typed event channels.

        Args:
            callback: Optional callback for "signal" events (preserves legacy API).
            max_retries: Maximum consecutive reconnection attempts before raising WebSocketMaxRetriesExceeded.
            initial_delay: Initial reconnect delay in seconds (default: 1.0).
            max_delay: Maximum reconnect delay in seconds (default: 30.0).
            backoff_factor: Multiplier for exponential backoff (default: 2.0).
            jitter: Fractional random jitter factor applied to delay (default: 0.2, i.e. +/- 20%).
            dedupe_size: Number of recent message IDs to track for deduplication.
        """
        if callback:
            self.callbacks.setdefault("signal", []).append(callback)

        auth_query = f"?token={self.token}" if self.token else ""
        url = f"{self.ws_url}{auth_query}"

        self._ws_running = True
        self._ws_close_requested = False
        attempt = 0
        seen_ids: collections.deque = collections.deque(maxlen=dedupe_size)
        seen_set: set = set()

        def _dedupe_check(msg_data: Dict[str, Any]) -> bool:
            """Returns True if message is a new unseen signal, False if duplicate."""
            msg_id = (
                msg_data.get("id")
                or msg_data.get("signal_id")
                or msg_data.get("txHash")
            )
            if not msg_id:
                raw_str = json.dumps(msg_data, sort_keys=True)
                msg_id = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()

            if msg_id in seen_set:
                return False

            if len(seen_ids) >= dedupe_size and seen_ids:
                oldest = seen_ids.popleft()
                seen_set.discard(oldest)

            seen_ids.append(msg_id)
            seen_set.add(msg_id)
            return True

        while self._ws_running and not self._ws_close_requested:
            try:
                await self._emit(
                    "status",
                    WebSocketStatus.CONNECTING if attempt == 0 else WebSocketStatus.RECONNECTING,
                )
                async with websockets.connect(url) as ws:
                    self._active_ws = ws
                    attempt = 0  # Reset retry counter on successful connection
                    logger.info("Connected to Nirium Signal Stream")
                    await self._emit("status", WebSocketStatus.CONNECTED)
                    await self._emit("connected", None)

                    async for message in ws:
                        if self._ws_close_requested:
                            break
                        data = json.loads(message)
                        event = data.get("type", "signal")

                        # Deduplicate signal messages
                        if event == "signal" or "signal" in self.callbacks:
                            if not _dedupe_check(data):
                                logger.debug(f"Dropped duplicate signal: {data.get('id')}")
                                continue

                        if event in self.callbacks:
                            await self._emit(event, data)
                        if (
                            event != "signal"
                            and "signal" in self.callbacks
                            and event not in ("connected", "status", "error", "log")
                        ):
                            await self._emit("signal", data)

                    if not self._ws_close_requested:
                        raise ConnectionResetError("WebSocket connection closed by remote server")

            except Exception as e:
                self._active_ws = None
                if self._ws_close_requested:
                    logger.info("WebSocket connection closed by user request.")
                    await self._emit("status", WebSocketStatus.CLOSED)
                    break

                attempt += 1
                await self._emit("status", WebSocketStatus.DISCONNECTED)
                await self._emit(
                    "error",
                    {"error": str(e), "exception": e, "attempt": attempt},
                )

                if max_retries is not None and attempt >= max_retries:
                    logger.error(
                        f"WS Reconnect failed after {attempt} attempts. Max retries exceeded."
                    )
                    await self._emit("status", WebSocketStatus.CLOSED)
                    raise WebSocketMaxRetriesExceeded(
                        f"WebSocket connection failed after {attempt} consecutive attempts: {e}"
                    ) from e

                # Calculate exponential backoff with jitter
                base_delay = min(
                    max_delay, initial_delay * (backoff_factor ** (attempt - 1))
                )
                jitter_range = base_delay * jitter
                actual_delay = max(
                    0.05, base_delay + random.uniform(-jitter_range, jitter_range)
                )

                logger.warning(
                    f"WS Disconnected: {e}. Reconnecting (attempt {attempt}/{max_retries or 'inf'}) in {actual_delay:.2f}s..."
                )
                await asyncio.sleep(actual_delay)
