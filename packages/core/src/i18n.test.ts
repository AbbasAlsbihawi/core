import { describe, expect, it } from 'vitest';

import { formats, getDirection, localeAlternates, pickMessages, toLocale } from './i18n.js';

const routing = { locales: ['en', 'ar'] as const, defaultLocale: 'en' as const };

describe('getDirection', () => {
  it.each([
    ['ar', 'rtl'],
    ['ar-IQ', 'rtl'],
    ['fa', 'rtl'],
    ['ckb', 'rtl'],
    ['en', 'ltr'],
    ['tr', 'ltr'],
    ['ku', 'ltr'], // Kurmanji is written in Latin script
  ])('%s → %s', (locale, dir) => {
    expect(getDirection(locale)).toBe(dir);
  });
});

describe('toLocale', () => {
  it('keeps a supported locale', () => {
    expect(toLocale('ar', routing)).toBe('ar');
  });

  it.each([[undefined], [null], [''], ['fr'], ['AR'], [42], [['ar']]])(
    'falls back for %j',
    (value) => {
      expect(toLocale(value, routing)).toBe('en');
    },
  );
});

describe('pickMessages', () => {
  it('keeps only the requested namespaces', () => {
    expect(
      pickMessages({ common: { a: 1 }, users: { b: 2 }, settings: {} }, ['common', 'users']),
    ).toEqual({
      common: { a: 1 },
      users: { b: 2 },
    });
  });
});

describe('formats', () => {
  it('formats dinars without fractions and with Western digits in Arabic', () => {
    expect(new Intl.NumberFormat('ar', formats.number.iqd).format(25000)).toMatch(/25,000/);
    expect(
      new Intl.NumberFormat('en', formats.number.iqd).format(25000.6).replace(/\s/g, ' '),
    ).toBe(
      'IQD 25,001', // Intl puts a no-break space after the code
    );
  });
});

describe('localeAlternates', () => {
  const getPathname = ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`;

  it('gives a canonical, every locale and x-default', () => {
    expect(localeAlternates('/products/p1', 'ar', routing, getPathname)).toEqual({
      canonical: '/ar/products/p1',
      languages: { en: '/en/products/p1', ar: '/ar/products/p1', 'x-default': '/en/products/p1' },
    });
  });
});
