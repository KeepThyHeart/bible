/**
 * `CollectionsBridge` against a real SQLite database (`PlatformPlan.md` P5).
 *
 * The api-impl already has its own suite against `InMemoryCollectionsBridge`,
 * which pins the *contract*. This file pins the half that fake cannot: that
 * the contract still holds when the rows live in `pinned_item` and the
 * ordering is maintained by `CollectionRepository.reorderPinnedItems` inside a
 * transaction rather than by splicing an array.
 *
 * That distinction is the whole reason this file exists. The dense-position
 * promise - n entries occupy exactly 0..n-1, so the index a caller reads back
 * is the index it can pass to `move` - is trivially true of an array and is
 * *not* automatic in SQL: `sort_order` allows gaps and ties, and `ORDER BY`
 * on a tie resolves however the engine feels like, so a passage the user
 * dragged can reappear somewhere else after a restart.
 *
 * Uses an in-memory database with the app's own `initializeUserSchema`, so the
 * CHECK constraints, the foreign keys and the cascade behaviour under test are
 * the ones that actually ship.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CollectionRepository } from '@bible/core';
import type { ISql, SqlParameter, SqlResult } from '@bible/core';

import { initializeUserSchema } from '../../schema/userSchema';
import { CollectionsBridge } from '../bridges/CollectionsBridge';

/**
 * A real SQLite handle over plain `better-sqlite3`.
 *
 * The app's own `SqliteProvider` wraps `better-sqlite3-multiple-ciphers`,
 * which is rebuilt against Electron's ABI and therefore cannot load in Vitest
 * (plain Node). That is why the desktop suite reaches for fakes elsewhere -
 * but a fake is exactly what must not be used here, since the invariant under
 * test is about what SQL does with `sort_order`. Plain `better-sqlite3` is
 * already a devDependency of `@bible/core` for the same reason, and is the
 * same engine minus the cipher layer.
 */
class TestSql implements ISql {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
    this.db.pragma('foreign_keys = ON');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  queryOne<T = unknown>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    return this.db.prepare(sql).get(...bind(params)) as T | undefined;
  }

  queryAll<T = unknown>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    return this.db.prepare(sql).all(...bind(params)) as T[];
  }

  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): SqlResult {
    const result = this.db.prepare(sql).run(...bind(params));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  isOpen(): boolean {
    return this.db.open;
  }

  getDatabasePath(): string {
    return ':memory:';
  }
}

/** Positional binds spread; a named-bind object is passed as one argument. */
function bind(params?: SqlParameter[] | Record<string, SqlParameter>): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

let db: TestSql;
let repo: CollectionRepository;
let bridge: CollectionsBridge;

beforeEach(() => {
  db = new TestSql();
  initializeUserSchema(db);
  repo = new CollectionRepository(db);
  bridge = new CollectionsBridge({
    getRepository: () => repo,
    formatReference: (start, end) => (start === end ? `V${start}` : `V${start}-${end}`),
  });
});

afterEach(() => {
  db.close();
});

/** Add n passages and return their ids in insertion order. */
function seed(collectionId: string, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(bridge.addPassage(collectionId, { verseIdStart: 43003016 + i }).id);
  }
  return ids;
}

/** The collection's entry ids, in stored order. */
function order(collectionId: string): string[] {
  return bridge.listPassages(collectionId).map((p) => p.id);
}

/** The collection's positions, in stored order. */
function positions(collectionId: string): number[] {
  return bridge.listPassages(collectionId).map((p) => p.position);
}

