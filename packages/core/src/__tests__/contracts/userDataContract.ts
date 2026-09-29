/**
 * The shared contract for the generic user store: `IUserDataRepository`
 * (`user_data_item`) plus `IVerseLinkRepository` (`verse_link`).
 *
 * Every implementation runs this same suite: SQLite over `ISql` (desktop),
 * `MemoryUserDb` (the web store's core) and the web app's IndexedDB-backed
 * store. The test framework is passed in (`Harness`) so the suite can be
 * imported from another package without that package resolving a second copy
 * of vitest.
 */
import { UserDataItem, appOwner } from '../../Data/Models/User/UserDataItem';
import { VerseLinkRecord } from '../../Data/Models/Common/VerseLinkRecord';
import type { IUserDataRepository } from '../../Data/Repositories/IUserDataRepository';
import type { IVerseLinkRepository } from '../../Data/Repositories/IVerseLinkRepository';

export interface Harness {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  beforeEach: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
}

export interface UserDataSubject {
  items: IUserDataRepository;
  links: IVerseLinkRepository;
  /** Make pending writes durable (a no-op for stores that write synchronously). */
  settle?: () => Promise<void>;
  dispose?: () => void | Promise<void>;
}

const MODULE_A = '6f1c2b3e-0000-4000-8000-00000000000a';
const MODULE_B = '6f1c2b3e-0000-4000-8000-00000000000b';

