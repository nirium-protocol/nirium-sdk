export class HttpResponseError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpResponseError';
    this.status = status;
  }
}

export interface FetchJsonOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes: number;
  maxRetries?: number;
  sleepFn?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, 10_000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), 10_000);
    }
  }
  return Math.min(250 * (2 ** attempt), 2_000);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  origin: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Response from ${origin} exceeds ${maxBytes} bytes`);
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`Response from ${origin} exceeds ${maxBytes} bytes`);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchJson(
  url: URL,
  options: FetchJsonOptions,
): Promise<unknown> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 2;
  const sleepFn = options.sleepFn ?? defaultSleep;
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new Error('maxBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('timeoutMs must be an integer between 1 and 120000');
  }
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error('maxRetries must be an integer between 0 and 5');
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxRetries) {
          clearTimeout(timeout);
          await response.body?.cancel();
          await sleepFn(retryDelay(response, attempt));
          continue;
        }
        throw new HttpResponseError(response.status, url.toString());
      }

      const bytes = await readBoundedBody(response, options.maxBytes, url.origin);
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        throw new Error(`Response from ${url.origin} is not valid JSON`);
      }
    } catch (error) {
      if (
        attempt < maxRetries
        && !(error instanceof HttpResponseError)
        && !(error instanceof SyntaxError)
        && !(error instanceof Error && error.message.includes('exceeds'))
        && !(error instanceof Error && error.message.includes('not valid JSON'))
      ) {
        await sleepFn(Math.min(250 * (2 ** attempt), 2_000));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Request failed: ${url.toString()}`);
}
