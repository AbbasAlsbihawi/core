import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { ApiError, parseNestError, toApiError, unwrap } from './envelope.js';

describe('unwrap', () => {
  it('returns the validated data of the success envelope', () => {
    const body = { success: true, data: { id: 'u1' }, timestamp: 't' };
    expect(unwrap(z.object({ id: z.string() }), body)).toEqual({ id: 'u1' });
  });

  it.each([
    [{ id: 'u1' }], // no envelope
    [{ success: false, data: { id: 'u1' }, timestamp: 't' }],
    [{ success: true, data: { id: 1 }, timestamp: 't' }], // data of the wrong shape
  ])('throws for %j', (body) => {
    expect(() => unwrap(z.object({ id: z.string() }), body)).toThrow();
  });
});

const error = (message: unknown) => ({
  success: false,
  statusCode: 400,
  message,
  timestamp: 't',
  path: '/api/v1/x',
});

describe('parseNestError (AllExceptionsFilter)', () => {
  it('reads a ValidationPipe 400: message is getResponse() with a string array inside', () => {
    const err = parseNestError(
      400,
      error({ statusCode: 400, message: ['email must be an email'], error: 'Bad Request' }),
    );
    expect(err.messages).toEqual(['email must be an email']);
    expect(err.messageKey).toBe('errors.http400');
  });

  it('reads a built-in exception: one string inside the object', () => {
    const err = parseNestError(401, error({ statusCode: 401, message: 'Invalid credentials' }));
    expect(err.messages).toEqual(['Invalid credentials']);
    expect(err.messageKey).toBe('errors.http401');
  });

  it('reads a BusinessException or a 500: a plain string', () => {
    expect(parseNestError(500, error('Internal server error')).messages).toEqual([
      'Internal server error',
    ]);
  });

  it('keeps the status of a body that is not a NestJS error', () => {
    const err = parseNestError(502, '<html>Bad gateway</html>');
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.messages).toEqual([]);
    expect(err.messageKey).toBe('errors.http500');
  });

  it('maps status 0 to the network message', () => {
    expect(new ApiError(0).messageKey).toBe('errors.network');
  });
});

describe('toApiError', () => {
  it('accepts an empty body (a bare 401 from the BFF)', async () => {
    const err = await toApiError(new Response(null, { status: 401 }));
    expect(err.status).toBe(401);
    expect(err.messageKey).toBe('errors.http401');
  });
});
