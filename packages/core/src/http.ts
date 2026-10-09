// One interface, two transports: the app's server client (Server Components and Actions → NestJS
// with the access cookie) and the browser client below (→ the same-origin BFF, never a token).
// Query factories take an Http, so one queryOptions prefetches on the server and refetches in the
// browser.
import type * as z from 'zod';

import { ApiError, toApiError, unwrap } from './envelope.js';

export type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Http {
  get<T extends z.ZodType>(
    path: string,
    schema: T,
    init?: { signal?: AbortSignal },
  ): Promise<z.output<T>>;
  send<T extends z.ZodType>(
    method: Method,
    path: string,
    body: unknown,
    schema: T,
  ): Promise<z.output<T>>;
  remove(path: string): Promise<void>;
}

/** Browser → `<prefix>/<path>`. A network failure is `ApiError(0)`; a 401 means the BFF could not refresh. */
export function createBffClient(prefix = '/api/bff'): Http {
  const base = prefix.replace(/\/+$/, '');

  async function call(path: string, init: RequestInit & { json?: unknown }): Promise<Response> {
    const { json, ...rest } = init;
    const headers = new Headers({ accept: 'application/json' });
    if (json !== undefined) headers.set('content-type', 'application/json');
    try {
      return await fetch(`${base}/${path.replace(/^\/+/, '')}`, {
        ...rest,
        body: json === undefined ? null : JSON.stringify(json),
        headers,
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError(0, ['network']);
    }
  }

  async function read<T extends z.ZodType>(res: Response, schema: T): Promise<z.output<T>> {
    if (!res.ok) throw await toApiError(res);
    return unwrap(schema, await res.json());
  }

  return {
    async get(path, schema, init) {
      return read(await call(path, { method: 'GET', signal: init?.signal ?? null }), schema);
    },
    async send(method, path, body, schema) {
      return read(await call(path, { method, json: body ?? {} }), schema);
    },
    async remove(path) {
      const res = await call(path, { method: 'DELETE' });
      if (!res.ok) throw await toApiError(res);
    },
  };
}
