// ═══════════════════════════════════════════════════════════════
// nirium — Official TypeScript SDK (x402 + MPP)
// Versión: solo en package.json (no aquí: un número en un comentario se
// desincroniza y ya mintió antes — decía 0.6.2 estando en 0.7.0).
// ═══════════════════════════════════════════════════════════════

import WebSocket from 'ws';
// @ts-ignore — ESM subpath imports
import { x402Client as X402ClientClass, wrapFetchWithPayment } from '@x402/fetch';
// @ts-ignore
import { createEd25519Signer } from '@x402/stellar';
// @ts-ignore
import { ExactStellarScheme } from '@x402/stellar/exact/client';
import * as MppxModule from 'mppx';

export interface AgentConfig {
    apiKey: string;
    baseUrl?: string;
    wsUrl?: string;
    /** JWT token for WebSocket auth (obtained from /api/auth/token) */
    token?: string;
}

/**
 * SEP-43 signer. Only `address` and `signAuthEntry` are required — that is all
 * x402 needs, and it is what browser wallets expose (Freighter, Stellar Wallets
 * Kit, Pollar). Lets the SDK pay from a browser without ever holding a secret.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export interface X402Signer {
    address: string;
    signAuthEntry: (
        authEntry: string,
        opts?: { networkPassphrase?: string; address?: string },
    ) => Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    signTransaction?: (...args: any[]) => Promise<any>;
}

export interface X402Config {
    /**
     * Stellar secret key (S...) for auth-entry signing. Server-side only —
     * pass `signer` instead when running in a browser.
     */
    secretKey?: string;
    /**
     * SEP-43 signer to sign with instead of a raw key. Use this for wallets:
     * the key never leaves the wallet, so the SDK works client-side.
     * Exactly one of `secretKey` or `signer` is required.
     */
    signer?: X402Signer;
    /** CAIP-2 network ID (e.g. 'stellar:testnet' or 'stellar:pubnet') */
    network?: string;
    /** Soroban RPC endpoint override (defaults per network) */
    rpcUrl?: string;
}

export interface MppConfig {
    /**
     * Stellar secret key (S...) for Soroban auth-entry signing.
     *
     * SERVER-SIDE ONLY, and unlike x402 there is no wallet alternative: the
     * upstream `mppx` client takes a raw key and exposes no SEP-43 signer hook
     * (verified against mppx 0.6.31 — zero references to one). Do not ship this
     * to a browser. For browser payments use x402 with `initX402({ signer })`.
     */
    secretKey: string;
    /** CAIP-2 network ID */
    network?: string;
    /** 'pull' = server assembles+broadcasts, 'push' = client broadcasts */
    mode?: 'pull' | 'push';
}

export interface Signal {
    id: string;
    signal_type: string;
    pair: string;
    data: {
        expectedProfit: number;
        profitPercentage: number;
        urgency: string;
        confidence: number;
        timeToLive: number;
        details: string;
    };
    timestamp: string;
    expiresAt: string;
}

export interface ExecutionResult {
    success: boolean;
    txHash?: string;
    profit?: number;
    gasUsed?: number;
    error?: string;
    timestamp: string;
    network: string;
    details?: Record<string, unknown>;
}

export interface Ticker {
    symbol: string;
    price: number | null;
    volume24h: number | null;
    change24h: number | null;
    network: string;
}

export interface TickersResponse {
    tickers: Ticker[];
    timestamp: string;
    network: string;
}

export interface GlobalStats {
    totalExecutions: number;
    totalProfit: number;
    activeAgents: number;
    network: string;
    timestamp: string;
}

export interface PathPaymentRoute {
    source: string;
    destination: string;
    path: string[];
    sourceAmount: number;
    destinationAmount: number;
    profitPercentage: number;
}

export interface MarketState {
    xlmPrice: number;
    /** Stellar base fee in stroops */
    baseFee: number;
    /** Best bid/ask spread on the native SDEX in basis points */
    sdexSpread: number;
    /** Soroswap AMM pool depth (XLM/USDC) */
    soroswapPoolDepth: number;
    blendApy: { supply: number; borrow: number };
    /** Discovered profitable multi-hop paths from Horizon */
    pathPaymentRoutes: PathPaymentRoute[];
    /** ISO timestamp of when market data was fetched */
    timestamp: string;
}

export interface LoopStatus {
    isRunning: boolean;
    scanCount: number;
    uptime: number;
    marketState: MarketState | null;
    config: Record<string, unknown>;
    lastAiDecision: Record<string, unknown> | null;
}

export interface SystemHealth {
    agent: { healthy: boolean; uptime: number };
    horizon: { healthy: boolean; latencyMs?: number; error?: string };
    soroban: { healthy: boolean; latencyMs?: number; error?: string };
    websocket: { healthy: boolean; clients: number };
    ipfs: { gateway: string };
    llm: { provider: string; model: string };
}

