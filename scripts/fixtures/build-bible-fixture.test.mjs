// Checks the COMMITTED fixture only (no source data needed).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = join(repoRoot, 'fixtures', 'bible-data');
const Database = createRequire(join(repoRoot, 'package.json'))('better-sqlite3');
const core = createRequire(join(repoRoot, 'apps', 'desktop', 'package.json'))('@bible/core');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

const main = new Database(join(root, 'main.db'), { readonly: true });
const rows = main.prepare('SELECT abbreviation, database_path FROM module_metadata').all();
assert.equal(rows.length, manifest.modules.length);
for (const r of rows) assert.ok(existsSync(join(root, r.database_path)), `missing ${r.database_path}`);
assert.equal(main.prepare('SELECT count(*) FROM setting').pluck().get(), 0);
main.close();

const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const all = walk(root);
assert.deepEqual(all.filter(f => /-(wal|shm|journal)$/.test(f)), []);
assert.ok(all.reduce((n, f) => n + statSync(f).size, 0) < 10 * 1024 * 1024, 'fixture must stay under 10 MB');

const ALLOWED = new Set(['PD', 'GPL-2.0-or-later']);
for (const m of manifest.modules) {
  const db = new Database(join(root, m.file), { readonly: true });
  assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
  const info = db.prepare('SELECT module_type, license_spdx, content_sha256 FROM module_info').get();
  assert.ok(ALLOWED.has(info.license_spdx), `${m.abbreviation}: licence ${info.license_spdx}`);
  assert.equal(info.content_sha256, m.contentSha256);
  const sql = {
    queryOne: (s, p) => (p !== undefined ? db.prepare(s).get(p) : db.prepare(s).get()),
    queryAll: (s, p) => (p !== undefined ? db.prepare(s).all(p) : db.prepare(s).all()),
  };
  const codec = core.resolveModuleCodec(sql, core.createNodeCodecRegistry());
  assert.equal(core.computeContentSha256(sql, core.normalizeModuleType(info.module_type), codec), info.content_sha256);
  if (info.module_type === 'bible') {
    for (const ck of manifest.chapters.map(c => { const [b, ch] = c.split(':').map(Number); return b * 1000 + ch; })) {
      const n = db.prepare('SELECT count(*) FROM bible_verse WHERE verse_id / 1000 = ?').pluck().get(ck);
      assert.ok(n > 0, `${m.abbreviation}: no verses for chapter key ${ck}`);
    }
  }
  db.close();
}
console.log('bible fixture ok');
