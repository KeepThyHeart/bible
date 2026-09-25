/**
 * `THEME_COLOR_KEYS` (packages/core) and `THEME_COLOR_CSS_VAR`
 * (`themeColorResolver.ts`) must map to `-rgb` variables that ACTUALLY exist,
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
import { resolveThemeColor } from './themeColorResolver';

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
