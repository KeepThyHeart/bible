import { describe, it, expect } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  inspectBackup, applyRestore, defaultSections, checkRegistryIntegrity, RestoreError, stampMs,
} from '../../Backup/Restore';
import type { RestoreMode } from '../../Backup/Restore';
import { createBackupPayload, readBackupPayload } from '../../Backup/Payload';
import { once } from '../../Backup/Streams';
import { NewerFormatError } from '../../Backup/errors';
import { tableSpec } from '../../Backup/Registry';
import { newUserDb, archiveOf, snapshot, canon, MemorySink, wopts } from './restoreHelpers';
import { seedRich } from './seed';
import { MemoryFiles, MemoryExtensions } from './memorySources';

async function restore(source: ReturnType<typeof newUserDb>, target: ReturnType<typeof newUserDb>, mode: RestoreMode, sections?: string[], extra: Partial<Parameters<typeof applyRestore>[1]> = {}, includeHistory = true) {
  const archive = await archiveOf({ sql: source }, includeHistory);
  const plan = inspectBackup(archive, { sql: target, ...extra }, { preview: false });
  return { plan, report: await applyRestore(plan, { sql: target, ...extra }, { mode, sections: sections ?? defaultSections(plan, mode) }) };
}

describe('replace', () => {
  it('reproduces every table exactly, with original ids, into an empty database', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    const { report } = await restore(a, b, 'replace');
    expect(report.ok).toBe(true);
    const sa = snapshot(a);
    const sb = snapshot(b);
    // This machine's own internal settings are kept, not replaced.
    const nonSystem = (rows: Array<Record<string, unknown>>) => rows.filter((r) => r.category !== 'system');
    for (const table of Object.keys(sa)) {
      if (table === 'setting') expect(nonSystem(sb[table]), table).toEqual(nonSystem(sa[table]));
      else expect(sb[table], table).toEqual(sa[table]);
    }
    expect(sb.setting.filter((r) => r.category === 'system')).toEqual(snapshot(newUserDb()).setting.filter((r) => r.category === 'system'));
    expect(checkRegistryIntegrity(b)).toEqual([]);
    expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('replacing notes also removes what belongs to them, and clears references to them, without touching unrelated rows', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO user_note (title, content) VALUES ('from backup', 'x')");
    const b = newUserDb();
    seedRich(b);
    const { report } = await restore(a, b, 'replace', ['user.user_note']);
    const s = snapshot(b);
    expect(s.user_note.map((r) => r.title)).toEqual(['from backup']);
    // links and pins that belong to the old notes are gone; those of journal entries and prayers stay
    expect(s.verse_link.map((l) => l.source_type).sort()).toEqual(['journal', 'prayer']);
    expect(s.pinned_item.map((p) => p.item_type)).toEqual(['verse']);
    // highlights survive; only their link to a note is cleared
    expect(s.user_text_markup).toHaveLength(2);
    expect(s.user_text_markup.every((m) => m.note_id === null)).toBe(true);
    expect(report.warnings.some((w) => w.code === 'dependentRemoved')).toBe(true);
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('a child restored without its parents never attaches to unrelated local rows that share ids', async () => {
    const a = newUserDb();
    seedRich(a, ' backup');
    const b = newUserDb();
    for (const t of ['LOCAL-A', 'LOCAL-B', 'LOCAL-C', 'LOCAL-D']) b.execute("INSERT INTO user_note (title, content) VALUES (?, 'x')", [t]);
    b.execute("INSERT INTO prayer_item (title) VALUES ('local prayer')");
    // Replace only prayers and links: the backup's note links point at note ids that mean something else here.
    const { report } = await restore(a, b, 'replace', ['user.prayer_item', 'user.verse_link']);
    const s = snapshot(b);
    expect(s.user_note.map((n) => n.title)).toEqual(['LOCAL-A', 'LOCAL-B', 'LOCAL-C', 'LOCAL-D']);
    expect(s.verse_link.filter((l) => ['note', 'document'].includes(String(l.source_type)))).toEqual([]);
    expect(report.perTable.find((t) => t.table === 'verse_link')!.dropped.danglingFk).toBeGreaterThan(0);
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('keeps this machine\'s internal settings and replaces the rest', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO setting (category, key, value) VALUES ('ui', 'zoom', '150'), ('system', 'schema', 'FROM-BACKUP')");
    const b = newUserDb();
    b.execute("INSERT INTO setting (category, key, value) VALUES ('ui', 'old', '1'), ('system', 'schema', 'LOCAL')");
    await restore(a, b, 'replace', ['user.setting']);
    const rows = Object.fromEntries(snapshot(b).setting.map((r) => [`${r.category}/${r.key}`, r.value]));
    expect(rows['ui/zoom']).toBe('150');
    expect(rows['ui/old']).toBeUndefined();
    expect(rows['system/schema']).toBe('LOCAL');
  });

  it('only touches the selected sections', async () => {
    const a = newUserDb();
    seedRich(a, ' A');
    const b = newUserDb();
    seedRich(b, ' B');
    const before = snapshot(b);
    await restore(a, b, 'replace', ['user.setting']);
    const after = snapshot(b);
    expect(after.setting.map((r) => r.value)).toEqual(snapshot(a).setting.map((r) => r.value));
    expect(after.user_note).toEqual(before.user_note);
    expect(after.collection).toEqual(before.collection);
  });

  it('is all-or-nothing: a failing row rolls everything back and names the row', async () => {
    const a = newUserDb();
    seedRich(a);
    const archive = await archiveOf({ sql: a });
    // Corrupt one session row after the fact by rebuilding the payload with an invalid value.
    const { zip } = await createBackupPayload({ sql: a }, wopts());
    const e = unzipSync(zip);
    const line = new TextDecoder().decode(e['user/session.ndjson']).replace('"is_default":0', '"is_default":7');
    const { manifest } = await createBackupPayload({ sql: a }, wopts());
    void manifest;
    e['user/session.ndjson'] = strToU8(line);
    const entries = await rehash(e);
    const bad = await readBackupPayload(once(entries));
    const b = newUserDb();
    seedRich(b, ' local');
    const before = snapshot(b);
    const plan = inspectBackup(bad, { sql: b }, { preview: false });
    await expect(applyRestore(plan, { sql: b }, { mode: 'replace', sections: defaultSections(plan, 'replace') })).rejects.toBeInstanceOf(RestoreError);
    expect(snapshot(b)).toEqual(before);
    void archive;
  });

  it('handles dangling references inside the backup by nulling or dropping, and reports them', async () => {
    const a = newUserDb();
    a.exec('PRAGMA foreign_keys = OFF');
    a.execute("INSERT INTO user_note (title, content, parent_note_id) VALUES ('orphan', 'x', 99)");
    a.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, note_id) VALUES (1, 1, 1, '#fff', 42)");
    a.execute("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('note', 77, 1, 1), ('commentary_entry', 1, 1, 1)");
    a.execute("INSERT INTO pinned_item (collection_id, item_type) VALUES (5, 'verse')");
    const b = newUserDb();
    const { report } = await restore(a, b, 'replace');
    const by = (t: string) => report.perTable.find((r) => r.table === t)!;
    expect(by('user_note').nulled).toBe(1);
    expect(snapshot(b).user_note[0].parent_note_id).toBeNull();
    expect(by('user_text_markup').nulled).toBe(1);
    expect(by('verse_link').dropped).toEqual({ danglingFk: 1, otherType: 1 });
    expect(by('pinned_item').dropped).toEqual({ danglingFk: 1 });
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('breaks parent cycles instead of failing', async () => {
    const a = newUserDb();
    a.exec('PRAGMA foreign_keys = OFF');
    a.execute("INSERT INTO user_note (note_id, title, content, parent_note_id) VALUES (1, 'a', 'x', 2), (2, 'b', 'x', 1)");
    const b = newUserDb();
    const { report } = await restore(a, b, 'replace');
    expect(report.perTable.find((r) => r.table === 'user_note')!.dropped.cycle).toBe(1);
    expect(snapshot(b).user_note).toHaveLength(2);
    expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('rebuilds the note search index', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO user_note (title, content) VALUES ('Zebra', 'striped horse')");
    const b = newUserDb();
    b.execute("INSERT INTO user_note (title, content) VALUES ('old', 'aardvark')");
    await restore(a, b, 'replace');
    expect(b.queryAll("SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH 'zebra'")).toHaveLength(1);
    expect(b.queryAll("SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH 'aardvark'")).toHaveLength(0);
  });
});

async function rehash(e: Record<string, Uint8Array>): Promise<Uint8Array> {
  const { sha256, hexEncode } = await import('../../Crypto');
  const manifest = JSON.parse(new TextDecoder().decode(e['manifest.json']));
  for (const ent of manifest.entries) {
    ent.size = e[ent.path].length;
    ent.sha256 = hexEncode(await sha256(e[ent.path]));
  }
  const ordered: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) };
  for (const [k, v] of Object.entries(e)) if (k !== 'manifest.json') ordered[k] = v;
  return zipSync(ordered, { level: 0 });
}

describe('merge', () => {
  it('into an empty database equals replace, modulo ids', async () => {
    const a = newUserDb();
    seedRich(a);
    const viaReplace = newUserDb();
    await restore(a, viaReplace, 'replace');
    const viaMerge = newUserDb();
    const { report } = await restore(a, viaMerge, 'merge', defaultSections((await mkPlan(a, viaMerge)), 'replace'));
    expect(report.ok).toBe(true);
    // Merge deliberately leaves out autosaves, stock presets, system settings and the profile,
    // so compare what the user made: the content and extension classes.
    const only = (c: Record<string, string[]>) => Object.fromEntries(Object.entries(c).filter(([t]) => ['content', 'extension'].includes(tableSpec(t)!.cls)));
    expect(only(canon(viaMerge))).toEqual(only(canon(viaReplace)));
    expect(checkRegistryIntegrity(viaMerge)).toEqual([]);
    expect(viaMerge.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('merging the same backup twice changes nothing the second time', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    b.execute("INSERT INTO user_note (title, content) VALUES ('mine', 'local')");
    b.execute("INSERT INTO user_commentary (name, is_default) VALUES ('Local default', 1)");
    const archive = await archiveOf({ sql: a });
    const plan = inspectBackup(archive, { sql: b }, { preview: false });
    const sections = defaultSections(plan, 'replace');
    const r1 = await applyRestore(plan, { sql: b }, { mode: 'merge', sections });
    const after1 = snapshot(b);
    expect(r1.perTable.find((t) => t.table === 'user_note')!.inserted).toBe(4);
    const r2 = await applyRestore(plan, { sql: b }, { mode: 'merge', sections });
    expect(snapshot(b)).toEqual(after1);
    expect(r2.perTable.every((t) => t.inserted === 0 && t.updated === 0)).toBe(true);
  });

  it('keeps every local row and its id, and never creates a second default notebook', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    b.execute("INSERT INTO user_commentary (name, is_default) VALUES ('Local default', 1)");
    b.execute("INSERT INTO user_note (user_commentary_id, title, content) VALUES (1, 'mine', 'local')");
    const localNotes = snapshot(b).user_note;
    await restore(a, b, 'merge');
    const s = snapshot(b);
    expect(s.user_note.find((n) => n.note_id === 1)).toEqual(localNotes[0]);
    expect(s.user_commentary.filter((c) => c.is_default === 1)).toHaveLength(1);
    expect(s.user_commentary.map((c) => c.name).sort()).toEqual(['Default', 'Local default', 'Sermons']);
    // the imported notes hang off the imported notebook, not off local ids
    const root = s.user_note.find((n) => n.title === 'Root')!;
    expect(s.user_commentary.find((c) => c.user_commentary_id === root.user_commentary_id)!.name).toBe('Default');
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('recognises rows already present, so overlapping data is not duplicated', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    seedRich(b); // identical content, same ids
    const before = canon(b);
    const { report } = await restore(a, b, 'merge');
    expect(canon(b)).toEqual(before);
    expect(report.perTable.filter((t) => t.inserted > 0)).toEqual([]);
  });

  it('remaps foreign keys when local ids differ, including parents and links', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    for (let i = 0; i < 10; i++) b.execute("INSERT INTO user_note (title, content) VALUES (?, 'pad')", [`pad${i}`]);
    for (let i = 0; i < 3; i++) b.execute("INSERT INTO collection (name) VALUES (?)", [`pad${i}`]);
    await restore(a, b, 'merge');
    const s = snapshot(b);
    const child = s.user_note.find((n) => n.title === 'Child')!;
    const root = s.user_note.find((n) => n.title === 'Root')!;
    expect(child.parent_note_id).toBe(root.note_id);
    expect(root.note_id).toBeGreaterThan(10);
    const link = s.verse_link.find((l) => l.link_type === 'primary_passage')!;
    expect(s.user_note.find((n) => n.note_id === link.source_id)!.title).toBe('Loose');
    const pin = s.pinned_item.find((p) => p.item_type === 'note')!;
    expect(pin.reference_id).toBe(root.note_id);
    const sub = s.collection.find((c) => c.name === 'Sub')!;
    expect(sub.parent_collection_id).toBe(s.collection.find((c) => c.name === 'Top')!.collection_id);
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('skips autosaves, stock presets and system settings; leaves the local profile alone', async () => {
    const a = newUserDb();
    seedRich(a);
    a.execute("INSERT INTO user_profile (profile_id, username) VALUES (1, 'backup-user')");
    const b = newUserDb();
    b.execute("INSERT INTO user_profile (profile_id, username) VALUES (1, 'local-user')");
    const plan = await mkPlan(a, b);
    await applyRestore(plan, { sql: b }, { mode: 'merge', sections: defaultSections(plan, 'replace') });
    const s = snapshot(b);
    expect(s.session.map((r) => r.name)).toEqual(['Saved']);
    expect(s.layout_preset.map((r) => r.name)).toEqual(['Mine']);
    expect(s.setting.map((r) => r.key)).toContain('zoom');
    expect(s.setting.some((r) => r.category === 'system' && r.key === 'schema')).toBe(false);
    expect(s.user_profile[0].username).toBe('local-user');
  });

  it('a parent that is not part of the merge makes children drop or null, and is reported', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    const { report } = await restore(a, b, 'merge', ['user.user_text_markup', 'user.verse_link']);
    const s = snapshot(b);
    expect(s.user_text_markup.every((m) => m.note_id === null)).toBe(true);
    expect(s.verse_link.filter((l) => ['note', 'document'].includes(String(l.source_type)))).toEqual([]);
    expect(report.perTable.find((t) => t.table === 'verse_link')!.dropped.danglingFk).toBeGreaterThan(0);
    expect(checkRegistryIntegrity(b)).toEqual([]);
  });

  it('extension key-value: newer wins, older is ignored, unknown extensions come along', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO extension_storage VALUES ('ext.a', 'newer', 'backup', 200), ('ext.a', 'older', 'backup', 100), ('ext.a', 'fresh', 'backup', 1), ('ext.gone', 'k', 'v', 1)");
    const b = newUserDb();
    b.execute("INSERT INTO extension_storage VALUES ('ext.a', 'newer', 'local', 100), ('ext.a', 'older', 'local', 200), ('ext.a', 'localonly', 'local', 1)");
    const { report } = await restore(a, b, 'merge');
    const kv = Object.fromEntries((snapshot(b).extension_storage).map((r) => [`${r.extension_id}/${r.key}`, [r.value, r.updated_at]]));
    expect(kv).toEqual({
      'ext.a/newer': ['backup', 200], 'ext.a/older': ['local', 200], 'ext.a/fresh': ['backup', 1],
      'ext.a/localonly': ['local', 1], 'ext.gone/k': ['v', 1],
    });
    expect(report.perTable.find((t) => t.table === 'extension_storage')!.updated).toBe(1);
    const again = await restore(a, b, 'merge');
    expect(again.report.perTable.find((t) => t.table === 'extension_storage')!.updated).toBe(0);
  });

  it('command history takes the larger counters and is idempotent', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO command_history VALUES ('c1', 500, 9), ('c2', 10, 1)");
    const b = newUserDb();
    b.execute("INSERT INTO command_history VALUES ('c1', 900, 2)");
    await restore(a, b, 'merge', ['user.command_history']);
    expect(snapshot(b).command_history).toEqual([
      { command_id: 'c1', last_used: 900, use_count: 9 }, { command_id: 'c2', last_used: 10, use_count: 1 }]);
  });

  it('newer-wins on user data items, comparing SQLite and ISO timestamps as UTC', async () => {
    expect(stampMs('2026-01-01 00:00:00')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(stampMs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(Number.isNaN(stampMs(null))).toBe(true);
    const a = newUserDb();
    a.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value, modified_date) VALUES ('o', 'c', 'k', 'new', '2026-02-01 00:00:00')");
    const b = newUserDb();
    b.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value, modified_date) VALUES ('o', 'c', 'k', 'old', '2026-01-01 00:00:00')");
    await restore(a, b, 'merge');
    expect(snapshot(b).user_data_item.map((r) => r.value)).toEqual(['new']);
  });

  it('keeps duplicate rows the source itself had (multiset semantics) and stays idempotent', async () => {
    const a = newUserDb();
    for (let i = 0; i < 3; i++) a.execute("INSERT INTO user_search_history (query, search_date) VALUES ('same', '2026-01-01 00:00:00')");
    const b = newUserDb();
    b.execute("INSERT INTO user_search_history (query, search_date) VALUES ('same', '2026-01-01 00:00:00')");
    await restore(a, b, 'merge', ['user.user_search_history']);
    expect(snapshot(b).user_search_history).toHaveLength(3);
    await restore(a, b, 'merge', ['user.user_search_history']);
    expect(snapshot(b).user_search_history).toHaveLength(3);
  });
});

async function mkPlan(source: ReturnType<typeof newUserDb>, target: ReturnType<typeof newUserDb>) {
  return inspectBackup(await archiveOf({ sql: source }), { sql: target }, { preview: false });
}

describe('inspect', () => {
  it('describes sections, columns, warnings and previews both modes without changing anything', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb();
    b.execute("INSERT INTO user_note (title, content) VALUES ('mine', 'x')");
    const before = snapshot(b);
    const plan = inspectBackup(await archiveOf({ sql: a }), { sql: b });
    expect(snapshot(b)).toEqual(before);
    const note = plan.sections.find((s) => s.id === 'user.user_note')!;
    expect(note).toMatchObject({ count: 4, targetExists: true, targetRows: 1, defaultOn: { replace: true, merge: true } });
    expect(plan.sections.find((s) => s.id === 'user.session')!.defaultOn).toEqual({ replace: true, merge: false });
    expect(plan.sections.find((s) => s.id === 'user.user_search_history')!.defaultOn).toEqual({ replace: true, merge: false });
    expect(plan.warnings.some((w) => w.code === 'moduleIds')).toBe(true);
    expect(plan.preview!.replace.perTable.find((t) => t.table === 'user_note')).toMatchObject({ cleared: 1, inserted: 4 });
    expect(plan.preview!.merge.perTable.find((t) => t.table === 'user_note')).toMatchObject({ cleared: 0, inserted: 4 });
    expect(plan.source.userSchemaVersion).toBe(1);
  });
  it('marks sections whose table this database lacks and skips them on apply', async () => {
    const a = newUserDb();
    seedRich(a);
    const b = newUserDb(false); // no extension_storage, keybindings, command_history
    const plan = inspectBackup(await archiveOf({ sql: a }), { sql: b }, { preview: false });
    expect(plan.sections.find((s) => s.id === 'user.user_keybindings')!.targetExists).toBe(false);
    const report = await applyRestore(plan, { sql: b }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    expect(report.skippedSections.map((s) => s.reason)).toContain('noTargetTable');
    expect(report.ok).toBe(true);
  });
  it('refuses a backup from a newer schema, and unknown section ids on apply', async () => {
    const a = newUserDb();
    const archive = await archiveOf({ sql: a });
    archive.manifest.userSchemaVersion = 2;
    expect(() => inspectBackup(archive, { sql: newUserDb() })).toThrow(NewerFormatError);
    archive.manifest.userSchemaVersion = 1;
    const plan = inspectBackup(archive, { sql: newUserDb() }, { preview: false });
    await expect(applyRestore(plan, { sql: newUserDb() }, { mode: 'merge', sections: ['nope'] })).rejects.toThrow(RangeError);
  });
  it('drops columns this database does not have, and counts them', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO user_note (title, content, sort_order) VALUES ('n', 'x', 5)");
    const b = newUserDb();
    b.exec('DROP INDEX idx_user_note_parent; ALTER TABLE user_note DROP COLUMN sort_order;'); // an older desktop shape
    const archive = await archiveOf({ sql: a });
    const plan = inspectBackup(archive, { sql: b }, { preview: false });
    expect(plan.sections.find((s) => s.id === 'user.user_note')!.droppedColumns).toEqual(['sort_order']);
    const report = await applyRestore(plan, { sql: b }, { mode: 'replace', sections: ['user.user_note'] });
    expect(report.droppedColumns).toEqual([{ table: 'user_note', column: 'sort_order', rows: 1 }]);
    expect(snapshot(b).user_note).toHaveLength(1);
  });
  it('passes preferences through for the caller to apply', async () => {
    const a = newUserDb();
    const archive = await archiveOf({ sql: a, preferences: async () => ({ theme: 'dark' }) });
    const b = newUserDb();
    const plan = inspectBackup(archive, { sql: b }, { preview: false });
    const report = await applyRestore(plan, { sql: b }, { mode: 'replace', sections: ['prefs'] });
    expect(report.preferences).toEqual({ theme: 'dark' });
    const merge = await applyRestore(plan, { sql: b }, { mode: 'merge', sections: defaultSections(plan, 'merge') });
    expect(merge.preferences).toBeUndefined();
  });
});

describe('note files', () => {
  const src = () => MemoryFiles.of({ 'Docs/a.bn': 'A from backup', 'Docs/b.bn': 'B', 'Verse Notes/John/3/16.bn': 'jn', 'Docs/a.bn.bak': 'old a' });
  async function plan(includeHistory = false) {
    const a = newUserDb();
    return inspectBackup(await archiveOf({ sql: a, notes: src() }, includeHistory), { sql: newUserDb(), notes: new MemorySink() }, { preview: false });
  }
  it('replace moves the existing folder aside, then writes the backup files', async () => {
    const p = await plan();
    const sink = MemorySink.of({ 'Docs/a.bn': 'local a', 'Docs/local-only.bn': 'keep me' });
    const report = await applyRestore(p, { sql: newUserDb(), notes: sink, now: () => new Date('2026-09-26T00:00:00Z') }, { mode: 'replace', sections: ['notes'] });
    expect(report.notes.movedAsideTo).toBe('before-restore-2026-09-26');
    expect([...sink.files.keys()].sort()).toEqual(['Docs/a.bn', 'Docs/b.bn', 'Verse Notes/John/3/16.bn']);
    expect(sink.text('Docs/a.bn')).toBe('A from backup');
    expect(sink.moved[0].files.has('Docs/local-only.bn')).toBe(true);
    expect(report.notes.written).toBe(3);
  });
  it('merge writes missing files, skips identical ones and keeps both versions of a differing one', async () => {
    const p = await plan();
    const sink = MemorySink.of({ 'Docs/a.bn': 'local a', 'Docs/b.bn': 'B' });
    const ctx = { sql: newUserDb(), notes: sink, now: () => new Date('2026-09-26T00:00:00Z') };
    const r1 = await applyRestore(p, ctx, { mode: 'merge', sections: ['notes'] });
    expect(sink.text('Docs/a.bn')).toBe('local a');
    expect(sink.text('Docs/a (restored 2026-09-26).bn')).toBe('A from backup');
    expect(sink.text('Verse Notes/John/3/16.bn')).toBe('jn');
    expect(r1.notes).toMatchObject({ written: 1, identical: 1, conflictCopies: [{ original: 'Docs/a.bn', copy: 'Docs/a (restored 2026-09-26).bn' }] });
    // second merge, another day: no new copies
    const filesBefore = [...sink.files.keys()].sort();
    await applyRestore(p, { ...ctx, now: () => new Date('2026-10-05T00:00:00Z') }, { mode: 'merge', sections: ['notes'] });
    expect([...sink.files.keys()].sort()).toEqual(filesBefore);
  });
  it('numbers a conflict copy when the dated name is taken by different content', async () => {
    const p = await plan();
    const sink = MemorySink.of({ 'Docs/a.bn': 'local a', 'Docs/a (restored 2026-09-26).bn': 'something else' });
    await applyRestore(p, { sql: newUserDb(), notes: sink, now: () => new Date('2026-09-26T00:00:00Z') }, { mode: 'merge', sections: ['notes'] });
    expect(sink.text('Docs/a (restored 2026-09-26) 2.bn')).toBe('A from backup');
  });
  it('history files never overwrite in merge', async () => {
    const p = await plan(true);
    const sink = MemorySink.of({ 'Docs/a.bn.bak': 'local bak' });
    const r = await applyRestore(p, { sql: newUserDb(), notes: sink }, { mode: 'merge', sections: ['notes.history'] });
    expect(sink.text('Docs/a.bn.bak')).toBe('local bak');
    expect(r.notes.skippedExisting).toBe(1);
  });
  it('a write failure is reported without undoing the database part', async () => {
    const p = await plan();
    const sink = MemorySink.of({});
    sink.write = async (path) => { if (path.endsWith('b.bn')) throw new Error('disk full'); sink.files.set(path, new Uint8Array()); };
    const r = await applyRestore(p, { sql: newUserDb(), notes: sink }, { mode: 'merge', sections: ['notes'] });
    expect(r.ok).toBe(false);
    expect(r.fileErrors).toEqual([{ path: 'Docs/b.bn', message: 'disk full' }]);
  });
});

describe('extension databases', () => {
  it('writes them in replace; keeps a local one in merge; reports both', async () => {
    const a = newUserDb();
    const archive = await archiveOf({ sql: a, extensions: new MemoryExtensions([{ id: 'ext.a', backupKv: true, databases: ['progress', 'notes'] }], { 'ext.a/progress': new Uint8Array([1]), 'ext.a/notes': new Uint8Array([2]) }) });
    const written = new Map<string, Uint8Array>([['ext.a/notes', new Uint8Array([9])]]);
    const sink = {
      dbExists: async (id: string, n: string) => written.has(`${id}/${n}`),
      writeDb: async (id: string, n: string, d: Uint8Array) => { written.set(`${id}/${n}`, d); },
    };
    const plan = inspectBackup(archive, { sql: newUserDb(), extensions: sink }, { preview: false });
    const rMerge = await applyRestore(plan, { sql: newUserDb(), extensions: sink }, { mode: 'merge', sections: defaultSections(plan, 'merge') });
    expect(rMerge.extDbs).toEqual([{ id: 'ext.a', name: 'notes', action: 'keptLocal' }, { id: 'ext.a', name: 'progress', action: 'written' }]);
    expect(written.get('ext.a/notes')).toEqual(new Uint8Array([9]));
    const rRep = await applyRestore(plan, { sql: newUserDb(), extensions: sink }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    expect(rRep.extDbs.every((e) => e.action === 'written')).toBe(true);
    expect(written.get('ext.a/notes')).toEqual(new Uint8Array([2]));
  });
});
