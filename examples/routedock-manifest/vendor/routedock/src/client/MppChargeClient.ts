/**
 * NOT vendored from RouteDock — see PROVENANCE.md.
 *
 * The real `MppChargeClient.ts` imports `@stellar/mpp/charge/client` and
 * `mppx/client`, whose subpaths have moved in the `@stellar/mpp` version
 * `nirium` (a package this example legitimately also depends on) pulls in,
 * so those two specific packages can't be resolved together in one
 * dependency tree right now — a real transitive version conflict between
 * two otherwise-unrelated dependencies, not something worth vendoring a
 * pinned duplicate `@stellar/mpp` copy to route around for a mode this
 * example never uses.
 *
 * `RouteDockClient`'s constructor instantiates this unconditionally (so the
 * module must exist and type-check), but its `pay()` is only ever called
 * from the real, unmodified `RouteDockClient.ts` when `selectMode()` returns
 * `'mpp-charge'` — which never happens here, since this manifest only
 * declares `modes: ['x402']`.
 */
import type { Keypair } from '@stellar/stellar-sdk'
import type { RouteDockManifest, PaymentResult } from '../types.js'
import type { RetryPolicy } from '../internal/retry.js'
import { RouteDockManifestError } from '../errors.js'

export class MppChargeClient {
  constructor(
    _keypair: Keypair,
    _network: 'testnet' | 'mainnet',
    _retryPolicy?: RetryPolicy,
  ) {}

  async pay(_url: string, _manifest: RouteDockManifest): Promise<PaymentResult> {
    throw new RouteDockManifestError(
      'mpp-charge is out of scope for this example (see vendor/routedock/src/client/MppChargeClient.ts)',
    )
  }
}
