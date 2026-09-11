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
 * What a run does:
 *   - Everything present (fonts.css, the Google woff2 files and Ezra SIL): exits
 *     immediately, so the hooks cost nothing once the fonts are installed.
 *   - Nothing (or no fonts.css) present, or --force: downloads everything and
 *     rewrites fonts.css and FONT-LICENSES.md.
 *   - Google fonts present but Ezra SIL missing: retries only Ezra SIL and, once
 *     its file exists, appends its @font-face to fonts.css.
 *
 * The Google Fonts families are required: if they cannot be downloaded the script
 * exits non-zero with instructions. Ezra SIL comes from software.sil.org, which has
 * been slow to accept connections, so it is optional: each download gets one retry,
 * and if Ezra SIL still fails the script only warns - fonts.css is written without
 * it (Hebrew falls back to the other families). The failure is recorded in
 * fonts/.ezra-sil-failed, and later runs skip the Ezra-only retry for 24 hours so an
 * unreachable host does not stall every `npm run dev`; --force (or deleting that
 * marker) retries at once, and a successful download removes the marker. The
 * Ezra zip is unpacked in memory with the `unzipper` package, so no system `unzip`
 * is needed. Downloads use node:https rather than fetch() because fetch's
 * connection timeout is fixed at 10 s, which that host has exceeded.
 *
 * Consequence worth knowing: **a clean build needs network access.** An offline
 * or air-gapped first build fails here, and this script also emits
 * FONT-LICENSES.md, which both electron-builder configs ship as `extraResources`
 * to satisfy the OFL attribution requirement. If we ever want offline-reproducible
 * builds, or the OFL notice present in the source tree rather than generated, the
 * fix is to commit these and drop the two .gitignore lines.
 *
 * Usage:  node scripts/fetch-fonts.mjs [--force]
 * Requires: Node 20+. Network access (on a clean checkout, or with --force).
 *
 * All bundled fonts are OFL 1.1 (freely redistributable). SBL Greek is intentionally
 * NOT bundled (not OFL); Greek falls back to Noto Serif, which includes greek subsets.
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = path.resolve(__dirname, '../src/ui/styles');
const FONTS_DIR = path.join(STYLES_DIR, 'fonts');
const FONTS_CSS = path.join(STYLES_DIR, 'fonts.css');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Covers both connecting and each pause while a response streams in.
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 2;
const MAX_REDIRECTS = 5;

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
const EZRA_ZIP_ENTRY = 'EzraSIL-2.51-web/web/SILEOT.woff';
const EZRA_FILE = path.join(FONTS_DIR, 'ezra-sil-regular.woff');
// Holds the ISO time of the last failed Ezra download; lives in the gitignored fonts dir.
const EZRA_FAILURE_MARKER = path.join(FONTS_DIR, '.ezra-sil-failed');
const EZRA_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EZRA_FONT_FACE =
  `/* Ezra SIL (Hebrew) - SIL International, OFL 1.1. Single regular weight. */\n` +
  `@font-face {\n  font-family: 'Ezra SIL';\n  font-style: normal;\n  font-weight: 400;\n` +
  `  font-display: swap;\n  src: url(./fonts/ezra-sil-regular.woff) format('woff');\n}\n`;

const CSS_HEADER =
  `/* Self-hosted web fonts - bundled for offline use, replaces Google Fonts @import\n` +
  `   (blocked by the renderer CSP style-src 'self'). Regenerate with:\n` +
  `     node scripts/fetch-fonts.mjs --force\n` +
  `   woff/woff2 files live in ./fonts/. All families are OFL 1.1. */\n\n`;

/** One GET, following redirects; resolves with the body of a 200 response. */
function httpGet(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft === 0) {
          reject(new Error('too many redirects'));
          return;
        }
        resolve(httpGet(new URL(res.headers.location, url).href, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`no response for ${REQUEST_TIMEOUT_MS / 1000} s`)));
    req.on('error', reject);
  });
}

