// culori 4 ships no type declarations; it is a test-only dependency (gamut + contrast checks).
declare module 'culori' {
  /** true when the colour (CSS string or culori object) is inside the sRGB gamut */
  export function displayable(color: string): boolean;
  /** WCAG 2.x contrast ratio between two colours */
  export function wcagContrast(a: string, b: string): number;
}
