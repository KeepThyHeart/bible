import { describe, it, expect } from 'vitest';
import { MemoryUserDb, UserDataItem, VerseLinkRecord, exportUserData, importUserData, migrateLocalStorage, appOwner } from '../UserData';
import type { KeyValueStorage } from '../UserData';
import { inspectBackup, applyRestore, defaultSections } from '../Backup/Restore';
import { createBackupPayload, readBackupPayload } from '../Backup/Payload';
import { once } from '../Backup/Streams';
import { UserDataRepository } from '../Data/Repositories/UserDataRepository';
import { VerseLinkRepository } from '../Data/Repositories/VerseLinkRepository';
import { newUserDb, APP } from './Backup/restoreHelpers';
import { seedRich } from './Backup/seed';

const fast = async () => new Uint8Array(32).fill(7);
const opts = { app: APP, now: () => new Date('2026-09-29T10:00:00Z') };

function seeded(now = '2026-01-01T00:00:00Z'): MemoryUserDb {
  const db = new MemoryUserDb({ now: () => new Date(now) });
  const a = db.items.put(UserDataItem.json(appOwner('demo'), 'things', 'a', { n: 1 }, { sortOrder: 2, metadata: { m: true } }));
  db.items.put(UserDataItem.json(appOwner('demo'), 'things', 'b', 'two'));
  db.links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: a.itemId!, verseIdStart: 43003016, verseIdEnd: 43003018, linkType: 'annotation', context: 'c' }));
  return db;
}

