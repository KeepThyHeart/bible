/** Restoring a v3 archive (no memory_passage.position) and numbering the rows afterwards (task 0219). */
import { describe, it, expect } from 'vitest';
import { inspectBackup, applyRestore, defaultSections } from '../../Backup/Restore';
import { upgradeRow, tableSpec } from '../../Backup/Registry';
import { ensureMemoryPassagePosition } from '../../Data/UserSchema';
import { newUserDb, archiveOf } from './restoreHelpers';
import type { TestSqliteProvider } from '../helpers/TestSqliteProvider';

function addPassage(db: TestSqliteProvider, id: number, list: number, addedAt: number, position: number | null = null): void {
  db.execute(
    "INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, position) VALUES (?, ?, 'KJV', ?, ?, 'ref', 1, ?, ?)",
    [id, list, 1000 + id, 1000 + id, addedAt, position],
  );
}
const positions = (db: TestSqliteProvider) =>
  db.queryAll<{ id: number; position: number | null }>('SELECT id, position FROM memory_passage ORDER BY id');

/** A v3 backup: the source has no position column, and the manifest says version 3. */
async function v3Archive() {
  const src = newUserDb();
  src.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'A', 1)");
  addPassage(src, 10, 1, 300);
  addPassage(src, 11, 1, 100);
  addPassage(src, 12, 1, 200);
  src.exec('DROP INDEX IF EXISTS memory_passage_collection_position; ALTER TABLE memory_passage DROP COLUMN position;');
  const archive = await archiveOf({ sql: src });
  archive.manifest.userSchemaVersion = 3;
  return archive;
}

describe('restoring a v3 archive', () => {
  it('the registry upgrader supplies a NULL position for a v3 row', () => {
    const spec = tableSpec('memory_passage')!;
    expect(upgradeRow(spec, { id: 1 }, 3)).toEqual({ id: 1, position: null });
    expect(upgradeRow(spec, { id: 1, position: 4 }, 4)).toEqual({ id: 1, position: 4 });
  });

  it('replace: rows arrive with NULL positions, then the backfill orders them by added_at', async () => {
    const archive = await v3Archive();
    const target = newUserDb();
    const plan = inspectBackup(archive, { sql: target }, { preview: false });
    const report = await applyRestore(plan, { sql: target }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    expect(report.ok).toBe(true);
    expect(positions(target)).toEqual([{ id: 10, position: null }, { id: 11, position: null }, { id: 12, position: null }]);
    ensureMemoryPassagePosition(target);
    expect(positions(target)).toEqual([{ id: 10, position: 2 }, { id: 11, position: 0 }, { id: 12, position: 1 }]);
    ensureMemoryPassagePosition(target);
    expect(positions(target)).toEqual([{ id: 10, position: 2 }, { id: 11, position: 0 }, { id: 12, position: 1 }]);
  });

  it('merge into a list that already has positions appends the restored rows after the max', async () => {
    const archive = await v3Archive();
    const target = newUserDb();
    target.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'A', 1)");
    addPassage(target, 50, 1, 999, 0);
    addPassage(target, 51, 1, 998, 1);
    const plan = inspectBackup(archive, { sql: target }, { preview: false });
    await applyRestore(plan, { sql: target }, { mode: 'merge', sections: defaultSections(plan, 'merge') });
    const byVerse = () => target.queryAll<{ start_verse_id: number; position: number | null }>(
      'SELECT start_verse_id, position FROM memory_passage WHERE id > 51 ORDER BY added_at, id');
    expect(byVerse().map((r) => r.position)).toEqual([null, null, null]);
    ensureMemoryPassagePosition(target);
    expect(positions(target).slice(0, 2)).toEqual([{ id: 50, position: 0 }, { id: 51, position: 1 }]);
    // merged ids are reassigned; ordered by added_at (11, 12, 10) they take 2, 3, 4
    expect(byVerse().map((r) => [r.start_verse_id, r.position])).toEqual([[1011, 2], [1012, 3], [1010, 4]]);
  });
});