describe('CollectionsBridge collections', () => {
  it('round-trips a collection through the store', () => {
    const created = bridge.createCollection('Romans 8', {
      description: 'The golden chain',
      color: '#aa0000',
      icon: 'book',
    });

    expect(created.name).toBe('Romans 8');
    expect(created.entryCount).toBe(0);
    expect(bridge.listCollections().map((c) => c.id)).toEqual([created.id]);

    const listed = bridge.listCollections()[0]!;
    expect(listed.description).toBe('The golden chain');
    expect(listed.color).toBe('#aa0000');
    expect(listed.icon).toBe('book');
  });

  it('nests under a parent and reports the parent id back', () => {
    const parent = bridge.createCollection('Study');
    const child = bridge.createCollection('Romans', { parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
  });

  it('refuses a parent that does not exist, rather than letting the FK speak', () => {
    // A constraint violation surfaces as a SQLite error string an extension
    // author cannot act on.
    expect(() => bridge.createCollection('Orphan', { parentId: '9999' })).toThrow(
      /Collection not found/,
    );
  });

  it('renames', () => {
    const created = bridge.createCollection('Old name');
    const renamed = bridge.renameCollection(created.id, 'New name');

    expect(renamed.name).toBe('New name');
    expect(bridge.listCollections()[0]!.name).toBe('New name');
  });

  it('deletes the collection and its passages together', () => {
    const c = bridge.createCollection('Doomed');
    seed(c.id, 3);

    bridge.deleteCollection(c.id);

    expect(bridge.listCollections()).toEqual([]);
    // The rows really are gone, not merely unreachable through the bridge.
    expect(repo.getPinnedItemsForCollection(Number(c.id))).toEqual([]);
  });

  it('counts only its own passages, not a child collection’s', () => {
    // An aggregating count would disagree with `listPassages(id).length`,
    // which is the number a caller can act on.
    const parent = bridge.createCollection('Parent');
    const child = bridge.createCollection('Child', { parentId: parent.id });
    seed(parent.id, 2);
    seed(child.id, 3);

    const byId = new Map(bridge.listCollections().map((c) => [c.id, c]));
    expect(byId.get(parent.id)!.entryCount).toBe(2);
    expect(byId.get(child.id)!.entryCount).toBe(3);
  });

  it('rejects a malformed id instead of binding NaN into a query', () => {
    // `Number('abc')` is NaN, which matches nothing and would read as "not
    // found" - a confusing answer to what is really a malformed argument.
    expect(() => bridge.listPassages('not-an-id')).toThrow(/not a valid id/);
  });
});

describe('CollectionsBridge passage ordering', () => {
  it('appends when no position is given, with dense positions', () => {
    const c = bridge.createCollection('Plan');
    const ids = seed(c.id, 4);

    expect(order(c.id)).toEqual(ids);
    expect(positions(c.id)).toEqual([0, 1, 2, 3]);
  });

  it('inserts at a position and renumbers the rest', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    const inserted = bridge.addPassage(c.id, { verseIdStart: 45001001, position: 1 });

    expect(order(c.id)).toEqual([a, inserted.id, b, d]);
    expect(positions(c.id)).toEqual([0, 1, 2, 3]);
  });

  it('appends when the position is past the end', () => {
    const c = bridge.createCollection('Plan');
    const ids = seed(c.id, 2);

    const inserted = bridge.addPassage(c.id, { verseIdStart: 45001001, position: 99 });

    expect(order(c.id)).toEqual([...ids, inserted.id]);
    expect(positions(c.id)).toEqual([0, 1, 2]);
  });

  it('closes the gap when a passage is removed from the middle', () => {
    // The gap is what would make a read-back position useless as a `move`
    // argument.
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    bridge.removePassage(b);

    expect(order(c.id)).toEqual([a, d]);
    expect(positions(c.id)).toEqual([0, 1]);
  });

  it('moves a passage down and returns the whole new ordering', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d, e] = seed(c.id, 4);

    const result = bridge.movePassage(a, 2);

    expect(result.map((p) => p.id)).toEqual([b, d, a, e]);
    expect(result.map((p) => p.position)).toEqual([0, 1, 2, 3]);
    expect(order(c.id)).toEqual([b, d, a, e]);
  });

  it('moves a passage up', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    bridge.movePassage(d, 0);

    expect(order(c.id)).toEqual([d, a, b]);
    expect(positions(c.id)).toEqual([0, 1, 2]);
  });

  it('clamps a move past the end to last, not past it', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    bridge.movePassage(a, 99);

    expect(order(c.id)).toEqual([b, d, a]);
    expect(positions(c.id)).toEqual([0, 1, 2]);
  });

  it('applies a wholesale reorder', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    const result = bridge.reorder(c.id, [d, a, b]);

    expect(result.map((p) => p.id)).toEqual([d, a, b]);
    expect(order(c.id)).toEqual([d, a, b]);
    expect(positions(c.id)).toEqual([0, 1, 2]);
  });

  it('refuses a partial reorder rather than applying half of it', () => {
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);

    // A subset would silently leave the omitted entries wherever the renumber
    // happened to put them.
    expect(() => bridge.reorder(c.id, [d, a])).toThrow(/expected 3 ids, got 2/);
    expect(order(c.id)).toEqual([a, b, d]);
  });

  it('refuses a reorder naming a foreign entry', () => {
    const c = bridge.createCollection('Plan');
    const other = bridge.createCollection('Other');
    const [a, b, d] = seed(c.id, 3);
    const [foreign] = seed(other.id, 1);

    expect(() => bridge.reorder(c.id, [a, b, foreign!])).toThrow(/is not in collection/);
    expect(order(c.id)).toEqual([a, b, d]);
  });

  it('refuses a reorder listing the same entry twice', () => {
    const c = bridge.createCollection('Plan');
    const [a] = seed(c.id, 2);

    // The right length, so the count check passes - and still not a
    // permutation, which is what the duplicate check is for.
    expect(() => bridge.reorder(c.id, [a!, a!])).toThrow(/listed twice/);
  });

  it('keeps two collections’ orderings independent', () => {
    const one = bridge.createCollection('One');
    const two = bridge.createCollection('Two');
    const [a1, b1] = seed(one.id, 2);
    const [a2, b2] = seed(two.id, 2);

    bridge.reorder(one.id, [b1!, a1!]);

    expect(order(one.id)).toEqual([b1, a1]);
    expect(order(two.id)).toEqual([a2, b2]);
  });

  it('survives a reload, which is the point of densifying', () => {
    // A fresh repository over the same database, standing in for a restart.
    // With tied or gapped `sort_order` values this is exactly where a
    // dragged passage would come back somewhere else.
    const c = bridge.createCollection('Plan');
    const [a, b, d] = seed(c.id, 3);
    bridge.reorder(c.id, [d, b, a]);

    const reloaded = new CollectionsBridge({
      getRepository: () => new CollectionRepository(db),
    });

    expect(reloaded.listPassages(c.id).map((p) => p.id)).toEqual([d, b, a]);
    expect(reloaded.listPassages(c.id).map((p) => p.position)).toEqual([0, 1, 2]);
  });
});

