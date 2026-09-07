import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { TopicalIndexRepository } from '../Data/Repositories/TopicalIndexRepository';
import { Topic } from '../Data/Models/TopicalIndex/Topic';
import { TopicVerse } from '../Data/Models/TopicalIndex/TopicVerse';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

// ---------------------------------------------------------------------------
// Read-only SQLite provider for testing against real module databases
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------
const DB_PATH = path.resolve(__dirname, '../../../desktop/data/modules/topical_nave.db');

describe.skipIf(!fs.existsSync(DB_PATH))('TopicalIndexRepository (topical_nave.db)', () => {
  let provider: TestSqliteProvider;
  let repo: TopicalIndexRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(DB_PATH);
    repo = new TopicalIndexRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  // ========================================================================
  // Module Info
  // ========================================================================

  describe('getModuleInfo', () => {
    it('should return module info', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.abbreviation).toBeDefined();
      expect(info!.fullName).toBeDefined();
      expect(typeof info!.abbreviation).toBe('string');
      expect(info!.fullName.length).toBeGreaterThan(0);
    });

    it('should have a language code', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.languageCode).toBeDefined();
      expect(info!.languageCode.length).toBeGreaterThanOrEqual(2);
    });

    it('should have moduleType set to topical_index', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.moduleType).toBe('topical_index');
    });
  });

  // ========================================================================
  // Root Topics
  // ========================================================================

  describe('getRootTopics', () => {
    it('should return a non-empty list of root topics', () => {
      const roots = repo.getRootTopics();
      expect(roots.length).toBeGreaterThan(0);
    });

    it('should return Topic instances with no parentTopicId', () => {
      const roots = repo.getRootTopics();
      for (const topic of roots.slice(0, 10)) {
        expect(topic).toBeInstanceOf(Topic);
        expect(topic.isRoot()).toBe(true);
      }
    });

    it('should return topics with names', () => {
      const roots = repo.getRootTopics();
      for (const topic of roots.slice(0, 10)) {
        expect(topic.name).toBeDefined();
        expect(topic.name.length).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // getTopic
  // ========================================================================

  describe('getTopic', () => {
    it('should return a topic by ID', () => {
      const roots = repo.getRootTopics();
      expect(roots.length).toBeGreaterThan(0);

      const firstRoot = roots[0];
      const fetched = repo.getTopic(firstRoot.topicId!);
      expect(fetched).toBeDefined();
      expect(fetched!.topicId).toBe(firstRoot.topicId);
      expect(fetched!.name).toBe(firstRoot.name);
    });

    it('should return undefined for a non-existent topic ID', () => {
      const result = repo.getTopic(999999999);
      expect(result).toBeUndefined();
    });
  });

  // ========================================================================
  // getChildren
  // ========================================================================

  describe('getChildren', () => {
    it('should return children of a root topic that has children', () => {
      const roots = repo.getRootTopics();
      // Find a root topic that has children
      let children: Topic[] = [];
      let parentTopic: Topic | undefined;
      for (const root of roots) {
        children = repo.getChildren(root.topicId!);
        if (children.length > 0) {
          parentTopic = root;
          break;
        }
      }

      expect(parentTopic).toBeDefined();
      expect(children.length).toBeGreaterThan(0);

      for (const child of children) {
        expect(child.parentTopicId).toBe(parentTopic!.topicId);
        expect(child.isRoot()).toBe(false);
      }
    });

    it('should return an empty array for a topic with no children', () => {
      // Find a leaf topic by traversing down
      const roots = repo.getRootTopics();
      let leaf: Topic | undefined;
      for (const root of roots) {
        const children = repo.getChildren(root.topicId!);
        if (children.length === 0) {
          leaf = root;
          break;
        }
        // Check grandchildren
        for (const child of children) {
          const grandchildren = repo.getChildren(child.topicId!);
          if (grandchildren.length === 0) {
            leaf = child;
            break;
          }
        }
        if (leaf) break;
      }

      if (leaf) {
        const children = repo.getChildren(leaf.topicId!);
        expect(children).toEqual([]);
      }
    });
  });

  // ========================================================================
  // getTopicsByVerse
  // ========================================================================

  describe('getTopicsByVerse', () => {
    it('should return topics for John 3:16 (43003016)', () => {
      const topics = repo.getTopicsByVerse(43003016);
      // John 3:16 is a very commonly referenced verse
      expect(topics.length).toBeGreaterThan(0);
      for (const topic of topics) {
        expect(topic).toBeInstanceOf(Topic);
        expect(topic.name).toBeDefined();
      }
    });

    it('should return topics for Genesis 1:1 (1001001)', () => {
      const topics = repo.getTopicsByVerse(1001001);
      expect(topics.length).toBeGreaterThan(0);
    });

    it('should return topics sorted by name', () => {
      const topics = repo.getTopicsByVerse(43003016);
      if (topics.length > 1) {
        // SQLite ORDER BY uses binary comparison (case-sensitive, uppercase < lowercase)
        // which may differ from JS localeCompare. Verify SQL ordering is consistent.
        for (let i = 1; i < topics.length; i++) {
          expect(topics[i].name >= topics[i - 1].name).toBe(true);
        }
      }
    });
  });

  // ========================================================================
  // searchTopics
  // ========================================================================

  describe('searchTopics', () => {
    it('should find topics matching "Love"', () => {
      const results = repo.searchTopics('Love');
      expect(results.length).toBeGreaterThan(0);
      // At least one result should contain "Love" in name or description
      const hasLove = results.some(
        t => t.name.toLowerCase().includes('love') ||
             (t.description && t.description.toLowerCase().includes('love'))
      );
      expect(hasLove).toBe(true);
    });

    it('should find topics matching "Faith"', () => {
      const results = repo.searchTopics('Faith');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should find topics matching "Prayer"', () => {
      const results = repo.searchTopics('Prayer');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect the limit option', () => {
      const results = repo.searchTopics('Love', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for a gibberish query', () => {
      const results = repo.searchTopics('xyzzy999qqq');
      expect(results).toEqual([]);
    });
  });

  // ========================================================================
  // getTopicsByName
  // ========================================================================

  describe('getTopicsByName', () => {
    it('should find topics by exact name (case-insensitive)', () => {
      // First, get a known topic name from root topics
      const roots = repo.getRootTopics();
      expect(roots.length).toBeGreaterThan(0);
      const targetName = roots[0].name;

      const results = repo.getTopicsByName(targetName);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name.toLowerCase()).toBe(targetName.toLowerCase());
    });

    it('should return empty array for a non-existent name', () => {
      const results = repo.getTopicsByName('ZZZ_NONEXISTENT_TOPIC_NAME_12345');
      expect(results).toEqual([]);
    });
  });

  // ========================================================================
  // getAllTopicsPaginated
  // ========================================================================

  describe('getAllTopicsPaginated', () => {
    it('should return topics with default pagination', () => {
      const topics = repo.getAllTopicsPaginated();
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.length).toBeLessThanOrEqual(50); // default limit
    });

    it('should respect limit parameter', () => {
      const topics = repo.getAllTopicsPaginated({ limit: 5 });
      expect(topics.length).toBeLessThanOrEqual(5);
      expect(topics.length).toBeGreaterThan(0);
    });

    it('should respect offset parameter', () => {
      const page1 = repo.getAllTopicsPaginated({ limit: 5, offset: 0 });
      const page2 = repo.getAllTopicsPaginated({ limit: 5, offset: 5 });

      expect(page1.length).toBe(5);
      expect(page2.length).toBe(5);

      // Pages should not overlap
      const page1Ids = new Set(page1.map(t => t.topicId));
      for (const t of page2) {
        expect(page1Ids.has(t.topicId)).toBe(false);
      }
    });

    it('should support filter parameter', () => {
      const topics = repo.getAllTopicsPaginated({ limit: 10, filter: 'Love' });
      expect(topics.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // getTopicCount
  // ========================================================================

  describe('getTopicCount', () => {
    it('should return the total number of topics', () => {
      const count = repo.getTopicCount();
      expect(count).toBeGreaterThan(0);
      // Nave's Topical Bible has thousands of topics
      expect(count).toBeGreaterThan(100);
    });
  });

  // ========================================================================
  // getVersesForTopic
  // ========================================================================

  describe('getVersesForTopic', () => {
    it('should return verses for a topic that has verse associations', () => {
      // Find a topic with verses
      const roots = repo.getRootTopics();
      let topicWithVerses: Topic | undefined;
      let verses: TopicVerse[] = [];

      for (const root of roots) {
        verses = repo.getVersesForTopic(root.topicId!);
        if (verses.length > 0) {
          topicWithVerses = root;
          break;
        }
        // Check children too
        const children = repo.getChildren(root.topicId!);
        for (const child of children) {
          verses = repo.getVersesForTopic(child.topicId!);
          if (verses.length > 0) {
            topicWithVerses = child;
            break;
          }
        }
        if (topicWithVerses) break;
      }

      expect(topicWithVerses).toBeDefined();
      expect(verses.length).toBeGreaterThan(0);

      for (const verse of verses) {
        expect(verse).toBeInstanceOf(TopicVerse);
        expect(verse.topicId).toBe(topicWithVerses!.topicId);
        expect(verse.startVerseId).toBeGreaterThan(0);
        expect(verse.endVerseId).toBeGreaterThanOrEqual(verse.startVerseId);
      }
    });

    it('should respect limit option', () => {
      const roots = repo.getRootTopics();
      // Find a topic with many verses
      for (const root of roots) {
        const count = repo.getVerseCount(root.topicId!);
        if (count > 5) {
          const limited = repo.getVersesForTopic(root.topicId!, { limit: 3 });
          expect(limited.length).toBeLessThanOrEqual(3);
          break;
        }
      }
    });
  });

  // ========================================================================
  // getVerseCount
  // ========================================================================

  describe('getVerseCount', () => {
    it('should return the count of verses for a topic', () => {
      const roots = repo.getRootTopics();
      let found = false;
      for (const root of roots) {
        const count = repo.getVerseCount(root.topicId!);
        if (count > 0) {
          found = true;
          const verses = repo.getVersesForTopic(root.topicId!);
          // getVerseCount expands ranges (Ge 48:5-20 counts sixteen) while
          // getVersesForTopic returns one row per stored reference, so the two
          // are equal only for a topic whose links are all single verses.
          // getReferenceCount is the one that matches the row count.
          expect(repo.getReferenceCount(root.topicId!)).toBe(verses.length);
          expect(count).toBeGreaterThanOrEqual(verses.length);
          break;
        }
      }
      // At least one topic should have verses
      expect(found).toBe(true);
    });

    it('should return 0 for a non-existent topic', () => {
      const count = repo.getVerseCount(999999999);
      expect(count).toBe(0);
    });
  });

  // ========================================================================
  // getParentChain
  // ========================================================================

  describe('getParentChain', () => {
    it('should return breadcrumb chain for a child topic', () => {
      // Find a child topic (non-root)
      const roots = repo.getRootTopics();
      let childTopic: Topic | undefined;

      for (const root of roots) {
        const children = repo.getChildren(root.topicId!);
        if (children.length > 0) {
          childTopic = children[0];
          break;
        }
      }

      expect(childTopic).toBeDefined();
      expect(childTopic!.isRoot()).toBe(false);

      const chain = repo.getParentChain(childTopic!.topicId!);
      expect(chain.length).toBeGreaterThan(0);

      // The first element should be a root topic
      expect(chain[0].isRoot()).toBe(true);

      // The last element should be the direct parent
      expect(chain[chain.length - 1].topicId).toBe(childTopic!.parentTopicId);
    });

    it('should return empty chain for a root topic', () => {
      const roots = repo.getRootTopics();
      expect(roots.length).toBeGreaterThan(0);

      const chain = repo.getParentChain(roots[0].topicId!);
      expect(chain).toEqual([]);
    });

    it('should return deeper chain for deeply nested topics', () => {
      // Find a grandchild
      const roots = repo.getRootTopics();
      let grandchild: Topic | undefined;

      for (const root of roots) {
        const children = repo.getChildren(root.topicId!);
        for (const child of children) {
          const grandchildren = repo.getChildren(child.topicId!);
          if (grandchildren.length > 0) {
            grandchild = grandchildren[0];
            break;
          }
        }
        if (grandchild) break;
      }

      if (grandchild) {
        const chain = repo.getParentChain(grandchild.topicId!);
        expect(chain.length).toBeGreaterThanOrEqual(2);
        // Root should come first
        expect(chain[0].isRoot()).toBe(true);
      }
    });
  });

  // ========================================================================
  // getRecursiveVersesForTopic
  // ========================================================================

  describe('getRecursiveVersesForTopic', () => {
    it('should return verses from the topic and all descendants', () => {
      // Find a root topic that has children with verses
      const roots = repo.getRootTopics();
      for (const root of roots) {
        const directCount = repo.getVerseCount(root.topicId!);
        const recursiveCount = repo.getRecursiveVerseCount(root.topicId!);
        if (recursiveCount > directCount && recursiveCount > 0) {
          const recursiveVerses = repo.getRecursiveVersesForTopic(root.topicId!);
          // getVerseCount / getRecursiveVerseCount sum the verse span of each
          // topic_verses row (end - start + 1). `getRecursiveVersesForTopic`
          // returns one row per topic_verses entry, so the row count must
          // equal the summed span with ranges collapsed back:
          const spannedVerses = recursiveVerses.reduce(
            (sum, tv) => sum + (tv.endVerseId - tv.startVerseId + 1),
            0
          );
          expect(spannedVerses).toBe(recursiveCount);
          expect(recursiveCount).toBeGreaterThan(directCount);
          break;
        }
      }
    });
  });

  // ========================================================================
  // getRecursiveVerseCount
  // ========================================================================

  describe('getRecursiveVerseCount', () => {
    it('should be >= the direct verse count', () => {
      const roots = repo.getRootTopics();
      for (const root of roots.slice(0, 20)) {
        const direct = repo.getVerseCount(root.topicId!);
        const recursive = repo.getRecursiveVerseCount(root.topicId!);
        expect(recursive).toBeGreaterThanOrEqual(direct);
      }
    });
  });

  // ========================================================================
  // Topic model methods
  // ========================================================================

  describe('Topic model methods', () => {
    it('getDescriptionExcerpt should truncate long descriptions', () => {
      const roots = repo.getRootTopics();
      const topicWithDesc = roots.find(t => t.description && t.description.length > 50);
      if (topicWithDesc) {
        const excerpt = topicWithDesc.getDescriptionExcerpt(30);
        expect(excerpt.length).toBeLessThanOrEqual(33); // 30 + '...'
      }
    });

    it('getDescriptionExcerpt should return empty string for missing description', () => {
      const topic = new Topic({ name: 'Test', topicId: 1 });
      expect(topic.getDescriptionExcerpt()).toBe('');
    });
  });
});
