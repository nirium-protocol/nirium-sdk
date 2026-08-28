import assert from 'node:assert/strict';
import { test } from 'node:test';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Keypair } from '@stellar/stellar-sdk';
// See vendor/routedock/PROVENANCE.md — these are RouteDock's own real files,
// copied verbatim, not reimplemented.
import { signManifest, verifyManifestSignature } from '../vendor/routedock/src/manifest/sign.ts';
import routedockSchema from '../vendor/routedock/src/schemas/routedock.schema.json' with { type: 'json' };

import { buildSignalsManifest, NIRIUM_X402_FACILITATOR, SIGNALS_RESOURCE_PATH } from '../src/manifest.ts';

// Validates against RouteDock's own real schema — not a local copy of it.
// Typed as Record<string, unknown> (mirroring RouteDock's own schema.ts)
// so ajv.compile() doesn't infer its generic from the JSON's literal shape.
const schema: Record<string, unknown> = routedockSchema;
const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

function demoManifest() {
    const payee = Keypair.random();
    const manifest = buildSignalsManifest({
        network: 'testnet',
        payee: payee.publicKey(),
        priceUsdc: '0.02',
    });
    return { payee, manifest };
}

test('unsigned manifest matches RouteDock\'s published JSON Schema shape once signed', () => {
    const { payee, manifest } = demoManifest();
    const signed = signManifest(manifest, payee.secret());

    const valid = validate(signed);
    assert.equal(valid, true, ajv.errorsText(validate.errors ?? []));
});

test('signed manifest verifies against the declared payee', () => {
    const { payee, manifest } = demoManifest();
    const signed = signManifest(manifest, payee.secret());

    assert.doesNotThrow(() => verifyManifestSignature(signed, payee.publicKey()));
});

test('signature verification rejects a substituted payee (out-of-band trust anchor)', () => {
    const { payee, manifest } = demoManifest();
    const signed = signManifest(manifest, payee.secret());
    const attacker = Keypair.random();

    assert.throws(() => verifyManifestSignature(signed, attacker.publicKey()));
});

test('signature verification rejects a tampered field', () => {
    const { payee, manifest } = demoManifest();
    const signed = signManifest(manifest, payee.secret());

    const tampered = { ...signed, pricing: { ...signed.pricing, x402: { ...signed.pricing.x402!, amount: '0.00' } } };
    assert.throws(() => verifyManifestSignature(tampered, payee.publicKey()));
});

test('manifest declares the real Nirium x402 facilitator and resource path', () => {
    const { manifest } = demoManifest();

    assert.equal(manifest.pricing.x402?.facilitator, NIRIUM_X402_FACILITATOR.testnet);
    assert.equal(manifest.endpoints.signals?.path, SIGNALS_RESOURCE_PATH);
    assert.equal(manifest.endpoints.signals?.method, 'GET');
    assert.deepEqual(manifest.modes, ['x402']);
});
