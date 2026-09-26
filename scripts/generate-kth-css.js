#!/usr/bin/env node
/**
 * Generate the per-app maps and the dark-scheme defaults of the KTH CSS framework
 * (`packages/ui/css/`) from the KTH_MAP table below and `admin/brand/theme-palettes.json`.
 *
 *   node scripts/generate-kth-css.js            # write the files
 *   node scripts/generate-kth-css.js --check    # verify they are up to date
 *
 * Why this exists
 * ---------------
 * `@bible/ui` components and the `.kth-*` classes are styled ONLY with `--kth-*`
 * custom properties, declared once in `packages/ui/css/kth-contract.css`. Each app
 * (and, later, each extension iframe) supplies those tokens from its own theme
 * variables: the desktop app from `--theme-*` (themes.css), the web app from the
 * palette tokens in `apps/web/src/themes/<id>/_vars.scss`. This table is the one
 * place that says which app variable backs which `--kth-*` token, so a new theme
 * or a renamed variable cannot silently break the shared components.
 *
 * Outputs (under packages/ui/css/generated/):
 *   map-desktop.css  :root { --kth-x: <desktop expression>; }
 *   map-web.css      :root { --kth-x: <web expression>; }
 *   kth-scheme.css   dark-theme defaults for tokens an app leaves unmapped
 *
 * Cascade: the contract and scheme defaults use :where() (specificity 0), the maps
 * use :root (0,1,0), so the maps win regardless of import order.
 *
 * Validation runs before anything is written (exit 1 with a message): every KTH_MAP
 * key is declared in the contract and vice versa (bar CONTRACT_CONSTANTS); every
 * desktop var() target is declared in themes.css; every web var() target is a
 * palette token or a WEB_RUNTIME_VARS entry.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PALETTE = path.join(ROOT, 'admin', 'brand', 'theme-palettes.json');
const CSS_DIR = path.join(ROOT, 'packages', 'ui', 'css');
const CONTRACT = path.join(CSS_DIR, 'kth-contract.css');
const OUT_DIR = path.join(CSS_DIR, 'generated');
const DESKTOP_THEMES = path.join(ROOT, 'apps', 'desktop', 'src', 'ui', 'styles', 'themes.css');

/**
 * --kth-* token -> CSS expression per app. null = not mapped for that app; the
 * contract default (kth-contract.css) and its dark variant (kth-scheme.css) apply.
 * Desktop targets must exist in apps/desktop/src/ui/styles/themes.css; web targets
 * must be palette tokens (apps/web/src/themes/<id>/_vars.scss) or WEB_RUNTIME_VARS.
 */
