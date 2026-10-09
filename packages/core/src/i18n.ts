// Locale helpers without a next-intl dependency: the routing object of either template fits.

export interface LocaleRouting<L extends string> {
  locales: readonly L[];
  defaultLocale: L;
}

// Do not rely on Intl.Locale#getTextInfo(): undefined on Node 20/22.
const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ckb']);

/** 'rtl' for Arabic, Persian, Hebrew, Urdu, Sorani; works for regional tags (ar-IQ). */
export function getDirection(locale: string): 'rtl' | 'ltr' {
  return RTL.has(locale.split('-')[0] ?? locale) ? 'rtl' : 'ltr';
}

/** Server Actions and Route Handlers receive the locale as untrusted input. */
export function toLocale<L extends string>(value: unknown, routing: LocaleRouting<L>): L {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value)
    ? (value as L)
    : routing.defaultLocale;
}

/** Send only the namespaces a subtree needs to the client (messages are atomic per provider). */
export function pickMessages<M extends Record<string, unknown>, K extends keyof M>(
  messages: M,
  keys: readonly K[],
): Pick<M, K> {
  return Object.fromEntries(keys.map((k) => [k, messages[k]])) as Pick<M, K>;
}

/**
 * next-intl formats: `ar` with Western digits pinned (numberingSystem: 'latn'), dinars without
 * fractions. Use `typeof formats` as AppConfig['Formats'].
 */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' },
    long: { dateStyle: 'long', timeStyle: 'short', numberingSystem: 'latn' },
  },
  number: {
    iqd: { style: 'currency', currency: 'IQD', maximumFractionDigits: 0, numberingSystem: 'latn' },
    precise: { maximumFractionDigits: 2, numberingSystem: 'latn' },
  },
} as const satisfies {
  dateTime: Record<string, Intl.DateTimeFormatOptions>;
  number: Record<string, Intl.NumberFormatOptions>;
};

/**
 * canonical + hreflang alternates (and x-default) for one locale-less href — the shape of Next's
 * Metadata['alternates']. `getPathname` is next-intl's, from createNavigation(routing).
 */
export function localeAlternates<L extends string, H>(
  href: H,
  locale: L,
  routing: LocaleRouting<L>,
  getPathname: (args: { href: H; locale: L }) => string,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = Object.fromEntries(
    routing.locales.map((l) => [l, getPathname({ href, locale: l })]),
  );
  languages['x-default'] = getPathname({ href, locale: routing.defaultLocale });
  return { canonical: getPathname({ href, locale }), languages };
}
