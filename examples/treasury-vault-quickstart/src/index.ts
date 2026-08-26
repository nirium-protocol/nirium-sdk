/**
 * Non-custodial treasury vault quickstart.
 *
 * Loop (every on-chain step):
 *   1. Agent builds an UNSIGNED XDR  — Nirium never sees a private key
 *   2. This process signs it with YOUR testnet keypair
 *   3. Agent.submitTreasuryTx broadcasts the signed XDR
 *
 * The SDK's Agent is used only as an HTTP client. Signing happens here,
 * with @stellar/stellar-sdk, against the testnet passphrase.
 */
import 'dotenv/config';

import { Horizon } from '@stellar/stellar-sdk';
import { Agent } from 'nirium';

import { attachBearerIfJwt, resolveApiKey } from './auth.ts';
import { explainFailure } from './errors.ts';
import { publicKeyFromSecret, resolveTestnetPassphrase, signUnsignedXdr } from './sign.ts';
import { ensureUsdcTrustline, missingUsdcError, requiredUsdc, usdcBalance } from './usdc.ts';

const DEFAULT_BASE_URL = 'https://nirium-agent.fly.dev';
const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const MIN_XLM = 10;

interface TreasuryInfo {
    network: string;
    signing?: string;
    defindex: {
        usdc: string;
        cetes: string;
        strategies: {
            usdcBlend: string;
            cetesBlend: string;
        };
    };
}

interface ManagedFund {
    asset: string;
    idle_amount?: string;
    invested_amount?: string;
    total_amount?: string;
}

interface VaultState {
    vault: string;
    network: string;
    holderBalance?: string;
    totalManagedFunds?: ManagedFund[];
    roles?: {
        manager?: string;
        rebalanceManager?: string;
    };
}

