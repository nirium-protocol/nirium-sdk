import { Agent } from 'nirium';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const TESTNET_NETWORK = 'stellar:testnet';
const TESTNET_EXPLORER = 'https://stellar.expert/explorer/testnet/tx';

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function signTransactionXdr(unsignedXdr: string, secretKey: string): string {
    const transaction = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
    transaction.sign(Keypair.fromSecret(secretKey));
    return transaction.toXDR();
}

function firstString(value: unknown, keys: string[]): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        if (typeof record[key] === 'string' && record[key]) return record[key];
    }
    return undefined;
}

function transactionHash(value: unknown): string | undefined {
    const direct = firstString(value, ['txHash', 'transactionHash', 'hash']);
    if (direct) return direct;

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return transactionHash(record.transaction) ?? transactionHash(record.result);
    }

    return undefined;
}

function explorerUrl(hash: string): string {
    return `${TESTNET_EXPLORER}/${hash}`;
}

function assertTestnet(): void {
    const network = process.env.NIRIUM_NETWORK?.trim() || TESTNET_NETWORK;
    if (network !== TESTNET_NETWORK) {
        throw new Error(`This example is testnet-only. Set NIRIUM_NETWORK=${TESTNET_NETWORK}.`);
    }
}

async function main(): Promise<void> {
    assertTestnet();

    const apiKey = required('NIRIUM_API_KEY');
    const baseUrl = required('NIRIUM_BASE_URL');
    const payerSecret = required('PAYER_SECRET_KEY');
    const sponsorSecret = required('SPONSOR_SECRET_KEY');
    const recipient = required('RECIPIENT_PUBLIC_KEY');
    const amount = process.env.PAYOUT_AMOUNT?.trim() || '1.00';
    const asset = process.env.PAYOUT_ASSET?.trim() || 'USDC';
    const sponsor = process.env.SPONSOR_PUBLIC_KEY?.trim() || Keypair.fromSecret(sponsorSecret).publicKey();

    const agent = new Agent({ apiKey, baseUrl });

    console.log(`Network: ${TESTNET_NETWORK}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Asset: ${asset}`);
    console.log('Requesting the sponsored trustline transaction...');

    const onboardingDraft = await agent.onboardPayoutRecipient(recipient, { asset, sponsor });
    if (!onboardingDraft.xdr) {
        throw new Error('The onboarding response did not include an unsigned XDR.');
    }

    const signedOnboardingXdr = signTransactionXdr(onboardingDraft.xdr, sponsorSecret);
    const onboardingResult = await agent.submitPayoutOnboard(signedOnboardingXdr);
    const onboardingHash = transactionHash(onboardingResult);
    if (!onboardingHash) {
        throw new Error('The onboarding response did not include a transaction hash.');
    }

    console.log(`Onboarding transaction: ${explorerUrl(onboardingHash)}`);
    console.log('Building the payroll batch...');

    const run = await agent.createPayoutRun({
        recipients: [{ wallet: recipient, amount }],
        asset,
        acknowledgeTerms: true,
    });
    if (!run.runId || !run.xdr) {
        throw new Error('The payout response did not include both runId and unsigned XDR.');
    }

    const signedPayoutXdr = signTransactionXdr(run.xdr, payerSecret);
    const submitted = await agent.submitPayout(run.runId, signedPayoutXdr);
    const history = await agent.getPayoutRuns();
    const completedRun = history.runs.find((candidate) => candidate.runId === run.runId);
    const payoutHash = transactionHash(submitted) ?? transactionHash(completedRun);
    const receiptCid = firstString(submitted, ['cid', 'receiptCid', 'ipfsCid'])
        ?? firstString(completedRun, ['cid', 'receiptCid', 'ipfsCid']);

    if (!payoutHash || !receiptCid) {
        throw new Error('The payout result did not include both a transaction hash and IPFS receipt CID.');
    }

    console.log(`Payout transaction: ${explorerUrl(payoutHash)}`);
    console.log(`IPFS receipt CID: ${receiptCid}`);
    console.log('Payroll quickstart completed. No private key was sent to the API.');
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Payroll quickstart failed: ${message}`);
    process.exitCode = 1;
});
