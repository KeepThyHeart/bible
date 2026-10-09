// Builds test/fixtures/mini.db (and mini-nc.db) from a full bible module .db.
// Usage: node test/fixtures/make-mini-db.mjs [path/to/bible_kjv.db]
// Rows are copied literally; nothing is rewritten.
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || '/home/psran/Documents/Tasks/work/0079-verse-hover/bible_kjv.db';

// [book, chapter, firstVerse|null, lastVerse|null]; null = whole chapter
const PICKS = [
  [43, 3, null, null], // John 3
  [43, 4, 1, 3], // so John 3:35-4:1 crosses a chapter boundary
  [19, 23, null, null], // Psalm 23
  [31, 1, null, null], // Obadiah 1
  [1, 1, 1, 5], // Genesis 1:1-5
  [64, 1, null, null], // 3 John 1
  [40, 5, 1, 12], // Matthew 5:1-12
];

function build(out, rows, info, srcDb) {
  if (existsSync(out)) rmSync(out);
  const db = new Database(out);
  const ddl = (name) => srcDb.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name).sql;
  db.exec(ddl('module_info'));
  db.exec(ddl('bible_verse'));
  const cols = Object.keys(info);
  db.prepare(`INSERT INTO module_info (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => info[c]));
  const ins = db.prepare('INSERT INTO bible_verse (verse_id, text, formatting, word_count, metadata) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const r of rows) ins.run(r.verse_id, r.text, r.formatting, r.word_count, r.metadata);
  })();
  db.close();
}

const s = new Database(src, { readonly: true });
const info = s.prepare('SELECT * FROM module_info').get();
const sel = s.prepare('SELECT * FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id');
const rows = [];
for (const [b, c, f, l] of PICKS) {
  const base = b * 1000000 + c * 1000;
  rows.push(...sel.all(base + (f ?? 0), base + (l ?? 999)));
}
rows.sort((a, b) => a.verse_id - b.verse_id);
build(join(here, 'mini.db'), rows, info, s);

const nc = rows.filter((r) => Math.floor(r.verse_id / 1000) === 43003 && r.verse_id % 1000 <= 5);
build(join(here, 'mini-nc.db'), nc, { ...info, abbreviation: 'NCTEST', full_name: 'Non-commercial test module', license_spdx: 'CC-BY-NC-4.0' }, s);
s.close();
console.log(`mini.db: ${rows.length} verses; mini-nc.db: ${nc.length} verses`);
