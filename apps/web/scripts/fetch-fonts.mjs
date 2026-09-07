#!/usr/bin/env node
/**
 * Self-host the web fonts the reader offers, replacing the Google Fonts
 * stylesheet that index.html used to link directly.
 *
 * Three reasons the CDN link had to go:
 *   - Privacy. It is a third-party request carrying the visitor's IP and
 *     Referer on every page load, which contradicts `privacy.mode: "strict"`.
 *   - Offline. The PWA precaches `**\/*.woff2` (see vite.config.ts), so
 *     self-hosted faces survive going offline; a CDN stylesheet does not.
 *   - CSP. Self-hosting is what lets `style-src` drop fonts.googleapis.com.
 *
 * Files land in `public/fonts/` (gitignored, served at `/fonts/`) alongside a
 * generated `fonts.css` that index.html links. Nothing here is committed: the
 * woff2 files are build output, refetched on demand by the `prebuild` and
 * `predev` hooks, so a clean checkout produces them on first build.
 *
 * Consequence worth knowing: a clean build needs network access, the same
 * tradeoff `fetch-embedding-model.mjs` already makes.
 *
 * Idempotent -- an existing fonts.css with at least one face is left alone.
 * Pass --force to refetch.
 *
 * Usage:
 *   node scripts/fetch-fonts.mjs [--force]
 *
 * Every family below is OFL 1.1, which permits self-hosting and
 * redistribution; the generated FONT-LICENSES.md carries the attribution.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const FONTS_DIR = join(packageRoot, 'public', 'fonts');
const SETTINGS_STORE = join(packageRoot, 'src', 'stores', 'settingsStore.ts');

// A browser UA is required: Google serves woff2 only to clients it believes
// support it, and hands older formats to anything it does not recognise.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * The families to self-host, with the exact weight/style specs the app uses.
 *
 * `latin-ext` is included because the locale files are translatable; the app
 * has no Greek or Hebrew face of its own (original-language text falls back to
 * the browser's default), so those subsets are deliberately not fetched.
 */
const FAMILIES = [
  { name: 'Cormorant Garamond', slug: 'cormorant-garamond', spec: 'Cormorant+Garamond:ital,wght@0,400;0,600;1,400' },
  { name: 'Crimson Pro',        slug: 'crimson-pro',        spec: 'Crimson+Pro:ital,wght@0,400;0,600;1,400' },
  { name: 'EB Garamond',        slug: 'eb-garamond',        spec: 'EB+Garamond:ital,wght@0,400;0,600;1,400' },
  { name: 'Libre Baskerville',  slug: 'libre-baskerville',  spec: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
  { name: 'Lora',               slug: 'lora',               spec: 'Lora:ital,wght@0,400;0,600;1,400' },
  { name: 'Merriweather',       slug: 'merriweather',       spec: 'Merriweather:ital,wght@0,400;0,700;1,400' },
  { name: 'Playfair Display',   slug: 'playfair-display',   spec: 'Playfair+Display:ital,wght@0,400;0,600;1,400' },
  { name: 'Spectral',           slug: 'spectral',           spec: 'Spectral:ital,wght@0,400;0,600;1,400' },
];

const SUBSETS = ['latin', 'latin-ext'];

/**
 * Families the browser resolves locally. Anything in FONT_SCHEMES that is not
 * one of these has to be downloaded, or the scheme silently falls back to a
 * generic serif on machines that lack it.
 */
const SYSTEM_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'system-ui',
  'Georgia', 'Times New Roman', 'Palatino Linotype', 'Book Antiqua',
  '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
]);

/**
 * Guards against the drift that put this script here in the first place: the
 * old index.html listed its eight families by hand, with nothing tying them to
 * the schemes the app actually offers. Adding a scheme that names a new family
 * now fails the build instead of shipping a font that never loads.
 */
