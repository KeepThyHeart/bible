/** W-070: the Settings "Reset All" button must be readable on the rose theme. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('settings reset button contrast (W-070)', () => {
  const scss = readFileSync(resolve(__dirname, '_settings.scss'), 'utf8');
  const rose = readFileSync(resolve(__dirname, '../themes/rose/_vars.scss'), 'utf8');
  const v = (n: string) => rose.match(new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i'))![1];
  const block = scss.match(/&__reset-btn \{[\s\S]*?\n  \}/)![0];
  const used = block.match(/^\s*color: var\(--([a-z-]+)\)/m)![1];

  it('uses a rose variable with at least 4.5:1 against the rose background', () => {
    expect(ratio(v(used), v('bg-primary'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v(used), v('bg-secondary'))).toBeGreaterThanOrEqual(4.5);
  });
});