const KTH_MAP = {
  '--kth-bg':             { web: 'var(--bg-primary)',   desktop: 'var(--theme-bg-primary)' },
  '--kth-bg-subtle':      { web: 'var(--bg-secondary)', desktop: 'var(--theme-bg-secondary)' },
  '--kth-bg-hover':       { web: 'var(--bg-tertiary)',  desktop: 'var(--theme-bg-hover)' },
  // Pressed/active and toolbar-cell hover; needed so .kth-toolbar__button matches .control-toolbar-button.
  '--kth-bg-active':      { web: 'color-mix(in srgb, var(--bg-tertiary), var(--text-primary) 8%)', desktop: 'var(--theme-bg-active)' },
  '--kth-surface':        { web: 'var(--bg-primary)',   desktop: 'var(--theme-surface-primary)' },
  '--kth-surface-raised': { web: 'var(--bg-primary)',   desktop: 'var(--theme-surface-elevated)' },
  '--kth-text':           { web: 'var(--text-primary)', desktop: 'var(--theme-text-primary)' },
  // "Muted" = secondary text that still passes AA. Desktop --theme-text-muted (#9CA3AF on white) does not.
  '--kth-text-muted':     { web: 'var(--text-secondary)', desktop: 'var(--theme-text-secondary)' },
  '--kth-text-heading':   { web: 'var(--text-primary)', desktop: 'var(--theme-text-heading)' },
  '--kth-border':         { web: 'var(--border-color)', desktop: 'var(--theme-border-primary)' },
  '--kth-border-strong':  { web: 'color-mix(in srgb, var(--border-color), var(--text-primary) 15%)', desktop: 'var(--theme-border-secondary)' },
  '--kth-accent':         { web: 'var(--accent-color)', desktop: 'var(--theme-accent-primary)' },
  '--kth-accent-hover':   { web: 'var(--accent-hover)', desktop: 'var(--theme-accent-hover)' },
  // Web draws white on accent fills everywhere (_search, _settings, _right-pane: `color: #fff`).
  '--kth-accent-text':    { web: '#fff',                desktop: 'var(--theme-accent-text)' },
  '--kth-accent-soft':    { web: 'color-mix(in srgb, var(--accent-color) 18%, transparent)', desktop: 'var(--theme-accent-soft)' },
  '--kth-focus':          { web: 'var(--accent-color)', desktop: 'var(--theme-border-focus)' },
  '--kth-input-bg':       { web: 'var(--bg-primary)',   desktop: 'var(--theme-input-bg)' },
  '--kth-input-border':   { web: 'var(--border-color)', desktop: 'var(--theme-input-border)' },
  '--kth-danger':         { web: null, desktop: 'var(--theme-danger)' },
  '--kth-danger-soft':    { web: null, desktop: 'var(--theme-danger-soft)' },
  '--kth-success':        { web: null, desktop: 'var(--theme-success)' },
  '--kth-warning':        { web: null, desktop: 'var(--theme-warning)' },
  '--kth-info':           { web: null, desktop: 'var(--theme-info)' },
  '--kth-shadow':         { web: '0 4px 12px var(--dropdown-shadow)', desktop: null },
  '--kth-overlay':        { web: 'var(--overlay-bg)',   desktop: 'var(--theme-bg-overlay)' },
  // Fonts follow each app's live "UI text" setting. Contract defaults remain the fallback.
  '--kth-font-ui':        { web: null, desktop: 'var(--ui-font-family)' },
  '--kth-font-size-ui':   { web: 'var(--ui-font-size, 14px)', desktop: 'calc(var(--ui-font-size) * var(--global-font-scale, 1))' },
};

/** Dark variants of contract defaults, emitted into kth-scheme.css for palette isDark themes. */
const DARK_DEFAULTS = {
  '--kth-danger': '#ef4444',        // = desktop dark --theme-danger-rgb 239 68 68
  '--kth-danger-soft': '#3d1f26',   // = desktop dark 61 31 38
  '--kth-success': '#22c55e',       // 34 197 94
  '--kth-warning': '#f59e0b',       // 245 158 11
  '--kth-info': '#60a5fa',          // 96 165 250
  '--kth-shadow': '0 4px 12px rgb(0 0 0 / 0.5)',
  '--kth-color-scheme': 'dark',
};

/** Contract tokens that are constants: declared in the contract, not mapped per app. */
const CONTRACT_CONSTANTS = [
  '--kth-radius', '--kth-space-1', '--kth-space-2', '--kth-space-3', '--kth-space-4', '--kth-color-scheme',
];

/** Web custom properties set at runtime (settingsStore.ts), always written with a fallback. */
const WEB_RUNTIME_VARS = ['--ui-font-size'];

const HEADER = `/*
 * GENERATED by scripts/generate-kth-css.js - do not edit.
 * Source: the KTH_MAP table in that script and admin/brand/theme-palettes.json (isDark).
 * Regenerate: npm run generate:kth-css   Verify: npm run check:kth-css
 */
`;

/** `--kth-*` names declared (as `--kth-x:`) in a CSS text. */
function declaredKthTokens(css) {
  const names = new Set();
  const re = /(--kth-[a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(css))) names.add(m[1]);
  return names;
}

