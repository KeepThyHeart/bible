#!/usr/bin/env node
/**
 * Generates a JSON Schema for each locale namespace from the English baseline.
 *
 * The schemas exist for editor validation: every `en/<ns>.json` names its
 * schema in a `$schema` key, so a translator adding a stray key or misspelling
 * an existing one sees it in the editor rather than at runtime.
 *
 * Output lands in `src/locales/schemas/` (gitignored -- generated, like the
 * fonts and icons) and is refreshed by the `prebuild:client` / `predev:client`
 * hooks, so a clean checkout has validation from the first build.
 *
 * The namespace list is read from `src/locales/en/` rather than hardcoded. It
 * used to be a literal array that omitted `booksShort`, so `booksShort.json`
 * pointed at a schema nothing ever generated and went unvalidated. Deriving the
 * list means adding a namespace cannot silently skip its schema again.
 *
 * Usage:
 *   node scripts/generate-locale-schemas.mjs           # generate/overwrite
 *   node scripts/generate-locale-schemas.mjs --check   # verify up to date (CI)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(scriptDir, '../src/locales');
const SCHEMAS_DIR = join(LOCALES_DIR, 'schemas');
const REFERENCE_LOCALE = 'en';

/** Prose appended to each schema's description. Unlisted namespaces get none. */
const DESCRIPTIONS = {
  ui: 'UI labels, buttons, messages, and tooltips',
  books: 'Bible book names (keys "1" through "66")',
  booksShort: 'Abbreviated Bible book names (keys "1" through "66")',
  modules: 'Bible translation and commentary descriptions',
  help: 'Help dialog content',
};

/** Every namespace that has an English baseline file. */
function namespaces() {
  return readdirSync(join(LOCALES_DIR, REFERENCE_LOCALE))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

/** Recursively convert a JSON value into a JSON Schema definition. */
function toSchema(value) {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) return { type: 'array' };
  if (typeof value === 'object' && value !== null) {
    const properties = {};
    const required = [];
    for (const [key, child] of Object.entries(value)) {
      properties[key] = toSchema(child);
      required.push(key);
    }
    const schema = { type: 'object', properties };
    if (required.length > 0) schema.required = required;
    schema.additionalProperties = false;
    return schema;
  }
  return {};
}

/** Wrap a namespace's shape in draft-07 metadata. */
function buildRootSchema(namespace, data) {
  const inner = toSchema(data);
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `Keep Thy Heart – ${namespace} namespace translations`,
    description:
      `Schema for ${namespace}.json locale files. ${DESCRIPTIONS[namespace] || ''}. ` +
      `Auto-generated from en/${namespace}.json — do not edit by hand.`,
    type: 'object',
    properties: {
      $schema: { type: 'string' },
      ...inner.properties,
    },
    required: inner.required || [],
    additionalProperties: false,
  };
}

function main() {
  const checkMode = process.argv.includes('--check');
  if (!checkMode) mkdirSync(SCHEMAS_DIR, { recursive: true });

  let allMatch = true;
  for (const ns of namespaces()) {
    const dataPath = join(LOCALES_DIR, REFERENCE_LOCALE, `${ns}.json`);
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    // Strip $schema before generating so it does not become a required key.
    delete data.$schema;

    const content = JSON.stringify(buildRootSchema(ns, data), null, 2) + '\n';
    const outPath = join(SCHEMAS_DIR, `${ns}.schema.json`);

    if (!checkMode) {
      writeFileSync(outPath, content, 'utf8');
      console.log(`[locale-schemas] generated ${ns}.schema.json`);
      continue;
    }
    if (!existsSync(outPath)) {
      console.error(`[locale-schemas] FAIL: missing ${ns}.schema.json`);
      allMatch = false;
    } else if (readFileSync(outPath, 'utf8') !== content) {
      console.error(`[locale-schemas] FAIL: out of date ${ns}.schema.json`);
      allMatch = false;
    } else {
      console.log(`[locale-schemas] ok ${ns}.schema.json`);
    }
  }

  if (checkMode && !allMatch) {
    console.error('[locale-schemas] Regenerate with: npm run generate:locale-schemas');
    process.exit(1);
  }
}

main();
