/** B-115: text on the accent colour must reach 4.5:1 in every web theme (the high-contrast yellow and the light-blue dark accents failed with a hard-coded #fff). */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('web themes: accent text contrast', () => {
  const dir = __dirname;
  for (const id of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    it(`${id}: --accent-text on --accent-color and --accent-hover >= 4.5`, () => {
      const css = readFileSync(resolve(dir, id, '_vars.scss'), 'utf8');
      const get = (k: string) => new RegExp(`--${k}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
      const accent = get('accent-color')!;
      const text = get('accent-text') ?? '#ffffff';
      expect(ratio(text, accent)).toBeGreaterThanOrEqual(4.5);
      const hover = get('accent-hover');
      if (hover) expect(ratio(text, hover)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
