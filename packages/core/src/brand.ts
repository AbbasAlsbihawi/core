// Pure and dependency-free: runs on the server (layout <style>) and in the browser (CSSOM).
// A hue + vividness seed becomes an 11-step OKLCH ladder kept inside sRGB by construction.
export const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LIGHTNESS = [0.985, 0.955, 0.905, 0.83, 0.75, 0.65, 0.58, 0.51, 0.44, 0.37, 0.27];
const SHAPE = [0.12, 0.25, 0.45, 0.7, 0.9, 1, 1, 1, 0.9, 0.75, 0.6];
const DARK_CHROMA = 0.85;
// Hues whose step 700 is too light for white text: yellow-green and cyan use step 400 + dark text.
const BRIGHT_BANDS: readonly (readonly [number, number])[] = [
  [60, 120],
  [190, 225],
];

function oklchToLinearSrgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Max chroma at (L, h) inside sRGB — strict [0,1] bounds (a ±1e-6 tolerance leaked out of gamut). */
export function maxChromaSrgb(L: number, h: number): number {
  const ok = (C: number) => oklchToLinearSrgb(L, C, h).every((x) => x >= 0 && x <= 1);
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Always round down: toFixed may round up and push the colour out of gamut. */
const c4 = (C: number) => (Math.floor(C * 1e4) / 1e4).toFixed(4);

export const isBrightHue = (h: number): boolean => BRIGHT_BANDS.some(([a, b]) => h >= a && h <= b);

/** All custom properties for one resolved mode. vivid is 0..1. */
export function brandVars(hue: number, vivid: number, dark: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const cm = dark ? DARK_CHROMA : 1;
  BRAND_STEPS.forEach((step, i) => {
    const L = LIGHTNESS[i] ?? 0.5;
    const C = maxChromaSrgb(L, hue) * (SHAPE[i] ?? 1) * vivid * cm;
    out[`--brand-${String(step)}`] = `oklch(${String(L)} ${c4(C)} ${String(hue)})`;
  });
  const on400 = dark || isBrightHue(hue);
  out['--primary'] = on400 ? 'var(--brand-400)' : 'var(--brand-700)';
  out['--primary-foreground'] = on400 ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)';
  out['--primary-text'] = dark ? 'var(--brand-400)' : 'var(--brand-700)';
  out['--ring'] = dark ? 'var(--brand-400)' : 'var(--brand-500)';
  for (let k = 0; k < 5; k++) {
    const ch = (hue + 72 * k) % 360;
    const L = dark ? 0.72 : 0.65;
    const cap = dark ? 0.12 : 0.14;
    const C = Math.min(cap, 0.9 * maxChromaSrgb(L, ch) * vivid);
    out[`--chart-${String(k + 1)}`] = `oklch(${String(L)} ${c4(C)} ${String(ch)})`;
  }
  return out;
}

/** Hue + vividness (0..100) → #rrggbb of step 700, so the custom picker opens on the current accent. */
export function seedToHex(hue: number, vivid: number): string {
  const L = LIGHTNESS[7] ?? 0.51;
  const C = maxChromaSrgb(L, hue) * (vivid / 100);
  const encode = (x: number) => {
    const v = Math.min(1, Math.max(0, x));
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${oklchToLinearSrgb(L, C, hue).map(encode).join('')}`;
}

/** #rrggbb → OKLCH. h is NaN for greys (chroma below the noise floor). */
export function hexToOklch(hex: string): { L: number; C: number; h: number } {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  return { L, C, h: C < 0.004 ? Number.NaN : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;

/**
 * The ladder as a stylesheet for both modes (vivid 0..100). "html…" selectors out-rank :root/.dark
 * in globals.css regardless of stylesheet order; `.light` / `.dark` on <html> pin a mode, no class
 * follows the OS.
 */
export function brandCss({ hue, vivid }: { hue: number; vivid: number }): string {
  const v = vivid / 100;
  return (
    block('html:root', brandVars(hue, v, false)) +
    block('html.dark', brandVars(hue, v, true)) +
    `@media (prefers-color-scheme: dark){${block('html:root:not(.light)', brandVars(hue, v, true))}}`
  );
}
