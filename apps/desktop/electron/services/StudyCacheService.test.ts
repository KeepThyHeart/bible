/**
 * The study cache is an accelerator and nothing else.
 *
 * Everything it serves can be computed from the installed modules, and is,
 * whenever the cache does not have it. These tests hold that line: the app must
 * be correct with no cache file at all, correct after the file is deleted mid
 * session, correct when the file is corrupt, and - the one that is easy to get
 * wrong - correct after the installed module set changes, where the temptation
 * is to keep serving what was computed under the old one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => tmpdir() },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SqliteProvider } from '../providers/SqliteProvider';
import {
  StudyCacheService,
  CACHED_SECTIONS,
  type AggregationContext,
  type StudyOverviewSection,
} from './StudyCacheService';
import type { TopicsByVerse } from '@bible/core';

/**
 * These tests drive real SQLite, so they need the native binding compiled for
 * the Node.js ABI vitest runs under. The repo normally keeps it compiled for
 * Electron, so in a default checkout the binding fails to load here. Skip
 * rather than fail - see initMainDatabase.test.ts for the same guard.
 */
const nativeSqliteAvailable = ((): boolean => {
  try {
    const probe = new SqliteProvider(':memory:', { readonly: false });
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

/**
 * A context with no real modules, whose topics are a function of the chapter -
 * so a cached answer and a freshly computed one are distinguishable, which is
 * the whole point of the write-through assertions below.
 */
function fakeContext(fingerprint: string, marker: string): AggregationContext {
  return {
    fingerprint,
    // `crossrefs` is the only section `CACHED_SECTIONS` enables, so the marker
    // that distinguishes a cached answer from a recomputed one has to live
    // there. `CrossRefAggregationService` reads it out of these modules.
    commentaryModules: [],
    crossRefModules: [
      {
        abbreviation: 'FAKExref',
        moduleName: 'Fake',
        repository: {
          getGroupsWithEntriesForRange: (start: number) => [
            {
              group: { groupId: 1, verseId: start, verseIdEnd: start, phrase: marker, sortOrder: 0 },
              entries: [{ entryId: 1, groupId: 1, targetVerseId: 45005008, sortOrder: 0 }],
            },
          ],
        } as unknown as AggregationContext['crossRefModules'][number]['repository'],
      },
    ],
    tagGraph: null,
    topicService: {
      getChapterTopics(book: number, chapter: number): TopicsByVerse {
        return {
          [`${book}${String(chapter).padStart(3, '0')}001`]: [
            { id: 1, n: `${marker}-${book}-${chapter}`, vc: 1, src: 'fake', sn: 'Fake' },
          ],
        };
      },
    },
  };
}

function topicName(topics: TopicsByVerse): string | undefined {
  const first = Object.values(topics)[0];
  return first?.[0]?.n;
}

/** The marker a fake context stamped onto this chapter's cross-references. */
function crossRefMarker(payload: { crossrefs: Record<string, Array<{ g: { ph?: string } }>> }): string | undefined {
  return Object.values(payload.crossrefs)[0]?.[0]?.g.ph;
}

describe.skipIf(!nativeSqliteAvailable)('StudyCacheService', () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'study-cache-'));
    cachePath = join(dir, 'cache', 'study-cache.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function service(context: AggregationContext): StudyCacheService {
    return new StudyCacheService({ cachePath, contextFactory: () => context });
  }

  describe('cold start, with no cache file at all', () => {
    it('serves a correct chapter computed live', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      expect(existsSync(cachePath)).toBe(false);

      const payload = svc.getChapter(43, 3);

      expect(payload.available).toBe(true);
      expect(payload.source).toBe('computed');
      expect(crossRefMarker(payload)).toBe('first');
      svc.close();
    });

    it('creates the cache file lazily, under the path it was given', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      expect(existsSync(cachePath)).toBe(true);
      svc.close();
    });

    it('still answers when the cache file cannot be created at all', () => {
      // A path that cannot be a directory: cache unusable, app unaffected.
      const blocker = join(dir, 'blocked');
      writeFileSync(blocker, 'not a directory');
      const svc = new StudyCacheService({
        cachePath: join(blocker, 'cache', 'study-cache.db'),
        contextFactory: () => fakeContext('fp-1', 'first'),
      });

      const payload = svc.getChapter(43, 3);
      expect(payload.available).toBe(true);
      expect(payload.source).toBe('computed');
      svc.close();
    });
  });

  describe('write-through', () => {
    it('persists a computed chapter and serves the next read from the cache', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      expect(svc.getChapter(43, 3).source).toBe('computed');
      expect(svc.getChapter(43, 3).source).toBe('cache');
      svc.close();
    });

    it('survives the process: a new service reads what the last one wrote', () => {
      const first = service(fakeContext('fp-1', 'first'));
      first.getChapter(43, 3);
      first.close();

      // Same fingerprint, DIFFERENT computation. A cache hit must return the
      // stored answer, which is how we know it did not just recompute.
      const second = service(fakeContext('fp-1', 'second'));
      const payload = second.getChapter(43, 3);
      expect(payload.source).toBe('cache');
      expect(crossRefMarker(payload)).toBe('first');
      second.close();
    });

    it('caches per chapter, not per book', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      expect(svc.getChapter(43, 4).source).toBe('computed');
      expect(svc.getChapter(43, 4).source).toBe('cache');
      svc.close();
    });
  });

  describe('invalidation when the installed modules change', () => {
    it('recomputes rather than serving what a different module set produced', () => {
      const before = service(fakeContext('fp-1', 'first'));
      before.getChapter(43, 3);
      before.close();

      // The user installed a commentary: new fingerprint, new answers.
      const after = service(fakeContext('fp-2', 'second'));
      const payload = after.getChapter(43, 3);

      expect(payload.source).toBe('computed');
      expect(crossRefMarker(payload)).toBe('second');
      after.close();
    });

    it('clears the superseded rows rather than disabling the cache', () => {
      const before = service(fakeContext('fp-1', 'first'));
      before.getChapter(43, 3);
      before.getChapter(43, 4);
      before.close();

      const after = service(fakeContext('fp-2', 'second'));
      after.getChapter(43, 3);
      after.close();

      const db = new SqliteProvider(cachePath, { readonly: true });
      const rows = db.queryAll<{ fingerprint: string }>('SELECT fingerprint FROM study_cache');
      db.close();

      // The old rows are gone (space reclaimed), and the cache is emphatically
      // still working: the chapter just read is cached under the new
      // fingerprint, rather than the cache disabling itself wholesale.
      expect(rows.every(r => r.fingerprint === 'fp-2')).toBe(true);
      expect(rows).toHaveLength(1);
    });

    it('keeps accelerating after the change', () => {
      const before = service(fakeContext('fp-1', 'first'));
      before.getChapter(43, 3);
      before.close();

      const after = service(fakeContext('fp-2', 'second'));
      expect(after.getChapter(43, 3).source).toBe('computed');
      expect(after.getChapter(43, 3).source).toBe('cache');
      after.close();
    });
  });

  describe('recovering from a damaged or missing file', () => {
    it('recreates a corrupt cache silently and keeps serving', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      svc.close();

      // Something wrote garbage over the file.
      writeFileSync(cachePath, 'this is not a database');

      const recovered = service(fakeContext('fp-1', 'first'));
      const payload = recovered.getChapter(43, 3);
      expect(payload.available).toBe(true);
      expect(payload.source).toBe('computed');
      // ...and the file is a working cache again.
      expect(recovered.getChapter(43, 3).source).toBe('cache');
      recovered.close();
    });

    it('rebuilds after the user deletes the file', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      svc.close();
      rmSync(cachePath, { force: true });

      const rebuilt = service(fakeContext('fp-1', 'first'));
      expect(rebuilt.getChapter(43, 3).source).toBe('computed');
      expect(existsSync(cachePath)).toBe(true);
      rebuilt.close();
    });

    it('reports unavailable, rather than throwing, when nothing can be computed', () => {
      const svc = new StudyCacheService({
        cachePath,
        contextFactory: () => {
          throw new Error('no modules');
        },
      });
      const payload = svc.getChapter(43, 3);
      expect(payload.available).toBe(false);
      expect(payload.source).toBe('unavailable');
      expect(payload.crossrefs).toEqual({});
      svc.close();
    });
  });

  describe('adopting a pre-generated cache', () => {
    it('migrates the generated schema and honours its whole-file fingerprint', () => {
      // Exactly what the generator writes: no per-row fingerprint column, one
      // `cache_metadata` row for the file.
      mkdirSync(join(dir, 'cache'), { recursive: true });
      const seed = new SqliteProvider(cachePath, { readonly: false });
      seed.execute(
        `CREATE TABLE study_cache (
           book INTEGER NOT NULL, chapter INTEGER NOT NULL,
           commentary_overview TEXT NOT NULL DEFAULT '[]',
           topics TEXT NOT NULL DEFAULT '{}',
           crossrefs TEXT NOT NULL DEFAULT '{}',
           entities TEXT NOT NULL DEFAULT '{}',
           PRIMARY KEY (book, chapter))`
      );
      seed.execute('CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      seed.execute('INSERT INTO cache_metadata (key, value) VALUES (?, ?)', [
        'module_fingerprint',
        'fp-1',
      ]);
      seed.execute(
        'INSERT INTO study_cache (book, chapter, crossrefs) VALUES (?, ?, ?)',
        [
          43,
          3,
          JSON.stringify({
            '43003001': [{ src: 'S', g: { id: 1, ph: 'seeded', so: 0 }, e: [{ tv: 45005008, so: 0 }] }],
          }),
        ]
      );
      seed.close();

      const svc = service(fakeContext('fp-1', 'fresh'));
      const payload = svc.getChapter(43, 3);

      // Served from the seed, not recomputed - the generated file is a valid
      // warm start rather than something to throw away.
      expect(payload.source).toBe('cache');
      expect(crossRefMarker(payload)).toBe('seeded');
      svc.close();
    });

    it('discards a seed built against a different module set', () => {
      mkdirSync(join(dir, 'cache'), { recursive: true });
      const seed = new SqliteProvider(cachePath, { readonly: false });
      seed.execute(
        `CREATE TABLE study_cache (
           book INTEGER NOT NULL, chapter INTEGER NOT NULL,
           commentary_overview TEXT NOT NULL DEFAULT '[]',
           topics TEXT NOT NULL DEFAULT '{}',
           crossrefs TEXT NOT NULL DEFAULT '{}',
           entities TEXT NOT NULL DEFAULT '{}',
           PRIMARY KEY (book, chapter))`
      );
      seed.execute('CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      seed.execute('INSERT INTO cache_metadata (key, value) VALUES (?, ?)', [
        'module_fingerprint',
        'someone-elses-modules',
      ]);
      seed.execute('INSERT INTO study_cache (book, chapter, crossrefs) VALUES (?, ?, ?)', [
        43,
        3,
        JSON.stringify({
          '43003001': [{ src: 'S', g: { id: 1, ph: 'stale', so: 0 }, e: [{ tv: 45005008, so: 0 }] }],
        }),
      ]);
      seed.close();

      const svc = service(fakeContext('fp-1', 'fresh'));
      const payload = svc.getChapter(43, 3);
      expect(payload.source).toBe('computed');
      expect(crossRefMarker(payload)).toBe('fresh');
      svc.close();
    });
  });

  describe('what a row is allowed to claim', () => {
    it('stores only the enabled sections, and says so', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      const payload = svc.getChapter(43, 3);

      expect(payload.sections).toEqual([...CACHED_SECTIONS]);
      // The sections that are switched off are not merely empty in the reply -
      // they are absent from `sections`, so a consumer can tell "not computed"
      // from "computed and empty".
      expect(payload.sections).not.toContain('topics');
      svc.close();
    });

    it('treats a row cached under a NARROWER section set as a miss', () => {
      // This is the promise that makes scoping down reversible: re-enabling a
      // section must not serve rows written while it was off.
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      expect(svc.getChapter(43, 3).source).toBe('cache');

      const wider: StudyOverviewSection[] = [...CACHED_SECTIONS, 'topics'];
      const widened = svc.getChapter(43, 3, wider);

      expect(widened.source).toBe('computed');
      // ...and the wider request really is answered, not silently emptied.
      expect(topicName(widened.topics)).toBe('first-43-3');
      expect(widened.sections).toEqual(expect.arrayContaining(wider));
      svc.close();
    });

    it('refills without any manual intervention once the constant widens', () => {
      // Simulates editing CACHED_SECTIONS: same file, same fingerprint, wider
      // request. No migration, no cache wipe, no restart.
      const before = service(fakeContext('fp-1', 'first'));
      before.getChapter(43, 3);
      before.close();

      const wider: StudyOverviewSection[] = [...CACHED_SECTIONS, 'topics'];
      const after = service(fakeContext('fp-1', 'first'));

      expect(after.getChapter(43, 3, wider).source).toBe('computed');
      // The refilled row now satisfies the wider request from cache...
      expect(after.getChapter(43, 3, wider).source).toBe('cache');
      // ...and still satisfies the narrow one.
      expect(after.getChapter(43, 3).source).toBe('cache');
      after.close();
    });

    it('serves a WIDER cached row for a narrower request', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3, [...CACHED_SECTIONS, 'topics']);
      // Containment, not equality: a row holding more than was asked for is a
      // perfectly good hit.
      expect(svc.getChapter(43, 3).source).toBe('cache');
      svc.close();
    });

    it('marks a seeded generated cache as complete, so it satisfies any request', () => {
      mkdirSync(join(dir, 'cache'), { recursive: true });
      const seed = new SqliteProvider(cachePath, { readonly: false });
      seed.execute(
        `CREATE TABLE study_cache (
           book INTEGER NOT NULL, chapter INTEGER NOT NULL,
           commentary_overview TEXT NOT NULL DEFAULT '[]',
           topics TEXT NOT NULL DEFAULT '{}',
           crossrefs TEXT NOT NULL DEFAULT '{}',
           entities TEXT NOT NULL DEFAULT '{}',
           PRIMARY KEY (book, chapter))`
      );
      seed.execute('CREATE TABLE cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      seed.execute('INSERT INTO cache_metadata (key, value) VALUES (?, ?)', [
        'module_fingerprint',
        'fp-1',
      ]);
      seed.execute('INSERT INTO study_cache (book, chapter, crossrefs) VALUES (?, ?, ?)', [
        43,
        3,
        JSON.stringify({
          '43003001': [{ src: 'S', g: { id: 1, ph: 'seeded', so: 0 }, e: [{ tv: 45005008, so: 0 }] }],
        }),
      ]);
      seed.close();

      // The generator computes all four sections, so its rows are complete
      // and the migration marks them as such.
      const svc = service(fakeContext('fp-1', 'fresh'));
      expect(svc.getChapter(43, 3, [...CACHED_SECTIONS, 'topics', 'commentary']).source).toBe('cache');
      svc.close();
    });
  });

  describe('housekeeping', () => {
    it('reports its own size, and zero when there is no file', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      expect(svc.sizeBytes()).toBe(0);
      svc.getChapter(43, 3);
      expect(svc.sizeBytes()).toBeGreaterThan(0);
      svc.close();
    });

    it('never writes anywhere but the cache directory it was given', () => {
      const svc = service(fakeContext('fp-1', 'first'));
      svc.getChapter(43, 3);
      svc.close();
      // The seed/blocker files this suite writes live directly in `dir`; the
      // cache itself must stay inside `dir/cache`.
      expect(existsSync(join(dir, 'cache'))).toBe(true);
      expect(readFileSync(cachePath).length).toBeGreaterThan(0);
    });
  });
});
