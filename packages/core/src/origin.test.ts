import { describe, expect, it } from 'vitest';

import { isSameOrigin } from './origin.js';

const APP = 'https://shop.example';
const req = (method: string, headers: Record<string, string> = {}) =>
  new Request(`${APP}/api/x`, { method, headers });

describe('isSameOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets the safe method %s through', (method) => {
    expect(isSameOrigin(req(method, { origin: 'https://evil.example' }), APP)).toBe(true);
  });

  it('accepts a same-origin POST', () => {
    expect(isSameOrigin(req('POST', { origin: APP, 'sec-fetch-site': 'same-origin' }), APP)).toBe(
      true,
    );
  });

  it.each([
    [{ origin: 'https://evil.example' }],
    [{ origin: APP, 'sec-fetch-site': 'cross-site' }],
    [{ origin: APP, 'sec-fetch-site': 'same-site' }], // a sibling subdomain is not this app
    [{}], // no Origin at all
  ])('refuses %j', (headers) => {
    expect(isSameOrigin(req('POST', headers), APP)).toBe(false);
  });

  it('compares origins, not strings (a trailing slash or path in the setting is fine)', () => {
    expect(isSameOrigin(req('DELETE', { origin: APP }), `${APP}/`)).toBe(true);
  });
});
