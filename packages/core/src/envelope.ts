// The response envelopes of new-structure-backend and the one error type the apps handle. Pure:
// server and browser.
import * as z from 'zod';

/** ResponseInterceptor: every success is `{ success: true, data, timestamp }`. */
export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, timestamp: z.string() });
}

const anyEnvelope = envelope(z.unknown());

/** `envelope(schema).parse(x).data` does not type-check inside a generic function — hence unwrap. */
export function unwrap<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  return schema.parse(anyEnvelope.parse(body).data);
}

const nestMessage = z.union([z.string(), z.array(z.string())]);

/**
 * AllExceptionsFilter: `message` is HttpException#getResponse() — a string for
 * `new HttpException('x', 400)`, but an object `{ statusCode, message, error }` for every built-in
 * exception and ValidationPipe 400. Anything that is not an HttpException gives a plain string.
 */
const nestErrorSchema = z.object({
  success: z.literal(false),
  statusCode: z.number(),
  message: z.union([
    nestMessage,
    z.looseObject({ message: nestMessage.optional(), error: z.string().optional() }),
  ]),
  timestamp: z.string(),
  path: z.string(),
});

export type ErrorKey =
  | 'errors.http400'
  | 'errors.http401'
  | 'errors.http403'
  | 'errors.http404'
  | 'errors.http409'
  | 'errors.http500'
  | 'errors.network';

const ERROR_KEYS: Partial<Record<number, ErrorKey>> = {
  400: 'errors.http400',
  401: 'errors.http401',
  403: 'errors.http403',
  404: 'errors.http404',
  409: 'errors.http409',
};

export class ApiError extends Error {
  readonly status: number; // no parameter properties (erasableSyntaxOnly)
  readonly messages: readonly string[];

  constructor(status: number, messages: readonly string[] = []) {
    super(messages[0] ?? `HTTP ${String(status)}`);
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
  }

  /** Key in the "common" namespace — never display `messages` (English server text). */
  get messageKey(): ErrorKey {
    return ERROR_KEYS[this.status] ?? (this.status === 0 ? 'errors.network' : 'errors.http500');
  }
}

export function parseNestError(status: number, body: unknown): ApiError {
  const parsed = nestErrorSchema.safeParse(body);
  if (!parsed.success) return new ApiError(status);
  const { message } = parsed.data;
  const inner = typeof message === 'object' && !Array.isArray(message) ? message.message : message;
  return new ApiError(status, inner === undefined ? [] : Array.isArray(inner) ? inner : [inner]);
}

export async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // empty or non-JSON body (e.g. a bare 401 from the BFF)
  }
  return parseNestError(res.status, body);
}