function assertCoversFontSchemes() {
  const source = readFileSync(SETTINGS_STORE, 'utf-8');
  const start = source.indexOf('export const FONT_SCHEMES');
  if (start === -1) throw new Error(`Could not find FONT_SCHEMES in ${SETTINGS_STORE}`);
  const block = source.slice(start, source.indexOf('\n];', start));

  // Only the two font-stack fields. Matching every quoted string in the block
  // would sweep up scheme ids, labels and group names as if they were families.
  const referenced = new Set();
  for (const [, , stack] of block.matchAll(/(?:headingFont|contentFont):\s*(['"])(.*?)\1/g)) {
    for (const part of stack.split(',')) {
      const name = part.trim().replace(/^'|'$/g, '');
      if (name && !SYSTEM_FAMILIES.has(name)) referenced.add(name);
    }
  }

  const fetched = new Set(FAMILIES.map((f) => f.name));
  const missing = [...referenced].filter((name) => !fetched.has(name)).sort();
  if (missing.length) {
    throw new Error(
      `FONT_SCHEMES references ${missing.map((m) => `"${m}"`).join(', ')}, which this script does not ` +
        'fetch. Add the family to FAMILIES here, or to SYSTEM_FAMILIES if the browser supplies it.'
    );
  }

  const unused = [...fetched].filter((name) => !referenced.has(name)).sort();
  if (unused.length) {
    console.warn(`[fonts] WARNING: fetching ${unused.join(', ')}, which no font scheme uses.`);
  }
}

/**
 * Fetches one family's stylesheet, downloads each woff2 it names, and returns
 * the @font-face rules rewritten to point at the local copies.
 */
async function fetchFamily(family) {
  const url = `https://fonts.googleapis.com/css2?family=${family.spec}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${family.name}: stylesheet HTTP ${res.status}`);
  const stylesheet = await res.text();

  // Google emits one @font-face per subset, each preceded by a /* subset */
  // comment. Splitting on that comment keeps every rule with its own label.
  let css = '';
  let count = 0;
  for (const block of stylesheet.split(/(?=\/\*\s*[a-z0-9-]+\s*\*\/)/i)) {
    const subset = block.match(/\/\*\s*([a-z0-9-]+)\s*\*\//i)?.[1];
    if (!subset || !SUBSETS.includes(subset)) continue;
    const remote = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
    if (!remote) continue;

    const style = block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal';
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400';
    const filename = `${family.slug}-${subset}-${weight}-${style}.woff2`;

    const binary = await fetch(remote);
    if (!binary.ok) throw new Error(`${filename}: HTTP ${binary.status}`);
    writeFileSync(join(FONTS_DIR, filename), Buffer.from(await binary.arrayBuffer()));

    css += `${block.replace(remote, `./${filename}`).trim()}\n\n`;
    count++;
  }
  if (count === 0) throw new Error(`${family.name}: no ${SUBSETS.join('/')} faces found`);
  console.log(`[fonts] ${family.name}: ${count} woff2`);
  return css;
}

function writeLicenses() {
  const rows = FAMILIES.map((f) => `| ${f.name} | Google Fonts | OFL 1.1 |`).join('\n');
  writeFileSync(
    join(FONTS_DIR, 'FONT-LICENSES.md'),
    '# Bundled web fonts\n\n' +
      'These files are generated by `scripts/fetch-fonts.mjs` and self-hosted so the app\n' +
      'works offline and makes no third-party request. Every family is licensed under the\n' +
      'SIL Open Font License 1.1, which permits bundling and redistribution.\n\n' +
      '| Font | Source | License |\n|------|--------|---------|\n' +
      rows +
      '\n| Font Awesome Free (fa-solid, fa-regular) | Fonticons, Inc. (fontawesome.com) | OFL 1.1 |\n' +
      '\nFont Awesome is a runtime dependency rather than a download of this script,\n' +
      'but its webfonts are compiled into the client bundle and so are redistributed\n' +
      'alongside the families above. Its icons are CC BY 4.0 and its code MIT; see\n' +
      'admin/THIRD-PARTY-NOTICES.md.\n' +
      '\nOFL 1.1: https://scripts.sil.org/OFL\n'
  );
}

async function main() {
  assertCoversFontSchemes();

  const cssPath = join(FONTS_DIR, 'fonts.css');
  const alreadyFetched =
    existsSync(cssPath) &&
    existsSync(FONTS_DIR) &&
    readdirSync(FONTS_DIR).some((name) => name.endsWith('.woff2'));
  if (alreadyFetched && !process.argv.includes('--force')) {
    console.log('[fonts] Already present -- skipping (use --force to refetch).');
    return;
  }

  mkdirSync(FONTS_DIR, { recursive: true });

  let css =
    '/* GENERATED by scripts/fetch-fonts.mjs -- do not edit, and do not commit.\n' +
    '   Self-hosted so the app makes no third-party font request and keeps its\n' +
    '   faces offline. Regenerate with `npm run fetch:fonts -- --force`. */\n\n';
  for (const family of FAMILIES) css += await fetchFamily(family);

  writeFileSync(cssPath, css);
  writeLicenses();
  console.log(`[fonts] Wrote ${cssPath}`);
}

main().catch((err) => {
  console.error(`[fonts] ${err.message}`);
  process.exit(1);
});