export interface Webhook {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt: string;
    lastTriggeredAt?: string;
    failureCount: number;
}

export interface Skill {
    slug: string;
    name: string;
    version: string;
    description?: string;
    isBuiltIn: boolean;
    installedAt?: string;
}

export interface SubscriptionOptions {
    signal_types?: string[];
    min_confidence?: number;
    min_profit_percentage?: number;
    pairs?: string[];
}

export interface Subscription {
    id: string;
    userId: string;
    filters: SubscriptionOptions;
    createdAt: string;
}

export interface SubscriptionStats {
    totalSubscriptions: number;
    connectedClients: number;
    recentSignals: number;
}

export interface Strategy {
    id: string;
    name: string;
    description?: string;
    category: string;
    assets: string[];
    riskLevel: string;
    isBuiltIn: boolean;
    enabled: boolean;
}

export interface AuthKey {
    id: string;
    name: string;
    tier: string;
    createdAt: string;
    lastUsedAt?: string;
    isActive: boolean;
}

export interface RevenueStats {
    total: string;
    currency: string;
    count: number;
    feed: Array<{ id: string; message: string; created_at: string }>;
}

export interface LLMConfig {
    provider: 'openai' | 'anthropic' | 'ollama' | 'minimax' | 'gemini' | 'grok' | 'bedrock' | 'openrouter';
    model?: string;
    apiKey?: string;
    ollamaUrl?: string;
}

export interface ExecutionNode {
    id: string;
    name: string;
    status: 'active' | 'architected' | 'proposed';
    custody: string;
    network: 'testnet' | 'mainnet' | 'both';
    summary: string;
}

export interface PayoutRecipient {
    wallet: string;
    amount: string | number;
}

/**
 * Identity of the paying company. Required on mainnet — the Payouts node
 * collects it ahead of Mexico's LFPIORPI Fracción XVI (effective 2027-01-17).
 */
export interface PayoutClientInfo {
    legalName: string;
    taxId: string;
    repName: string;
}

export interface PayoutRunOptions {
    recipients: PayoutRecipient[];
    /** Must be true — the node returns 403 without it, on both networks. */
    acknowledgeTerms: boolean;
    asset?: string;
    memo?: string;
    runId?: string;
    /** Paying treasury (G-address). Defaults to the node's configured treasury. */
    treasury?: string;
    clientInfo?: PayoutClientInfo;
}

