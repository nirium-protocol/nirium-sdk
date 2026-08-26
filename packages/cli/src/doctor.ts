import fs from 'fs';
import path from 'path';

export interface DoctorCheckResult {
  name: string;
  status: 'pass' | 'fail';
  message: string;
  fix?: string;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  network: string;
  checks: DoctorCheckResult[];
  timestamp: string;
}

export interface DoctorOptions {
  network?: string;
  config?: string;
  json?: boolean;
  fetchFn?: typeof fetch;
}

export function loadEnvFile(filePath?: string): Record<string, string> {
  const env: Record<string, string> = {};
  const targetPath = filePath
    ? path.resolve(process.cwd(), filePath)
    : path.resolve(process.cwd(), '.env');

  if (fs.existsSync(targetPath)) {
    try {
      const content = fs.readFileSync(targetPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          env[key] = val;
        }
      }
    } catch {
      // Ignore file read errors
    }
  }
  return env;
}

export function normalizeNetwork(inputNet?: string): 'stellar:testnet' | 'stellar:pubnet' {
  const net = (inputNet || '').toLowerCase();
  if (net === 'pubnet' || net === 'mainnet' || net === 'stellar:pubnet' || net === 'stellar:mainnet') {
    return 'stellar:pubnet';
  }
  return 'stellar:testnet';
}

