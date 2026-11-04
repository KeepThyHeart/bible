// Bundled and run by generate-beta1-profile.mjs against the extracted 0.1.0-beta.1
// sources. Everything imported below is BETA.1's own code, not the working tree's.
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { initializeUserSchema } from '../../../apps/desktop/electron/schema/userSchema';
import { initializeExtensionSchema } from '../../../apps/desktop/electron/extensions/extensionSchema';
import { ensureContentVerseLinkTable } from '../../../apps/desktop/electron/utils/verseIndexing';
import { createPlainExport } from '../../../apps/desktop/electron/services/BackupService';

const [outDir, sessionJsonPath] = process.argv.slice(2);
const STMT_SEP = '\n-- @@stmt@@\n';

function makeSql(db) {
  return {
    execute: (s, p = []) => {
      const r = db.prepare(s).run(...p);
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    queryAll: (s, p = []) => db.prepare(s).all(...p),
    queryOne: (s, p = []) => db.prepare(s).get(...p),
    transaction: (f) => db.transaction(f)(),
  };
}

const work = mkdtempSync(join(tmpdir(), 'beta1-fixture-'));
const db = new Database(join(work, 'user.db'));
db.pragma('foreign_keys = ON');
const sql = makeSql(db);
initializeUserSchema(sql);
initializeExtensionSchema(sql);
ensureContentVerseLinkTable(sql);

// --- seed: representative beta.1 user content, fixed timestamps -----------
const T = '2026-10-06 09:00:00';
const run = (s, p = []) => sql.execute(s, p);
run("INSERT INTO user_commentary (name, is_default, created_date, modified_date) VALUES ('Default', 1, ?, ?)", [T, T]);
run("INSERT INTO user_note (user_commentary_id, title, content, note_type, created_date, modified_date, tags) VALUES (1, 'John 3:16', '<p>God so loved the world</p>', 'verse_note', ?, ?, 'love,gospel')", [T, T]);
run("INSERT INTO user_note (title, content, note_type, document_type, created_date, modified_date) VALUES ('Sermon on grace', '<p>grace upon grace</p>', 'sermon', 'sermon', ?, ?)", [T, T]);
run("INSERT INTO user_note (parent_note_id, title, content, note_type, created_date, modified_date) VALUES (2, 'Outline', '<p>point one</p>', 'document', ?, ?)", [T, T]);
run("INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end, link_type) VALUES (1, 43003016, 43003016, 'primary_passage')");
run("INSERT INTO content_verse_link (content_type, content_id, verse_id_start, verse_id_end) VALUES ('note', 2, 45008028, 45008030)");
run("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, text_start, text_end, color, note_id, created_date) VALUES (1, 43003016, 43003016, 4, 20, '#FFF3A3', 1, ?)", [T]);
run("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, created_date) VALUES (1, 45008028, 45008030, '#A3D9FF', ?)", [T]);
run("INSERT INTO collection (name, created_date, modified_date) VALUES ('Favourites', ?, ?)", [T, T]);
run("INSERT INTO pinned_item (collection_id, item_type, verse_id_start, verse_id_end, reference_text, created_date) VALUES (1, 'verse', 19023001, 19023001, 'Psalm 23:1', ?)", [T]);
run("INSERT INTO pinned_item (collection_id, item_type, reference_id, title, created_date) VALUES (1, 'note', 1, 'John 3:16', ?)", [T]);
run("INSERT INTO user_keybindings VALUES ('cmd.example', 'ctrl+k', NULL, NULL)");
run("INSERT INTO command_history VALUES ('cmd.example', 1790000000, 3)");
run("INSERT INTO extension_storage VALUES ('ext.bible-app.word-count', 'lastRun', '{\"n\":3}', 1790000000)");
run("INSERT INTO extensions (id, version, install_path, granted_permissions, installed_at, updated_at) VALUES ('ext.bible-app.word-count', '1.0.0', '/x/ext.bible-app.word-count', '[\"bible:read\"]', 1790000000, 1790000000)");
const sessionJson = JSON.stringify(JSON.parse(readFileSync(sessionJsonPath, 'utf8')));
run("INSERT INTO session (name, is_autosave, is_default, session_data, created_date, modified_date, last_opened) VALUES ('Autosave', 1, 0, ?, ?, ?, ?)", [sessionJson, T, T, T]);
run("INSERT INTO session (name, is_autosave, is_default, session_data, created_date, modified_date) VALUES ('Saved study', 0, 0, ?, ?, ?)", [JSON.stringify({ ui: { preferences: { theme: 'light' } } }), T, T]);

// --- dump as statement-separated SQL ---------------------------------------
const master = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
const virtuals = master.filter((m) => m.type === 'table' && /^\s*CREATE VIRTUAL TABLE/i.test(m.sql)).map((m) => m.name);
const isShadow = (n) => virtuals.some((v) => n.startsWith(`${v}_`));
const tables = master.filter((m) => m.type === 'table' && !virtuals.includes(m.name) && !isShadow(m.name));
const virtualDdl = master.filter((m) => virtuals.includes(m.name));
const indexes = master.filter((m) => m.type === 'index' && !isShadow(m.tbl_name));
const triggers = master.filter((m) => m.type === 'trigger');
const out = [
  ...tables.map((t) => t.sql), ...virtualDdl.map((t) => t.sql), ...indexes.map((t) => t.sql), ...triggers.map((t) => t.sql),
];
const dataTables = [];
for (const t of tables) {
  if (t.name === 'sqlite_sequence') continue;
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all().map((c) => c.name);
  const rows = db.prepare(`SELECT ${cols.map((c) => `quote("${c}")`).join(', ')} FROM "${t.name}" ORDER BY rowid`).raw().all();
  if (rows.length) dataTables.push(t.name);
  for (const r of rows) out.push(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${r.join(', ')})`);
}
const userVersion = db.pragma('user_version', { simple: true });
writeFileSync(join(outDir, 'beta1-user.sql'),
  `-- Generated by generate-beta1-profile.mjs from 0.1.0-beta.1 (c0ba3b62). Do not edit.\n-- user_version: ${userVersion}\n-- statements are separated by a line holding only "-- @@stmt@@"\n${STMT_SEP}${out.join(STMT_SEP)}\n`);

// --- backup: beta.1's own plain export --------------------------------------
const notesDir = join(work, 'notes');
mkdirSync(join(notesDir, 'Docs'), { recursive: true });
writeFileSync(join(notesDir, 'Docs', 'sermon.bn'), '{"bn":1,"title":"Sermon"}\n');
const zipPath = join(outDir, 'beta1-backup.zip');
await createPlainExport(
  {
    sql, notesDir, now: () => new Date('2026-10-07T12:00:00Z'),
    appInfo: { name: 'Keep Thy Heart', version: '0.1.0-beta.1', platform: 'linux' },
  },
  { destinationPath: zipPath, includeHistory: false },
);
const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
const manifestKey = Object.keys(entries).find((k) => /manifest\.json$/.test(k));
if (manifestKey) {
  const manifest = JSON.parse(Buffer.from(entries[manifestKey]).toString('utf8'));
  writeFileSync(join(outDir, 'beta1-backup.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify({ userVersion, dataTables, zipEntries: Object.keys(entries) }, null, 2));
db.close();