async function main(): Promise<void> {
    const secret = requireTestnetSecret();
    const passphrase = resolveTestnetPassphrase(process.env.NETWORK_PASSPHRASE);
    const caller = publicKeyFromSecret(secret);
    const manager = process.env.VAULT_MANAGER?.trim() || caller;
    const baseUrl = (process.env.NIRIUM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');

    console.log('Nirium treasury vault quickstart (testnet, non-custodial)');
    console.log(`  caller / signer: ${caller}`);
    console.log(`  manager:         ${manager}`);
    console.log(`  agent:           ${baseUrl}`);
    console.log(`  passphrase:      ${passphrase}`);
    console.log('');

    await preflightXlm(caller);

    const apiKey = await resolveApiKey(baseUrl, caller);
    attachBearerIfJwt(apiKey, baseUrl);

    // Agent is an HTTP client. It does not receive STELLAR_SECRET_KEY.
    const agent = new Agent({ apiKey, baseUrl });

    const info = (await agent.getTreasuryInfo()) as unknown as TreasuryInfo;
    if (info.network && info.network !== 'testnet') {
        throw new Error(`Agent is on "${info.network}", not testnet. Point NIRIUM_BASE_URL at the testnet agent.`);
    }
    console.log(`  custody model:   ${info.signing ?? 'Every endpoint returns an unsigned XDR.'}`);

    const { asset, strategy, label } = pickAsset(info);
    const depositAmount = process.env.DEPOSIT_AMOUNT_STROOPS?.trim() || '10000000';
    const invest = (process.env.INVEST ?? 'false').toLowerCase() === 'true';
    const name = process.env.VAULT_NAME?.trim() || `Quickstart ${caller.slice(-4)}`;
    const symbol = (process.env.VAULT_SYMBOL?.trim() || `QS${caller.slice(-3)}`).slice(0, 10);

    console.log(`  vault asset:     ${label} ${asset}`);
    console.log(`  strategy:        ${strategy}`);
    console.log(`  deposit:         ${depositAmount} stroops (invest=${invest})`);
    console.log('');

    if (label === 'usdc-blend') {
        await ensureUsdcTrustline(secret, caller);
        const have = await usdcBalance(caller);
        const need = requiredUsdc(depositAmount);
        console.log(`  USDC balance:    ${have}`);
        if (have < need) {
            throw missingUsdcError(caller, have, need);
        }
    }

    const signAndSubmit = async (xdr: string, step: string) => {
        console.log(`→ ${step}: signing unsigned XDR locally (Agent never sees the key)`);
        const signedXdr = signUnsignedXdr(xdr, secret, passphrase);
        const result = await agent.submitTreasuryTx(signedXdr);
        const explorer = result.explorer || explorerTx(result.hash);
        console.log(`  tx: ${explorer}`);
        return result;
    };

    try {
        const existingVault = process.env.VAULT_ID?.trim();
        let vaultId = existingVault;
        let deployed: { hash: string; explorer?: string; contract?: string } | undefined;

        if (vaultId) {
            console.log(`1/3 reuse VAULT_ID ${vaultId} (skip deploy)`);
        } else {
            console.log('1/3 deployTreasuryVault — Agent returns unsigned XDR');
            const deploy = await agent.deployTreasuryVault({
                caller,
                manager,
                assets: [{ address: asset, strategies: [{ address: strategy, name: label }] }],
                name,
                symbol,
            });
            deployed = await signAndSubmit(deploy.xdr, 'deploy');
            vaultId = deployed.contract;
            if (!vaultId) {
                throw new Error('Deploy confirmed but the agent did not return a vault contract id.');
            }
        }
        console.log(`  vault: ${vaultId}`);
        console.log('');

        console.log('2/3 depositToTreasuryVault — Agent returns unsigned XDR');
        const deposit = await agent.depositToTreasuryVault({
            vault: vaultId,
            from: caller,
            amounts: [depositAmount],
            invest,
        });
        const deposited = await signAndSubmit(deposit.xdr, 'deposit');
        console.log('');

        console.log('3/3 getTreasuryVault — idle vs invested');
        const state = (await agent.getTreasuryVault(vaultId, caller)) as unknown as VaultState;
        printIdleInvested(state);

        console.log('');
        console.log('Done. Paste these into the PR description:');
        if (deployed) {
            console.log(`  deploy:  ${deployed.explorer || explorerTx(deployed.hash)}`);
        } else if (existingVault) {
            console.log(`  deploy:  (reused ${existingVault})`);
        }
        console.log(`  deposit: ${deposited.explorer || explorerTx(deposited.hash)}`);
    } catch (err) {
        throw explainFailure(err);
    }
}

function requireTestnetSecret(): string {
    const secret = process.env.STELLAR_SECRET_KEY?.trim();
    if (!secret) {
        throw new Error(
            'Set STELLAR_SECRET_KEY in .env to your own funded testnet secret (S...).\n' +
                'This value is used only to sign locally — it is never sent to Nirium.',
        );
    }
    if (secret.startsWith('G')) {
        throw new Error('STELLAR_SECRET_KEY is a public key (G...). You need the secret seed (S...).');
    }
    return secret;
}

async function preflightXlm(address: string): Promise<void> {
    const horizon = new Horizon.Server(HORIZON_TESTNET);
    try {
        const account = await horizon.loadAccount(address);
        const native = account.balances.find((b) => b.asset_type === 'native');
        const xlm = native ? Number(native.balance) : 0;
        console.log(`  XLM balance:     ${xlm}`);
        if (xlm < MIN_XLM) {
            throw new Error(
                `Insufficient balance: account ${address} has ${xlm} XLM, need at least ${MIN_XLM} for deploy fees.\n` +
                    `Fund it: ${FRIENDBOT}?addr=${address}`,
            );
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|404/i.test(message)) {
            throw new Error(
                `Account ${address} is not on testnet yet. Fund it first:\n` +
                    `  ${FRIENDBOT}?addr=${address}`,
            );
        }
        throw err;
    }
}

function pickAsset(info: TreasuryInfo): { asset: string; strategy: string; label: string } {
    const choice = (process.env.VAULT_ASSET ?? 'usdc').trim().toLowerCase();
    if (choice === 'cetes') {
        return {
            asset: process.env.VAULT_ASSET_ID?.trim() || info.defindex.cetes,
            strategy: process.env.VAULT_STRATEGY_ID?.trim() || info.defindex.strategies.cetesBlend,
            label: 'cetes-blend',
        };
    }
    if (choice !== 'usdc') {
        throw new Error(`VAULT_ASSET must be "usdc" or "cetes", got "${choice}".`);
    }
    return {
        asset: process.env.VAULT_ASSET_ID?.trim() || info.defindex.usdc,
        strategy: process.env.VAULT_STRATEGY_ID?.trim() || info.defindex.strategies.usdcBlend,
        label: 'usdc-blend',
    };
}

function printIdleInvested(state: VaultState): void {
    const funds = state.totalManagedFunds ?? [];
    if (funds.length === 0) {
        console.log(`  vault ${state.vault}: no managed-funds snapshot yet`);
        return;
    }
    for (const row of funds) {
        console.log(`  vault   ${state.vault}`);
        console.log(`  asset   ${row.asset}`);
        console.log(`  idle      ${formatStroops(row.idle_amount)}`);
        console.log(`  invested  ${formatStroops(row.invested_amount)}`);
        console.log(`  total     ${formatStroops(row.total_amount)}`);
        if (state.holderBalance) {
            console.log(`  holder    ${formatStroops(state.holderBalance)} of vault asset`);
        }
        if (state.roles?.manager) {
            console.log(`  manager   ${state.roles.manager}  (can rescue / pause / revoke rebalance)`);
        }
        if (state.roles?.rebalanceManager) {
            console.log(`  rebalance ${state.roles.rebalanceManager}  (cannot withdraw)`);
        }
    }
}

function formatStroops(value?: string): string {
    if (value === undefined) return 'n/a';
    const raw = BigInt(value);
    const decimals = 7n;
    const base = 10n ** decimals;
    const whole = raw / base;
    const frac = (raw % base).toString().padStart(Number(decimals), '0');
    return `${whole.toString()}.${frac} (${value} stroops)`;
}

function explorerTx(hash: string): string {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
});
