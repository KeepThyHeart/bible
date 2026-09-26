/** Regression tests for the findings of the security review of the backup format. */
import { describe, it, expect } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBackupPayload, readBackupPayload, decodeNdjson } from '../../Backup/Payload';
import { inspectBackup, applyRestore, defaultSections } from '../../Backup/Restore';
import { DamagedError, NewerFormatError } from '../../Backup/errors';
import { once } from '../../Backup/Streams';
import { readZip, writeZip, ZipError, DEFAULT_ZIP_LIMITS } from '../../Backup/Zip';
import { sha256, hexEncode } from '../../Crypto';
import { newUserDb, archiveOf, snapshot, wopts, MemorySink } from './restoreHelpers';
import { seedRich } from './seed';
import { MemoryFiles, MemoryExtensions } from './memorySources';

type Entries = Record<string, Uint8Array>;

/** Rebuild a payload with a manifest edit and matching checksums, so only the edit is under test. */
async function edited(a: ReturnType<typeof newUserDb>, edit: (m: any, e: Entries) => void): Promise<Uint8Array> {
  const { zip } = await createBackupPayload({ sql: a }, wopts());
  const e = unzipSync(zip) as Entries;
  const m = JSON.parse(new TextDecoder().decode(e['manifest.json']));
  edit(m, e);
  for (const ent of m.entries) {
    if (e[ent.path]) {
      ent.size = e[ent.path].length;
      ent.sha256 = hexEncode(await sha256(e[ent.path]));
    }
  }
  m.entries = m.entries.filter((x: any) => e[x.path]);
  const ordered: Entries = { 'manifest.json': strToU8(JSON.stringify(m)) };
  for (const [k, v] of Object.entries(e)) if (k !== 'manifest.json') ordered[k] = v;
  return zipSync(ordered, { level: 0 });
}

describe('hostile manifests', () => {
  it('a whole-table section for extension_storage is unknown, so it cannot wipe extension data', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO extension_storage VALUES ('ext.a', 'k', 'v', 1)");
    const zip = await edited(a, (m) => {
      m.sections.push({ id: 'user.extension_storage', kind: 'table', class: 'content', required: false, count: 0, table: 'extension_storage', columns: ['extension_id', 'key', 'value', 'updated_at'], paths: [m.entries.find((x: any) => x.path === 'user/setting.ndjson').path] });
    });
    const archive = await readBackupPayload(once(zip));
    expect(archive.unknownSections.map((s) => s.id)).toContain('user.extension_storage');
    const b = newUserDb();
    b.execute("INSERT INTO extension_storage VALUES ('ext.z', 'mine', 'local', 1)");
    const plan = inspectBackup(archive, { sql: b }, { preview: false });
    await applyRestore(plan, { sql: b }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    expect(snapshot(b).extension_storage.map((r) => r.extension_id)).toContain('ext.z');
  });

  it('the class of a section comes from this version, not from the file', async () => {
    const a = newUserDb();
    const zip = await edited(a, (m) => {
      for (const s of m.sections) if (s.id === 'user.session') s.class = 'content';
      m.sections.push({ id: 'weird', kind: 'files', class: 'content', required: false, count: 0, paths: [] });
    });
    const archive = await readBackupPayload(once(zip));
    expect(archive.sections.find((s) => s.id === 'user.session')!.class).toBe('workspace');
    expect(archive.unknownSections.map((s) => s.id)).toContain('weird');
    const plan = inspectBackup(archive, { sql: newUserDb() }, { preview: false });
    expect(defaultSections(plan, 'merge')).not.toContain('user.session');
    expect(defaultSections(plan, 'merge')).not.toContain('weird');
  });

  it('refuses inconsistent section ids, duplicate table sections and wrong counts', async () => {
    const a = newUserDb();
    seedRich(a);
    await expect(readBackupPayload(once(await edited(a, (m) => { m.sections[0].id = 'user.something_else'; })))).rejects.toBeInstanceOf(DamagedError);
    await expect(readBackupPayload(once(await edited(a, (m) => { m.sections.push({ ...m.sections.find((s: any) => s.kind === 'table') }); m.sections[m.sections.length - 1].id = 'user.dup'; })))).rejects.toBeInstanceOf(DamagedError);
    await expect(readBackupPayload(once(await edited(a, (m) => { m.sections.find((s: any) => s.id === 'user.user_note').count = 999; })))).rejects.toBeInstanceOf(DamagedError);
  });

  it('a required unknown section still refuses', async () => {
    const a = newUserDb();
    const zip = await edited(a, (m) => { m.sections.push({ id: 'x', kind: 'hologram', class: 'content', required: true, count: 0, paths: [] }); });
    await expect(readBackupPayload(once(zip))).rejects.toBeInstanceOf(NewerFormatError);
  });
});

