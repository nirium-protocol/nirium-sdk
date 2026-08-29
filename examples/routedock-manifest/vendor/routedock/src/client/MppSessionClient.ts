/**
 * NOT vendored from RouteDock — see PROVENANCE.md and the sibling
 * MppChargeClient.ts for why (a real `@stellar/mpp`/`mppx` subpath version
 * conflict against `nirium`'s own dependency tree, for a mode this example
 * never exercises).
 *
 * `RouteDockClient`'s constructor instantiates this unconditionally, but
 * `openSession()` is only reachable via `RouteDockClient.openSession()`,
 * which this example never calls — it only uses `pay()` against a
 * `modes: ['x402']` manifest.
 */
import type { Keypair } from '@stellar/stellar-sdk'
import type { RouteDockManifest, SessionHandle, SessionOptions } from '../types.js'
import type { RetryPolicy } from '../internal/retry.js'
import { RouteDockManifestError } from '../errors.js'

export class MppSessionClient {
  constructor(
    _keypair: Keypair,
    _network: 'testnet' | 'mainnet',
    _retryPolicy?: RetryPolicy,
  ) {}

  async openSession(
    _url: string,
    _manifest: RouteDockManifest,
    _commitmentSecret: string,
    _options?: SessionOptions,
    _onSpend?: (amount: string) => Promise<void>,
  ): Promise<SessionHandle> {
    throw new RouteDockManifestError(
      'mpp-session is out of scope for this example (see vendor/routedock/src/client/MppSessionClient.ts)',
    )
  }
}
