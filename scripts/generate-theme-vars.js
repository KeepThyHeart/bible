#!/usr/bin/env node
/**
 * Generate the web client's per-theme SCSS variable files from the canonical
 * palette in `admin/brand/theme-palettes.json`.
 *
 *   node scripts/generate-theme-vars.js            # write the files
 *   node scripts/generate-theme-vars.js --check    # verify they are up to date
 *
 * Why this exists
 * ---------------
 * The same fifteen themes are defined twice in this repo: once in
 * `apps/web/src/themes/<id>/_vars.scss` (21 tokens) and once in
 * `apps/desktop/src/ui/styles/themes.css` (143 tokens). Twelve of the
 * fifteen were byte-identical in both; the other three (light, dark, sepia)
 * had drifted into genuinely different colour choices without anyone
 * noticing, so "Sepia" did not mean the same thing in the two apps.
 *
 * The palette file is now the single place those colours are written down.
 * Where the two apps agree, the value appears once. Where they intentionally
 * differ, it appears as `{ "web": ..., "desktop": ... }` — visible in one
 * file instead of buried in two stylesheets. Replacing such an object with a
 * single string unifies that colour across both apps.
 *
 * This script owns the web side. The desktop stylesheet is hand-written (its
 * token set is far larger and mostly derived), so it is *checked* against the
 * palette rather than generated — see `themePalette.test.ts` in the desktop
 * package, which fails on any drift that is not recorded as an override here.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PALETTE = path.join(ROOT, 'admin', 'brand', 'theme-palettes.json');
const THEME_DIR = path.join(ROOT, 'apps', 'web', 'src', 'themes');
const DESKTOP_THEMES = path.join(ROOT, 'apps', 'desktop', 'src', 'ui', 'styles', 'themes.css');

/**
 * Keyword-mark colours (`--theme-mark-N-rgb`, task 0065) are contrast-checked per
 * theme on the desktop, so the web copies them from the desktop stylesheet
 * instead of keeping a second palette. Returns { themeId: [ 'R G B' x8 ] }.
 */
function readDesktopMarkColors() {
  const css = fs.readFileSync(DESKTOP_THEMES, 'utf8');
  const out = {};
  const blockRe = /(?::root,\s*)?\[data-theme="([a-z0-9-]+)"\]\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const vals = [];
    for (let i = 1; i <= 8; i++) {
      const v = new RegExp(`--theme-mark-${i}-rgb:\\s*([0-9 ]+);`).exec(m[2]);
      if (v) vals.push(v[1].trim());
    }
    if (vals.length === 8) out[m[1]] = vals;
  }
  return out;
}
const MARK_COLORS = readDesktopMarkColors();

/** Token order in the generated file — matches the hand-written originals. */
const TOKEN_ORDER = [
  'bg-primary', 'bg-secondary', 'bg-tertiary',
  'text-primary', 'text-secondary', 'text-muted',
  'border-color', 'accent-color', 'accent-hover',
  'highlight-bg', 'highlight-bg-hover', 'christ-words',
  'header-bg', 'shadow', 'dropdown-shadow', 'overlay-bg',
  'accent-secondary', 'scrollbar-track', 'scrollbar-thumb', 'scrollbar-thumb-hover',
];

/** Web palette tokens re-emitted as `R G B` triples for the decoration colour keys. */
const RGB_TOKENS = [
  ['accent-color', '--theme-accent-primary-rgb'],
  ['text-primary', '--theme-text-primary-rgb'],
  ['text-secondary', '--theme-text-secondary-rgb'],
  ['text-muted', '--theme-text-muted-rgb'],
];

/** '#2563eb' or '#abc' -> '37 99 235'; anything else -> null. */
function hexToRgbTriple(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

/** Resolve a palette entry for one app. */
function resolve(value, app) {
  if (value && typeof value === 'object') return value[app];
  return value;
}

function renderVars(themeId, theme) {
  const selector = themeId === 'light' ? ':root, [data-theme="light"]' : `[data-theme="${themeId}"]`;
  const lines = [`${selector} {`];
  for (const token of TOKEN_ORDER) {
    const raw = theme.colors[token];
    if (raw === undefined) continue;
    const value = resolve(raw, 'web');
    if (value === undefined) continue;
    lines.push(`  --${token}: ${value};`);
  }
  // Decoration colour keys (`accent`, `text*`) resolve to `--theme-*-rgb` triples
  // (core ThemeColorResolver). The web palette is hex, so derive the triples from
  // it; without them an `accent` underline (weights and measures, task 0069, or an
  // extension decoration) resolves to an invalid colour and is not drawn.
  for (const [token, cssVar] of RGB_TOKENS) {
    const value = resolve(theme.colors[token], 'web');
    const rgb = typeof value === 'string' ? hexToRgbTriple(value) : null;
    if (rgb) lines.push(`  ${cssVar}: ${rgb};`);
  }
  const marks = MARK_COLORS[themeId];
  if (marks) marks.forEach((v, i) => lines.push(`  --theme-mark-${i + 1}-rgb: ${v};`));
  lines.push('}');
  return lines.join('\n') + '\n';
}

function renderMeta(theme) {
  return JSON.stringify(
    { id: theme.id, name: theme.name, group: theme.group, order: theme.order, isDark: theme.isDark, swatch: theme.swatch },
    null,
    2,
  ) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const palette = JSON.parse(fs.readFileSync(PALETTE, 'utf8'));

  let written = 0;
  const stale = [];

  for (const [themeId, theme] of Object.entries(palette.themes)) {
    const dir = path.join(THEME_DIR, themeId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const varsPath = path.join(dir, '_vars.scss');
    const next = renderVars(themeId, theme);
    const current = fs.existsSync(varsPath) ? fs.readFileSync(varsPath, 'utf8') : null;

    if (current !== next) {
      if (check) stale.push(path.relative(ROOT, varsPath));
      else { fs.writeFileSync(varsPath, next); written++; }
    }
  }

  if (check) {
    if (stale.length > 0) {
      console.error('Theme variables are out of date with admin/brand/theme-palettes.json:');
      stale.forEach(f => console.error(`  ${f}`));
      console.error('\nRun: node scripts/generate-theme-vars.js');
      process.exit(1);
    }
    console.log(`Theme variables are up to date (${Object.keys(palette.themes).length} themes).`);
    return;
  }

  console.log(`generate-theme-vars: ${written} file(s) written, ${Object.keys(palette.themes).length} themes total.`);
}

main();
