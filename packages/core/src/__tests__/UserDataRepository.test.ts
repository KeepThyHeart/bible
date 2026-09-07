import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserDataRepository } from '../Data/Repositories/UserDataRepository';
import { UserDataItem, appOwner } from '../Data/Models/User/UserDataItem';
import { VerseLinkRepository } from '../Data/Repositories/VerseLinkRepository';
import { VerseLinkRecord } from '../Data/Models/Common/VerseLinkRecord';
import { UserTestHelper } from './helpers/UserTestHelper';

const MODULE_A = '6f1c2b3e-0000-4000-8000-00000000000a';
const MODULE_B = '6f1c2b3e-0000-4000-8000-00000000000b';

describe('UserDataRepository', () => {
  let repo: UserDataRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    repo = new UserDataRepository(UserTestHelper.getProvider());
  });

  afterAll(() => UserTestHelper.cleanup());
  beforeEach(() => UserTestHelper.clearData());

  describe('get / put', () => {
    it('should round-trip a JSON item', () => {
      repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'blue' }));

      const found = repo.get(MODULE_A, 'settings', 'theme');
      expect(found).toBeDefined();
      expect(found!.valueType).toBe('json');
      expect(found!.parsedValue()).toEqual({ accent: 'blue' });
    });

    it('should assign an itemId on first write', () => {
      const item = repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', 1));
      expect(item.itemId).toBeGreaterThan(0);
    });

    it('should return undefined for a key the owner has not set', () => {
      expect(repo.get(MODULE_A, 'settings', 'absent')).toBeUndefined();
    });

    it('should keep the same itemId when overwriting an existing key', () => {
      const first = repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'blue' }));
      const second = repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', { accent: 'red' }));

      // Stable ids are what let verse_link rows survive an overwrite.
      expect(second.itemId).toBe(first.itemId);
      expect(repo.get(MODULE_A, 'settings', 'theme')!.parsedValue()).toEqual({ accent: 'red' });
    });

    it('should decode each value type', () => {
      repo.putAll([
        new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 's', value: 'hi', valueType: 'string' }),
        new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'i', value: '42', valueType: 'int' }),
        new UserDataItem({ ownerUuid: MODULE_A, collection: 'c', itemKey: 'b', value: '1', valueType: 'bool' }),
      ]);

      expect(repo.get(MODULE_A, 'c', 's')!.parsedValue()).toBe('hi');
      expect(repo.get(MODULE_A, 'c', 'i')!.parsedValue()).toBe(42);
      expect(repo.get(MODULE_A, 'c', 'b')!.parsedValue()).toBe(true);
    });

    it('should treat malformed JSON as absent rather than throwing', () => {
      repo.put(new UserDataItem({
        ownerUuid: MODULE_A, collection: 'c', itemKey: 'bad', value: '{not json', valueType: 'json'
      }));
      expect(repo.get(MODULE_A, 'c', 'bad')!.parsedValue()).toBeUndefined();
    });
  });

  describe('isolation between owners and collections', () => {
    it('should not let one owner see another owner\'s key', () => {
      repo.put(UserDataItem.json(MODULE_A, 'settings', 'theme', 'a'));
      repo.put(UserDataItem.json(MODULE_B, 'settings', 'theme', 'b'));

      expect(repo.get(MODULE_A, 'settings', 'theme')!.parsedValue()).toBe('a');
      expect(repo.get(MODULE_B, 'settings', 'theme')!.parsedValue()).toBe('b');
    });

    it('should keep the same key distinct across collections', () => {
      repo.put(UserDataItem.json(MODULE_A, 'settings', 'x', 1));
      repo.put(UserDataItem.json(MODULE_A, 'cache', 'x', 2));

      expect(repo.get(MODULE_A, 'settings', 'x')!.parsedValue()).toBe(1);
      expect(repo.get(MODULE_A, 'cache', 'x')!.parsedValue()).toBe(2);
    });

    it('should namespace app-owned data away from module data', () => {
      const owner = appOwner('reading-stats');
      repo.put(UserDataItem.json(owner, 'settings', 'x', 'app'));

      expect(repo.get(owner, 'settings', 'x')!.isAppOwned()).toBe(true);
      expect(repo.get(MODULE_A, 'settings', 'x')).toBeUndefined();
    });
  });

  describe('list / collections / owners', () => {
    it('should list a collection by sortOrder then itemKey', () => {
      repo.putAll([
        UserDataItem.json(MODULE_A, 'list', 'c', 3, { sortOrder: 2 }),
        UserDataItem.json(MODULE_A, 'list', 'a', 1, { sortOrder: 1 }),
        UserDataItem.json(MODULE_A, 'list', 'b', 2, { sortOrder: 1 }),
      ]);

      expect(repo.list(MODULE_A, 'list').map(i => i.itemKey)).toEqual(['a', 'b', 'c']);
    });

    it('should report an owner\'s collections and the store\'s owners', () => {
      repo.put(UserDataItem.json(MODULE_A, 'settings', 'x', 1));
      repo.put(UserDataItem.json(MODULE_A, 'ratings', 'y', 1));
      repo.put(UserDataItem.json(MODULE_B, 'settings', 'z', 1));

      expect(repo.collections(MODULE_A)).toEqual(['ratings', 'settings']);
      expect(repo.collections(MODULE_B)).toEqual(['settings']);
      expect(repo.owners()).toEqual([MODULE_A, MODULE_B].sort());
    });
  });

  describe('removal', () => {
    it('should remove one item and report whether it existed', () => {
      repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));

      expect(repo.remove(MODULE_A, 'c', 'k')).toBe(true);
      expect(repo.remove(MODULE_A, 'c', 'k')).toBe(false);
    });

    it('should clear one collection without touching the owner\'s others', () => {
      repo.put(UserDataItem.json(MODULE_A, 'keep', 'k', 1));
      repo.putAll([
        UserDataItem.json(MODULE_A, 'drop', 'a', 1),
        UserDataItem.json(MODULE_A, 'drop', 'b', 1),
      ]);

      expect(repo.clearCollection(MODULE_A, 'drop')).toBe(2);
      expect(repo.list(MODULE_A, 'keep')).toHaveLength(1);
    });

    it('should clear one owner without touching another', () => {
      repo.put(UserDataItem.json(MODULE_A, 'c', 'k', 1));
      repo.put(UserDataItem.json(MODULE_B, 'c', 'k', 1));

      expect(repo.clearOwner(MODULE_A)).toBe(1);
      expect(repo.owners()).toEqual([MODULE_B]);
    });
  });

  describe('verse anchoring through verse_link', () => {
    it('should find an item by a verse inside its anchored passage', () => {
      const links = new VerseLinkRepository(UserTestHelper.getProvider());
      const item = repo.put(UserDataItem.json(MODULE_A, 'verse_ratings', 'beatitudes', { stars: 5 }));

      links.create(new VerseLinkRecord({
        sourceType: 'user_data_item',
        sourceId: item.itemId!,
        verseIdStart: 40005003,
        verseIdEnd: 40005012,
        linkType: 'annotation'
      }));

      // A verse in the middle of the passage, not its first.
      const hits = links.getForVerse(40005007).filter(l => l.sourceType === 'user_data_item');
      expect(hits).toHaveLength(1);
      expect(hits[0].sourceId).toBe(item.itemId);

      // And the item round-trips from that link.
      const found = repo.list(MODULE_A, 'verse_ratings').find(i => i.itemId === hits[0].sourceId);
      expect(found!.parsedValue()).toEqual({ stars: 5 });
    });
  });
});
