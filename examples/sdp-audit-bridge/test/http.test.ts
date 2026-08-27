import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJson } from '../src/http.js';

test('streaming response bodies are stopped as soon as the byte limit is exceeded', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"payload":"'));
      controller.enqueue(new Uint8Array(128));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    () => fetchJson(new URL('https://gateway.test/ipfs/cid'), {
      maxBytes: 32,
      maxRetries: 0,
      fetchFn: async () => new Response(body),
    }),
    /exceeds 32 bytes/,
  );
  assert.equal(cancelled, true);
});

test('the request timeout remains active while a response body is streaming', async () => {
  const fetchFn: typeof fetch = async (_input, init): Promise<Response> => {
    const signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => {
          controller.error(signal.reason);
        }, { once: true });
      },
    }));
  };

  await assert.rejects(
    () => fetchJson(new URL('https://gateway.test/ipfs/cid'), {
      maxBytes: 32,
      timeoutMs: 10,
      maxRetries: 0,
      fetchFn,
    }),
  );
});

test('retry and timeout limits reject configurations that could loop indefinitely', async () => {
  const fetchFn: typeof fetch = async () => new Response('{}');
  await assert.rejects(
    () => fetchJson(new URL('https://horizon.test'), {
      maxBytes: 32,
      maxRetries: Number.POSITIVE_INFINITY,
      fetchFn,
    }),
    /maxRetries must be an integer between 0 and 5/,
  );
  await assert.rejects(
    () => fetchJson(new URL('https://horizon.test'), {
      maxBytes: 32,
      timeoutMs: 0,
      fetchFn,
    }),
    /timeoutMs must be an integer between 1 and 120000/,
  );
});
