import { displayable, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import {
  BRAND_STEPS,
  brandVars,
  hexToOklch,
  isBrightHue,
  maxChromaSrgb,
  seedToHex,
} from './brand.js';

const HUES = Array.from({ length: 360 }, (_, h) => h);
const VIVIDS = [0, 0.35, 0.7, 1];
// surfaces from globals.css
const WHITE_TEXT = 'oklch(0.985 0 0)';
const DARK_TEXT = 'oklch(0.145 0 0)';
const LIGHT_BACKGROUND = 'oklch(1 0 0)';
const DARK_BACKGROUND = 'oklch(0.145 0 0)';
const DARK_CARD = 'oklch(0.205 0 0)';

/** Resolve one var(--x) level against the generated set. */
const resolve = (vars: Record<string, string>, name: string): string => {
  const value = vars[name] ?? '';
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref?.[1] ? (vars[ref[1]] ?? '') : value;
};

describe('brand ladder: gamut', () => {
  it.each([false, true])('every step and chart colour is inside sRGB (dark=%s)', (dark) => {
    for (const hue of HUES) {
      for (const vivid of VIVIDS) {
        const vars = brandVars(hue, vivid, dark);
        for (const [name, value] of Object.entries(vars)) {
          if (value.startsWith('var(')) continue;
          expect(displayable(value), `${name}=${value} (h=${String(hue)})`).toBe(true);
        }
      }
    }
  });

  it('emits all 11 steps, the primary pair, ring and 5 chart colours', () => {
    const keys = Object.keys(brandVars(252, 0.9, false));
    expect(keys).toEqual([
      ...BRAND_STEPS.map((s) => `--brand-${String(s)}`),
      '--primary',
      '--primary-foreground',
      '--primary-text',
      '--ring',
      '--chart-1',
      '--chart-2',
      '--chart-3',
      '--chart-4',
      '--chart-5',
    ]);
  });

  it('maxChromaSrgb is 0 at the white point and positive mid-ladder', () => {
    expect(maxChromaSrgb(1, 120)).toBeLessThan(0.001);
    expect(maxChromaSrgb(0.6, 30)).toBeGreaterThan(0.1);
  });
});

describe('brand ladder: contrast guaranteed by construction (WCAG)', () => {
  it('light mode: --primary-foreground on --primary ≥ 4.5 (AA) for every hue and vividness', () => {
    for (const hue of HUES) {
      for (const vivid of VIVIDS) {
        const vars = brandVars(hue, vivid, false);
        const ratio = wcagContrast(
          resolve(vars, '--primary-foreground'),
          resolve(vars, '--primary'),
        );
        const min = isBrightHue(hue) ? 7 : 4.5; // bright hues switch to step 400 + dark text (AAA)
        expect(ratio, `h=${String(hue)} v=${String(vivid)}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('dark mode: dark text on --primary (step 400) ≥ 7 (AAA) for every hue and vividness', () => {
    for (const hue of HUES) {
      for (const vivid of VIVIDS) {
        const vars = brandVars(hue, vivid, true);
        const at = `h=${String(hue)} v=${String(vivid)}`;
        expect(vars['--primary-foreground'], at).toBe(DARK_TEXT);
        expect(wcagContrast(DARK_TEXT, resolve(vars, '--primary')), at).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('--primary-text is readable as text: ≥ 4.5 on white, ≥ 7 on the dark background and card', () => {
    for (const hue of HUES) {
      for (const vivid of VIVIDS) {
        const at = `h=${String(hue)} v=${String(vivid)}`;
        const light = brandVars(hue, vivid, false);
        expect(
          wcagContrast(resolve(light, '--primary-text'), LIGHT_BACKGROUND),
          at,
        ).toBeGreaterThanOrEqual(4.5);
        const text = resolve(brandVars(hue, vivid, true), '--primary-text');
        expect(wcagContrast(text, DARK_BACKGROUND), at).toBeGreaterThanOrEqual(7);
        expect(wcagContrast(text, DARK_CARD), at).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('a bright hue never pairs white text with step 400', () => {
    expect(isBrightHue(90)).toBe(true);
    const vars = brandVars(90, 1, false);
    expect(vars['--primary']).toBe('var(--brand-400)');
    expect(vars['--primary-foreground']).toBe(DARK_TEXT);
    expect(brandVars(252, 1, false)['--primary-foreground']).toBe(WHITE_TEXT);
  });
});

describe('hexToOklch', () => {
  it('recovers the Radix indigo-9 hue used by the presets', () => {
    const { h, C } = hexToOklch('#3e63dd');
    expect(Math.round(h)).toBe(267);
    expect(C).toBeGreaterThan(0.1);
  });

  it('returns NaN hue for greys', () => {
    expect(hexToOklch('#808080').h).toBeNaN();
    expect(hexToOklch('#ffffff').L).toBeCloseTo(1, 3);
  });
});

describe('seedToHex', () => {
  // The custom picker opens on seedToHex(current) and saves via hexToOklch. 8-bit rounding may
  // shift the hue a few degrees at low chroma, so assert what the user sees: the step-700 colour
  // before and after the round trip stays below a just-noticeable difference (ΔE_OK ≈ 0.02).
  const toLab = (L: number, C: number, h: number) => [
    L,
    C * Math.cos((h * Math.PI) / 180),
    C * Math.sin((h * Math.PI) / 180),
  ];

  it('round-trips a seed through #rrggbb without a visible change', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const vivid of [10, 30, 60, 90, 100]) {
        const hex = seedToHex(hue, vivid);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        const L = 0.51;
        const before = toLab(L, maxChromaSrgb(L, hue) * (vivid / 100), hue);
        const { h } = hexToOklch(hex);
        const vividBack = Math.round((100 * hexToOklch(hex).C) / maxChromaSrgb(L, h));
        const after = toLab(L, maxChromaSrgb(L, h) * (vividBack / 100), h);
        expect(Math.hypot(...before.map((v, i) => v - (after[i] ?? 0)))).toBeLessThan(0.01);
      }
    }
  });

  it('vividness 0 is a grey', () => {
    expect(hexToOklch(seedToHex(252, 0)).h).toBeNaN();
  });
});
