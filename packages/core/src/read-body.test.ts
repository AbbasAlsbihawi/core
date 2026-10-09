import { describe, expect, it } from 'vitest';

import { readBodyCapped } from './read-body.js';

// `duplex` is required by undici for stream bodies and missing from the DOM RequestInit type
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);

/** A body without Content-Length (chunked), produced in 1 KB chunks on demand. */
const chunked = (bytes: number) => {
  const state = { sent: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.sent >= bytes) {
        controller.close();
        return;
      }
      const n = Math.min(1024, bytes - state.sent);
      state.sent += n;
      controller.enqueue(new Uint8Array(n).fill(97));
    },
  });
  return { stream, state };
};

describe('readBodyCapped', () => {
  it('returns the text of a body within the cap, counting UTF-8 bytes', async () => {
    expect(await readBodyCapped(post('{"a":1}'), 16)).toBe('{"a":1}');
    expect(await readBodyCapped(post('عربي'), 8)).toBe('عربي'); // 8 bytes, 4 UTF-16 units
    expect(await readBodyCapped(post('عربي'), 7)).toBeNull();
  });

  it('rejects a declared Content-Length over the cap without reading the body', async () => {
    const req = post('tiny', { 'content-length': '999999' });
    expect(await readBodyCapped(req, 1024)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it('stops reading a chunked body as soon as it crosses the cap', async () => {
    const big = chunked(3 * 1024 * 1024);
    expect(await readBodyCapped(post(big.stream), 16 * 1024)).toBeNull();
    expect(big.state.sent).toBeLessThan(64 * 1024); // cancelled, not drained
    expect(await readBodyCapped(post(chunked(2048).stream), 4096)).toHaveLength(2048);
  });

  it('treats a missing body as empty', async () => {
    expect(await readBodyCapped(new Request('http://localhost/api/x'), 10)).toBe('');
  });
});
