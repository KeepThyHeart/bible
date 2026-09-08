/**
 * Guards the desktop stylesheet against the canonical palette.
 *
 * The same fifteen themes exist in both apps: here in `themes.css` (143 tokens
 * per theme) and in the web client's `_vars.scss` (21). Twelve of the fifteen
 * were byte-identical in both; light, dark and sepia had drifted into genuinely
 * different colour choices, so "Sepia" did not mean the same thing in the two
 * apps and nothing caught it.
 *
 * `admin/brand/theme-palettes.json` is now the single place those colours are
 * written down. This test holds `themes.css` to it. Unlike the web side, this
 * stylesheet is NOT generated - its token set is far larger and mostly derived
 * - so it is checked instead.
 *
 * If this fails you have changed a shared colour on one side only. Either make
 * the same change in `admin/brand/theme-palettes.json` (and regenerate the web files
 * with `node scripts/generate-theme-vars.js`), or, if the two apps really are
 * meant to differ here, record it in the palette as
 * `{ "web": "...", "desktop": "..." }`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const PALETTE_PATH = resolve(REPO_ROOT, 'admin/brand/theme-palettes.json');
const CSS_PATH = resolve(__dirname, 'themes.css');

/** web palette key -> desktop CSS custom property holding the same colour */
const TOKEN_MAP: Record<string, string> = {
  'bg-primary': '--theme-bg-primary-rgb',
  'bg-secondary': '--theme-bg-secondary-rgb',
  'bg-tertiary': '--theme-bg-tertiary-rgb',
  'text-primary': '--theme-text-primary-rgb',
  'text-secondary': '--theme-text-secondary-rgb',
  'text-muted': '--theme-text-muted-rgb',
  'border-color': '--theme-border-primary-rgb',
  'accent-color': '--theme-accent-primary-rgb',
  'accent-hover': '--theme-accent-hover-rgb',
  'christ-words': '--theme-christ-rgb',
};

interface PaletteFile {
  themes: Record<string, { colors: Record<string, string | { web: string; desktop: string }> }>;
}

const palette: PaletteFile = JSON.parse(readFileSync(PALETTE_PATH, 'utf8'));
const css = readFileSync(CSS_PATH, 'utf8');

function themeBlock(theme: string): string | null {
  const m = css.match(new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : null;
}

function rgbTripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('');
}

/** The value the desktop app is expected to use for this token. */
function expectedDesktop(value: string | { web: string; desktop: string }): string {
  return typeof value === 'string' ? value : value.desktop;
}

describe('desktop themes.css matches the canonical palette', () => {
  const themeIds = Object.keys(palette.themes);

  it('defines every theme in the palette', () => {
    const missing = themeIds.filter(t => themeBlock(t) === null);
    expect(missing, `themes.css has no [data-theme] block for: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(themeIds)('theme %s uses the palette colours', (themeId) => {
    const block = themeBlock(themeId);
    expect(block, `no block for ${themeId}`).not.toBeNull();

    const mismatches: string[] = [];

    for (const [paletteKey, cssVar] of Object.entries(TOKEN_MAP)) {
      const paletteValue = palette.themes[themeId].colors[paletteKey];
      if (paletteValue === undefined) continue;

      const m = block!.match(new RegExp(`${cssVar}:\\s*([^;]+);`));
      if (!m) { mismatches.push(`${cssVar} is not defined`); continue; }

      const actual = rgbTripletToHex(m[1]);
      const expected = expectedDesktop(paletteValue).toLowerCase();
      if (actual !== expected) {
        mismatches.push(`${cssVar}: stylesheet has ${actual}, palette says ${expected}`);
      }
    }

    expect(mismatches, `${themeId}:\n  ${mismatches.join('\n  ')}`).toEqual([]);
  });
});

describe('palette overrides are deliberate', () => {
  // Only these three themes are allowed to render differently in the two apps.
  // Every other theme must resolve to one shared value per token - if a new
  // override appears elsewhere, it is drift, not a design decision.
  const ALLOWED_DIVERGENT_THEMES = new Set(['light', 'dark', 'sepia']);

  it('confines per-app overrides to the themes known to differ', () => {
    const unexpected: string[] = [];

    for (const [themeId, theme] of Object.entries(palette.themes)) {
      if (ALLOWED_DIVERGENT_THEMES.has(themeId)) continue;
      for (const [key, value] of Object.entries(theme.colors)) {
        if (value && typeof value === 'object') {
          unexpected.push(`${themeId}.${key} (web ${value.web} vs desktop ${value.desktop})`);
        }
      }
    }

    expect(
      unexpected,
      'These themes gained a per-app colour override. That means the two apps ' +
        'drifted apart. Either make them match, or add the theme to ' +
        'ALLOWED_DIVERGENT_THEMES with a note explaining why:\n  ' +
        unexpected.join('\n  '),
    ).toEqual([]);
  });
});
