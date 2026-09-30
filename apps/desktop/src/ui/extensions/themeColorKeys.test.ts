/**
 * `THEME_COLOR_KEYS` (packages/core) and `THEME_COLOR_CSS_VAR`
 * (`ThemeColorResolver.ts` in core Annotations) must map to `-rgb` variables that ACTUALLY exist,
 * in every theme block, in `themes.css` (task 0036, P0.1a; design doc §16:
 * "a test that parses the stylesheet and fails when a theme is added without
 * a token"). This is the exact class of bug the allowlist-resolver design
 * invites - a key that type-checks but silently paints nothing (or the
 * fallback colour) in one theme because that theme never got the variable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Extensions } from '@bible/core';
import { resolveThemeColor } from '@bible/core/browser';

const { THEME_COLOR_KEYS, THEME_COLOR_CSS_VAR } = Extensions;

const CSS_PATH = resolve(__dirname, '../styles/themes.css');
const css = readFileSync(CSS_PATH, 'utf8');

const THEME_IDS = [
  'light', 'dark', 'sepia', 'arctic', 'autumn', 'forest', 'lagoon', 'meadow',
  'midnight', 'ocean', 'parchment', 'rose', 'slate', 'sunrise', 'sunset',
];

function themeBlock(theme: string): string {
  const m = css.match(new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`themes.css has no [data-theme="${theme}"] block`);
  return m[1];
}

describe('THEME_COLOR_KEYS <-> themes.css', () => {
  it('every key has a CSS var mapping', () => {
    for (const key of THEME_COLOR_KEYS) {
      expect(THEME_COLOR_CSS_VAR[key], `no THEME_COLOR_CSS_VAR entry for '${key}'`).toBeTruthy();
    }
  });

  it.each(THEME_IDS)('every key resolves to a var defined in [data-theme="%s"]', (theme) => {
    const block = themeBlock(theme);
    for (const key of THEME_COLOR_KEYS) {
      const cssVar = THEME_COLOR_CSS_VAR[key];
      expect(block, `${cssVar} (key '${key}') missing from [data-theme="${theme}"]`).toContain(`${cssVar}:`);
    }
  });
});

describe('resolveThemeColor', () => {
  it('produces a var() expression, never a literal colour', () => {
    expect(resolveThemeColor('accent')).toBe('rgb(var(--theme-accent-primary-rgb))');
  });

  it('applies alpha as a Tailwind-style opacity modifier', () => {
    expect(resolveThemeColor('accent', 0.32)).toBe('rgb(var(--theme-accent-primary-rgb) / 0.32)');
  });

  it('falls back to the default key for an unknown colour key', () => {
    expect(resolveThemeColor('bogus')).toBe(resolveThemeColor('accent'));
  });
});

/** WCAG relative luminance / contrast for `R G B` triplets. */
function luminance([r, g, b]: number[]): number {
  const f = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function rgbVar(block: string, name: string): number[] | null {
  const m = block.match(new RegExp(`--theme-${name}-rgb:\\s*(\\d+) (\\d+) (\\d+)`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

describe('keyword mark colours (task 0065)', () => {
  it.each(THEME_IDS)('[data-theme="%s"] defines mark-1..8 with >= 3:1 contrast on page and surface backgrounds', (theme) => {
    const block = themeBlock(theme);
    const backgrounds = ['bg-primary', 'surface-primary', 'bg-secondary']
      .map((n) => rgbVar(block, n))
      .filter((c): c is number[] => c !== null);
    expect(backgrounds.length).toBeGreaterThan(0);
    for (let i = 1; i <= 8; i++) {
      const mark = rgbVar(block, `mark-${i}`);
      expect(mark, `--theme-mark-${i}-rgb missing from [data-theme="${theme}"]`).not.toBeNull();
      for (const bg of backgrounds) {
        expect(contrast(mark!, bg), `mark-${i} on ${bg.join(' ')} in ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
