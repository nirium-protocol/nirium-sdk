const INSUFFICIENT = /insufficient|underfunded|balance too low|does not have enough|exceeds balance|not enough|trustline entry is missing|HostError: Error\(Contract, #13\)/i;
const PASSPHRASE = /passphrase|wrong network|network mismatch|invalid network/i;

export function explainFailure(err: unknown): Error {
    const message = extractMessage(err);

    if (INSUFFICIENT.test(message)) {
        return new Error(
            `Insufficient balance for this step.\n` +
                `  • Deploy needs testnet XLM for fees / contract creation — fund via Friendbot:\n` +
                `    https://friendbot.stellar.org?addr=<YOUR_G_ADDRESS>\n` +
                `  • Deposit needs Blend testnet USDC (not Circle). Open the trustline, then use https://testnet.blend.capital\n` +
                `Original: ${message}`,
        );
    }

    if (PASSPHRASE.test(message)) {
        return new Error(
            `Signing used the wrong network passphrase (or the agent built the XDR for a different network).\n` +
                `This example must use: "Test SDF Network ; September 2015".\n` +
                `Original: ${message}`,
        );
    }

    return err instanceof Error ? err : new Error(message);
}

export function extractMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

export function isInsufficientBalance(err: unknown): boolean {
    return INSUFFICIENT.test(extractMessage(err));
}

export function isPassphraseMismatch(err: unknown): boolean {
    return PASSPHRASE.test(extractMessage(err));
}
