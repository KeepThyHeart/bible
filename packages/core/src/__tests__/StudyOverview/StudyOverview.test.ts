/**
 * Tests for StudyOverview cross-module aggregation services.
 *
 * These run against the real `commentary_barnes.db`, `xref_tsk.db`,
 * `topical_nave.db`, and `tag_graph.db` fixtures under
 * `apps/desktop/data/`. The tests are skipped automatically if the
 * fixtures aren't present so CI environments without the data dir still pass.
 *
 * Each suite verifies that the new core services produce the same shapes that
 * the legacy `scripts/generate-study-cache.js` aggregation functions produced.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ISql } from '../../Data/Core/ISql';
import { CommentaryRepository } from '../../Data/Repositories/CommentaryRepository';
import { CrossReferenceRepository } from '../../Data/Repositories/CrossReferenceRepository';
import { TopicalIndexRepository } from '../../Data/Repositories/TopicalIndexRepository';
import { TagGraphRepository } from '../../Data/Repositories/TagGraphRepository';
import {
  CommentaryAggregationService,
  CrossRefAggregationService,
  TopicAggregationService,
  EntityAggregationService,
} from '../../Services/StudyOverview';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { TEST_DATA_DIR, TEST_MODULES_DIR, testDataAvailable } from '../helpers/testData';

// -- Test SQLite provider --------------------------------------------------

// -- Fixture paths ---------------------------------------------------------

const MODULES_DIR = path.join(TEST_MODULES_DIR, 'modules');
const DESKTOP_DATA_DIR = TEST_DATA_DIR;

const BARNES = path.join(MODULES_DIR, 'commentary_barnes.db');
const TSK = path.join(MODULES_DIR, 'xref_tsk.db');
const NAVE = path.join(MODULES_DIR, 'topical_nave.db');
const TAG_GRAPH = path.join(DESKTOP_DATA_DIR, 'tag_graph.db');

/**
 * Vitest still evaluates the body of a `describe.skipIf(...)` suite during
 * collection, so opening a fixture database at suite scope would throw before
 * the skip takes effect. This defers the open until a test actually runs and
 * memoizes it for the rest of the suite.
 */
function lazyRepository<T>(dbPath: string, make: (sql: ISql) => T): () => T {
  let repo: T | undefined;
  return () => {
    if (repo === undefined) {
      repo = make(new TestSqliteProvider(dbPath));
    }
    return repo;
  };
}

// -------------------------------------------------------------------------
// CommentaryAggregationService
// -------------------------------------------------------------------------

describe.skipIf(!testDataAvailable('CommentaryAggregationService', BARNES))('CommentaryAggregationService', () => {
  const getRepo = lazyRepository(BARNES, sql => new CommentaryRepository(sql));
  const service = new CommentaryAggregationService();

  it('returns all entries for a chapter with the wire shape', () => {
    const repo = getRepo();
    // John 3 - has many entries in barnes
    const result = service.getChapterOverview(43, 3, [
      { abbreviation: 'barnes', moduleName: "Barnes' Notes", repository: repo },
    ]);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const sample = result[0];
    expect(sample.m).toBe('barnes');
    expect(sample.mn).toBe("Barnes' Notes");
    expect(typeof sample.s).toBe('number');
    expect(typeof sample.e).toBe('number');
    expect(sample.e).toBeGreaterThanOrEqual(sample.s);
    expect(typeof sample.l).toBe('string');
    expect(typeof sample.w).toBe('number');
  });

  it('preserves module iteration order', () => {
    const repo = getRepo();
    const result = service.getChapterOverview(43, 3, [
      { abbreviation: 'a-fake', moduleName: 'A', repository: repo },
      { abbreviation: 'z-fake', moduleName: 'Z', repository: repo },
    ]);
    // First half should all be a-fake (since both pull the same DB)
    const half = Math.floor(result.length / 2);
    expect(result[0].m).toBe('a-fake');
    expect(result[result.length - 1].m).toBe('z-fake');
    // Both halves should have the same length
    expect(half).toBeGreaterThan(0);
  });

  it('returns empty array for a chapter with no commentary entries', () => {
    const repo = getRepo();
    // Use a verse range that doesn't exist (book 67 doesn't exist)
    const result = service.getChapterOverview(67, 1, [
      { abbreviation: 'barnes', moduleName: "Barnes' Notes", repository: repo },
    ]);
    expect(result).toEqual([]);
  });

  it('serializes to JSON without null fields', () => {
    const repo = getRepo();
    const result = service.getChapterOverview(43, 3, [
      { abbreviation: 'barnes', moduleName: "Barnes' Notes", repository: repo },
    ]);
    const json = JSON.stringify(result);
    // Wire format never has null fields - every field is required
    expect(json).not.toContain('null');
  });
});

// -------------------------------------------------------------------------
// CrossRefAggregationService
// -------------------------------------------------------------------------

