import { describe, expect, it } from 'vitest';

import { makeNonce, nonceCsp, staticCsp } from './csp.js';

const directives = (csp: string) =>
  new Map(
    csp.split('; ').map((d) => {
      const [name = '', ...values] = d.split(' ');
      return [name, values] as const;
    }),
  );

describe('makeNonce', () => {
  it('is 128-bit base64 and unique per call', () => {
    const nonces = new Set(Array.from({ length: 200 }, makeNonce));
    expect(nonces.size).toBe(200);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('nonceCsp (production)', () => {
  const raw = nonceCsp('abc123');
  const csp = directives(raw);

  it('is the header template-admin 1.0.0 sent, directive for directive and in the same order', () => {
    expect(raw).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc123' 'strict-dynamic'; " +
        "style-src 'self' 'nonce-abc123'; style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'; report-to csp; report-uri /api/csp-report; upgrade-insecure-requests",
    );
  });

  it('allows scripts only by nonce + strict-dynamic, never unsafe-inline/eval', () => {
    expect(csp.get('script-src')).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(raw).not.toContain("'unsafe-eval'");
    expect(raw.match(/'unsafe-inline'/g)).toHaveLength(1); // style-src-attr only
  });

  it('nonces <style> elements and allows only style="" attributes inline', () => {
    expect(csp.get('style-src')).toEqual(["'self'", "'nonce-abc123'"]);
    expect(csp.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
  });

  it('locks down framing, plugins, base and forms, and reports violations', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.get('report-to')).toEqual(['csp']);
    expect(csp.get('report-uri')).toEqual(['/api/csp-report']);
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
  });
});

describe('nonceCsp options', () => {
  it('development: unsafe-eval for React tooling, inline styles for HMR, no upgrade', () => {
    const csp = directives(nonceCsp('abc123', { dev: true }));
    expect(csp.get('script-src')).toContain("'unsafe-eval'");
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.has('upgrade-insecure-requests')).toBe(false);
  });

  it('extend adds sources without replacing the defaults or duplicating them', () => {
    const csp = directives(
      nonceCsp('n', {
        extend: { 'img-src': ['https://cdn.example', "'self'"], 'media-src': ["'self'"] },
      }),
    );
    expect(csp.get('img-src')).toEqual(["'self'", 'blob:', 'data:', 'https://cdn.example']);
    expect(csp.get('media-src')).toEqual(["'self'"]);
  });

  it('upgradeInsecureRequests: false on an http origin, true forced even in development', () => {
    expect(
      directives(nonceCsp('n', { upgradeInsecureRequests: false })).has(
        'upgrade-insecure-requests',
      ),
    ).toBe(false);
    expect(
      directives(staticCsp({ upgradeInsecureRequests: false })).has('upgrade-insecure-requests'),
    ).toBe(false);
    expect(
      directives(nonceCsp('n', { dev: true, upgradeInsecureRequests: true })).has(
        'upgrade-insecure-requests',
      ),
    ).toBe(true);
    // the default keeps the header of 1.x byte for byte
    expect(nonceCsp('n')).toBe(nonceCsp('n', { upgradeInsecureRequests: true }));
  });

  it('reportPath null drops both report directives', () => {
    const csp = directives(nonceCsp('n', { reportPath: null }));
    expect(csp.has('report-to')).toBe(false);
    expect(csp.has('report-uri')).toBe(false);
  });
});

describe('staticCsp (prerendered pages)', () => {
  it('allows inline scripts by hash only when hashes are known', () => {
    const csp = directives(staticCsp({ hashes: ['sha256-AAA=', 'sha256-BBB='] }));
    expect(csp.get('script-src')).toEqual(["'self'", "'sha256-AAA='", "'sha256-BBB='"]);
  });

  it.each([[undefined], [null], [[]]])(
    'falls back to unsafe-inline without hashes (%j)',
    (hashes) => {
      expect(directives(staticCsp({ hashes })).get('script-src')).toEqual([
        "'self'",
        "'unsafe-inline'",
      ]);
    },
  );

  it('carries no nonce and keeps the other directives of the nonce policy', () => {
    const raw = staticCsp();
    expect(raw).not.toContain('nonce-');
    expect(raw).not.toContain('strict-dynamic');
    const csp = directives(raw);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(raw.startsWith("default-src 'self'; script-src")).toBe(true);
  });
});
