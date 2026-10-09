// Content-Security-Policy builders. Pure and runtime-agnostic (Web Crypto, no node: imports):
// the proxy runs them on Node, a cache handler or an edge function may too.
//   nonceCsp  — pages rendered per request (template-admin, cart/checkout/account of a store)
//   staticCsp — prerendered/ISR pages, which cannot carry a per-request nonce

export const CSP_REPORT_PATH = '/api/csp-report';

/** 128 bits from the CSPRNG, base64 (valid in a 'nonce-…' source). */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Extra sources per directive, e.g. { 'img-src': ['https://cdn.example.com'] }. */
export type CspDirectives = Readonly<Record<string, readonly string[]>>;

export interface CspOptions {
  /** next dev: React needs eval, and Turbopack injects unnonced styles */
  dev?: boolean;
  /** Same-origin path that receives reports (report-uri + Reporting-Endpoints "csp"); null = none */
  reportPath?: string | null;
  /** Added to the defaults (never replaces them) */
  extend?: CspDirectives;
}

// After script-src/style-src; 'default-src' always comes first (template-admin's header, unchanged).
const rest = (dev: boolean, reportPath: string | null): Record<string, string[]> => ({
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"], // next/font self-hosts the fonts
  'connect-src': ["'self'"], // BFF only: the browser never talks to the API
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  ...(reportPath ? { 'report-to': ['csp'], 'report-uri': [reportPath] } : {}),
  ...(dev ? {} : { 'upgrade-insecure-requests': [] }),
});

function serialize(directives: Record<string, string[]>, extend: CspDirectives = {}): string {
  const merged: Record<string, string[]> = { ...directives };
  for (const [name, sources] of Object.entries(extend)) {
    merged[name] = [...new Set([...(merged[name] ?? []), ...sources])];
  }
  return Object.entries(merged)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

/** Per-request nonce + 'strict-dynamic'. Next nonces its own tags from the request's CSP header. */
export function nonceCsp(
  nonce: string,
  { dev = false, reportPath = CSP_REPORT_PATH, extend }: CspOptions = {},
): string {
  return serialize(
    {
      'default-src': ["'self'"],
      'script-src': [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(dev ? ["'unsafe-eval'"] : []),
      ],
      'style-src': ["'self'", dev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
      // a nonce never applies to style="" attributes (next/image, Base UI, colour swatches)
      'style-src-attr': ["'unsafe-inline'"],
      ...rest(dev, reportPath),
    },
    extend,
  );
}

export interface StaticCspOptions extends CspOptions {
  /**
   * sha256-… of the page's inline scripts (the RSC payload pushes), computed when the HTML was
   * stored. Without them — a page rendered for the first time, or just expired — the policy falls
   * back to 'unsafe-inline' for scripts: the page then works, with a weaker script policy.
   */
  hashes?: readonly string[] | null;
}

/** For prerendered/ISR pages: inline scripts allowed by hash, or by 'unsafe-inline' as a fallback. */
export function staticCsp({
  hashes,
  dev = false,
  reportPath = CSP_REPORT_PATH,
  extend,
}: StaticCspOptions = {}): string {
  const scripts = hashes?.length ? hashes.map((h) => `'${h}'`) : ["'unsafe-inline'"];
  return serialize(
    {
      'default-src': ["'self'"],
      'script-src': ["'self'", ...scripts, ...(dev ? ["'unsafe-eval'"] : [])],
      'style-src': ["'self'", "'unsafe-inline'"], // no nonce exists for prerendered styles either
      ...rest(dev, reportPath),
    },
    extend,
  );
}
