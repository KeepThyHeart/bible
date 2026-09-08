#!/usr/bin/env node
/**
 * i18n-pseudo.js
 *
 * Generates a pseudo-locale catalog under `apps/desktop/locales/xx-pseudo/`
 * from the source `en` catalogs. Pseudo-localization wraps every English
 * string in brackets and replaces ASCII letters with accented look-alikes,
 * making any string that escaped the i18n migration visually obvious when the
 * app is switched to `xx-pseudo`.
 *
 * Rules:
 *   - ICU placeholders like `{name}`, `{count, plural, ...}` are preserved
 *     verbatim - only the surrounding text is transliterated.
 *   - Each string is wrapped in `⟦ ... ⟧` so even short strings stand out.
 *   - The string is padded ~30% with extra characters to surface layout
 *     issues caused by longer translations (German, Russian, etc.).
 *
 * Usage:
 *   node scripts/i18n-pseudo.js
 *
 * The generated catalog is committed to the repo. Re-run whenever `en/`
 * changes.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'locales', 'en');
const DST_DIR = path.join(ROOT, 'locales', 'xx-pseudo');

/**
 * `meta.json` describes the locale itself (name, native name, draft status,
 * writing direction) rather than UI copy, so it must not be transliterated -
 * a pseudo-ized `"locale.status": "çøɱþļéţé"` would silently break the language
 * picker. It is written verbatim instead.
 */
const META_NAMESPACE = 'meta.json';
const PSEUDO_META = {
  'locale.name': 'Pseudo-locale (development)',
  'locale.nativeName': '⟦Pseudo⟧',
  'locale.status': 'draft',
  'locale.direction': 'ltr',
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

  // Pad ~30% with diacritics so layout overflow becomes visible.
  const padCount = Math.max(2, Math.floor(out.replace(/\{[^}]*\}/g, '').length * 0.3));
  const padding = '·'.repeat(padCount);
  return `⟦${out} ${padding}⟧`;
}

function processCatalog(file) {
  const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  const src = JSON.parse(text);
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = typeof v === 'string' ? pseudoize(v) : v;
  }
  return out;
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    process.stderr.write(`i18n-pseudo: source dir ${SRC_DIR} missing\n`);
    process.exit(1);
  }
  fs.mkdirSync(DST_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const out = file === META_NAMESPACE ? PSEUDO_META : processCatalog(file);
    const dst = path.join(DST_DIR, file);
    fs.writeFileSync(dst, JSON.stringify(out, null, 2) + '\n');
    process.stdout.write(`i18n-pseudo: wrote ${path.relative(ROOT, dst)} (${Object.keys(out).length} keys)\n`);
  }
}

main();