describe('CollectionsBridge passage fields', () => {
  it('stores a single verse with end equal to start, never NULL', () => {
    // A nullable end is what previously made single-verse rows match every
    // later range query.
    const c = bridge.createCollection('Plan');
    const entry = bridge.addPassage(c.id, { verseIdStart: 43003016 });

    expect(entry.verseIdStart).toBe(43003016);
    expect(entry.verseIdEnd).toBe(43003016);
    expect(repo.getPinnedItem(Number(entry.id))!.verseIdEnd).toBe(43003016);
  });

  it('stores a range as a passage and a single verse as a verse', () => {
    const c = bridge.createCollection('Plan');
    const single = bridge.addPassage(c.id, { verseIdStart: 43003016 });
    const range = bridge.addPassage(c.id, { verseIdStart: 45008028, verseIdEnd: 45008030 });

    expect(repo.getPinnedItem(Number(single.id))!.itemType).toBe('verse');
    expect(repo.getPinnedItem(Number(range.id))!.itemType).toBe('passage');
  });

  it('carries label, notes and module through', () => {
    const c = bridge.createCollection('Plan');
    const entry = bridge.addPassage(c.id, {
      verseIdStart: 45008028,
      verseIdEnd: 45008030,
      label: 'The golden chain',
      notes: 'Day 3',
      moduleId: '7',
    });

    const read = bridge.listPassages(c.id)[0]!;
    expect(read.label).toBe('The golden chain');
    expect(read.notes).toBe('Day 3');
    // The store's key is an INTEGER; the contract's is the string form that
    // `bible.getRange({ module })` already accepts.
    expect(read.moduleId).toBe('7');
    expect(entry.moduleId).toBe('7');
  });

  it('rejects a non-numeric module id instead of storing NULL', () => {
    // Storing NULL would silently turn "pinned to the KJV" into "whatever is
    // open" - a data loss the caller never sees.
    const c = bridge.createCollection('Plan');
    expect(() =>
      bridge.addPassage(c.id, { verseIdStart: 43003016, moduleId: 'KJV' }),
    ).toThrow(/not a known module id/);
  });

  it('resolves a human-readable reference', () => {
    const c = bridge.createCollection('Plan');
    bridge.addPassage(c.id, { verseIdStart: 45008028, verseIdEnd: 45008030 });

    expect(bridge.listPassages(c.id)[0]!.reference).toBe('V45008028-45008030');
  });

  it('leaves reference absent when the host cannot resolve one', () => {
    // The DTO documents exactly this for a verse id outside the installed
    // versification.
    const bare = new CollectionsBridge({ getRepository: () => repo });
    const c = bare.createCollection('Plan');
    bare.addPassage(c.id, { verseIdStart: 43003016 });

    expect(bare.listPassages(c.id)[0]!.reference).toBeUndefined();
  });

  it('reports a missing passage rather than returning undefined', () => {
    expect(() => bridge.removePassage('9999')).toThrow(/Passage not found/);
    expect(() => bridge.movePassage('9999', 0)).toThrow(/Passage not found/);
  });
});