describe('export / import (backup format v1)', () => {
  it('writes the same sections a desktop backup has', async () => {
    const out = await exportUserData(seeded(), opts);
    expect(out.extension).toBe('zip');
    const archive = await readBackupPayload(once(out.bytes));
    expect(archive.manifest.sections.map((s) => s.id).sort()).toEqual(['user.user_data_item', 'user.verse_link']);
    expect(archive.manifest.format).toBe('kth-backup');
  });

  it('round-trips into an empty store with dates, values and links intact', async () => {
    const src = seeded();
    const dest = new MemoryUserDb();
    dest.items.put(UserDataItem.json('app:pad', 'x', 'x', 1)); // shifts ids so the link remap is exercised
    const report = await importUserData(dest, (await exportUserData(src, opts)).bytes);
    expect(report.items).toEqual({ added: 2, updated: 0, unchanged: 0, invalid: 0 });
    expect(report.links.added).toBe(1);
    const a = dest.items.get(appOwner('demo'), 'things', 'a')!;
    expect(a.parsedValue()).toEqual({ n: 1 });
    expect(a.sortOrder).toBe(2);
    expect(a.metadata).toEqual({ m: true });
    expect(a.createdDate).toBe('2026-01-01 00:00:00');
    const [link] = dest.links.getForVerse(43003017);
    expect(link.sourceId).toBe(a.itemId);
    expect(link.linkType).toBe('annotation');
  });

  it('merge: a newer local value wins, a newer backup value wins, links are not duplicated', async () => {
    const backup = (await exportUserData(seeded('2026-03-01T00:00:00Z'), opts)).bytes;
    const dest = new MemoryUserDb({ now: () => new Date('2026-02-01T00:00:00Z') });
    dest.items.put(UserDataItem.json(appOwner('demo'), 'things', 'a', 'local-older'));
    const b = new MemoryUserDb({ now: () => new Date('2026-04-01T00:00:00Z') });
    b.items.put(UserDataItem.json(appOwner('demo'), 'things', 'b', 'local-newer'));
    await importUserData(dest, backup);
    expect(dest.items.get(appOwner('demo'), 'things', 'a')!.parsedValue()).toEqual({ n: 1 });
    await importUserData(b, backup);
    expect(b.items.get(appOwner('demo'), 'things', 'b')!.parsedValue()).toBe('local-newer');
    const again = await importUserData(dest, backup);
    expect(again.items.added).toBe(0);
    expect(again.links.added).toBe(0);
    expect(dest.links.getForVerse(43003016)).toHaveLength(1);
  });

  it('replace empties the store first', async () => {
    const dest = new MemoryUserDb();
    dest.items.put(UserDataItem.json('app:old', 'c', 'k', 1));
    await importUserData(dest, (await exportUserData(seeded(), opts)).bytes, { mode: 'replace' });
    expect(dest.items.owners()).toEqual([appOwner('demo')]);
  });

  it('encrypts with a password (.bbk) and refuses a wrong one before changing anything', async () => {
    const out = await exportUserData(seeded(), { ...opts, password: 'pw', seal: { kdf: fast } });
    expect(out.extension).toBe('bbk');
    const dest = new MemoryUserDb();
    dest.items.put(UserDataItem.json('app:keep', 'c', 'k', 1));
    await expect(importUserData(dest, out.bytes, { password: 'pw', mode: 'replace', open: { kdf: async () => new Uint8Array(32).fill(9) } })).rejects.toThrow();
    expect(dest.items.owners()).toEqual(['app:keep']);
    const ok = await importUserData(dest, out.bytes, { password: 'pw', open: { kdf: fast } });
    expect(ok.items.added).toBe(2);
  });

  it('rejects a damaged file without touching the store', async () => {
    const bytes = (await exportUserData(seeded(), opts)).bytes.slice();
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const dest = new MemoryUserDb();
    dest.items.put(UserDataItem.json('app:keep', 'c', 'k', 1));
    await expect(importUserData(dest, bytes, { mode: 'replace' })).rejects.toThrow();
    expect(dest.items.owners()).toEqual(['app:keep']);
  });

  it('a desktop backup imports its user_data_item rows and reports every other section as ignored', async () => {
    const desktop = newUserDb();
    seedRich(desktop);
    const items = new UserDataRepository(desktop);
    const it1 = items.put(UserDataItem.json('app:desk', 'c', 'k', { from: 'desktop' }));
    new VerseLinkRepository(desktop).create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: it1.itemId!, verseIdStart: 19023001 }));
    const { zip } = await createBackupPayload({ sql: desktop }, { includeHistory: false, app: APP });
    const dest = new MemoryUserDb();
    const report = await importUserData(dest, zip);
    expect(dest.items.get('app:desk', 'c', 'k')!.parsedValue()).toEqual({ from: 'desktop' });
    expect(dest.items.get('app:x', 'c', 'k')).toBeDefined(); // seedRich's own item
    expect(dest.links.getForVerse(19023001).map((l) => l.sourceType)).toEqual(['user_data_item']);
    expect(report.links.dropped).toBeGreaterThan(0); // note / journal / prayer links have no home on the web
    expect(report.ignoredSections).toContain('user.user_note');
    expect(report.ignoredSections).toContain('user.collection');
  });

  it('a web export restores through the desktop restore planner', async () => {
    const { bytes } = await exportUserData(seeded(), opts);
    const target = newUserDb();
    const archive = await readBackupPayload(once(bytes));
    const plan = inspectBackup(archive, { sql: target }, { preview: false });
    const report = await applyRestore(plan, { sql: target }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    expect(report.ok).toBe(true);
    const items = new UserDataRepository(target);
    expect(items.get(appOwner('demo'), 'things', 'a')!.parsedValue()).toEqual({ n: 1 });
    const links = new VerseLinkRepository(target);
    const a = items.get(appOwner('demo'), 'things', 'a')!;
    expect(links.getForSource('user_data_item', a.itemId!)).toHaveLength(1);
  });

  it('rejects a payload that is not a backup', async () => {
    await expect(importUserData(new MemoryUserDb(), new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

class FakeStorage implements KeyValueStorage {
  constructor(public data: Record<string, string>) {}
  getItem(k: string) { return k in this.data ? this.data[k] : null; }
  removeItem(k: string) { delete this.data[k]; }
}

describe('migrateLocalStorage', () => {
  const mapping = {
    legacyKey: 'old-history',
    ownerUuid: appOwner('history'),
    collection: 'entries',
    convert: (raw: string) => {
      const list = JSON.parse(raw) as Array<{ id: number }>;
      return list.map((e, i) => ({ itemKey: String(e.id), payload: e, sortOrder: i }));
    },
  };

  it('copies once, removes the legacy key after persisting, and skips next time', async () => {
    const db = new MemoryUserDb();
    const storage = new FakeStorage({ 'old-history': '[{"id":2},{"id":1}]' });
    let persisted = 0;
    const r1 = await migrateLocalStorage(db.items, storage, [mapping], async () => { persisted++; expect(storage.getItem('old-history')).not.toBeNull(); });
    expect(r1).toEqual([{ legacyKey: 'old-history', outcome: 'migrated', written: 2 }]);
    expect(persisted).toBe(1);
    expect(storage.getItem('old-history')).toBeNull();
    expect(db.items.list(appOwner('history'), 'entries').map((i) => i.itemKey)).toEqual(['2', '1']);
    storage.data['old-history'] = '[{"id":9}]';
    const r2 = await migrateLocalStorage(db.items, storage, [mapping]);
    expect(r2[0].outcome).toBe('already-migrated');
    expect(db.items.get(appOwner('history'), 'entries', '9')).toBeUndefined();
  });

  it('leaves an unreadable value alone and records nothing', async () => {
    const db = new MemoryUserDb();
    const storage = new FakeStorage({ 'old-history': '{oops' });
    const r = await migrateLocalStorage(db.items, storage, [mapping]);
    expect(r[0].outcome).toBe('unreadable');
    expect(storage.getItem('old-history')).toBe('{oops');
    expect(db.items.owners()).toEqual([]);
  });

  it('reports an absent key without recording a marker, and never overwrites existing items', async () => {
    const db = new MemoryUserDb();
    const storage = new FakeStorage({});
    expect((await migrateLocalStorage(db.items, storage, [mapping]))[0].outcome).toBe('absent');
    expect(db.items.owners()).toEqual([]);
    db.items.put(UserDataItem.json(appOwner('history'), 'entries', '1', { id: 1, mine: true }));
    storage.data['old-history'] = '[{"id":1},{"id":3}]';
    const r = await migrateLocalStorage(db.items, storage, [mapping]);
    expect(r[0].written).toBe(1);
    expect(db.items.get(appOwner('history'), 'entries', '1')!.parsedValue()).toEqual({ id: 1, mine: true });
  });

  it('keeps the legacy key when asked', async () => {
    const db = new MemoryUserDb();
    const storage = new FakeStorage({ 'old-history': '[]' });
    await migrateLocalStorage(db.items, storage, [{ ...mapping, keepLegacy: true }]);
    expect(storage.getItem('old-history')).toBe('[]');
  });
});