export function userDataContract(h: Harness, name: string, create: () => UserDataSubject | Promise<UserDataSubject>): void {
  const { describe, it, expect } = h;

  describe(`user-data contract: ${name}`, () => {
    let repo: IUserDataRepository;
    let links: IVerseLinkRepository;
    let subject: UserDataSubject;

    h.beforeEach(async () => {
      subject = await create();
      repo = subject.items;
      links = subject.links;
    });
    h.afterEach(async () => {
      await subject.dispose?.();
    });

    describe('get / put', () => {
      it('round-trips a JSON item', () => {
        repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'blue' }));
        const found = repo.get(MODULE_A, 'settings', 'theme');
        expect(found).toBeDefined();
        expect(found!.valueType).toBe('json');
        expect(found!.parsedValue()).toEqual({ accent: 'blue' });
      });

      it('assigns an itemId on first write', () => {
        expect(repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', 1)).itemId).toBeGreaterThan(0);
      });

      it('returns undefined for a key the owner has not set', () => {
        expect(repo.get(MODULE_A, 'settings', 'absent')).toBeUndefined();
      });

      it('keeps itemId and createdDate when overwriting an existing key', () => {
        const first = repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'blue' }));
        const second = repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'red' }));
        expect(second.itemId).toBe(first.itemId);
        expect(second.createdDate).toBe(first.createdDate);
        expect(repo.get(MODULE_A, 'settings', 'theme')!.parsedValue()).toEqual({ accent: 'red' });
      });

      it('stamps dates in the CURRENT_TIMESTAMP shape', () => {
        const item = repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
        expect(item.createdDate).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
        expect(item.modifiedDate).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      });

      it('decodes each value type', () => {
        repo.putAll([
          new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 's', value: 'hi', valueType: 'string' }),
          new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'i', value: '42', valueType: 'int' }),
          new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'b', value: '1', valueType: 'bool' }),
        ]);
        expect(repo.get(MODULE_A, 'c', 's')!.parsedValue()).toBe('hi');
        expect(repo.get(MODULE_A, 'c', 'i')!.parsedValue()).toBe(42);
        expect(repo.get(MODULE_A, 'c', 'b')!.parsedValue()).toBe(true);
      });

      it('treats malformed JSON as absent rather than throwing', () => {
        repo.put(new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'bad', value: '{not json', valueType: 'json' }));
        expect(repo.get(MODULE_A, 'c', 'bad')!.parsedValue()).toBeUndefined();
      });

      it('distinguishes a present-but-empty value from an absent key', () => {
        repo.put(new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'empty', valueType: 'string' }));
        const found = repo.get(MODULE_A, 'c', 'empty');
        expect(found).toBeDefined();
        expect(found!.value).toBeUndefined();
      });

      it('round-trips metadata and sortOrder', () => {
        repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1, { sortOrder: 7, metadata: { tag: 'x', n: 2 } }));
        const found = repo.get(MODULE_A, 'c', 'k')!;
        expect(found.sortOrder).toBe(7);
        expect(found.metadata).toEqual({ tag: 'x', n: 2 });
      });

      it('does not let a returned item alias stored state', () => {
        repo.put(UserDataItem.json(MODULE_A, 'c', 'k', { a: 1 }, { metadata: { m: 1 } }));
        const one = repo.get(MODULE_A, 'c', 'k')!;
        (one.metadata as Record<string, unknown>).m = 99;
        one.value = 'tampered';
        expect(repo.get(MODULE_A, 'c', 'k')!.metadata).toEqual({ m: 1 });
        expect(repo.get(MODULE_A, 'c', 'k')!.value).toBe('{"a":1}');
      });
    });

    describe('isolation between owners and collections', () => {
      it('does not let one owner see another owner\'s key', () => {
        repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', 'a'));
        repo.put(UserDataItem.json(MODULE_B, 'settings', 'theme', 'b'));
        expect(repo.get(MODULE_A, 'settings', 'theme')!.parsedValue()).toBe('a');
        expect(repo.get(MODULE_B, 'settings', 'theme')!.parsedValue()).toBe('b');
      });

      it('keeps the same key distinct across collections', () => {
        repo.put(UserDataItem.json(MODULE_A, 'settings', 'x', 1));
        repo.put(UserDataItem.json(MODULE_A, 'cache', 'x', 2));
        expect(repo.get(MODULE_A, 'settings', 'x')!.parsedValue()).toBe(1);
        expect(repo.get(MODULE_A, 'cache', 'x')!.parsedValue()).toBe(2);
      });

      it('namespaces app-owned data away from module data', () => {
        const owner = appOwner('reading-stats');
        repo.put(UserDataItem.json(owner, 'settings', 'x', 'app'));
        expect(repo.get(owner, 'settings', 'x')!.isAppOwned()).toBe(true);
        expect(repo.get(MODULE_A, 'settings', 'x')).toBeUndefined();
      });

      it('handles keys that contain separator-like characters without collisions', () => {
        repo.put(UserDataItem.json('app:a', 'b', 'c', 1));
        repo.put(UserDataItem.json('app:a', 'b\u0000c', '', 2));
        repo.put(UserDataItem.json('app:a', 'b', 'c"],["', 3));
        expect(repo.get('app:a', 'b', 'c')!.parsedValue()).toBe(1);
        expect(repo.get('app:a', 'b\u0000c', '')!.parsedValue()).toBe(2);
        expect(repo.get('app:a', 'b', 'c"],["')!.parsedValue()).toBe(3);
      });
    });

    describe('list / collections / owners', () => {
      it('lists a collection by sortOrder then itemKey', () => {
        repo.putAll([
          UserDataItem.json(MODULE_A, 'list', 'c', 3, { sortOrder: 2 }),
          UserDataItem.json(MODULE_A, 'list', 'a', 1, { sortOrder: 1 }),
          UserDataItem.json(MODULE_A, 'list', 'b', 2, { sortOrder: 1 }),
        ]);
        expect(repo.list(MODULE_A, 'list').map((i) => i.itemKey)).toEqual(['a', 'b', 'c']);
      });

      it('reports an owner\'s collections and the store\'s owners, sorted', () => {
        repo.put(UserDataItem.json(MODULE_A, 'settings', 'x', 1));
        repo.put(UserDataItem.json(MODULE_A, 'ratings', 'y', 1));
        repo.put(UserDataItem.json(MODULE_B, 'settings', 'z', 1));
        expect(repo.collections(MODULE_A)).toEqual(['ratings', 'settings']);
        expect(repo.collections(MODULE_B)).toEqual(['settings']);
        expect(repo.owners()).toEqual([MODULE_A, MODULE_B].sort());
      });

      it('returns empty results for an unknown owner or collection', () => {
        expect(repo.list(MODULE_A, 'nope')).toEqual([]);
        expect(repo.collections(MODULE_A)).toEqual([]);
        expect(repo.owners()).toEqual([]);
      });
    });

    describe('removal', () => {
      it('removes one item and reports whether it existed', () => {
        repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
        expect(repo.remove(MODULE_A, 'c', 'k')).toBe(true);
        expect(repo.remove(MODULE_A, 'c', 'k')).toBe(false);
        expect(repo.get(MODULE_A, 'c', 'k')).toBeUndefined();
      });

      it('clears one collection without touching the owner\'s others', () => {
        repo.put(UserDataItem.json(MODULE_A, 'keep', 'k', 1));
        repo.putAll([UserDataItem.json(MODULE_A, 'drop', 'a', 1), UserDataItem.json(MODULE_A, 'drop', 'b', 1)]);
        expect(repo.clearCollection(MODULE_A, 'drop')).toBe(2);
        expect(repo.list(MODULE_A, 'keep')).toHaveLength(1);
        expect(repo.list(MODULE_A, 'drop')).toHaveLength(0);
      });

      it('clears one owner without touching another', () => {
        repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
        repo.put(UserDataItem.json(MODULE_B, 'c', 'k', 1));
        expect(repo.clearOwner(MODULE_A)).toBe(1);
        expect(repo.owners()).toEqual([MODULE_B]);
      });

      it('issues a new itemId when a removed key is written again', () => {
        const first = repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
        repo.remove(MODULE_A, 'c', 'k');
        const again = repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 2));
        expect(again.itemId).not.toBe(first.itemId);
      });
    });

    describe('verse links', () => {
      it('finds an item by a verse inside its anchored passage', () => {
        const item = repo.put(UserDataItem.json(MODULE_A, 'verse_ratings', 'beatitudes', { stars: 5 }));
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 40005003, verseIdEnd: 40005012, linkType: 'annotation' }));
        const hits = links.getForVerse(40005007).filter((l) => l.sourceType === 'user_data_item');
        expect(hits).toHaveLength(1);
        expect(hits[0].sourceId).toBe(item.itemId);
        expect(repo.list(MODULE_A, 'verse_ratings').find((i) => i.itemId === hits[0].sourceId)!.parsedValue()).toEqual({ stars: 5 });
      });

      it('keeps links attached when an item is overwritten, and does not cascade on remove', () => {
        const item = repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: item.itemId!, verseIdStart: 43003016 }));
        repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 2));
        expect(links.getForSource('user_data_item', item.itemId!)).toHaveLength(1);
        repo.remove(MODULE_A, 'c', 'k');
        expect(links.getForSource('user_data_item', item.itemId!)).toHaveLength(1);
      });

      it('stores a single verse with end = start and reads it back as a single verse', () => {
        const link = links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 43003016 }));
        expect(link.linkId).toBeGreaterThan(0);
        const [read] = links.getForSource('user_data_item', 1);
        expect(read.effectiveEnd()).toBe(43003016);
        expect(read.isSingleVerse()).toBe(true);
        expect(read.linkType).toBe('reference');
      });

      it('matches ranges that overlap the query, and not ones that merely touch outside it', () => {
        links.createMany([
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 40005003, verseIdEnd: 40005012 }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 2, verseIdStart: 40005013 }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 3, verseIdStart: 40005001, verseIdEnd: 40005002 }),
        ]);
        expect(links.getForVerseRange(40005010, 40005013).map((l) => l.sourceId)).toEqual([1, 2]);
        expect(links.getSourceIdsForVerse('user_data_item', 40005003)).toEqual([1]);
        expect(links.getSourceIdsForVerse('user_data_item', 40005020)).toEqual([]);
      });

      it('filters by source type, link type and limit, ordered by start verse', () => {
        links.createMany([
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 2, linkType: 'annotation' }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 2, verseIdStart: 1, linkType: 'reference' }),
          new VerseLinkRecord({ sourceType: 'note', sourceId: 3, verseIdStart: 1, linkType: 'reference' }),
        ]);
        expect(links.getForVerseRange(1, 2).map((l) => l.sourceId)).toEqual([2, 3, 1]);
        expect(links.getForVerseRange(1, 2, { sourceType: 'user_data_item' }).map((l) => l.sourceId)).toEqual([2, 1]);
        expect(links.getForVerseRange(1, 2, { linkType: 'annotation' }).map((l) => l.sourceId)).toEqual([1]);
        expect(links.getForVerseRange(1, 2, { limit: 1 })).toHaveLength(1);
        expect(links.getForVerseRange(1, 2, { limit: 0 })).toHaveLength(0);
      });

      it('groups links by source, orders by sortOrder then verse, and omits sources with none', () => {
        links.createMany([
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 9, sortOrder: 0 }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 5, sortOrder: 1 }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 7, sortOrder: 0 }),
          new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 2, verseIdStart: 1 }),
        ]);
        expect(links.getForSource('user_data_item', 1).map((l) => l.verseIdStart)).toEqual([7, 9, 5]);
        const grouped = links.getForSources('user_data_item', [1, 2, 3]);
        expect([...grouped.keys()].sort()).toEqual([1, 2]);
        expect(links.getForSources('user_data_item', [])).toEqual(new Map());
      });

      it('reports whether any link exists for a source type', () => {
        expect(links.hasLinksFor('user_data_item')).toBe(false);
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 1 }));
        expect(links.hasLinksFor('user_data_item')).toBe(true);
        expect(links.hasLinksFor('note')).toBe(false);
      });

      it('deletes one link, or every link of a source', () => {
        const a = links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 1 }));
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 2 }));
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 2, verseIdStart: 3 }));
        expect(links.delete(a.linkId!)).toBe(true);
        expect(links.delete(a.linkId!)).toBe(false);
        expect(links.deleteForSource('user_data_item', 1)).toBe(1);
        expect(links.getForSource('user_data_item', 2)).toHaveLength(1);
      });

      it('rejects an unknown source or link type and writes nothing', () => {
        const bad = new VerseLinkRecord({ sourceType: 'bogus' as never, sourceId: 1, verseIdStart: 1 });
        expect(() => links.create(bad)).toThrow();
        const badType = new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 1, linkType: 'bogus' as never });
        expect(() => links.create(badType)).toThrow();
        expect(() => links.createMany([new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 1 }), bad])).toThrow();
        expect(links.hasLinksFor('user_data_item')).toBe(false);
      });

      it('round-trips context and metadata', () => {
        links.create(new VerseLinkRecord({ sourceType: 'user_data_item', sourceId: 1, verseIdStart: 1, context: 'ctx', metadata: { a: [1, 2] } }));
        const [l] = links.getForSource('user_data_item', 1);
        expect(l.context).toBe('ctx');
        expect(l.metadata).toEqual({ a: [1, 2] });
      });
    });
  });
}
