/**
 * Obtain a credential the Agent can send as `x-api-key`.
 *
 * Deploy/deposit require auth. A first-time reader should not have to mint
 * an institutional key: the public demo-auth endpoint issues a short-lived
 * token from the caller's own G-address.
 *
 * If that token is a JWT, we also attach `Authorization: Bearer` on requests
 * to the agent — the published Agent client only sets `x-api-key`.
 */
export async function resolveApiKey(baseUrl: string, address: string): Promise<string> {
    const fromEnv = process.env.NIRIUM_API_KEY?.trim();
    if (fromEnv) return fromEnv;

    const response = await fetch(`${baseUrl}/api/public/demo-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
    });
    const body = await response.text();
    if (!response.ok) {
        throw new Error(
            `demo-auth failed (${response.status}). Set NIRIUM_API_KEY or retry.\n${body}`,
        );
    }

    const data = JSON.parse(body) as Record<string, unknown>;
    const key = [data.apiKey, data.api_key, data.token, data.accessToken].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (!key) {
        throw new Error(`demo-auth did not return a token: ${body}`);
    }
    return key;
}

export function attachBearerIfJwt(token: string, baseUrl: string): void {
    if (!isJwt(token)) return;

    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(baseUrl)) {
            return original(input, init);
        }
        const headers = new Headers(init?.headers);
        if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return original(input, { ...init, headers });
    };
}

function isJwt(value: string): boolean {
    const parts = value.split('.');
    return parts.length === 3 && parts.every((part) => part.length > 0);
}
