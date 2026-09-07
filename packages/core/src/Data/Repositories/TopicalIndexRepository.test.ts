import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TopicalIndexRepository } from './TopicalIndexRepository';
import { TestSqliteProvider } from '../../__tests__/helpers/TestSqliteProvider';

/**
 * Unit tests for the browse-list options, run against a purpose-built
 * in-memory topical index.
 *
 * The sibling suite in `src/__tests__/TopicalIndexRepository.test.ts` runs
 * against the real `topical_nave.db` and skips itself when that module is not
 * present, which is no good for the behaviour under test here: the whole point
 * of `rootsOnly` is a specific shape of hierarchy (Nave's has 17,206 topics of
 * which only 5,320 are roots - "(A penalty)" hangs under "Fine"), and that
 * shape is easier to assert on when the fixture states it outright.
 */

/** A hierarchy that mirrors the real one in miniature: roots, and glosses. */
const FIXTURE_SQL = `
  CREATE TABLE topic (
    topic_id INTEGER PRIMARY KEY,
    parent_topic_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    metadata TEXT
  );
  CREATE VIRTUAL TABLE topic_fts USING fts5(name, description, content='');

  INSERT INTO topic (topic_id, parent_topic_id, name) VALUES
    (1, NULL, 'Fine'),
    (2, 1,    '(A penalty)'),
    (3, 1,    'Levied on the guilty'),
    (4, NULL, 'Jericho'),
    (5, NULL, 'Jerusalem'),
    (6, 5,    'Besieged'),
    (7, NULL, 'Abstinence');

  INSERT INTO topic_fts (rowid, name, description)
    SELECT topic_id, name, description FROM topic;
`;

describe('TopicalIndexRepository (in-memory fixture)', () => {
  let provider: TestSqliteProvider;
  let repo: TopicalIndexRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(':memory:');
    provider.exec(FIXTURE_SQL);
    repo = new TopicalIndexRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  describe('getAllTopicsPaginated', () => {
    it('returns every topic, at every level, by default', () => {
      const topics = repo.getAllTopicsPaginated();
      expect(topics.map(t => t.name)).toContain('(A penalty)');
      expect(topics).toHaveLength(7);
    });

    it('returns only top-level topics when rootsOnly is set', () => {
      const topics = repo.getAllTopicsPaginated({ rootsOnly: true });

      expect(topics.map(t => t.name).sort()).toEqual(['Abstinence', 'Fine', 'Jericho', 'Jerusalem']);
      for (const topic of topics) {
        expect(topic.isRoot()).toBe(true);
      }
    });

    it('agrees with getRootTopics about what a root is', () => {
      const paged = repo.getAllTopicsPaginated({ rootsOnly: true, limit: 100 });
      const roots = repo.getRootTopics();

      expect(new Set(paged.map(t => t.topicId))).toEqual(new Set(roots.map(t => t.topicId)));
    });

    it('pages through roots without overlapping', () => {
      const page1 = repo.getAllTopicsPaginated({ rootsOnly: true, limit: 2, offset: 0 });
      const page2 = repo.getAllTopicsPaginated({ rootsOnly: true, limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      const first = new Set(page1.map(t => t.topicId));
      for (const topic of page2) {
        expect(first.has(topic.topicId)).toBe(false);
      }
    });

    it('still spans subtopics when a filter is supplied, even with rootsOnly', () => {
      // The point of the exception: a reader who types a subtopic's name is
      // asking for that subtopic, not for whatever root happens to contain it.
      const topics = repo.getAllTopicsPaginated({ rootsOnly: true, filter: 'penalty' });

      expect(topics.map(t => t.name)).toEqual(['(A penalty)']);
    });
  });

  describe('getTopicCount', () => {
    it('counts every topic by default', () => {
      expect(repo.getTopicCount()).toBe(7);
    });

    it('counts only roots when rootsOnly is set', () => {
      expect(repo.getTopicCount(undefined, { rootsOnly: true })).toBe(4);
    });
  });

  describe('getChildCounts', () => {
    it('returns direct-child counts for a batch, omitting childless topics', () => {
      const counts = repo.getChildCounts([1, 4, 5, 7]);

      expect(counts.get(1)).toBe(2);
      expect(counts.get(5)).toBe(1);
      expect(counts.has(4)).toBe(false);
      expect(counts.has(7)).toBe(false);
    });

    it('returns an empty map for an empty batch', () => {
      expect(repo.getChildCounts([]).size).toBe(0);
    });

    it('matches getChildren for every root', () => {
      const roots = repo.getRootTopics();
      const counts = repo.getChildCounts(roots.map(t => t.topicId!));

      for (const root of roots) {
        expect(counts.get(root.topicId!) ?? 0).toBe(repo.getChildren(root.topicId!).length);
      }
    });
  });

  describe('searchTopics', () => {
    it('matches a partial word so results appear as the reader types', () => {
      // "jeri" is not a token in the index; without prefix matching this
      // returns nothing and the search box reads as broken.
      const results = repo.searchTopics('jeri');

      expect(results.map(t => t.name)).toEqual(['Jericho']);
    });

    it('does not treat punctuation in the query as FTS syntax', () => {
      // Unescaped, "(A penalty)" is a syntax error rather than a query, and
      // SQLite throws instead of returning no rows.
      const results = repo.searchTopics('(A penalty)');

      expect(results.map(t => t.name)).toEqual(['(A penalty)']);
    });

    it('finds subtopics as readily as roots', () => {
      expect(repo.searchTopics('besieg').map(t => t.name)).toEqual(['Besieged']);
    });

    it('returns nothing for a blank query rather than erroring', () => {
      expect(repo.searchTopics('   ')).toEqual([]);
    });

    it('pages with limit and offset', () => {
      const all = repo.searchTopics('jer');
      expect(all.length).toBe(2);

      const page1 = repo.searchTopics('jer', { limit: 1, offset: 0 });
      const page2 = repo.searchTopics('jer', { limit: 1, offset: 1 });
      expect(page1).toHaveLength(1);
      expect(page2).toHaveLength(1);
      expect(page1[0].topicId).not.toBe(page2[0].topicId);
    });
  });
});
