#!/usr/bin/env node
/**
 * i18n-validate.js
 *
 * Verifies that every locale catalog under `apps/desktop/locales/`
 * contains every key present in the `en` catalog. The `en` catalog is the
 * source of truth; any other locale is allowed to have extra keys (it just
 * means future English work hasn't propagated yet) but MUST NOT be missing
 * any.
 *
 * Catalog files are flat JSON, organized by namespace:
 *   locales/<bcp47>/<namespace>.json
 *
 * For each non-en locale, the script:
 *   1. Loads every namespace JSON.
 *   2. Compares its key set against the matching `en` namespace.
 *   3. Reports missing keys, extra keys (warning only), and JSON parse errors.
 *
 * Exit code: 0 if every non-en locale has every en key, 1 otherwise.
 *
 * Usage:
 *   node scripts/i18n-validate.js
 *   node scripts/i18n-validate.js --locale=es
 *   node scripts/i18n-validate.js --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const SOURCE_LOCALE = 'en';

function listLocales() {
  if (!fs.existsSync(LOCALES_DIR)) return [];
  return fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function listNamespaces(locale) {
  const dir = path.join(LOCALES_DIR, locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

function loadCatalog(locale, namespace) {
  const file = path.join(LOCALES_DIR, locale, `${namespace}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    return { __parseError: err.message, __file: file };
  }
}

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const localeFilter = (args.find((a) => a.startsWith('--locale=')) || '').split('=')[1];

  const locales = listLocales();
  if (!locales.includes(SOURCE_LOCALE)) {
    process.stderr.write(`i18n-validate: source locale '${SOURCE_LOCALE}' missing from ${LOCALES_DIR}\n`);
    process.exit(1);
  }

  const enNamespaces = listNamespaces(SOURCE_LOCALE);
  const enKeysByNs = {};
  for (const ns of enNamespaces) {
    const cat = loadCatalog(SOURCE_LOCALE, ns);
    if (!cat || cat.__parseError) {
      process.stderr.write(`i18n-validate: failed to parse en/${ns}.json: ${cat?.__parseError}\n`);
      process.exit(1);
    }
    enKeysByNs[ns] = new Set(Object.keys(cat));
  }

  const report = {};
  let totalMissing = 0;

  for (const locale of locales) {
    if (locale === SOURCE_LOCALE) continue;
    if (localeFilter && locale !== localeFilter) continue;
    const localeReport = { missing: {}, extra: {}, parseErrors: [] };
    for (const ns of enNamespaces) {
      const cat = loadCatalog(locale, ns);
      if (!cat) {
        // Whole namespace missing - every en key in this namespace is missing.
        const missing = Array.from(enKeysByNs[ns]);
        if (missing.length > 0) {
          localeReport.missing[ns] = missing;
          totalMissing += missing.length;
        }
        continue;
      }
      if (cat.__parseError) {
        localeReport.parseErrors.push({ ns, error: cat.__parseError });
        continue;
      }
      const localeKeys = new Set(Object.keys(cat));
      const missing = [];
      for (const k of enKeysByNs[ns]) {
        if (!localeKeys.has(k)) missing.push(k);
      }
      if (missing.length > 0) {
        localeReport.missing[ns] = missing;
        totalMissing += missing.length;
      }
      const extra = [];
      for (const k of localeKeys) {
        if (!enKeysByNs[ns].has(k)) extra.push(k);
      }
      if (extra.length > 0) localeReport.extra[ns] = extra;
    }
    report[locale] = localeReport;
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    let any = false;
    for (const [locale, r] of Object.entries(report)) {
      const missingCount = Object.values(r.missing).reduce((a, b) => a + b.length, 0);
      const extraCount = Object.values(r.extra).reduce((a, b) => a + b.length, 0);
      if (missingCount === 0 && extraCount === 0 && r.parseErrors.length === 0) continue;
      any = true;
      process.stdout.write(`\n${locale}:\n`);
      if (r.parseErrors.length > 0) {
        for (const pe of r.parseErrors) {
          process.stdout.write(`  PARSE ERROR  ${pe.ns}.json: ${pe.error}\n`);
        }
      }
      for (const [ns, keys] of Object.entries(r.missing)) {
        process.stdout.write(`  missing in ${ns}.json (${keys.length}):\n`);
        for (const k of keys) process.stdout.write(`    - ${k}\n`);
      }
      for (const [ns, keys] of Object.entries(r.extra)) {
        process.stdout.write(`  extra in ${ns}.json (${keys.length}):\n`);
        for (const k of keys) process.stdout.write(`    + ${k}\n`);
      }
    }
    if (!any) {
      process.stdout.write('i18n-validate: all locales contain every en key.\n');
    }
  }

  process.exit(totalMissing === 0 ? 0 : 1);
}

main();
