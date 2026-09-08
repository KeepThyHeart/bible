/**
 * fetch-fonts.mjs - regenerate the self-hosted web fonts used by the desktop app.
 *
 * The desktop renderer's CSP (style-src 'self') blocks external stylesheets, and
 * the app must work fully offline, so the Bible/study fonts are self-hosted rather
 * than pulled from Google Fonts at runtime. This script (re)downloads them into
 *   apps/desktop/src/ui/styles/fonts/            (woff2/woff binaries)
 * and regenerates
 *   apps/desktop/src/ui/styles/fonts.css         (@font-face rules)
 * which globals.css imports via `@import './fonts.css'`.
 *
 * The generated files are NOT committed - apps/desktop/.gitignore excludes
 * both `src/ui/styles/fonts` and `src/ui/styles/fonts.css`. They are regenerated
 * automatically by the `prebuild` and `predev` hooks in the desktop package, so a
 * clean checkout produces them on first build.
 *
 * Consequence worth knowing: **a clean build needs network access.** An offline
 * or air-gapped first build fails here, and this script also emits
 * FONT-LICENSES.md, which both electron-builder configs ship as `extraResources`
 * to satisfy the OFL attribution requirement. If we ever want offline-reproducible
 * builds, or the OFL notice present in the source tree rather than generated, the
 * fix is to commit these and drop the two .gitignore lines.
 *
 * Usage:  node scripts/fetch-fonts.mjs
 * Requires: Node 18+ (global fetch) - Node 20+ recommended. Network access.
 *
 * All bundled fonts are OFL 1.1 (freely redistributable). SBL Greek is intentionally
 * NOT bundled (not OFL); Greek falls back to Noto Serif, which includes greek subsets.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = path.resolve(__dirname, '../src/ui/styles');
const FONTS_DIR = path.join(STYLES_DIR, 'fonts');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Google Fonts (OFL). Latin serifs get latin + latin-ext; Noto Serif also serves
// as the Greek fallback (.greek-text), so it additionally gets greek + greek-ext.
const GOOGLE_FAMILIES = [
  { name: 'Noto Serif',        slug: 'noto-serif',        spec: 'Noto+Serif:ital,wght@0,400;0,700;1,400',        subsets: ['latin', 'latin-ext', 'greek', 'greek-ext'] },
  { name: 'Merriweather',      slug: 'merriweather',      spec: 'Merriweather:ital,wght@0,400;0,700;1,400',       subsets: ['latin', 'latin-ext'] },
  { name: 'Crimson Text',      slug: 'crimson-text',      spec: 'Crimson+Text:ital,wght@0,400;0,600;0,700;1,400', subsets: ['latin', 'latin-ext'] },
  { name: 'Libre Baskerville', slug: 'libre-baskerville', spec: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400',  subsets: ['latin', 'latin-ext'] },
];

// Ezra SIL (Hebrew, OFL) - not on Google Fonts; sourced from SIL's web package (.woff).
const EZRA_WEB_ZIP = 'https://software.sil.org/downloads/r/ezra/EzraSIL-2.51-web.zip';

async function fetchGoogleFonts() {
  let css = '';
  let total = 0;
  for (const fam of GOOGLE_FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${fam.spec}&display=swap`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`css ${fam.name}: HTTP ${res.status}`);
    const text = await res.text();
    const blocks = text.split(/(?=\/\*\s*[a-z0-9-]+\s*\*\/)/i);
    let famCount = 0;
    for (const block of blocks) {
      const sm = block.match(/\/\*\s*([a-z0-9-]+)\s*\*\//i);
      if (!sm || !fam.subsets.includes(sm[1])) continue;
      const um = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
      if (!um) continue;
      const style = (block.match(/font-style:\s*(\w+)/) || [, 'normal'])[1];
      const weight = (block.match(/font-weight:\s*(\d+)/) || [, '400'])[1];
      const fname = `${fam.slug}-${sm[1]}-${weight}-${style}.woff2`;
      const wres = await fetch(um[1]);
      if (!wres.ok) throw new Error(`woff2 ${fname}: HTTP ${wres.status}`);
      fs.writeFileSync(path.join(FONTS_DIR, fname), Buffer.from(await wres.arrayBuffer()));
      css += block.replace(um[1], `./fonts/${fname}`).trim() + '\n\n';
      famCount++; total++;
    }
    console.log(`${fam.name}: ${famCount} woff2`);
  }
  return { css, total };
}

async function fetchEzraSil() {
  // Download the SIL web package and extract the regular .woff.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezra-'));
  const zipPath = path.join(tmp, 'ezra-web.zip');
  const res = await fetch(EZRA_WEB_ZIP, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Ezra SIL zip: HTTP ${res.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  // Extract SILEOT.woff (regular) using the system unzip (available in Git Bash / *nix).
  execFileSync('unzip', ['-o', '-j', zipPath, 'EzraSIL-2.51-web/web/SILEOT.woff', '-d', tmp], { stdio: 'ignore' });
  fs.copyFileSync(path.join(tmp, 'SILEOT.woff'), path.join(FONTS_DIR, 'ezra-sil-regular.woff'));
  console.log('Ezra SIL: 1 woff');
  return (
    `/* Ezra SIL (Hebrew) — SIL International, OFL 1.1. Single regular weight. */\n` +
    `@font-face {\n  font-family: 'Ezra SIL';\n  font-style: normal;\n  font-weight: 400;\n` +
    `  font-display: swap;\n  src: url(./fonts/ezra-sil-regular.woff) format('woff');\n}\n`
  );
}

function writeLicenses() {
  fs.writeFileSync(
    path.join(FONTS_DIR, 'FONT-LICENSES.md'),
    `# Bundled fonts\n\n` +
      `All fonts here are self-hosted for offline use and licensed under the\n` +
      `SIL Open Font License 1.1 (OFL), which permits bundling and redistribution.\n\n` +
      `| Font | Source | License |\n|------|--------|---------|\n` +
      `| Noto Serif | Google Fonts (fonts.google.com) | OFL 1.1 |\n` +
      `| Merriweather | Google Fonts | OFL 1.1 |\n` +
      `| Crimson Text | Google Fonts | OFL 1.1 |\n` +
      `| Libre Baskerville | Google Fonts | OFL 1.1 |\n` +
      `| Ezra SIL (ezra-sil-regular.woff) | SIL International (software.sil.org/ezra) | OFL 1.1 |\n\n` +
      `Note: \`SBL Greek\` is intentionally NOT bundled — it is not OFL-licensed. Greek text\n` +
      `falls back to Noto Serif (which includes the greek + greek-ext subsets here).\n`
  );
}