/** httpGet with one retry; the final error names the URL. */
async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      return await httpGet(url);
    } catch (err) {
      lastError = err;
      if (attempt < DOWNLOAD_ATTEMPTS) console.warn(`  ${url}: ${err.message} - retrying`);
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

async function fetchGoogleFonts() {
  let css = '';
  let total = 0;
  for (const fam of GOOGLE_FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${fam.spec}&display=swap`;
    const text = (await download(url)).toString('utf8');
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
      fs.writeFileSync(path.join(FONTS_DIR, fname), await download(um[1]));
      css += block.replace(um[1], `./fonts/${fname}`).trim() + '\n\n';
      famCount++; total++;
    }
    if (famCount === 0) throw new Error(`no woff2 files found in the Google Fonts CSS for ${fam.name}`);
    console.log(`${fam.name}: ${famCount} woff2`);
  }
  return { css, total };
}

/**
 * Download the SIL web package and extract the regular .woff. Returns false (after
 * a warning) instead of throwing, because Ezra SIL is optional - see the header.
 */
async function tryFetchEzraSil() {
  try {
    const zip = await unzipper.Open.buffer(await download(EZRA_WEB_ZIP));
    const entry = zip.files.find((f) => f.path === EZRA_ZIP_ENTRY);
    if (!entry) throw new Error(`${EZRA_ZIP_ENTRY} is not in ${EZRA_WEB_ZIP}`);
    fs.writeFileSync(EZRA_FILE, await entry.buffer());
  } catch (err) {
    fs.writeFileSync(EZRA_FAILURE_MARKER, new Date().toISOString());
    console.warn(
      `WARNING: Ezra SIL (Hebrew font) could not be downloaded - ${err.message}\n` +
        `  Continuing without it; Hebrew text falls back to the other fonts.\n` +
        `  Runs of this script (e.g. npm run dev) will try Ezra SIL again after 24 hours;\n` +
        `  to retry sooner, run it with --force or delete ${path.relative(process.cwd(), EZRA_FAILURE_MARKER)}.`
    );
    return false;
  }
  fs.rmSync(EZRA_FAILURE_MARKER, { force: true });
  console.log('Ezra SIL: 1 woff');
  return true;
}

function writeLicenses(includeEzra) {
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
      (includeEzra ? `| Ezra SIL (ezra-sil-regular.woff) | SIL International (software.sil.org/ezra) | OFL 1.1 |\n` : '') +
      `\nNote: \`SBL Greek\` is intentionally NOT bundled - it is not OFL-licensed. Greek text\n` +
      `falls back to Noto Serif (which includes the greek + greek-ext subsets here).\n`
  );
}

function googleFontsPresent() {
  return fs.existsSync(FONTS_CSS) && fs.existsSync(FONTS_DIR) && fs.readdirSync(FONTS_DIR).some((f) => f.endsWith('.woff2'));
}

function fontsCssHasEzra() {
  return fs.readFileSync(FONTS_CSS, 'utf8').includes("font-family: 'Ezra SIL'");
}

/** True while a recorded Ezra failure is younger than the retry cooldown. */
function ezraCoolingDown() {
  if (!fs.existsSync(EZRA_FAILURE_MARKER)) return false;
  const failedAt = Date.parse(fs.readFileSync(EZRA_FAILURE_MARKER, 'utf8').trim());
  return Date.now() - failedAt < EZRA_RETRY_COOLDOWN_MS;
}

/** Fetch Ezra SIL if its file is missing, then add its @font-face to the existing fonts.css. */
async function completeEzraSil() {
  if (!fs.existsSync(EZRA_FILE)) {
    if (ezraCoolingDown()) {
      console.log(
        `Fonts present except Ezra SIL, which failed to download in the last 24 hours - not retrying yet ` +
          `(run with --force, or delete ${path.relative(process.cwd(), EZRA_FAILURE_MARKER)}, to retry now).`
      );
      return;
    }
    console.log('Fonts present except Ezra SIL - retrying Ezra SIL only.');
    if (!(await tryFetchEzraSil())) return;
  }
  fs.appendFileSync(FONTS_CSS, '\n' + EZRA_FONT_FACE);
  writeLicenses(true);
  console.log(`Added Ezra SIL to ${path.relative(process.cwd(), FONTS_CSS)}`);
}

async function fetchAll() {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  let google;
  try {
    google = await fetchGoogleFonts();
  } catch (err) {
    throw new Error(
      `could not download the Google Fonts families (${err.message}).\n` +
        `  The desktop app self-hosts these fonts and cannot be built or run without them.\n` +
        `  Check that fonts.googleapis.com and fonts.gstatic.com are reachable (proxy or\n` +
        `  firewall), then re-run: npm run fonts -w @bible/desktop`
    );
  }
  // With --force, a failed download still leaves a previously fetched Ezra file usable.
  const hasEzra = (await tryFetchEzraSil()) || fs.existsSync(EZRA_FILE);
  fs.writeFileSync(FONTS_CSS, CSS_HEADER + google.css + (hasEzra ? EZRA_FONT_FACE : ''));
  writeLicenses(hasEzra);
  console.log(`\nDone: ${google.total} woff2 + ${hasEzra ? 1 : 0} woff -> ${path.relative(process.cwd(), FONTS_DIR)}`);
  console.log(`Wrote ${path.relative(process.cwd(), FONTS_CSS)}`);
}

async function main() {
  // The fonts are gitignored and fetched on demand by the desktop package's
  // prebuild/predev hooks, so the common case must be a fast no-op.
  if (!process.argv.includes('--force') && googleFontsPresent()) {
    if (fs.existsSync(EZRA_FILE) && fontsCssHasEzra()) {
      console.log('Fonts already present - skipping fetch (use --force to refresh).');
      return;
    }
    await completeEzraSil();
    return;
  }
  await fetchAll();
}

main().catch((e) => {
  console.error('fetch-fonts failed:', e.message);
  process.exit(1);
});
