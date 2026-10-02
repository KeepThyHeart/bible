#!/usr/bin/env node
/**
 * i18n-pseudo.js
 *
 * Shared generator for the two dev-only pseudo-locales, for both apps'
 * catalog layouts:
 *
 *   desktop  apps/desktop/locales/<tag>/<ns>.json      (flat dotted keys)
 *   web      apps/web/src/locales/<tag>/<ns>.json      (nested objects, `$schema`)
 *
 * Modes:
 *   (default)  `xx-pseudo` - every string is wrapped in brackets and its ASCII
 *              letters are replaced with accented look-alikes (+~30 % padding),
 *              so any string that escaped the i18n migration stands out.
 *              Generated for desktop only unless `--app=web|all` is given.
 *   --rtl      `xx-rtl` - every string is wrapped in RLM marks (U+200F) and is
 *              otherwise the unchanged English text, so developers can read it
 *              while neutral runs (punctuation, numbers, placeholders) behave
 *              as inside a real right-to-left string. The locale's
 *              meta.json declares direction `rtl`, which flips the UI.
 *              Generated for both apps unless `--app=` narrows it.
 *
 * ICU syntax is never altered: `{name}`, `{n, plural, one {...} other {...}}`
 * stay verbatim (pseudo: only text outside braces is transliterated; rtl: the
 * whole message is wrapped, never the inside of a `{...}`).
 *
 * Usage:
 *   node scripts/i18n-pseudo.js [--rtl] [--app=desktop|web|all]
 *
 * The generated catalogs are committed. Re-run whenever `en/` changes
 * (`pnpm run i18n:pseudo` regenerates everything).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APPS = {
  desktop: path.join(REPO_ROOT, 'apps', 'desktop', 'locales'),
  web: path.join(REPO_ROOT, 'apps', 'web', 'src', 'locales'),
};

const META_NAMESPACE = 'meta.json';
const RLM = '‏';

/**
 * `meta.json` describes the locale itself rather than UI copy, so it is
 * written verbatim, never transliterated (a pseudo-ized `locale.status` would
 * silently break the language picker).
 */
const MODES = {
  pseudo: {
    dir: 'xx-pseudo',
    meta: {
      'locale.name': 'Pseudo-locale (development)',
      'locale.nativeName': '⟦Pseudo⟧',
      'locale.status': 'draft',
      'locale.direction': 'ltr',
    },
    transform: pseudoize,
    defaultApps: ['desktop'],
  },
  rtl: {
    dir: 'xx-rtl',
    meta: {
      'locale.name': 'Pseudo RTL',
      'locale.nativeName': 'Pseudo RTL',
      'locale.status': 'draft',
      'locale.direction': 'rtl',
      'locale.notes':
        'Development only. English text wrapped in RLM marks, with the UI direction forced to rtl, to test the mirrored layout without a real translation. Never promote this locale.',
    },
    transform: wrapRtl,
    defaultApps: ['desktop', 'web'],
  },
};

const MAP = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ',
  i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ø', p: 'þ',
  q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ',
  y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ',
  I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ø', P: 'Þ',
  Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ',
  Y: 'Ý', Z: 'Ž',
};

/**
 * Transliterates a single string while preserving ICU `{...}` placeholders.
 * Splits on balanced braces; even-index segments are plain text, odd-index
 * segments are placeholders left untouched.
 */
function pseudoize(input) {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '{') {
      if (depth === 0) {
        parts.push({ text: buf, placeholder: false });
        buf = '';
      }
      depth++;
      buf += ch;
    } else if (ch === '}') {
      depth--;
      buf += ch;
      if (depth === 0) {
        parts.push({ text: buf, placeholder: true });
        buf = '';
      }
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push({ text: buf, placeholder: false });

  let out = '';
  for (const p of parts) {
    if (p.placeholder) {
      out += p.text;
    } else {
      out += p.text.replace(/[A-Za-z]/g, (c) => MAP[c] || c);
    }
  }

  // Pad ~30% so layout overflow becomes visible.
  const padCount = Math.max(2, Math.floor(out.replace(/\{[^}]*\}/g, '').length * 0.3));
  const padding = '·'.repeat(padCount);
  return `⟦${out} ${padding}⟧`;
}

/** Wraps the whole message in RLM marks; the message itself is untouched. */
function wrapRtl(input) {
  return `${RLM}${input}${RLM}`;
}

/**
 * Applies `transform` to every string leaf. Desktop catalogs are flat; web
 * catalogs nest objects. `$schema` (an editor hint, not copy) is kept as is.
 */
function transformValue(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((v) => transformValue(v, transform));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === '$schema' ? v : transformValue(v, transform);
    }
    return out;
  }
  return value;
}

function countLeaves(value) {
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((n, v) => n + countLeaves(v), 0);
  }
  return 1;
}

/**
 * Generates one pseudo-locale for one app. Returns the files written.
 * `localesDir` / `log` are injectable for tests.
 */
function generate(mode, app, { localesDir = APPS[app], log = () => {} } = {}) {
  const cfg = MODES[mode];
  const srcDir = path.join(localesDir, 'en');
  const dstDir = path.join(localesDir, cfg.dir);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`i18n-pseudo: source dir ${srcDir} missing`);
  }
  fs.mkdirSync(dstDir, { recursive: true });
  const written = [];
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.json'))) {
    let out;
    if (file === META_NAMESPACE) {
      const src = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
      // Web's meta.json carries a `$schema` editor hint; keep it first.
      out = src.$schema ? { $schema: src.$schema, ...cfg.meta } : { ...cfg.meta };
    } else {
      out = transformValue(JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8')), cfg.transform);
    }
    const dst = path.join(dstDir, file);
    fs.writeFileSync(dst, JSON.stringify(out, null, 2) + '\n');
    written.push(dst);
    log(`i18n-pseudo: wrote ${path.relative(REPO_ROOT, dst)} (${countLeaves(out)} keys)\n`);
  }
  return written;
}

function main(argv) {
  const mode = argv.includes('--rtl') ? 'rtl' : 'pseudo';
  const appArg = argv.find((a) => a.startsWith('--app='));
  const which = appArg ? appArg.slice('--app='.length) : null;
  let apps;
  if (which === 'all') apps = Object.keys(APPS);
  else if (which) apps = which.split(',');
  else apps = MODES[mode].defaultApps;
  for (const app of apps) {
    if (!APPS[app]) {
      process.stderr.write(`i18n-pseudo: unknown app "${app}" (use desktop, web or all)\n`);
      process.exit(1);
    }
  }
  try {
    for (const app of apps) generate(mode, app, { log: (m) => process.stdout.write(m) });
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { pseudoize, wrapRtl, transformValue, generate, MODES };