describe('rows that do not carry their keys', () => {
  it('a section without its primary key column, or with a repeated one, is damage (never silently thinner)', async () => {
    const a = newUserDb();
    seedRich(a);
    const noKey = await edited(a, (m, e) => {
      const sec = m.sections.find((s: any) => s.id === 'user.user_note');
      sec.columns = sec.columns.filter((c: string) => c !== 'note_id');
      const rows = new TextDecoder().decode(e['user/user_note.ndjson']).trim().split('\n').map((l) => { const o = JSON.parse(l); delete o.note_id; return JSON.stringify(o); });
      e['user/user_note.ndjson'] = strToU8(rows.join('\n') + '\n');
    });
    const dup = await edited(a, (_m, e) => {
      const rows = new TextDecoder().decode(e['user/user_note.ndjson']).trim().split('\n').map((l) => { const o = JSON.parse(l); o.note_id = 1; return JSON.stringify(o); });
      e['user/user_note.ndjson'] = strToU8(rows.join('\n') + '\n');
    });
    for (const zip of [noKey, dup]) {
      const b = newUserDb();
      const plan = inspectBackup(await readBackupPayload(once(zip)), { sql: b }, { preview: false });
      for (const mode of ['replace', 'merge'] as const) {
        await expect(applyRestore(plan, { sql: b }, { mode, sections: ['user.user_note'] })).rejects.toBeInstanceOf(DamagedError);
        expect(snapshot(b).user_note).toEqual([]);
      }
    }
  });

  it('a very deep parent chain restores without overflowing the stack', async () => {
    const a = newUserDb();
    a.exec('PRAGMA foreign_keys = OFF');
    const n = 5000;
    a.exec(`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n}) INSERT INTO user_note (note_id, title, content, parent_note_id) SELECT x, 't', 'c', CASE WHEN x = 1 THEN NULL ELSE x - 1 END FROM c`);
    const b = newUserDb();
    const plan = inspectBackup(await archiveOf({ sql: a }), { sql: b }, { preview: false });
    await applyRestore(plan, { sql: b }, { mode: 'merge', sections: ['user.user_note'] });
    expect(snapshot(b).user_note).toHaveLength(n);
  });

  it('a merge whose identity column is missing skips that section instead of dropping rows', async () => {
    const a = newUserDb();
    a.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value) VALUES ('o', 'c', 'k1', '1'), ('o', 'c', 'k2', '2')");
    const b = newUserDb();
    b.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value) VALUES ('o', 'c', 'k0', '0')");
    const zip = await edited(a, (m, e) => {
      const sec = m.sections.find((s: any) => s.id === 'user.user_data_item');
      sec.columns = sec.columns.filter((c: string) => c !== 'item_key');
      const rows = new TextDecoder().decode(e['user/user_data_item.ndjson']).trim().split('\n').map((l) => { const o = JSON.parse(l); delete o.item_key; return JSON.stringify(o); });
      e['user/user_data_item.ndjson'] = strToU8(rows.join('\n') + '\n');
    });
    const plan = inspectBackup(await readBackupPayload(once(zip)), { sql: b }, { preview: false });
    const report = await applyRestore(plan, { sql: b }, { mode: 'merge', sections: ['user.user_data_item'] });
    expect(report.skippedSections).toEqual([{ id: 'user.user_data_item', reason: 'missingKeyColumn' }]);
    expect(snapshot(b).user_data_item).toHaveLength(1);
  });
});

describe('row values', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('invalid UTF-8, booleans and __proto__ are damage, not stray exceptions', () => {
    expect(() => decodeNdjson(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d, 0x0a]))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('{"a":true}\n'))).toThrow(DamagedError);
    expect(() => decodeNdjson(enc('{"__proto__":null}\n'))).toThrow(DamagedError);
  });
});

describe('resource limits', () => {
  it('many entries just under the per-entry ratio cannot add up to a bomb', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}.bin`, data: new Uint8Array(1024 * 1024) }));
    const zip = writeZip(entries);
    await expect(readZip(once(zip))).rejects.toThrow(/ratio/);
  });
  it('defaults are sized for the desktop main process', () => {
    expect(DEFAULT_ZIP_LIMITS.maxEntryBytes).toBeLessThanOrEqual(512 * 1024 ** 2);
    expect(DEFAULT_ZIP_LIMITS.maxTotalBytes).toBeLessThanOrEqual(2 * 1024 ** 3);
  });
  it('manifest.json has its own small cap', async () => {
    const big = writeZip([{ name: 'manifest.json', data: new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24) }]);
    await expect(readZip(once(big), { maxManifestBytes: 1024 })).rejects.toBeInstanceOf(ZipError);
  });
});

describe('extension databases in a backup', () => {
  it('a declared database that does not exist yet does not fail the backup', async () => {
    const a = newUserDb();
    const ext = new MemoryExtensions([{ id: 'ext.a', backupKv: true, databases: ['missing', 'present'] }], { 'ext.a/present': new Uint8Array([1]) });
    const { manifest, warnings } = await createBackupPayload({ sql: a, extensions: ext }, wopts());
    expect(manifest.sections.map((s) => s.id)).toContain('ext.ext.a.db.present');
    expect(manifest.sections.map((s) => s.id)).not.toContain('ext.ext.a.db.missing');
    expect(warnings).toContainEqual({ code: 'extensionSkipped', params: { id: 'ext.a', db: 'missing' } });
  });
});

describe('notes on case-insensitive file systems', () => {
  it('a name differing only by case or Unicode form is the same file, and gets a conflict copy instead of an overwrite', async () => {
    const a = newUserDb();
    const archive = await archiveOf({ sql: a, notes: MemoryFiles.of({ 'Docs/Foo.bn': 'from backup', 'Docs/café.bn': 'accent' }) }, false);
    const sink = MemorySink.of({ 'docs/foo.bn': 'local', 'Docs/café.bn': 'local accent' });
    const plan = inspectBackup(archive, { sql: newUserDb(), notes: sink }, { preview: false });
    const report = await applyRestore(plan, { sql: newUserDb(), notes: sink, now: () => new Date('2026-09-26T00:00:00Z') }, { mode: 'merge', sections: ['notes'] });
    expect(sink.text('docs/foo.bn')).toBe('local');
    expect(sink.text('Docs/café.bn')).toBe('local accent');
    expect(report.notes.conflictCopies).toHaveLength(2);
    expect(report.notes.conflictCopies[0].original).toBe('docs/foo.bn');
  });
});
