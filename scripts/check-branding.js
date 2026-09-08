#!/usr/bin/env node
/**
 * Branding readiness check.
 *
 * Reports which public-facing names, domains, and URLs are still provisional,
 * and where each one is duplicated outside `admin/brand/branding.json`. Run it before
 * cutting a release:
 *
 *   npm run branding:check
 *
 * Exits non-zero when anything is still undecided, so it can gate a release
 * pipeline later. It is informational, not a test — nothing else depends on it.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const branding = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin', 'brand', 'branding.json'), 'utf8'));
const undecided = branding._undecided ?? [];

/**
 * Places that still hold their own copy of a branding value. The website reads
 * branding.json directly; these do not, because they are YAML, SQL, or
 * localized strings that cannot import it. Renaming means editing them too.
 */
const TOUCHPOINTS = [
  {
    key: 'productName',
    files: [
      'apps/desktop/electron-builder.yml',
      'apps/desktop/electron-builder.curated.yml',
      'apps/desktop/build-installer.nsh',
      'apps/desktop/index.html',
      'apps/desktop/detached.html',
      'apps/desktop/electron/main.ts',
      'apps/desktop/src/ui/App.tsx',
      'apps/desktop/locales/en/ui.json',
    ],
  },
  {
    key: 'appId',
    files: [
      'apps/desktop/electron-builder.yml',
      'apps/desktop/electron-builder.curated.yml',
    ],
  },
  {
    // `trustedCatalogKeys.ts` is the ONLY remaining copy, and it must stay a
    // hard-coded literal. It is a pinning trust anchor: if the official URL
    // prefix were build-configurable, anyone able to set an environment
    // variable could point the pin at a host they control, which is precisely
    // the attack pinning exists to stop. The value flows the other way — the
    // build reads `admin/brand/branding.json`, and this file is checked against it here.
    //
    // `initMainDatabase.ts` and `002_module_manager.sql` used to hold copies.
    // They no longer do: the repository seed reads `APP_CONFIG.moduleCatalogUrl`,
    // which `electron.vite.config.ts` defaults from `admin/brand/branding.json`.
    key: 'moduleRepositoryUrl',
    files: ['apps/desktop/electron/services/trustedCatalogKeys.ts'],
  },
];

function occurrences(relativePath, needle) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return null;
  const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
  return lines.reduce((count, line) => count + (line.includes(needle) ? 1 : 0), 0);
}

console.log('\nBranding readiness\n==================\n');

const settled = Object.keys(branding).filter(
  (key) => !key.startsWith('_') && !key.startsWith('$') && !undecided.includes(key),
);

console.log(`Settled (${settled.length}):`);
for (const key of settled) {
  console.log(`  ✓ ${key} = ${JSON.stringify(branding[key])}`);
}

console.log(`\nStill undecided (${undecided.length}):`);
for (const key of undecided) {
  console.log(`  ? ${key} = ${JSON.stringify(branding[key])}  (provisional)`);
}

console.log('\nHardcoded copies outside admin/brand/branding.json');
console.log('--------------------------------------');
console.log('These cannot import admin/brand/branding.json. Update them when the value changes.\n');

let missingFiles = 0;
for (const {key, files} of TOUCHPOINTS) {
  const value = branding[key];
  const status = undecided.includes(key) ? 'undecided' : 'settled';
  console.log(`  ${key} (${status}) — "${value}"`);
  for (const file of files) {
    const count = occurrences(file, value);
    if (count === null) {
      console.log(`      [missing file] ${file}`);
      missingFiles += 1;
    } else if (count > 0) {
      console.log(`      ${String(count).padStart(2)}× ${file}`);
    }
  }
  console.log('');
}

if (missingFiles > 0) {
  console.log(`Note: ${missingFiles} touchpoint file(s) listed above no longer exist.`);
  console.log('Update the TOUCHPOINTS list in scripts/check-branding.js.\n');
}

if (undecided.length > 0) {
  console.log(
    `${undecided.length} value(s) still provisional. Settle each one in admin/brand/branding.json\n` +
      'and remove its key from "_undecided".\n',
  );
  process.exit(1);
}

console.log('All branding values settled.\n');
