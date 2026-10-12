// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<object>()),
  UserRepositories: await import('../../../../packages/core/src/Data/Repositories/userRepositories'),
}));

import { createUserDataMirrorRepo } from './userDataMirrorRepo';
import { finishOpen } from './openUserDb';
import { loadSqlite, type Sqlite3 } from './mirrorTestHarness';

let sqlite3: Sqlite3;
beforeAll(async () => {
  sqlite3 = await loadSqlite();
}, 60_000);

const item = (id: number, key: string, value = '1') => ({
  item_id: id, owner_uuid: 'app:t', collection: 'c', item_key: key, value, value_type: 'json', sort_order: 0,
  created_date: '2026-01-01 00:00:00', modified_date: '2026-01-02 00:00:00', metadata: null,
});
const link = (id: number) => ({
  link_id: id, source_type: 'user_data_item', source_id: 1, verse_id_start: 1001001, verse_id_end: 1001001,
  link_type: 'reference', sort_order: 0, context: null, metadata: null,
});

function setup() {
  const { sql } = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
  return { sql, repo: createUserDataMirrorRepo(sql) };
}

describe('userDataMirror repo', () => {
  it('applies puts with ids preserved, upserts by key and keeps the id, deletes', () => {
    const { repo } = setup();
    repo.applyChanges([{ type: 'item:put', row: item(7, 'a') }, { type: 'link:put', row: link(9) }]);
    let snap = repo.readSnapshot();
    expect(snap.items).toEqual([item(7, 'a')]);
    expect(snap.links).toEqual([link(9)]);
    // same key, different id in the change: the stored id stays, the fields update
    repo.applyChanges([{ type: 'item:put', row: { ...item(8, 'a', '2'), modified_date: '2026-02-02 00:00:00' } }]);
    snap = repo.readSnapshot();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({ item_id: 7, value: '2', modified_date: '2026-02-02 00:00:00', created_date: '2026-01-01 00:00:00' });
    repo.applyChanges([{ type: 'link:put', row: { ...link(9), sort_order: 4 } }]);
    expect(repo.readSnapshot().links[0].sort_order).toBe(4);
    expect(repo.applyChanges([
      { type: 'item:delete', ownerUuid: 'app:t', collection: 'c', itemKey: 'a' },
      { type: 'link:delete', linkId: 9 },
    ])).toEqual({ applied: 2 });
    expect(repo.readSnapshot()).toEqual({ items: [], links: [] });
  });

  it('rolls the whole batch back when one change fails', () => {
    const { repo } = setup();
    expect(() => repo.applyChanges([
      { type: 'item:put', row: item(1, 'a') },
      { type: 'item:put', row: { ...item(2, 'b'), value_type: 'bogus' } },
    ])).toThrow();
    expect(repo.readSnapshot().items).toEqual([]);
  });

  it('reserveIds hands out disjoint blocks and later inserts land above them', () => {
    const { sql, repo } = setup();
    const a = repo.reserveIds('item', 100);
    const b = repo.reserveIds('item', 50);
    expect(a).toEqual({ start: 1, end: 101 });
    expect(b).toEqual({ start: 101, end: 151 });
    sql.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key) VALUES ('x', 'y', 'z')");
    expect(repo.readSnapshot().items[0].item_id).toBe(151);
    // existing rows above the sequence are respected
    repo.applyChanges([{ type: 'link:put', row: link(500) }]);
    expect(repo.reserveIds('link', 10)).toEqual({ start: 501, end: 511 });
    sql.execute("INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end) VALUES ('a', 1, 1, 1)");
    expect(repo.readSnapshot().links.at(-1)!.link_id).toBe(511);
    // count 0 only probes
    expect(repo.reserveIds('link', 0)).toEqual({ start: 512, end: 512 });
    expect(repo.reserveIds('link', 1)).toEqual({ start: 512, end: 513 });
    expect(() => repo.reserveIds('item', -1)).toThrow();
  });
});
