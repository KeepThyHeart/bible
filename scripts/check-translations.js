#!/usr/bin/env node

/**
 * Translation coverage checker.
 *
 * Compares each locale folder against the English (en/) reference to find
 * missing keys, extra keys, and overall coverage.
 *
 * Two catalog roots are checked, because the two apps ship their strings
 * separately:
 *
 *   - `apps/desktop/locales/`       (Electron app; flat dotted keys)
 *   - `apps/web/src/locales/`       (Preact/Express app)
 *
 * Namespaces are discovered from the reference locale rather than hard-coded,
 * so adding `foo.json` to `en/` automatically makes it required everywhere.
 *
 * Locale status (`complete` vs `draft`) is read from each locale's
 * `meta.json` (`locale.status`) where present and shown in the report, so a
 * 100 %-coverage draft is never mistaken for a reviewed translation. See
 * `apps/desktop/locales/README.md`.
 *
 * Usage:
 *   node scripts/check-translations.js           # check all locales, both roots
 *   node scripts/check-translations.js es        # check a specific locale
 */

const fs = require('fs');
const path = require('path');

const ROOTS = [
  { label: 'desktop', dir: path.resolve(__dirname, '../apps/desktop/locales') },
  { label: 'web', dir: path.resolve(__dirname, '../apps/web/src/locales') },
];
const REFERENCE_LOCALE = 'en';
/** Directories inside a locales root that are not locales. */
const NON_LOCALE_DIRS = new Set(['schemas']);

/**
 * Flatten a nested object into dot-separated key paths.
 * { a: { b: 1, c: 2 } } => ['a.b', 'a.c']
 *
 * Desktop catalogs are already flat (the whole key is the property name); this
 * handles both shapes.
 */
function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$schema') continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Load and flatten keys from a namespace JSON file.
 * Returns null if the file does not exist.
 */
function loadNamespaceKeys(root, locale, namespace) {
  const filePath = path.join(root, locale, `${namespace}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return new Set(flattenKeys(readJson(filePath)));
}

/** Namespaces required by a root, taken from its reference locale. */
function referenceNamespaces(root) {
  const refDir = path.join(root, REFERENCE_LOCALE);
  if (!fs.existsSync(refDir)) return [];
  return fs
    .readdirSync(refDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** `complete` / `draft` / `unknown`, from the locale's own meta.json. */
function localeStatus(root, locale) {
  const metaPath = path.join(root, locale, 'meta.json');
  if (!fs.existsSync(metaPath)) return 'unknown';
  try {
    const status = readJson(metaPath)['locale.status'];
    return status === 'complete' || status === 'draft' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Compare a single locale against the reference and return results per namespace.
 */
function checkLocale(root, namespaces, locale) {
  const results = [];

  for (const ns of namespaces) {
    const refKeys = loadNamespaceKeys(root, REFERENCE_LOCALE, ns);
    if (!refKeys) {
      console.error(`  Warning: reference file ${REFERENCE_LOCALE}/${ns}.json not found`);
      continue;
    }

    const localeKeys = loadNamespaceKeys(root, locale, ns);

    if (localeKeys === null) {
      results.push({
        namespace: ns,
        missing: [...refKeys],
        extra: [],
        total: refKeys.size,
        translated: 0,
        fileExists: false,
      });
      continue;
    }

    const missing = [...refKeys].filter((k) => !localeKeys.has(k));
    const extra = [...localeKeys].filter((k) => !refKeys.has(k));
    const translated = refKeys.size - missing.length;

    results.push({
      namespace: ns,
      missing,
      extra,
      total: refKeys.size,
      translated,
      fileExists: true,
    });
  }

  return results;
}

function listLocales(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== REFERENCE_LOCALE && !NON_LOCALE_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const targetLocale = process.argv[2] || null;

let hasMissing = false;
let checkedAny = false;

for (const { label, dir } of ROOTS) {
  if (!fs.existsSync(dir)) {
    console.log(`\n=== ${label} === (${dir} not found, skipped)`);
    continue;
  }

  const namespaces = referenceNamespaces(dir);
  if (namespaces.length === 0) {
    console.error(`\n=== ${label} === no ${REFERENCE_LOCALE}/ reference catalogs found in ${dir}`);
    process.exit(1);
  }

  let locales = listLocales(dir);
  if (targetLocale) {
    locales = locales.filter((l) => l === targetLocale);
  }

  console.log(`\n=== ${label} === (${dir})`);
  console.log(`  namespaces: ${namespaces.join(', ')}`);

  if (locales.length === 0) {
    console.log('  No non-English locale folders. Nothing to check.');
    continue;
  }

  for (const locale of locales) {
    checkedAny = true;
    const status = localeStatus(dir, locale);
    const statusNote =
      status === 'draft'
        ? '  [DRAFT - awaiting native-speaker review]'
        : status === 'unknown'
          ? '  [no meta.json - status unknown, treated as draft]'
          : '';
    console.log(`\n[${locale}]${statusNote}`);
    const results = checkLocale(dir, namespaces, locale);

    for (const r of results) {
      const pct = r.total > 0 ? ((r.translated / r.total) * 100).toFixed(1) : '0.0';

      if (!r.fileExists) {
        console.log(`  ${r.namespace}.json  MISSING FILE  (0/${r.total} keys, 0%)`);
        hasMissing = true;
        continue;
      }

      const state = r.missing.length === 0 ? 'OK' : `${r.missing.length} missing`;
      console.log(`  ${r.namespace}.json  ${r.translated}/${r.total} keys  ${pct}%  ${state}`);

      if (r.missing.length > 0) {
        hasMissing = true;
        for (const key of r.missing) {
          console.log(`    - ${key}`);
        }
      }

      if (r.extra.length > 0) {
        console.log(`    Extra keys (not in ${REFERENCE_LOCALE}):`);
        for (const key of r.extra) {
          console.log(`    + ${key}`);
        }
      }
    }
  }
}

console.log('');

if (hasMissing) {
  console.log('FAIL: Some locales have missing keys.');
  process.exit(1);
}

if (!checkedAny) {
  console.log('No non-English locale folders found. Nothing to check.');
  process.exit(0);
}

console.log('PASS: All locales are fully translated.');
console.log('Note: "fully translated" means key coverage only. Locales marked DRAFT');
console.log('have not been reviewed by a native speaker - see apps/desktop/locales/README.md.');
process.exit(0);