async function main() {
  // Skip if fonts are already present (they are gitignored and fetched on demand
  // by the desktop package's prebuild/predev hooks). Pass --force to refresh.
  const force = process.argv.includes('--force');
  const fontsCssPath = path.join(STYLES_DIR, 'fonts.css');
  const hasFonts =
    fs.existsSync(fontsCssPath) &&
    fs.existsSync(FONTS_DIR) &&
    fs.readdirSync(FONTS_DIR).some((f) => /\.woff2?$/.test(f));
  if (hasFonts && !force) {
    console.log('Fonts already present — skipping fetch (use --force to refresh).');
    return;
  }
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  const header =
    `/* Self-hosted web fonts — bundled for offline use, replaces Google Fonts @import\n` +
    `   (blocked by the renderer CSP style-src 'self'). Regenerate with:\n` +
    `     node scripts/fetch-fonts.mjs\n` +
    `   woff/woff2 files live in ./fonts/. All families are OFL 1.1. */\n\n`;
  const { css: googleCss, total } = await fetchGoogleFonts();
  const ezraCss = await fetchEzraSil();
  fs.writeFileSync(path.join(STYLES_DIR, 'fonts.css'), header + googleCss + ezraCss);
  writeLicenses();
  console.log(`\nDone: ${total} woff2 + 1 woff -> ${path.relative(process.cwd(), FONTS_DIR)}`);
  console.log(`Wrote ${path.relative(process.cwd(), path.join(STYLES_DIR, 'fonts.css'))}`);
}

main().catch((e) => {
  console.error('fetch-fonts failed:', e.message);
  process.exit(1);
});
