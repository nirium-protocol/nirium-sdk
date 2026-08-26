import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorDisbursementBatch } from './audit.js';
import type { BatchDescriptor } from './record.js';

interface AnchorCliOptions {
  descriptor: BatchDescriptor;
  horizonUrl?: string;
}

const usage = `Usage:
  npm run anchor -- --tx <hash> [--tx <hash> ...]
  npm run anchor -- --source <G...> --from <ISO-8601> --to <ISO-8601>

Options:
  --horizon <url>  Read-only Testnet Horizon endpoint
  --help            Show this help
`;

function nextValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseAnchorArguments(args: readonly string[]): AnchorCliOptions | null {
  const txHashes: string[] = [];
  let sourceAccount: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let horizonUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      return null;
    }
    if (argument === '--tx') {
      txHashes.push(nextValue(args, index, '--tx'));
      index += 1;
    } else if (argument === '--source') {
      if (sourceAccount !== undefined) {
        throw new Error('--source may only be provided once');
      }
      sourceAccount = nextValue(args, index, '--source');
      index += 1;
    } else if (argument === '--from') {
      if (from !== undefined) {
        throw new Error('--from may only be provided once');
      }
      from = nextValue(args, index, '--from');
      index += 1;
    } else if (argument === '--to') {
      if (to !== undefined) {
        throw new Error('--to may only be provided once');
      }
      to = nextValue(args, index, '--to');
      index += 1;
    } else if (argument === '--horizon') {
      if (horizonUrl !== undefined) {
        throw new Error('--horizon may only be provided once');
      }
      horizonUrl = nextValue(args, index, '--horizon');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }

  const hasSourceWindow = sourceAccount !== undefined || from !== undefined || to !== undefined;
  if (txHashes.length > 0 && hasSourceWindow) {
    throw new Error('Use either --tx values or --source/--from/--to, not both');
  }
  if (txHashes.length > 0) {
    return { descriptor: { txHashes }, ...(horizonUrl ? { horizonUrl } : {}) };
  }
  if (!sourceAccount || !from || !to) {
    throw new Error('Provide --tx or the complete --source/--from/--to descriptor');
  }
  return {
    descriptor: { sourceAccount, from, to },
    ...(horizonUrl ? { horizonUrl } : {}),
  };
}

export async function runAnchorCli(args: readonly string[]): Promise<void> {
  const cli = parseAnchorArguments(args);
  if (!cli) {
    process.stdout.write(usage);
    return;
  }
  const horizonUrl = cli.horizonUrl ?? process.env.HORIZON_URL;
  const anchored = await anchorDisbursementBatch({
    descriptor: cli.descriptor,
    ...(horizonUrl ? { horizonUrl } : {}),
    ...(process.env.NIRIUM_API_URL ? { niriumApiUrl: process.env.NIRIUM_API_URL } : {}),
    ...(process.env.NIRIUM_API_KEY ? { niriumApiKey: process.env.NIRIUM_API_KEY } : {}),
    ...(process.env.AUDIT_AGENT_SECRET_KEY
      ? { agentSecretKey: process.env.AUDIT_AGENT_SECRET_KEY }
      : {}),
    ...(process.env.AUDIT_AGENT_ID ? { agentId: process.env.AUDIT_AGENT_ID } : {}),
  });
  process.stdout.write(`${JSON.stringify({
    cid: anchored.cid,
    contentSha256: anchored.contentSha256,
    anchoredAt: anchored.anchoredAt,
    signature: anchored.attestedBy ? 'valid' : 'absent',
    attestedBy: anchored.attestedBy,
    paymentOperationCount: anchored.paymentOperationCount,
    record: anchored.record,
  }, null, 2)}\n`);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined
    && resolve(entryPoint) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runAnchorCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sdp-audit-anchor: ${message}\n`);
    process.exitCode = 1;
  });
}
