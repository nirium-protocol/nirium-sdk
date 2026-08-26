import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    Account,
    Asset,
    Keypair,
    Networks,
    Operation,
    TransactionBuilder,
} from '@stellar/stellar-sdk';

import { explainFailure, isInsufficientBalance, isPassphraseMismatch } from '../src/errors.ts';
import { resolveTestnetPassphrase, signUnsignedXdr, TESTNET_PASSPHRASE } from '../src/sign.ts';

function unsignedPaymentXdr(secret: string, passphrase: string): string {
    const keypair = Keypair.fromSecret(secret);
    const account = new Account(keypair.publicKey(), '1');
    return new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase })
        .addOperation(
            Operation.payment({
                destination: keypair.publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(30)
        .build()
        .toXDR();
}

test('resolveTestnetPassphrase accepts the testnet passphrase', () => {
    assert.equal(resolveTestnetPassphrase(TESTNET_PASSPHRASE), TESTNET_PASSPHRASE);
});

test('resolveTestnetPassphrase rejects the public network passphrase', () => {
    assert.throws(() => resolveTestnetPassphrase(Networks.PUBLIC), /passphrase mismatch/i);
});

test('signUnsignedXdr signs a testnet XDR with the caller key', () => {
    const secret = Keypair.random().secret();
    const xdr = unsignedPaymentXdr(secret, TESTNET_PASSPHRASE);
    const signed = signUnsignedXdr(xdr, secret, TESTNET_PASSPHRASE);
    const tx = TransactionBuilder.fromXDR(signed, TESTNET_PASSPHRASE);
    assert.equal(tx.signatures.length, 1);
});

test('signUnsignedXdr refuses to sign under the public passphrase', () => {
    const secret = Keypair.random().secret();
    const xdr = unsignedPaymentXdr(secret, TESTNET_PASSPHRASE);
    assert.throws(() => signUnsignedXdr(xdr, secret, Networks.PUBLIC), /passphrase mismatch/i);
});

test('explainFailure classifies insufficient balance', () => {
    const err = explainFailure(new Error('op_underfunded: account does not have enough XLM'));
    assert.match(err.message, /Insufficient balance/);
    assert.equal(isInsufficientBalance(err), true);
});

test('explainFailure classifies a missing USDC trustline as insufficient balance', () => {
    const err = explainFailure(new Error('trustline entry is missing for account GABC'));
    assert.match(err.message, /Insufficient balance/);
    assert.equal(isInsufficientBalance(err), true);
});

test('explainFailure classifies a passphrase mismatch from the agent', () => {
    const err = explainFailure(new Error('tx_bad_auth: wrong network passphrase'));
    assert.match(err.message, /wrong network passphrase/);
    assert.equal(isPassphraseMismatch(err), true);
});
