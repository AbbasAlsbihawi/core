import { describe, expect, it } from 'vitest';

import { MAX_REPORTS, parseCspReport } from './csp-report.js';

const violation = (i: number) => ({
  type: 'csp-violation',
  body: {
    documentURL: `https://app.example/en/users?token=secret${String(i)}`,
    effectiveDirective: 'script-src-elem',
    blockedURL: 'inline',
  },
});

describe('parseCspReport', () => {
  it('reads the legacy report-uri format, dropping query strings', () => {
    expect(
      parseCspReport({
        'csp-report': {
          'document-uri': 'https://app.example/ar/settings?email=a@b.c#x',
          'violated-directive': 'style-src',
          'blocked-uri': 'https://cdn.example/x.css?k=1',
        },
      }),
    ).toEqual([{ page: '/ar/settings', directive: 'style-src', blocked: '/x.css' }]);
  });

  it('reads Reporting API batches, keeps only csp-violation entries, caps the batch', () => {
    const batch = [
      { type: 'deprecation', body: {} },
      ...Array.from({ length: 50 }, (_, i) => violation(i)),
    ];
    const out = parseCspReport(batch);
    expect(out).toHaveLength(MAX_REPORTS);
    expect(out[0]).toEqual({ page: '/en/users', directive: 'script-src-elem', blocked: 'inline' });
  });

  it('truncates attacker-controlled fields', () => {
    const [v] = parseCspReport({
      'csp-report': {
        'document-uri': `https://app.example/${'a'.repeat(5000)}`,
        'violated-directive': `script-src${'x'.repeat(5000)}`,
        'blocked-uri': 'b'.repeat(5000),
      },
    });
    expect(v?.page?.length).toBeLessThanOrEqual(128);
    expect(v?.directive?.length).toBeLessThanOrEqual(128);
    expect(v?.blocked?.length).toBeLessThanOrEqual(64);
  });

  it('returns [] for anything else', () => {
    expect(parseCspReport(null)).toEqual([]);
    expect(parseCspReport({ hello: 'world' })).toEqual([]);
    expect(parseCspReport([{ nope: 1 }])).toEqual([]);
  });
});
