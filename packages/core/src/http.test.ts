import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { ApiError } from './envelope.js';
import { createBffClient } from './http.js';

const fetchMock = vi.fn<typeof fetch>();
const user = z.object({ id: z.string() });
const ok = (data: unknown, status = 200) =>
  Response.json({ success: true, data, timestamp: 't' }, { status });

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(ok({ id: 'u1' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sent = (n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] ?? [];
  return {
    url: url instanceof URL ? url.href : url instanceof Request ? url.url : url,
    init,
    headers: new Headers(init?.headers),
  };
};

describe('createBffClient', () => {
  it('gets <prefix>/<path> same-origin and returns the validated data', async () => {
    const http = createBffClient();
    await expect(http.get('/users/u1', user)).resolves.toEqual({ id: 'u1' });
    const { url, init, headers } = sent();
    expect(url).toBe('/api/bff/users/u1');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('content-type')).toBe(false);
  });

  it('sends JSON with its content type (the BFF refuses anything else)', async () => {
    await createBffClient('/api/account/').send('PATCH', 'me', { name: 'Ali' }, user);
    const { url, init, headers } = sent();
    expect(url).toBe('/api/account/me');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe('{"name":"Ali"}');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('deletes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(createBffClient().remove('users/u1')).resolves.toBeUndefined();
    expect(sent().init?.method).toBe('DELETE');
  });

  it('throws the ApiError of a NestJS error', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { success: false, statusCode: 409, message: 'taken', timestamp: 't', path: '/' },
        { status: 409 },
      ),
    );
    const error = await createBffClient()
      .send('POST', 'users', {}, user)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, messages: ['taken'], messageKey: 'errors.http409' });
  });

  it('turns a network failure into ApiError(0)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createBffClient().get('users', user)).rejects.toMatchObject({
      status: 0,
      messageKey: 'errors.network',
    });
  });
});