describe.skipIf(!testDataAvailable('CrossRefAggregationService', TSK))('CrossRefAggregationService', () => {
  const getRepo = lazyRepository(TSK, sql => new CrossReferenceRepository(sql));
  const service = new CrossRefAggregationService();

  it('returns a verse-keyed dict of cross-ref blocks for John 3', () => {
    const repo = getRepo();
    const result = service.getChapterCrossRefs(43, 3, [
      { abbreviation: 'tsk', moduleName: 'Treasury of Scripture Knowledge', repository: repo },
    ]);

    expect(typeof result).toBe('object');
    const keys = Object.keys(result);
    expect(keys.length).toBeGreaterThan(0);

    // John 3:16 should be present
    const john316 = result['43003016'];
    expect(john316).toBeDefined();
    expect(john316.length).toBeGreaterThan(0);

    const block = john316[0];
    expect(block.src).toBe('tsk');
    expect(block.g).toBeDefined();
    expect(typeof block.g.id).toBe('number');
    expect(typeof block.g.so).toBe('number');
    expect(Array.isArray(block.e)).toBe(true);
    expect(block.e.length).toBeGreaterThan(0);

    const entry = block.e[0];
    expect(typeof entry.tv).toBe('number');
    expect(typeof entry.so).toBe('number');
  });

  it('omits optional fields rather than serializing nulls', () => {
    const repo = getRepo();
    const result = service.getChapterCrossRefs(43, 3, [
      { abbreviation: 'tsk', moduleName: 'TSK', repository: repo },
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain('null');
  });

  it('returns empty object for a chapter with no cross-refs', () => {
    const repo = getRepo();
    const result = service.getChapterCrossRefs(67, 1, [
      { abbreviation: 'tsk', moduleName: 'TSK', repository: repo },
    ]);
    expect(result).toEqual({});
  });
});

// -------------------------------------------------------------------------
// TopicAggregationService
// -------------------------------------------------------------------------

describe.skipIf(!testDataAvailable('TopicAggregationService', NAVE))('TopicAggregationService', () => {
  const getRepo = lazyRepository(NAVE, sql => new TopicalIndexRepository(sql));

  it('precomputes parent chains and recursive verse counts', () => {
    const repo = getRepo();
    const service = TopicAggregationService.from([
      { abbreviation: 'nave', moduleName: "Nave's Topical Bible", repository: repo },
    ]);

    const modules = service.getPrecomputedModules();
    expect(modules.length).toBe(1);
    expect(modules[0].topicMap.size).toBeGreaterThan(0);
    expect(modules[0].verseToTopics.size).toBeGreaterThan(0);

    // At least one topic should have a non-empty parent chain
    const withChain = [...modules[0].topicMap.values()].find(t => t.ancestors.length > 0);
    expect(withChain).toBeDefined();
    if (withChain) {
      // Recursive count must be >= 0
      expect(withChain.recursiveVerseCount).toBeGreaterThanOrEqual(0);
      // Every ancestor must carry a real id - a name alone cannot be opened.
      for (const ancestor of withChain.ancestors) {
        expect(ancestor.topicId).toBeGreaterThan(0);
        expect(ancestor.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns chapter-scoped topics keyed by verse id', () => {
    const repo = getRepo();
    const service = TopicAggregationService.from([
      { abbreviation: 'nave', moduleName: "Nave's", repository: repo },
    ]);

    // John 3 - should have topics on at least one verse
    const result = service.getChapterTopics(43, 3);
    expect(typeof result).toBe('object');
    const keys = Object.keys(result);

    // It's possible (though unusual) for a chapter to have no topics in Nave's;
    // if so, the dict is just empty. We assert structure when populated.
    if (keys.length > 0) {
      const sample = result[keys[0]];
      expect(Array.isArray(sample)).toBe(true);
      expect(sample.length).toBeGreaterThan(0);
      const entry = sample[0];
      expect(typeof entry.id).toBe('number');
      expect(typeof entry.n).toBe('string');
      expect(typeof entry.vc).toBe('number');
      expect(entry.src).toBe('nave');
      expect(entry.sn).toBe("Nave's");
    }

    // Verse-id keys must all be in chapter range
    const start = 43 * 1000000 + 3 * 1000;
    const end = start + 999;
    for (const k of keys) {
      const vid = Number(k);
      expect(vid).toBeGreaterThanOrEqual(start);
      expect(vid).toBeLessThanOrEqual(end);
    }
  });

  it('emits ancestor ids alongside the joined parent chain', () => {
    const repo = getRepo();
    const service = TopicAggregationService.from([
      { abbreviation: 'nave', moduleName: "Nave's", repository: repo },
    ]);
    const result = service.getChapterTopics(43, 3);
    const entries = Object.values(result).flat();

    // Every entry with a parent chain must also carry the id-bearing tuples.
    // Without them the study pane renders breadcrumb ancestors it cannot open.
    for (const entry of entries) {
      if (entry.p === undefined) {
        expect(entry.a).toBeUndefined();
        continue;
      }
      expect(entry.a).toBeDefined();
      expect(entry.a!.map(([, name]) => name).join(' > ')).toBe(entry.p);
      for (const [topicId] of entry.a!) expect(topicId).toBeGreaterThan(0);
    }
  });

  it('omits parent and description fields when absent', () => {
    const repo = getRepo();
    const service = TopicAggregationService.from([
      { abbreviation: 'nave', moduleName: "Nave's", repository: repo },
    ]);
    const result = service.getChapterTopics(43, 3);
    const json = JSON.stringify(result);
    // No literal `null` should appear - optional fields are omitted
    expect(json).not.toContain('null');
  });
});

// -------------------------------------------------------------------------
// EntityAggregationService
// -------------------------------------------------------------------------

describe.skipIf(!testDataAvailable('EntityAggregationService', TAG_GRAPH))('EntityAggregationService', () => {
  it('returns empty dict when tag graph is null', () => {
    const service = new EntityAggregationService();
    expect(service.getChapterEntities(43, 3, null)).toEqual({});
    expect(service.getChapterEntities(43, 3, undefined)).toEqual({});
  });

  it('returns empty dict for a chapter when entity_verses table is empty', () => {
    // The deployed tag_graph fixture has no entity_verses rows yet, so the
    // result must be a non-throwing empty object.
    const provider = new TestSqliteProvider(TAG_GRAPH);
    const repo = new TagGraphRepository(provider);
    const service = new EntityAggregationService();
    const result = service.getChapterEntities(43, 3, repo);
    expect(result).toEqual({});
    provider.close();
  });
});