/** Every `var(--x` reference in an expression. */
function varRefs(expr) {
  return [...expr.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
}

/** Web palette token names (colour keys used by any theme). */
function webPaletteTokens(palette) {
  const names = new Set();
  for (const theme of Object.values(palette.themes)) {
    for (const key of Object.keys(theme.colors)) names.add(`--${key}`);
  }
  return names;
}

/** Custom properties declared in desktop themes.css. */
function desktopThemeVars(themesCss) {
  const names = new Set();
  const re = /(--[a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(themesCss))) names.add(m[1]);
  return names;
}

function validate(palette, contractCss, themesCss) {
  const errors = [];
  const declared = declaredKthTokens(contractCss);
  const constants = new Set(CONTRACT_CONSTANTS);

  for (const key of Object.keys(KTH_MAP)) {
    if (!declared.has(key)) errors.push(`KTH_MAP key ${key} is not declared in kth-contract.css`);
  }
  for (const name of declared) {
    if (!(name in KTH_MAP) && !constants.has(name)) {
      errors.push(`contract token ${name} is neither in KTH_MAP nor in CONTRACT_CONSTANTS`);
    }
  }
  for (const name of CONTRACT_CONSTANTS) {
    if (!declared.has(name)) errors.push(`CONTRACT_CONSTANTS entry ${name} is not declared in kth-contract.css`);
    if (name in KTH_MAP) errors.push(`${name} is in both KTH_MAP and CONTRACT_CONSTANTS`);
  }
  for (const name of Object.keys(DARK_DEFAULTS)) {
    if (!declared.has(name)) errors.push(`DARK_DEFAULTS key ${name} is not declared in kth-contract.css`);
  }

  const desktopVars = desktopThemeVars(themesCss);
  const webVars = new Set([...webPaletteTokens(palette), ...WEB_RUNTIME_VARS]);
  for (const [key, entry] of Object.entries(KTH_MAP)) {
    if (entry.desktop) {
      for (const ref of varRefs(entry.desktop)) {
        if (!desktopVars.has(ref)) errors.push(`${key} (desktop) references ${ref}, not declared in apps/desktop/src/ui/styles/themes.css`);
      }
    }
    if (entry.web) {
      for (const ref of varRefs(entry.web)) {
        if (!webVars.has(ref)) errors.push(`${key} (web) references ${ref}, which is not a palette token or WEB_RUNTIME_VARS entry`);
      }
    }
  }
  return errors;
}

function renderMap(app) {
  const lines = [];
  const omitted = [];
  for (const [token, entry] of Object.entries(KTH_MAP)) {
    const expr = entry[app];
    if (expr === null || expr === undefined) omitted.push(token);
    else lines.push(`  ${token}: ${expr};`);
  }
  let out = `${HEADER}:root {\n${lines.join('\n')}\n}\n`;
  if (omitted.length > 0) {
    out += `/* Not mapped here; contract default applies: ${omitted.join(', ')} */\n`;
  }
  return out;
}

function darkThemeIds(palette) {
  return Object.entries(palette.themes).filter(([, t]) => t.isDark).map(([id]) => id);
}

function renderScheme(palette) {
  const selector = `:where(${darkThemeIds(palette).map((id) => `[data-theme="${id}"]`).join(', ')})`;
  const lines = Object.entries(DARK_DEFAULTS).map(([k, v]) => `  ${k}: ${v};`);
  return `${HEADER}${selector} {\n${lines.join('\n')}\n}\n`;
}

/** Render all generated files in memory: { absolute path -> content }. */
function render(palette) {
  return {
    [path.join(OUT_DIR, 'map-desktop.css')]: renderMap('desktop'),
    [path.join(OUT_DIR, 'map-web.css')]: renderMap('web'),
    [path.join(OUT_DIR, 'kth-scheme.css')]: renderScheme(palette),
  };
}

function main() {
  const check = process.argv.includes('--check');
  const palette = JSON.parse(fs.readFileSync(PALETTE, 'utf8'));
  const contractCss = fs.readFileSync(CONTRACT, 'utf8');
  const themesCss = fs.readFileSync(DESKTOP_THEMES, 'utf8');

  const errors = validate(palette, contractCss, themesCss);
  if (errors.length > 0) {
    console.error('KTH CSS inputs are inconsistent:');
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  const files = render(palette);
  const stale = [];
  let written = 0;
  for (const [file, next] of Object.entries(files)) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === next) continue;
    if (check) stale.push(path.relative(ROOT, file));
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
      written++;
    }
  }

  const darkCount = darkThemeIds(palette).length;
  if (check) {
    if (stale.length > 0) {
      console.error('KTH CSS is out of date with scripts/generate-kth-css.js / admin/brand/theme-palettes.json:');
      stale.forEach((f) => console.error(`  ${f}`));
      console.error('\nRun: node scripts/generate-kth-css.js');
      process.exit(1);
    }
    console.log(`KTH CSS is up to date (${Object.keys(files).length} files, ${Object.keys(KTH_MAP).length} mapped tokens, ${darkCount} dark themes).`);
    return;
  }
  console.log(`generate-kth-css: ${written} file(s) written.`);
}

if (require.main === module) main();

module.exports = { KTH_MAP, DARK_DEFAULTS, CONTRACT_CONSTANTS, WEB_RUNTIME_VARS, render, validate };
