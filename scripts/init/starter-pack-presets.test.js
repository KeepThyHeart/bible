#!/usr/bin/env node
/**
 * The recommended sets in `starter-packs.json` are installable from the setup
 * script by name (`--select=essentials`), resolving each `module_id` against
 * the catalog and skipping the ones a catalog does not offer.
 *
 * Usage:  node scripts/init/starter-pack-presets.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { selectByName } = require('./catalog');
const { PRESETS, readStarterPackPresets } = require('./index');

const entries = [
  { module_id: 'bible_kjv', abbreviation: 'KJV' },
  { module_id: 'bible_webbe', abbreviation: 'WEBBE' },
  { module_id: 'commentary_mhc', abbreviation: 'MHC' },
  { module_id: 'xref_tsk', abbreviation: 'TSKxref' },
];

// Every pack in the shipped file becomes a preset named by its pack_id.
const shipped = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../packages/core/src/Data/Core/starter-packs.json'), 'utf8'));
for (const pack of shipped.packs) {
  assert.deepEqual(PRESETS[pack.pack_id], pack.module_ids, `preset ${pack.pack_id} matches the file`);
}

// Selecting a pack by name picks the modules the catalog offers, by module_id,
// and reports the rest as unavailable rather than failing.
{
  const { picked, unknown, unavailable } = selectByName(['essentials'], entries, PRESETS);
  assert.deepEqual(picked.map((e) => e.abbreviation), ['KJV', 'WEBBE', 'MHC', 'TSKxref']);
  assert.deepEqual(unknown, []);
  assert.ok(unavailable.includes('commentary_gill'), 'a module the catalog lacks is reported');
}

// Abbreviations still work, and win over a module_id spelled the same.
{
  const { picked } = selectByName(['KJV'], entries, PRESETS);
  assert.deepEqual(picked.map((e) => e.module_id), ['bible_kjv']);
}

// The dev presets keep their names even if a pack reuses one.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
  const file = path.join(dir, 'packs.json');
  fs.writeFileSync(file, JSON.stringify({ packs: [{ pack_id: 'demo', module_ids: ['bible_kjv'] }, { pack_id: 'bad' }] }));
  assert.deepEqual(readStarterPackPresets(file), { demo: ['bible_kjv'] }, 'a malformed pack is skipped');
  fs.rmSync(dir, { recursive: true, force: true });
}
assert.ok(PRESETS.starter.includes('KJV') && PRESETS.tests.includes('MHC'), 'starter and tests presets remain');

console.log('starter-pack-presets: ok');
