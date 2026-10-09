// CSRF guard for Route Handlers, which have no Origin check of their own (only Server Actions do).
// Pure: the app turns `false` into its own 403 response.

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when a state-changing request comes from `appOrigin` (safe methods always pass). */
export function isSameOrigin(request: Request, appOrigin: string): boolean {
  if (SAFE.has(request.method)) return true;
  const site = request.headers.get('sec-fetch-site'); // cannot be forged from page JavaScript
  if (site && site !== 'same-origin') return false;
  return request.headers.get('origin') === new URL(appOrigin).origin;
}
