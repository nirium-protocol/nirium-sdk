import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export const TESTNET_PASSPHRASE = Networks.TESTNET;

/**
 * This example is testnet-only. Signing a testnet XDR with the public
 * network passphrase produces a signature the network will reject.
 */
export function resolveTestnetPassphrase(value?: string): string {
    const passphrase = (value ?? TESTNET_PASSPHRASE).trim();
    const normalized = passphrase.toLowerCase();
    if (
        normalized.includes('public') ||
        normalized.includes('mainnet') ||
        normalized === Networks.PUBLIC.toLowerCase()
    ) {
        throw wrongPassphraseError(passphrase);
    }
    if (passphrase !== TESTNET_PASSPHRASE) {
        throw wrongPassphraseError(passphrase);
    }
    return passphrase;
}

export function wrongPassphraseError(got: string): Error {
    return new Error(
        `Network passphrase mismatch. This quickstart is testnet-only.\n` +
            `  expected: ${TESTNET_PASSPHRASE}\n` +
            `  got:      ${got}\n` +
            `Signing with the public/mainnet passphrase will fail on submit.`,
    );
}

/**
 * Sign an unsigned XDR with the caller's own keypair. The Nirium Agent is
 * not involved — the secret never leaves this process.
 */
export function signUnsignedXdr(xdr: string, secret: string, passphrase: string): string {
    resolveTestnetPassphrase(passphrase);
    if (!secret.startsWith('S') || secret.length < 56) {
        throw new Error('STELLAR_SECRET_KEY must be a Stellar secret seed (S...).');
    }

    try {
        const tx = TransactionBuilder.fromXDR(xdr, passphrase);
        tx.sign(Keypair.fromSecret(secret));
        return tx.toXDR();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/passphrase|network/i.test(message)) {
            throw wrongPassphraseError(`${passphrase} (${message})`);
        }
        throw err;
    }
}

export function publicKeyFromSecret(secret: string): string {
    return Keypair.fromSecret(secret).publicKey();
}