export interface PayoutRun {
    runId: string;
    /** Unsigned transaction — sign it with your own wallet, then call submitPayout. */
    xdr?: string;
    recipientCount?: number;
    totalAmount?: string;
    asset?: string;
    txHash?: string;
    cid?: string;
    pricing?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface AgentAttestationInput {
    /** ed25519 public key of the agent, as a Stellar address (G...). */
    key: string;
    /** base64 or hex ed25519 signature over `nirium-audit-v1:<content_sha256>`. */
    signature: string;
    /** Optional free-form label for the agent (max 64 chars). */
    id?: string;
}

export interface AuditAnchorOptions {
    /** sha-256 hex (64 chars) of your evidence. Provide this or `record`. */
    hash?: string;
    /** Small JSON object (max 8KB) anchored verbatim. Anchor hashes, not personal data. */
    record?: Record<string, unknown>;
    txHash?: string;
    network?: string;
    tag?: string;
    /**
     * Attests *who* produced the evidence. The CID alone proves the fact wasn't
     * altered; this proves which agent declared it. An invalid signature is
     * rejected with 400 — nothing is anchored.
     */
    agent?: AgentAttestationInput;
}

export interface AuditAnchor {
    cid: string;
    contentSha256: string;
    gatewayUrl?: string;
    anchoredAt: string;
    /** Present when the anchor carried a verified agent attestation. */
    attestedBy?: string;
    [key: string]: unknown;
}

export interface ReportingPeriod {
    from?: string;
    to?: string;
    network?: 'testnet' | 'mainnet';
}

export interface ReportingSummary {
    node: string;
    period: { from: string | null; to: string | null };
    network: string;
    payroll: { settledRuns: number; recipientsPaid: number; totalsByAsset: Record<string, string>; lastSettledAt: string | null };
    payments: { count: number; totalUsdc: string; byGateway: Record<string, { count: number; totalUsdc: number }> };
    anchors: { count: number; latestCid: string | null };
    generatedAt: string;
    disclaimer: string;
}

/** Build a `?a=1&b=2` suffix, dropping undefined values. Returns '' when empty. */
function queryString(params?: object): string {
    if (!params) return '';
    const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    return pairs.length ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString()}` : '';
}

/**
 * NiriumClient — Full API + WebSocket wrapper for the Nirium Agent.
 *
 * @example
 * ```typescript
 * import { Agent } from 'nirium';
 *
 * const agent = new Agent({
 *   apiKey: 'nrm_your_key_here',
 *   baseUrl: 'http://localhost:3001',
 * });
 *
 * // Check health
 * const healthy = await agent.ping();
 * console.log('Agent alive:', healthy);
 *
 * // Get market data (REAL data from Horizon)
 * const market = await agent.getMarket();
 * console.log('XLM Price:', market.xlmPrice);
 *
 * // Execute a strategy
 * const result = await agent.execute('flash-loan-arb', 'XLM-USDC', { amount: 5000 });
 * console.log('Profit:', result.profit);
 *
 * // Subscribe to real-time signals
 * agent.subscribe((signal) => {
 *   console.log('Signal:', signal.signal_type, signal.data.details);
 * });
 * ```
 */
export class Agent {
    private apiKey: string;
    private baseUrl: string;
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private signalCallbacks: Array<(signal: Signal) => void> = [];
    private logCallbacks: Array<(log: Record<string, unknown>) => void> = [];

    private token: string | null = null;

    private x402Client: { fetch: typeof fetch } | null = null;
    private mppClient: { fetch: typeof fetch } | null = null;

    constructor(config: AgentConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl || 'http://localhost:3001').replace(/\/$/, '');
        this.wsUrl = config.wsUrl || this.baseUrl.replace(/^http/, 'ws') + '/ws/signals';
        this.token = config.token || null;
    }

    // ─── HTTP Methods ────────────────────────────────────────

    private async request<T>(
        method: string,
        path: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        return this.requestWithHeaders(method, path, body, {});
    }

    private async requestWithHeaders<T>(
        method: string,
        path: string,
        body?: Record<string, unknown>,
        extraHeaders?: Record<string, string>
    ): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            ...extraHeaders,
        };

        const options: RequestInit = { method, headers };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(`Nirium API Error [${response.status}]: ${JSON.stringify(error)}`);
        }

        return response.json() as Promise<T>;
    }

    // ─── Health ──────────────────────────────────────────────

    /** Health check — returns true if agent is reachable. */
    async ping(): Promise<boolean> {
        try {
            const data = await this.request<{ status: string }>('GET', '/health');
            return data.status === 'operational' || data.status === 'online';
        } catch {
            return false;
        }
    }

    /** Detailed health information. */
    async health(): Promise<Record<string, unknown>> {
        return this.request('GET', '/health');
    }

    /** Detailed system health (Horizon, Soroban, WebSocket, IPFS, LLM). */
    async systemHealth(): Promise<SystemHealth> {
        return this.request('GET', '/api/system/health');
    }

    // ─── Execution ───────────────────────────────────────────

    /**
     * Execute a strategy via a real Soroban contract transaction on Stellar.
     * Strategy names: flash-loan-arb, path-arbitrage, cross-dex, blend-yield, soroswap-swap
     *
     * @param stellarAccount - Your Stellar wallet address (required for legal consent verification)
     */
    async execute(
        strategy: string,
        asset: string,
        params?: Record<string, unknown>,
        stellarAccount?: string
    ): Promise<ExecutionResult> {
        const extraHeaders: Record<string, string> = {};
        if (stellarAccount) {
            extraHeaders['x-stellar-account'] = stellarAccount;
        }
        return this.requestWithHeaders('POST', '/api/execute', { strategy, asset, ...params }, extraHeaders);
    }

    /**
     * Demo execution (Soroban dry-run simulation, no TX submitted).
     * Returns a professional market assessment message.
     */
    async executeDemo(strategy: string, asset: string): Promise<{
        success: boolean;
        simulated_profit: number;
        gas_consumed: number;
        message: string;
    }> {
        return this.request('POST', '/api/execute-demo', { strategy, asset });
    }

    // ─── Market Data ─────────────────────────────────────────

    /** Get asset price tickers (XLM, USDC) from Stellar Horizon. */
    async getTickers(): Promise<TickersResponse> {
        return this.request('GET', '/api/tickers');
    }

    /** Get current market state (real data from Horizon). */
    async getMarket(): Promise<MarketState> {
        return this.request('GET', '/api/market');
    }

    /** Get global protocol statistics. */
    async getStats(): Promise<GlobalStats> {
        return this.request('GET', '/api/stats/global');
    }

    /** Get autonomous loop status. */
    async getLoopStatus(): Promise<LoopStatus> {
        return this.request('GET', '/api/loop/status');
    }

    /** Start the autonomous scanning loop. */
    async startLoop(config?: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
        return this.request('POST', '/api/loop/start', { config });
    }

    /** Stop the autonomous scanning loop. */
    async stopLoop(): Promise<{ success: boolean; message: string }> {
        return this.request('POST', '/api/loop/stop');
    }

    /** Trigger a manual market scan. */
    async triggerScan(): Promise<{ success: boolean; marketState: MarketState }> {
        return this.request('POST', '/api/loop/scan');
    }

    // ─── Subscriptions ───────────────────────────────────────

    /** Create a signal subscription with filters. */
    async createSubscription(
        options?: SubscriptionOptions
    ): Promise<Record<string, unknown>> {
        return this.request('POST', '/api/subscriptions', { filters: options });
    }

    /** Get recent signals. */
    async getRecentSignals(count = 20): Promise<{ signals: Signal[] }> {
        return this.request('GET', `/api/signals/recent?count=${count}`);
    }

    /** List all active subscriptions for the current user. */
    async getSubscriptions(): Promise<{ subscriptions: Subscription[] }> {
        return this.request('GET', '/api/subscriptions');
    }

    /** Delete a subscription by ID. */
    async deleteSubscription(id: string): Promise<{ message: string }> {
        return this.request('DELETE', `/api/subscriptions/${id}`);
    }

    /** Get subscription stats (total, connected clients, recent signals). */
    async getSubscriptionStats(): Promise<SubscriptionStats> {
        return this.request('GET', '/api/subscriptions/stats');
    }

    // ─── Skills ──────────────────────────────────────────────

    /** List all loaded skills (built-in + user-installed). */
    async getSkills(): Promise<{ skills: Skill[]; total: number }> {
        return this.request('GET', '/api/skills');
    }

    /** Install a skill by slug. */
    async installSkill(source: string): Promise<Skill> {
        return this.request('POST', '/api/skills/install', { source });
    }

    /** Uninstall a user-installed skill by slug. */
    async uninstallSkill(slug: string): Promise<{ success: boolean }> {
        return this.request('DELETE', `/api/skills/${slug}`);
    }

    /** List skills available in the marketplace. */
    async getSkillMarketplace(): Promise<{ skills: Skill[]; total: number }> {
        return this.request('GET', '/api/skills/marketplace');
    }

    /** Execute a custom action on an installed skill. */
    async executeSkillAction(
        slug: string,
        action: string,
        params?: Record<string, unknown>,
        context?: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        return this.request('POST', `/api/skills/${slug}/actions/${action}`, { params, context });
    }

    /** List available strategies (from loaded skills). */
    async getStrategies(): Promise<{ strategies: Strategy[]; total: number; network: string }> {
        return this.request('GET', '/api/strategies');
    }

    // ─── Webhooks ────────────────────────────────────────────

    /** Register a webhook endpoint. */
    async registerWebhook(
        url: string,
        events: string[],
        secret?: string
    ): Promise<Webhook> {
        return this.request('POST', '/api/webhooks', { url, events, secret });
    }

    /** List all registered webhooks. */
    async getWebhooks(): Promise<Webhook[]> {
        return this.request('GET', '/api/webhooks');
    }

    /** Delete a webhook by ID. */
    async deleteWebhook(id: string): Promise<{ success: boolean }> {
        return this.request('DELETE', `/api/webhooks/${id}`);
    }

    /** Test a webhook (sends a test event). */
    async testWebhook(id: string): Promise<{ success: boolean; message: string }> {
        return this.request('POST', `/api/webhooks/${id}/test`);
    }

    // ─── Auth Management ─────────────────────────────────────

    /** Get a JWT token for a Stellar wallet address. */
    async getAuthToken(walletAddress: string): Promise<{ token: string; expiresIn: string; userId: string }> {
        return this.request('POST', '/api/auth/token', { walletAddress });
    }

    /** Create a new API key. Requires auth. */
    async createAuthKey(name: string, tier?: string): Promise<{ apiKey: string; name: string; tier: string }> {
        return this.request('POST', '/api/auth/keys', { name, tier });
    }

    /** List API keys for the current user. Requires auth. */
    async getAuthKeys(): Promise<{ keys: AuthKey[] }> {
        return this.request('GET', '/api/auth/keys');
    }

    /** Revoke an API key by ID. Requires auth. */
    async revokeAuthKey(id: string): Promise<{ message: string }> {
        return this.request('DELETE', `/api/auth/keys/${id}`);
    }

    // ─── Revenue & Info ──────────────────────────────────────

    /** Get x402/MPP revenue stats and payment feed. */
    async getRevenue(): Promise<RevenueStats> {
        return this.request('GET', '/api/revenue');
    }

    /** Get protocol info (endpoints, LLM, version). */
    async getInfo(): Promise<Record<string, unknown>> {
        return this.request('GET', '/api/info');
    }

    // ─── Execution Nodes ─────────────────────────────────────

    /** List execution nodes with live status, custody model and network. */
    async getNodes(): Promise<{ nodes: ExecutionNode[] }> {
        return this.request('GET', '/api/nodes');
    }

    // ─── Payouts / Disbursements ─────────────────────────────
    //
    // Non-custodial by construction: the node builds an unsigned XDR, you sign
    // it with your own wallet and broadcast it via submitPayout. Nirium never
    // holds funds and never sees your keys.
    //
    // Licensed for independent service payments only (contractors, freelancers,
    // B2B) — never for subordinate-employee salary. See getPayoutTerms().

    /**
     * Build a batch payout (up to 100 recipients in one classic Stellar tx).
     * Returns an unsigned XDR to sign with your own wallet.
     *
     * `acknowledgeTerms: true` is mandatory on every network — the node replies
     * 403 without it. On mainnet the node is invite-only (institutional tier)
     * and additionally requires `clientInfo`.
     */
    async createPayoutRun(options: PayoutRunOptions): Promise<PayoutRun> {
        return this.request('POST', '/api/payroll/run', options as unknown as Record<string, unknown>);
    }

    /** Broadcast the payout XDR after signing it with your own wallet. */
    async submitPayout(runId: string, signedXdr: string): Promise<PayoutRun> {
        return this.request('POST', '/api/payroll/submit', { runId, signedXdr });
    }

    /** Build a self-signed USDC trustline so a new recipient can receive payouts. */
    async onboardPayoutRecipient(
        employee: string,
        options?: { asset?: string; sponsor?: string; limit?: string }
    ): Promise<{ xdr: string; [key: string]: unknown }> {
        return this.request('POST', '/api/payroll/onboard', { employee, ...options });
    }

    /** Broadcast the signed trustline XDR from onboardPayoutRecipient. */
    async submitPayoutOnboard(signedXdr: string): Promise<Record<string, unknown>> {
        return this.request('POST', '/api/payroll/onboard/submit', { signedXdr });
    }

    /** Payout history for the current network, each with tx hash and IPFS receipt CID. */
    async getPayoutRuns(): Promise<{ runs: PayoutRun[] }> {
        return this.request('GET', '/api/payroll/runs');
    }

    /** Payouts Terms v1.0 — the text `acknowledgeTerms` accepts. */
    async getPayoutTerms(): Promise<Record<string, unknown>> {
        return this.request('GET', '/api/payroll/terms');
    }

    /** Payouts node metadata: pricing tiers, mainnet access, legal notice. */
    async getPayoutInfo(): Promise<Record<string, unknown>> {
        return this.request('GET', '/api/payroll/info');
    }

    // ─── Audit Trail ─────────────────────────────────────────

    /**
     * Anchor evidence to IPFS and get back a CID — an integrity seal, not
     * notarization and not legal proof of content.
     *
     * Anchor a `hash` of your data rather than the data itself: IPFS content
     * cannot be deleted, so raw personal data would outlive any erasure request.
     */
    async anchorAuditRecord(options: AuditAnchorOptions): Promise<AuditAnchor> {
        return this.request('POST', '/api/audit/log', options as unknown as Record<string, unknown>);
    }

    /** Audit Trail node metadata: limits, pricing and disclaimer. */
    async getAuditInfo(): Promise<Record<string, unknown>> {
        return this.request('GET', '/api/audit/info');
    }

    // ─── Reporting ───────────────────────────────────────────

    /**
     * Institutional-format summary of payouts, x402/MPP receipts and anchors.
     * Not certified regulatory reporting — what you file remains your responsibility.
     */
    async getReportingSummary(period?: ReportingPeriod): Promise<ReportingSummary> {
        return this.request('GET', `/api/reporting/summary${queryString(period)}`);
    }

    /** Export rows as JSON. Use `format: 'csv'` via getReportingExportUrl for a file download. */
    async getReportingExport(
        type: 'payroll' | 'payments' | 'anchors',
        period?: ReportingPeriod & { limit?: number }
    ): Promise<Record<string, unknown>> {
        return this.request('GET', `/api/reporting/export${queryString({ ...period, type, format: 'json' })}`);
    }

    /** URL for the CSV export, for handing to a browser download or a spreadsheet. */
    getReportingExportUrl(
        type: 'payroll' | 'payments' | 'anchors',
        period?: ReportingPeriod & { limit?: number }
    ): string {
        return `${this.baseUrl}/api/reporting/export${queryString({ ...period, type, format: 'csv' })}`;
    }

    // ─── Admin ───────────────────────────────────────────────

    /** Update the active LLM provider (admin only). */
    async configureLLM(config: LLMConfig): Promise<{ success: boolean; message: string }> {
        return this.request('POST', '/api/config/llm', config as unknown as Record<string, unknown>);
    }

    // ─── WebSocket ───────────────────────────────────────────

    /**
     * Subscribe to real-time signals via WebSocket.
     * Optionally filter by subscription ID.
     */
    subscribe(
        callback: (signal: Signal) => void,
        subscriptionId?: string
    ): void {
        this.signalCallbacks.push(callback);
        this.connectWebSocket(subscriptionId);
    }

    /**
     * Subscribe to real-time log messages.
     */
    onLog(callback: (log: Record<string, unknown>) => void): void {
        this.logCallbacks.push(callback);
        this.connectWebSocket();
    }

    private connectWebSocket(subscriptionId?: string): void {
        if (this.ws?.readyState === WebSocket.OPEN) return;

        const authQuery = this.token ? `?token=${this.token}` : '';
        this.ws = new WebSocket(`${this.wsUrl}${authQuery}`);

        this.ws.on('open', () => {
            console.log('[Nirium SDK] WebSocket connected');
            this.reconnectAttempts = 0;

            if (subscriptionId) {
                this.ws?.send(JSON.stringify({ type: 'subscribe', subscriptionId }));
            }
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'signal') {
                    this.signalCallbacks.forEach(cb => cb(message as Signal));
                } else if (message.type === 'log') {
                    this.logCallbacks.forEach(cb => cb(message));
                }
            } catch (error) {
                // Ignore parse errors
            }
        });

        this.ws.on('close', () => {
            console.log('[Nirium SDK] WebSocket disconnected');
            this.attemptReconnect(subscriptionId);
        });

        this.ws.on('error', (error: Error) => {
            console.error('[Nirium SDK] WebSocket error:', error.message);
        });
    }

    private attemptReconnect(subscriptionId?: string): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[Nirium SDK] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        setTimeout(() => {
            console.log(`[Nirium SDK] Reconnecting (attempt ${this.reconnectAttempts})...`);
            this.connectWebSocket(subscriptionId);
        }, delay);
    }

    // ─── x402 Protocol ────────────────────────────────────────

    /**
     * Initialize the x402 client for pay-per-request micropayments.
     * Uses canonical @x402/fetch with ExactStellarScheme + OZ Channels facilitator.
     * Agent signs Soroban auth entries only — facilitator sponsors all network fees.
     *
     * Sign with a raw key server-side, or with a SEP-43 wallet in the browser —
     * the same call either way.
     *
     * @example
     * ```typescript
     * // Server: raw key
     * agent.initX402({ secretKey: 'S...', network: 'stellar:testnet' });
     *
     * // Browser: the key never leaves the wallet
     * agent.initX402({ signer: freighterSigner, network: 'stellar:pubnet' });
     *
     * const data = await agent.x402Fetch('https://nirium-agent.fly.dev/api/v1/premium/signals');
     * ```
     */
    initX402(config: X402Config): void {
        const network = config.network || 'stellar:testnet';
        // Un signer externo o una llave cruda — nunca los dos, nunca ninguno.
        // Se valida aquí y no al pagar: un config mal armado debe fallar al
        // inicializar, no a mitad de un cobro.
        if (!config.signer && !config.secretKey) {
            throw new Error(
                'initX402 requires either `secretKey` (server-side) or `signer` (SEP-43 wallet, browser-safe).',
            );
        }
        if (config.signer && config.secretKey) {
            throw new Error(
                'initX402 got both `secretKey` and `signer` — pass only one, so it is unambiguous which key signs.',
            );
        }
        const signer = config.signer ?? (createEd25519Signer as any)(config.secretKey, network);
        // Pubnet: el SDF NO corre RPC público de mainnet — soroban.stellar.org no
        // existe. Default al RPC público de gateway.fm (mismo default que
        // @stellar/mpp); siempre overrideable por config.rpcUrl.
        const rpcUrl = config.rpcUrl || (network.includes('testnet')
            ? 'https://soroban-testnet.stellar.org'
            : 'https://soroban-rpc.mainnet.stellar.gateway.fm');
        const client = new (X402ClientClass as any)().register(
            'stellar:*',
            new (ExactStellarScheme as any)(signer, { url: rpcUrl })
        );
        this.x402Client = { fetch: wrapFetchWithPayment(fetch, client) } as any;
    }

    /**
     * Fetch a paid resource via x402 protocol.
     * The client automatically handles 402 negotiation, auth-entry signing, and payment.
     * Returns the Response object — call .json() or .text() for the payload.
     */
    async x402Fetch(url: string, init?: RequestInit): Promise<Response> {
        if (!this.x402Client) {
            throw new Error('x402 client not initialized. Call agent.initX402() first.');
        }
        return this.x402Client.fetch(url, init);
    }

    // ─── MPP Protocol (Charge Mode) ────────────────────────────

    /**
     * Initialize the MPP Charge client for per-request Soroban SAC payments.
     * Uses canonical @stellar/mpp charge mode with mppx.
     * In pull mode, the server assembles and broadcasts the transaction.
     *
     * @example
     * ```typescript
     * agent.initMpp({ secretKey: 'S...', network: 'stellar:testnet', mode: 'pull' });
     * const data = await agent.mppFetch('http://localhost:3403/signals/trading');
     * ```
     */
    initMpp(config: MppConfig): void {
        const Mppx = (MppxModule as any).default || MppxModule;
        const mppx = Mppx.create({
            stellar: {
                charge: {
                    secretKey: config.secretKey,
                    network: config.network || 'stellar:testnet',
                    mode: config.mode || 'pull',
                },
            },
        });
        this.mppClient = mppx;
    }

    /**
     * Fetch a paid resource via MPP Charge protocol.
     * The client automatically handles 402 challenge, auth-entry signing,
     * and Soroban SAC USDC settlement.
     * Returns the Response object.
     */
    async mppFetch(url: string, init?: RequestInit): Promise<Response> {
        if (!this.mppClient) {
            throw new Error('MPP client not initialized. Call agent.initMpp() first.');
        }
        return this.mppClient.fetch(url, init);
    }

    // ─── Connection ─────────────────────────────────────────

    /** Close the WebSocket connection. */
    disconnect(): void {
        this.maxReconnectAttempts = 0; // Prevent reconnection
        this.ws?.close();
        this.ws = null;
        this.signalCallbacks = [];
        this.logCallbacks = [];
    }
}

// ─── x402Serve — el otro lado del mostrador ────────────────────
//
// `initX402` te deja PAGAR por APIs ajenas. Esto te deja COBRAR por la tuya.
//
// Montar x402 a mano son ~25 líneas: cliente del facilitador, headers de
// auth por método, registro de esquema por red, y una tabla de rutas con
// una forma que hay que adivinar leyendo la librería. Aquí van los defaults
// que ya corren en producción y quedan tres líneas.
//
//   app.use('/premium', x402Serve({
//       payTo: 'G...',
//       routes: { 'GET /signals': '$0.02' },
//   }));
//
// Devuelve middleware de Express. `@x402/express` se carga solo si llamas
// esto — quien use el SDK únicamente como cliente no arrastra Express.

export interface X402ServeConfig {
    /** Cuenta Stellar que recibe los pagos. Sin esto no hay a quién cobrarle. */
    payTo: string;
    /** `'GET /signals': '$0.02'` — el método es opcional y default GET. */
    routes: Record<string, string | { price: string; description?: string }>;
    network?: 'stellar:testnet' | 'stellar:pubnet';
    /** Default: OpenZeppelin Channels, el facilitador canónico de Stellar. */
    facilitatorUrl?: string;
    /** Mainnet lo exige; testnet no. */
    facilitatorApiKey?: string;
    facilitatorAuthHeader?: string;
    appName?: string;
    appLogo?: string;
}

const X402_FACILITATORS = {
    'stellar:pubnet': 'https://channels.openzeppelin.com/x402',
    'stellar:testnet': 'https://channels.openzeppelin.com/x402/testnet',
} as const;

export function x402Serve(config: X402ServeConfig): any {
    if (!config.payTo || !/^G[A-Z2-7]{55}$/.test(config.payTo)) {
        throw new Error('x402Serve: `payTo` must be a Stellar public key (G...). Without it there is nobody to pay.');
    }
    const entries = Object.entries(config.routes || {});
    if (entries.length === 0) {
        throw new Error('x402Serve: `routes` is empty — nothing would ever be charged for.');
    }

    const network = config.network || 'stellar:testnet';
    // Falla al montar, no al primer cobro. Y aplica a las DOS redes: probado
    // el 5-ago-2026, el facilitador de OpenZeppelin responde 401 a
    // `getSupported` también en testnet, así que sin llave el servidor no
    // llega ni a ofrecer un 402.
    if (!config.facilitatorApiKey && !config.facilitatorUrl) {
        throw new Error(
            'x402Serve: `facilitatorApiKey` is required — the facilitator rejects unauthenticated '
            + 'servers on testnet too. Keys are PER NETWORK and free: '
            + 'channels.openzeppelin.com/testnet/gen for testnet, channels.openzeppelin.com/gen for '
            + 'mainnet. A mainnet key returns 401 against testnet. '
            + 'Or point `facilitatorUrl` at your own facilitator.',
        );
    }

    // `import()` dinámico, no `require`.
    //
    // El dist del SDK se evalúa como ESM, donde `require` sencillamente no
    // existe — así que el try/catch lo leía como "falta el paquete" y decía
    // que instalaras algo que ya estaba instalado. Verificado el 5-ago-2026
    // desde una instalación limpia en Windows. `import()` funciona en los dos
    // formatos y distingue de verdad entre ausente y roto.
    const load = async (m: string) => {
        try {
            return await import(/* @vite-ignore */ m);
        } catch (err: any) {
            const missing = /cannot find (module|package)/i.test(String(err?.message));
            throw new Error(missing
                ? `x402Serve needs "${m}". Install it alongside the SDK: npm i @x402/express @x402/core @x402/stellar`
                : `x402Serve could not load "${m}": ${err?.message}`);
        }
    };

    const authHeader = config.facilitatorAuthHeader || 'Authorization';
    const headers = () => ({
        [authHeader]: authHeader.toLowerCase() === 'authorization'
            ? `Bearer ${config.facilitatorApiKey}`
            : String(config.facilitatorApiKey),
    });

    // 'GET /signals' y '/signals' significan lo mismo: el método se omite
    // porque casi todo cobro es un GET, y obligar a escribirlo es fricción.
    const routes: Record<string, any> = {};
    for (const [key, value] of entries) {
        const spec = typeof value === 'string' ? { price: value } : value;
        const routeKey = /^[A-Z]+\s/.test(key) ? key : `GET ${key}`;
        routes[routeKey] = {
            accepts: {
                scheme: 'exact' as const,
                price: spec.price,
                network,
                payTo: config.payTo,
                ...(spec.description ? { description: spec.description } : {}),
            },
        };
    }

    // El middleware se construye en la PRIMERA petición, no aquí.
    //
    // `paymentMiddlewareFromConfig` dispara su inicialización contra el
    // facilitador de forma asíncrona al construirse, y si esa llamada falla
    // —llave mala, facilitador caído— la promesa rechaza sin dueño y **tumba
    // el proceso** con un stack de dentro de @x402/core. Verificado el
    // 5-ago-2026 con una llave inválida.
    //
    // Construyéndolo dentro del request, esa promesa es nuestra y se captura.
    // Un helper de tres líneas no puede matar el servidor de nadie: falla en
    // un 503 que dice qué revisar y deja el resto de la app en pie.
    const facilitatorUrl = config.facilitatorUrl || X402_FACILITATORS[network];

    // Preflight OBLIGATORIO antes de construir.
    //
    // No basta con capturar el error: `paymentMiddlewareFromConfig` guarda su
    // propia promesa de inicialización, y si el facilitador rechaza la llave
    // esa promesa queda sin dueño y **mata el proceso** aunque nosotros
    // respondamos 503. Verificado el 5-ago-2026.
    //
    // Así que se pregunta primero. Si el facilitador no acepta la llave, el
    // middleware nunca se construye y no hay promesa que explote.
    const preflight = async (): Promise<void> => {
        const r = await fetch(`${facilitatorUrl}/supported`, {
            headers: config.facilitatorApiKey ? headers() : {},
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) {
            throw new Error(
                r.status === 401 || r.status === 403
                    ? `facilitator rejected the API key (${r.status}) — check facilitatorApiKey`
                    : `facilitator returned ${r.status}`,
            );
        }
    };

    let cached: any;
    const build = async () => {
        const [{ paymentMiddlewareFromConfig }, { HTTPFacilitatorClient }, { ExactStellarScheme: ServerScheme }] =
            await Promise.all([
                load('@x402/express'),
                load('@x402/core/server'),
                load('@x402/stellar/exact/server'),
            ]);

        const facilitator = new HTTPFacilitatorClient({
            url: facilitatorUrl,
            ...(config.facilitatorApiKey ? {
                createAuthHeaders: async () => ({ verify: headers(), settle: headers(), supported: headers() }),
            } : {}),
        });

        return paymentMiddlewareFromConfig(
            routes,
            facilitator,
            [{ network, server: new ServerScheme() }],
            {
                appName: config.appName || 'Nirium',
                ...(config.appLogo ? { appLogo: config.appLogo } : {}),
                testnet: network === 'stellar:testnet',
            },
        );
    };

    const explain = (res: any, err: any) => {
        if (res.headersSent) return;
        const detail = err?.message ? String(err.message).slice(0, 200) : undefined;
        res.status(503).json({
            error: 'x402 payments unavailable',
            detail,
            hint: /401|unauthor/i.test(detail || '')
                ? 'the facilitator rejected the API key — check facilitatorApiKey'
                : 'the facilitator could not be reached',
        });
    };

    return async function niriumX402(req: any, res: any, next: any) {
        try {
            if (!cached) {
                await preflight();
                cached = await build();
            }
            await cached(req, res, next);
        } catch (err) {
            cached = undefined; // que el siguiente request reintente
            explain(res, err);
        }
    };
}

export { x402Metrics } from './metrics';
export type { X402MetricsResult, MetricsSnapshot } from './metrics';

export default Agent;
