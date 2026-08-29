/**
 * One-time setup for scripts/testnet-proof.ts: funds the payee and buyer
 * testnet accounts with XLM via Friendbot and opens a USDC trustline on
 * both (required before either can send/receive the SAC-wrapped classic
 * USDC asset). Real network calls — no mocks.
 *
 * This does NOT fund the buyer with testnet USDC itself — Circle's public
 * faucet (https://faucet.circle.com, network: "Stellar Testnet") gates that
 * behind reCAPTCHA, so it has to be a human step. Run this script first,
 * then request USDC for the printed buyer address at that faucet, then run
 * `npm run testnet-proof`.
 *
 * Run: npm run testnet-proof:setup
 */
import 'dotenv/config';

import {
    Asset,
    BASE_FEE,
    Horizon,
    Keypair,
    Networks,
    Operation,
    TransactionBuilder,
} from '@stellar/stellar-sdk';

// The classic Stellar issuer that @x402/stellar's USDC_TESTNET_ADDRESS SAC
// wraps — verified by deriving `new Asset('USDC', ISSUER).contractId(Networks.TESTNET)`
// and confirming it equals USDC_TESTNET_ADDRESS.
//
// NOTE: RouteDock's own `ASSET_ISSUERS.USDC.testnet` constant in
// vendor/routedock/src/client/RouteDockClient.ts (copied verbatim from their
// real source — see PROVENANCE.md) is a DIFFERENT, invalid address: it fails
// `StrKey.isValidEd25519PublicKey()` entirely (bad checksum). That constant
// only feeds RouteDockClient's trustline-preflight remediation message text
// (`preflight()` / `pay()`'s non-fatal trustline check), so it doesn't break
// this example, but it means that remediation message would print a bogus
// issuer if it were ever hit. Worth reporting upstream to winsznx/routedock.
const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

async function fundIfNeeded(server: Horizon.Server, publicKey: string): Promise<void> {
    try {
        await server.loadAccount(publicKey);
        console.log(`  already funded: ${publicKey}`);
        return;
    } catch {
        // Not found — fall through to Friendbot.
    }
    const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
    if (!res.ok) {
        throw new Error(`Friendbot funding failed for ${publicKey}: HTTP ${res.status}`);
    }
    console.log(`  funded via Friendbot: ${publicKey}`);
}

async function openTrustlineIfNeeded(
    server: Horizon.Server,
    keypair: Keypair,
): Promise<void> {
    const account = await server.loadAccount(keypair.publicKey());
    const hasTrustline = (account.balances as unknown as Array<Record<string, unknown>>).some(
        (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_TESTNET_ISSUER,
    );
    if (hasTrustline) {
        console.log(`  trustline already open: ${keypair.publicKey()}`);
        return;
    }

    const asset = new Asset('USDC', USDC_TESTNET_ISSUER);
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
    })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(30)
        .build();
    tx.sign(keypair);
    await server.submitTransaction(tx);
    console.log(`  USDC trustline opened: ${keypair.publicKey()}`);
}

async function main() {
    const payeeSecret = requireEnv('NIRIUM_ROUTEDOCK_PAYEE_SECRET');
    const buyerSecret = requireEnv('BUYER_SECRET');
    const payee = Keypair.fromSecret(payeeSecret);
    const buyer = Keypair.fromSecret(buyerSecret);

    const server = new Horizon.Server(HORIZON_URL);

    console.log('Funding accounts (Friendbot)...');
    await fundIfNeeded(server, payee.publicKey());
    await fundIfNeeded(server, buyer.publicKey());

    console.log('Opening USDC trustlines...');
    await openTrustlineIfNeeded(server, payee);
    await openTrustlineIfNeeded(server, buyer);

    console.log('\nDone. Next: get testnet USDC for the buyer at');
    console.log('  https://faucet.circle.com  (asset: USDC, network: Stellar Testnet)');
    console.log(`  address: ${buyer.publicKey()}`);
    console.log('\nThen run: npm run testnet-proof');
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var ${name}. See .env.example.`);
    }
    return value;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
