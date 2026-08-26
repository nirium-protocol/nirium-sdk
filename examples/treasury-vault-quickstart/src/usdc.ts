import {
    Asset,
    BASE_FEE,
    Horizon,
    Keypair,
    Networks,
    Operation,
    TransactionBuilder,
} from '@stellar/stellar-sdk';

/** Blend testnet USDC issuer — NOT Circle. DeFindex vaults on testnet use this asset. */
export const BLEND_USDC_ISSUER = 'GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56';
export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
export const BLEND_FAUCET_UI = 'https://testnet.blend.capital';

export function blendUsdc(): Asset {
    return new Asset('USDC', BLEND_USDC_ISSUER);
}

export async function usdcBalance(publicKey: string): Promise<number> {
    const horizon = new Horizon.Server(HORIZON_TESTNET);
    const account = await horizon.loadAccount(publicKey);
    const row = account.balances.find(
        (balance) =>
            'asset_code' in balance &&
            balance.asset_code === 'USDC' &&
            'asset_issuer' in balance &&
            balance.asset_issuer === BLEND_USDC_ISSUER,
    );
    return row && 'balance' in row ? Number(row.balance) : 0;
}

export function hasUsdcTrustline(account: Horizon.AccountResponse): boolean {
    return account.balances.some(
        (balance) =>
            'asset_code' in balance &&
            balance.asset_code === 'USDC' &&
            'asset_issuer' in balance &&
            balance.asset_issuer === BLEND_USDC_ISSUER,
    );
}

/** Open the Blend testnet USDC trustline. Signed locally — Nirium is not involved. */
export async function ensureUsdcTrustline(secret: string, publicKey: string): Promise<void> {
    const horizon = new Horizon.Server(HORIZON_TESTNET);
    const account = await horizon.loadAccount(publicKey);
    if (hasUsdcTrustline(account)) return;

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
    })
        .addOperation(Operation.changeTrust({ asset: blendUsdc() }))
        .setTimeout(60)
        .build();
    tx.sign(Keypair.fromSecret(secret));
    await horizon.submitTransaction(tx);
    console.log('  opened Blend testnet USDC trustline (signed locally)');
}

export function requiredUsdc(depositStroops: string): number {
    return Number(depositStroops) / 10_000_000;
}

export function missingUsdcError(publicKey: string, have: number, need: number): Error {
    return new Error(
        `Insufficient balance for the deposit. ${publicKey} holds ${have} BlendUSDC; ` +
            `this run needs at least ${need}.\n` +
            `  The vault asset is Blend testnet USDC (issuer ${BLEND_USDC_ISSUER}), not Circle USDC.\n` +
            `  This script opens the trustline if it is missing. Then request tokens from ${BLEND_FAUCET_UI} (Faucet).`,
    );
}