export async function runDoctorDiagnostics(options: DoctorOptions): Promise<DoctorReport> {
  const fileEnv = loadEnvFile(options.config);
  const getEnv = (key: string): string => {
    return process.env[key] || fileEnv[key] || '';
  };

  const rawNetwork = options.network || getEnv('STELLAR_NETWORK') || getEnv('NETWORK') || 'testnet';
  const canonicalNetwork = normalizeNetwork(rawNetwork);
  const isTestnet = canonicalNetwork === 'stellar:testnet';

  const checks: DoctorCheckResult[] = [];

  // Check 1: payTo address
  const payTo = getEnv('STELLAR_PAY_TO') || getEnv('PAY_TO') || getEnv('NIRIUM_X402_PAY_TO') || getEnv('STELLAR_PAYTO');
  if (!payTo) {
    checks.push({
      name: 'payTo',
      status: 'fail',
      message: 'payTo address is missing',
      fix: 'Set STELLAR_PAY_TO in .env to a valid Stellar public key starting with G...',
    });
  } else if (payTo.startsWith('S')) {
    checks.push({
      name: 'payTo',
      status: 'fail',
      message: 'payTo address is a secret key (S...), not a public key',
      fix: 'Replace STELLAR_PAY_TO with your public key (G...). Secret keys must never be exposed as payTo.',
      detail: `Value starts with '${payTo.slice(0, 4)}...'`,
    });
  } else if (!/^G[A-Z2-7]{55}$/.test(payTo)) {
    checks.push({
      name: 'payTo',
      status: 'fail',
      message: 'payTo address is invalid (must be a 56-character Stellar G... address)',
      fix: 'Ensure STELLAR_PAY_TO is a valid 56-char Stellar public key.',
      detail: `Length: ${payTo.length}`,
    });
  } else {
    checks.push({
      name: 'payTo',
      status: 'pass',
      message: `payTo address is a valid Stellar public key (${payTo.slice(0, 4)}...${payTo.slice(-4)})`,
      detail: payTo,
    });
  }

  // Check 2: Facilitator API key & reachability
  const facilitatorApiKey =
    getEnv('X402_FACILITATOR_API_KEY') ||
    getEnv('STELLAR_FACILITATOR_API_KEY') ||
    getEnv('FACILITATOR_API_KEY');

  const defaultFacilitatorUrl = isTestnet
    ? 'https://channels.openzeppelin.com/x402/testnet'
    : 'https://channels.openzeppelin.com/x402';

  const facilitatorUrl = getEnv('FACILITATOR_URL') || getEnv('X402_FACILITATOR_URL') || defaultFacilitatorUrl;
  const customFetch = options.fetchFn || globalThis.fetch;

  if (!facilitatorApiKey && !getEnv('FACILITATOR_URL')) {
    const genUrl = isTestnet
      ? 'https://channels.openzeppelin.com/testnet/gen'
      : 'https://channels.openzeppelin.com/gen';
    checks.push({
      name: 'facilitator',
      status: 'fail',
      message: 'facilitatorApiKey is missing — OpenZeppelin Channels facilitator rejects unauthenticated requests',
      fix: `Get a free ${rawNetwork} key at ${genUrl} and set X402_FACILITATOR_API_KEY in .env`,
    });
  } else {
    try {
      const headers: Record<string, string> = {};
      if (facilitatorApiKey) {
        headers['Authorization'] = `Bearer ${facilitatorApiKey}`;
      }
      const response = await customFetch(`${facilitatorUrl}/supported`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        checks.push({
          name: 'facilitator',
          status: 'pass',
          message: `Facilitator reachable and API key authenticated on ${rawNetwork}`,
          detail: facilitatorUrl,
        });
      } else if (response.status === 401 || response.status === 403) {
        const genUrl = isTestnet
          ? 'https://channels.openzeppelin.com/testnet/gen'
          : 'https://channels.openzeppelin.com/gen';
        checks.push({
          name: 'facilitator',
          status: 'fail',
          message: `Facilitator rejected API key (HTTP ${response.status})`,
          fix: `Verify X402_FACILITATOR_API_KEY is valid for ${rawNetwork}. Keys are per-network: get one at ${genUrl}`,
          detail: `Status ${response.status} from ${facilitatorUrl}`,
        });
      } else {
        checks.push({
          name: 'facilitator',
          status: 'fail',
          message: `Facilitator returned HTTP ${response.status}`,
          fix: `Check facilitator service status at ${facilitatorUrl}`,
        });
      }
    } catch (err: any) {
      checks.push({
        name: 'facilitator',
        status: 'fail',
        message: `Facilitator endpoint unreachable at ${facilitatorUrl}`,
        fix: 'Check network connectivity or custom FACILITATOR_URL setting.',
        detail: err?.message || String(err),
      });
    }
  }

  // Check 3: Network & RPC consistency
  const defaultRpcUrl = isTestnet
    ? 'https://soroban-testnet.stellar.org'
    : 'https://soroban-rpc.mainnet.stellar.gateway.fm';
  const rpcUrl = getEnv('STELLAR_RPC_URL') || getEnv('RPC_URL') || defaultRpcUrl;
  const expectedPassphrase = isTestnet
    ? 'Test SDF Network ; July 2015'
    : 'Public Global Stellar Network ; September 2015';

  try {
    const rpcRes = await customFetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: AbortSignal.timeout(5000),
    });

    if (rpcRes.ok) {
      checks.push({
        name: 'network',
        status: 'pass',
        message: `Soroban RPC endpoint operational for ${canonicalNetwork}`,
        detail: `${rpcUrl} (Passphrase: "${expectedPassphrase}")`,
      });
    } else {
      checks.push({
        name: 'network',
        status: 'fail',
        message: `Soroban RPC endpoint returned HTTP ${rpcRes.status}`,
        fix: `Verify STELLAR_RPC_URL for network ${canonicalNetwork}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'network',
      status: 'fail',
      message: `Soroban RPC endpoint unreachable at ${rpcUrl}`,
      fix: `Check network connection or set a working STELLAR_RPC_URL for ${canonicalNetwork}`,
      detail: err?.message || String(err),
    });
  }

  // Check 4: Secret Key check (if configured)
  const secretKey = getEnv('STELLAR_SECRET_KEY') || getEnv('SECRET_KEY') || getEnv('NIRIUM_SECRET_KEY');
  if (secretKey) {
    if (!/^S[A-Z2-7]{55}$/.test(secretKey)) {
      checks.push({
        name: 'secretKey',
        status: 'fail',
        message: 'Secret key format is invalid (must be a 56-character Stellar S... key)',
        fix: 'Ensure STELLAR_SECRET_KEY is a valid Stellar secret key starting with S...',
      });
    } else {
      checks.push({
        name: 'secretKey',
        status: 'pass',
        message: 'Secret key format is valid (S...)',
      });
    }
  }

  // Check 5: MPP Configuration (if configured)
  const mppMode = getEnv('MPP_MODE');
  const mppSecret = getEnv('MPP_SECRET_KEY');
  if (mppMode || mppSecret) {
    if (mppMode && mppMode !== 'pull' && mppMode !== 'push') {
      checks.push({
        name: 'mpp',
        status: 'fail',
        message: `Invalid MPP_MODE: "${mppMode}" (must be "pull" or "push")`,
        fix: 'Set MPP_MODE=pull or MPP_MODE=push in .env',
      });
    } else if (mppSecret && !/^S[A-Z2-7]{55}$/.test(mppSecret)) {
      checks.push({
        name: 'mpp',
        status: 'fail',
        message: 'Invalid MPP_SECRET_KEY format (must be a 56-character S... key)',
        fix: 'Check MPP_SECRET_KEY in .env',
      });
    } else {
      checks.push({
        name: 'mpp',
        status: 'pass',
        message: `MPP protocol configuration valid (mode: ${mppMode || 'pull'})`,
      });
    }
  }

  const ok = checks.every((c) => c.status === 'pass');

  return {
    ok,
    network: canonicalNetwork,
    checks,
    timestamp: new Date().toISOString(),
  };
}

export function formatDoctorOutput(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`🩺 Nirium Doctor — x402/MPP Diagnostic Report`);
  lines.push(`Target Network: ${report.network}`);
  lines.push(`Timestamp:      ${report.timestamp}`);
  lines.push(`--------------------------------------------------`);

  for (const check of report.checks) {
    const symbol = check.status === 'pass' ? '✔' : '❌';
    lines.push(`${symbol} [${check.name.toUpperCase()}] ${check.message}`);
    if (check.detail && check.status === 'pass') {
      lines.push(`   Detail: ${check.detail}`);
    }
    if (check.fix) {
      lines.push(`   💡 Fix: ${check.fix}`);
    }
  }

  lines.push(`--------------------------------------------------`);
  lines.push(report.ok ? `✅ All checks passed!` : `❌ Diagnostic failed. See fix suggestions above.`);
  return lines.join('\n');
}
