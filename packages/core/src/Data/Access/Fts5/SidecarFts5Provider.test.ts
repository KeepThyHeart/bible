/**
 * `SidecarFts5Provider`'s own tests (task 0027, revision 2, subtask F6).
 *
 * The subject here is a state machine that spans the filesystem and the
 * contents of real SQLite files, and whose failure mode is a search that
 * quietly returns nothing. So nothing below is mocked: every test runs against
 * a real temporary directory, real `.kwi` files built from real downloaded
 * modules (`bible_kjv.db`, `commentary_barnes.db`) through M5's
 * `getIndexSource()`, and a real `better-sqlite3` connection. Where a test
 * needs a corrupt index, it corrupts a real one; where it needs an interrupted
 * build, it interrupts a real one partway through.
 *
 * `SidecarFts5Provider.contract.test.ts` runs the provider-neutral M4 contract
 * against this same provider - including the three build-lifecycle bullets
 * that had to be skipped for `InModuleFts5Provider`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TestSqliteProvider } from '../../../__tests__/helpers/TestSqliteProvider';
import { openTestSidecarDatabase } from '../../../__tests__/helpers/TestSidecarDatabase';
import { moduleDb, testDataAvailable } from '../../../__tests__/helpers/testData';
import { BibleRepository } from '../../Repositories/BibleRepository';
import { CommentaryRepository } from '../../Repositories/CommentaryRepository';
import { RuntimeEnvironment } from '../IKeywordIndexProvider';
import { KeywordIndexRegistry } from '../KeywordIndexRegistry';
import { IIndexSource, IndexDocument, IndexTarget, KeywordQuery } from '../KeywordTypes';
import {
  SIDECAR_BUILD_BATCH_SIZE,
  SIDECAR_FTS5_FEATURES,
  SidecarFts5Provider,
  SidecarIndexBuildAbortedError,
  SidecarIndexBuildError,
} from './SidecarFts5Provider';
import {
  KWI_FORMAT,
  KWI_META_KEYS,
  SIDECAR_BUILDER_VERSION,
  SIDECAR_SCHEMA_SQL,
  SIDECAR_TOKENIZER,
} from './sidecarSchema';

const KJV_DB_PATH = moduleDb('bible_kjv.db');
const BARNES_DB_PATH = moduleDb('commentary_barnes.db');

const DATA_AVAILABLE = testDataAvailable(
  'SidecarFts5Provider (bible_kjv.db + commentary_barnes.db)',
  KJV_DB_PATH,
  BARNES_DB_PATH
);

/** The environment this provider needs: FTS5, and a writable derived-data location. */
function envWith(overrides: Partial<RuntimeEnvironment> = {}): RuntimeEnvironment {
  return {
    runtime: 'node-server',
    sqlite: { fts5: true, writableModules: false },
    codecs: new Set(['none']),
    indexDir: '/tmp/any-non-null-value',
    ...overrides,
  };
}

const LOVE: KeywordQuery = { kind: 'terms', terms: ['love'], all: false };

/**
 * A sample of a real source: the first `max` documents, with a truthful
 * `count()`.
 *
 * Real content, less of it. A full KJV build is ~31,000 documents and there is
 * nothing a test below learns from the 4,000th verse that it does not learn
 * from the 400th - except in the one place where volume IS the point (the
 * abort test needs a build long enough to interrupt), which uses the unsampled
 * source.
 */
function sample(source: IIndexSource, max: number): IIndexSource {
  return {
    target: source.target,
    count: () => Math.min(source.count(), max),
    documents: () => take(source.documents(), max),
  };
}

function* take(documents: Iterable<IndexDocument>, max: number): Iterable<IndexDocument> {
  let taken = 0;
  for (const document of documents) {
    if (taken >= max) return;
    taken += 1;
    yield document;
  }
}

/** Read a built `.kwi`'s own `kwi_meta`, from outside the provider. */
function readMeta(kwiPath: string): Map<string, string> {
  const db = openTestSidecarDatabase(kwiPath, { readonly: true, create: false });
  try {
    const rows = db.queryAll<{ key: string; value: string }>('SELECT key, value FROM kwi_meta');
    return new Map(rows.map((row) => [row.key, row.value]));
  } finally {
    db.close();
  }
}

/** Edit a built `.kwi`'s `kwi_meta` in place, simulating drift since it was built. */
function rewriteMeta(kwiPath: string, key: string, value: string): void {
  const db = openTestSidecarDatabase(kwiPath, { readonly: false, create: false });
  try {
    db.execute('UPDATE kwi_meta SET value = ? WHERE key = ?', [value, key]);
  } finally {
    db.close();
  }
}

describe.skipIf(!DATA_AVAILABLE)('SidecarFts5Provider', () => {
  let kjvDb: TestSqliteProvider;
  let barnesDb: TestSqliteProvider;
  let kjvSource: IIndexSource;
  let barnesSource: IIndexSource;
  let kjvTarget: IndexTarget;
  let barnesTarget: IndexTarget;

  let indexDir: string;
  let provider: SidecarFts5Provider;

  beforeAll(() => {
    kjvDb = new TestSqliteProvider(KJV_DB_PATH, { readonly: true, fileMustExist: true });
    barnesDb = new TestSqliteProvider(BARNES_DB_PATH, { readonly: true, fileMustExist: true });
    kjvSource = new BibleRepository(kjvDb).getIndexSource();
    barnesSource = new CommentaryRepository(barnesDb).getIndexSource();
    kjvTarget = kjvSource.target;
    barnesTarget = barnesSource.target;
  });

  afterAll(() => {
    kjvDb.close();
    barnesDb.close();
  });

  beforeEach(() => {
    indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwi-test-'));
    provider = new SidecarFts5Provider({ indexDir, openDatabase: openTestSidecarDatabase });
  });

  afterEach(() => {
    fs.rmSync(indexDir, { recursive: true, force: true });
  });

  // =========================================================================
  // Real module data is a precondition for everything below, so assert the
  // shape this suite assumes before relying on it.
  // =========================================================================
  it('is backed by real modules with real content digests', () => {
    expect(kjvTarget.moduleUuid).toMatch(/^[0-9a-f-]{36}$/u);
    expect(kjvTarget.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(kjvTarget.moduleType).toBe('bible');
    expect(kjvSource.count()).toBeGreaterThan(30000);

    expect(barnesTarget.moduleUuid).not.toBe(kjvTarget.moduleUuid);
    expect(barnesTarget.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(barnesTarget.moduleType).toBe('commentary');
  });

  // =========================================================================
  // supports(): environment, and the empty-contentSha256 judgement call
  // =========================================================================
  describe('supports()', () => {
    it('accepts a real target in an FTS5 environment with an index directory', () => {
      expect(provider.supports(kjvTarget, envWith())).toBe(true);
    });

    it('refuses when the SQLite build has no FTS5', () => {
      expect(provider.supports(kjvTarget, envWith({ sqlite: { fts5: false, writableModules: false } }))).toBe(
        false
      );
    });

    it('refuses when the environment has no writable derived-data location', () => {
      expect(provider.supports(kjvTarget, envWith({ indexDir: null }))).toBe(false);
    });

    /**
     * The judgement call, asserted. A `.kwi` is addressed by content digest,
     * so a target without one cannot be addressed at all - and inventing a key
     * would be worse than refusing, because a key that does not change when
     * the content does produces an index that reports `ready` forever. See
     * `unsupportedReason`'s doc comment.
     */
    it('refuses a target with no content digest rather than inventing a key for it', () => {
      const noDigest: IndexTarget = { ...kjvTarget, contentSha256: '' };
      expect(provider.supports(noDigest, envWith())).toBe(false);
    });

    it('refuses a digest too short to key a filename', () => {
      expect(provider.supports({ ...kjvTarget, contentSha256: 'abc' }, envWith())).toBe(false);
    });

    /**
     * `BaseModuleRepository.buildIndexTarget` (M5) falls back to the database
     * FILE PATH for `moduleUuid` when a module has no `module_info` row.
     * Interpolating one of those into `<indexDir>/<uuid>.<sha>.kwi` would
     * write outside the index directory entirely.
     */
    it('refuses a moduleUuid that is a path, not an identifier', () => {
      const pathish: IndexTarget = { ...kjvTarget, moduleUuid: '/home/user/data/modules/bible_kjv.db' };
      expect(provider.supports(pathish, envWith())).toBe(false);
      expect(provider.supports({ ...kjvTarget, moduleUuid: '../../escape' }, envWith())).toBe(false);
    });

    it('status() reports an unsupported target as unavailable, never throwing', async () => {
      expect(await provider.status({ ...kjvTarget, contentSha256: '' })).toEqual({
        state: 'unavailable',
        reason: 'no-provider',
      });
    });

    /**
     * Bullet 4 of the M4 contract, at the level that matters to a caller: the
     * registry must route an unsupported target to `skipped`, and must still
     * return the supported one's hits.
     */
    it('KeywordIndexRegistry skips an unsupported target and still searches the rest', async () => {
      await provider.build(sample(kjvSource, 2000));

      const registry = new KeywordIndexRegistry(envWith());
      registry.register(provider);

      const unsupported: IndexTarget = { ...barnesTarget, contentSha256: '' };
      const response = await registry.search(LOVE, { targets: [kjvTarget, unsupported] });

      expect(response.hits.length).toBeGreaterThan(0);
      expect(response.hits.every((hit) => hit.target.moduleUuid === kjvTarget.moduleUuid)).toBe(true);
      expect(response.skipped).toEqual([
        { target: unsupported, reason: { state: 'unavailable', reason: 'no-provider' } },
      ]);
    });
  });

  // =========================================================================
  // 1. Build, then search
  // =========================================================================
  describe('build() then search()', () => {
    it('writes a .kwi at the documented path and reports ready', async () => {
      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');

      await provider.build(sample(kjvSource, 2000));

      const kwiPath = provider.kwiPathFor(kjvTarget);
      expect(path.basename(kwiPath)).toBe(
        `${kjvTarget.moduleUuid}.${kjvTarget.contentSha256.slice(0, 12)}.kwi`
      );
      expect(fs.existsSync(kwiPath)).toBe(true);
      expect(fs.existsSync(provider.partPathFor(kjvTarget))).toBe(false);

      expect(await provider.status(kjvTarget)).toEqual({
        state: 'ready',
        providerId: 'sidecar-fts5',
        supports: SIDECAR_FTS5_FEATURES,
      });
    });

    it('returns real hits, tagged with the target and carrying the source rowid', async () => {
      await provider.build(sample(kjvSource, 2000));

      const index = await provider.open([kjvTarget]);
      const response = await index.search(LOVE, { targets: [kjvTarget] });
      index.close();

      expect(response.hits.length).toBeGreaterThanOrEqual(2);
      expect(response.skipped).toEqual([]);
      for (const hit of response.hits) {
        expect(hit.target).toBe(kjvTarget);
        // Genesis 1:1 is verse_id 1001001; the first 2000 verses stay well
        // inside Genesis/Exodus, so every rowid is a real Bible verse id.
        expect(hit.rowId).toBeGreaterThan(1000000);
        // Contentless index: no snippet, and `rank` is the documented
        // placeholder, not a bm25 score.
        expect(hit.snippet).toBeUndefined();
        expect(hit.rank).toBe(0);
        // No passage range: `CONTENT_MAP['bible']` (F1) declares no `range`,
        // so M5's `IIndexSource` yields Bible verses with no start/end verse
        // id and this index faithfully stores NULL. See `buildScopeFilter`.
        expect(hit.startVerseId).toBeUndefined();
        expect(hit.endVerseId).toBeUndefined();
      }
    });

    it('carries the passage range through for content that has one', async () => {
      await provider.build(sample(barnesSource, 500));

      const index = await provider.open([barnesTarget]);
      const response = await index.search({ kind: 'terms', terms: ['kingdom'], all: true }, { targets: [] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
      for (const hit of response.hits) {
        // Barnes is New Testament only: Matthew 1:1 is 40001001.
        expect(hit.startVerseId).toBeGreaterThanOrEqual(40001001);
        expect(hit.endVerseId).toBeGreaterThanOrEqual(hit.startVerseId!);
      }
    });

    it('the hits really are the verses that contain the word', async () => {
      await provider.build(sample(kjvSource, 2000));

      const index = await provider.open([kjvTarget]);
      const response = await index.search({ kind: 'phrase', phrase: 'living creature' }, { targets: [] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
      for (const hit of response.hits) {
        const verse = kjvDb.queryOne<{ text: string }>('SELECT text FROM bible_verse WHERE verse_id = ?', [
          hit.rowId,
        ]);
        expect(verse?.text.toLowerCase()).toContain('living creature');
      }
    });

    it('records provenance and the real document count in kwi_meta', async () => {
      const source = sample(kjvSource, 2000);
      await provider.build(source);

      const meta = readMeta(provider.kwiPathFor(kjvTarget));
      expect(meta.get(KWI_META_KEYS.format)).toBe(KWI_FORMAT);
      expect(meta.get(KWI_META_KEYS.providerId)).toBe('sidecar-fts5');
      expect(meta.get(KWI_META_KEYS.tokenizer)).toBe(SIDECAR_TOKENIZER);
      expect(meta.get(KWI_META_KEYS.builder)).toBe(SIDECAR_BUILDER_VERSION);
      expect(meta.get(KWI_META_KEYS.moduleUuid)).toBe(kjvTarget.moduleUuid);
      expect(meta.get(KWI_META_KEYS.contentSha256)).toBe(kjvTarget.contentSha256);
      expect(meta.get(KWI_META_KEYS.source)).toBe('bible');
      expect(meta.get(KWI_META_KEYS.docCount)).toBe(String(source.count()));
      expect(meta.get(KWI_META_KEYS.builtAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    });

    it('reports progress monotonically, ending at the total', async () => {
      const source = sample(kjvSource, 5000);
      const progress: Array<{ done: number; total: number }> = [];

      await provider.build(source, (done, total) => progress.push({ done, total }));

      expect(progress.length).toBe(Math.ceil(5000 / SIDECAR_BUILD_BATCH_SIZE));
      expect(progress.every((step) => step.total === 5000)).toBe(true);
      expect(progress.map((step) => step.done)).toEqual([2000, 4000, 5000]);
    });

    it('indexes a commentary - the provider is not Bible-specific', async () => {
      await provider.build(sample(barnesSource, 500));

      expect((await provider.status(barnesTarget)).state).toBe('ready');
      const index = await provider.open([barnesTarget]);
      const response = await index.search({ kind: 'terms', terms: ['heaven'], all: true }, { targets: [] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
      expect(response.hits.every((hit) => hit.target.moduleUuid === barnesTarget.moduleUuid)).toBe(true);
    });
  });

  // =========================================================================
  // 2. Rebuild is idempotent
  // =========================================================================
  describe('rebuild', () => {
    it('building twice leaves one index, with the same answers and no stray files', async () => {
      const source = sample(kjvSource, 2000);

      await provider.build(source);
      const first = await searchOnce(provider, kjvTarget, LOVE);
      const firstMeta = readMeta(provider.kwiPathFor(kjvTarget));

      await provider.build(source);
      const second = await searchOnce(provider, kjvTarget, LOVE);
      const secondMeta = readMeta(provider.kwiPathFor(kjvTarget));

      expect(second.map((hit) => hit.rowId)).toEqual(first.map((hit) => hit.rowId));
      expect(secondMeta.get(KWI_META_KEYS.docCount)).toBe(firstMeta.get(KWI_META_KEYS.docCount));

      // The old file was REPLACED, not left beside the new one: the rename is
      // onto the same name, so exactly one `.kwi` and no `.part` may remain.
      expect(fs.readdirSync(indexDir).sort()).toEqual([path.basename(provider.kwiPathFor(kjvTarget))]);
      expect((await provider.status(kjvTarget)).state).toBe('ready');
    });
  });

  // =========================================================================
  // 3. prune() / pruneExcept()
  // =========================================================================
  describe('prune()', () => {
    it('deletes the file and flips status back to unbuilt', async () => {
      await provider.build(sample(kjvSource, 1000));
      const kwiPath = provider.kwiPathFor(kjvTarget);
      expect(fs.existsSync(kwiPath)).toBe(true);

      await provider.prune(kjvTarget);

      expect(fs.existsSync(kwiPath)).toBe(false);
      expect(await provider.status(kjvTarget)).toEqual({ state: 'unbuilt', providerId: 'sidecar-fts5' });
    });

    it('also removes a leftover .part for that target, whatever its age', async () => {
      const partPath = provider.partPathFor(kjvTarget);
      fs.writeFileSync(partPath, 'half-written index');

      await provider.prune(kjvTarget);

      expect(fs.existsSync(partPath)).toBe(false);
    });

    it('is a no-op for a target that was never built', async () => {
      await expect(provider.prune(kjvTarget)).resolves.toBeUndefined();
      expect(fs.readdirSync(indexDir)).toEqual([]);
    });
  });

  describe('pruneExcept()', () => {
    it('keeps the installed targets and deletes everything else it owns', async () => {
      await provider.build(sample(kjvSource, 500));
      await provider.build(sample(barnesSource, 200));

      // An orphan from a module that was uninstalled while the app was not
      // running: a well-formed name nobody can name a target for any more.
      const orphan = path.join(indexDir, 'deadbeef-dead-beef-dead-beefdeadbeef.0123456789ab.kwi');
      fs.writeFileSync(orphan, 'orphaned index');
      // Something this provider does not own at all.
      const foreign = path.join(indexDir, 'notes.txt');
      fs.writeFileSync(foreign, 'not ours');

      await provider.pruneExcept([kjvTarget]);

      expect(fs.existsSync(provider.kwiPathFor(kjvTarget))).toBe(true);
      expect(fs.existsSync(provider.kwiPathFor(barnesTarget))).toBe(false);
      expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.existsSync(foreign)).toBe(true);
    });

    it('sweeps a .part for a target that is not installed, at any age', async () => {
      const strayPart = path.join(indexDir, 'deadbeef-dead-beef-dead-beefdeadbeef.0123456789ab.kwi.part');
      fs.writeFileSync(strayPart, 'interrupted');

      await provider.pruneExcept([kjvTarget]);

      expect(fs.existsSync(strayPart)).toBe(false);
    });

    /**
     * Design doc §4.4's last row: an orphan `.part` for a module that IS still
     * installed is only swept once it is old enough to be certainly nobody's
     * build in progress. A fresh one is left alone; deleting it would break a
     * build that was about to succeed.
     */
    it('leaves a fresh .part for an installed target alone, and sweeps an old one', async () => {
      const partPath = provider.partPathFor(kjvTarget);
      fs.writeFileSync(partPath, 'in progress');

      await provider.pruneExcept([kjvTarget]);
      expect(fs.existsSync(partPath)).toBe(true);

      backdate(partPath, 2 * 60 * 60 * 1000);
      await provider.pruneExcept([kjvTarget]);
      expect(fs.existsSync(partPath)).toBe(false);
    });

    it('does nothing at all when the index directory is gone', async () => {
      fs.rmSync(indexDir, { recursive: true, force: true });
      await expect(provider.pruneExcept([kjvTarget])).resolves.toBeUndefined();
      fs.mkdirSync(indexDir, { recursive: true });
    });
  });

  // =========================================================================
  // 5. An aborted build leaves unbuilt, never ready
  // =========================================================================
  describe('aborted build', () => {
    /**
     * Genuinely mid-build, and proved so rather than asserted:
     *
     * - the source is the WHOLE KJV (~31,000 documents, 16 batches), so the
     *   build cannot finish before the abort;
     * - the abort is fired from inside the progress callback after the SECOND
     *   batch, i.e. after 4,000 documents have really been written;
     * - that same callback asserts the `.part` file exists and already has
     *   bytes in it at the moment of the abort, so "nothing had started yet"
     *   is ruled out, not assumed.
     *
     * After the abort, what must be true is the whole point of the bullet: no
     * `.kwi` (a partial index must never be reachable), no `.part` left behind,
     * and `status()` reporting `unbuilt` - NOT `failed`, because an interrupted
     * build is a non-event that should simply be retried.
     */
    it('stops partway, leaves no index and no .part, and reports unbuilt', async () => {
      const controller = new AbortController();
      const partPath = provider.partPathFor(kjvTarget);
      const progress: Array<{ done: number; total: number }> = [];
      const partSizesDuringBuild: number[] = [];

      await expect(
        provider.build(
          kjvSource,
          (done, total) => {
            progress.push({ done, total });
            partSizesDuringBuild.push(fs.statSync(partPath).size);
            if (progress.length === 2) controller.abort();
          },
          controller.signal
        )
      ).rejects.toBeInstanceOf(SidecarIndexBuildAbortedError);

      // It really got two batches in, out of sixteen.
      expect(progress).toEqual([
        { done: 2000, total: kjvSource.count() },
        { done: 4000, total: kjvSource.count() },
      ]);
      expect(kjvSource.count()).toBeGreaterThan(8 * SIDECAR_BUILD_BATCH_SIZE);
      // And a real, growing partial file existed at the moment it was aborted.
      expect(partSizesDuringBuild[0]).toBeGreaterThan(0);
      expect(partSizesDuringBuild[1]!).toBeGreaterThan(partSizesDuringBuild[0]!);

      expect(fs.existsSync(partPath)).toBe(false);
      expect(fs.existsSync(provider.kwiPathFor(kjvTarget))).toBe(false);
      expect(fs.readdirSync(indexDir)).toEqual([]);
      expect(await provider.status(kjvTarget)).toEqual({ state: 'unbuilt', providerId: 'sidecar-fts5' });
    });

    it('an already-aborted signal costs nothing and leaves nothing behind', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(provider.build(kjvSource, undefined, controller.signal)).rejects.toBeInstanceOf(
        SidecarIndexBuildAbortedError
      );

      expect(fs.readdirSync(indexDir)).toEqual([]);
      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');
    });

    it('a previously-built index survives an aborted rebuild', async () => {
      await provider.build(sample(kjvSource, 1000));
      const before = await searchOnce(provider, kjvTarget, LOVE);

      const controller = new AbortController();
      let batches = 0;
      await expect(
        provider.build(
          kjvSource,
          () => {
            batches += 1;
            if (batches === 1) controller.abort();
          },
          controller.signal
        )
      ).rejects.toBeInstanceOf(SidecarIndexBuildAbortedError);

      // The rebuild only ever wrote to the `.part`, so the previous index is
      // untouched and still answers.
      expect((await provider.status(kjvTarget)).state).toBe('ready');
      expect((await searchOnce(provider, kjvTarget, LOVE)).map((hit) => hit.rowId)).toEqual(
        before.map((hit) => hit.rowId)
      );
    });
  });

  // =========================================================================
  // 6. Subset search
  // =========================================================================
  describe('subset search', () => {
    it('options.targets naming one of two open indexes returns only that one', async () => {
      await provider.build(sample(kjvSource, 1000));
      await provider.build(sample(barnesSource, 300));

      const index = await provider.open([kjvTarget, barnesTarget]);
      const both = await index.search(LOVE, { targets: [] });
      const onlyKjv = await index.search(LOVE, { targets: [kjvTarget] });
      index.close();

      expect(both.hits.some((hit) => hit.target.moduleUuid === barnesTarget.moduleUuid)).toBe(true);
      expect(onlyKjv.hits.length).toBeGreaterThan(0);
      expect(onlyKjv.hits.every((hit) => hit.target.moduleUuid === kjvTarget.moduleUuid)).toBe(true);
    });

    it('a per-module index never leaks another module rows', async () => {
      await provider.build(sample(kjvSource, 1000));

      const index = await provider.open([kjvTarget]);
      const response = await index.search(LOVE, { targets: [kjvTarget, barnesTarget] });
      index.close();

      expect(response.hits.every((hit) => hit.target.moduleUuid === kjvTarget.moduleUuid)).toBe(true);
    });

    it('reports an unbuilt target as skipped rather than returning nothing silently', async () => {
      await provider.build(sample(kjvSource, 1000));

      const index = await provider.open([kjvTarget, barnesTarget]);
      const response = await index.search(LOVE, { targets: [] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
      expect(response.skipped).toEqual([
        { target: barnesTarget, reason: { state: 'unbuilt', providerId: 'sidecar-fts5' } },
      ]);
    });
  });

  // =========================================================================
  // 7. Stable ordering
  // =========================================================================
  it('returns the same hits in the same order for the same query', async () => {
    await provider.build(sample(kjvSource, 2000));

    const index = await provider.open([kjvTarget]);
    const first = await index.search(LOVE, { targets: [kjvTarget] });
    const second = await index.search(LOVE, { targets: [kjvTarget] });
    index.close();

    expect(second.hits).toEqual(first.hits);
    // Ordered by document rowid, which for verse-addressed content is Bible
    // order - see SIDECAR_FTS5_FEATURES on why not bm25.
    const ids = first.hits.map((hit) => hit.rowId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  // =========================================================================
  // 8. Staleness
  // =========================================================================
  describe('staleness', () => {
    it('reports stale when the index was built with a different tokenizer', async () => {
      await provider.build(sample(kjvSource, 1000));
      rewriteMeta(provider.kwiPathFor(kjvTarget), KWI_META_KEYS.tokenizer, 'unicode61');

      expect(await provider.status(kjvTarget)).toEqual({
        state: 'stale',
        providerId: 'sidecar-fts5',
        builtFor: kjvTarget.contentSha256,
      });
    });

    it('reports stale when the index was built by an older builder', async () => {
      await provider.build(sample(kjvSource, 1000));
      rewriteMeta(provider.kwiPathFor(kjvTarget), KWI_META_KEYS.builder, '0.9.0');

      expect((await provider.status(kjvTarget)).state).toBe('stale');
    });

    it('reports stale when a 12-character filename prefix hides a different digest', async () => {
      await provider.build(sample(kjvSource, 1000));
      rewriteMeta(
        provider.kwiPathFor(kjvTarget),
        KWI_META_KEYS.contentSha256,
        kjvTarget.contentSha256.slice(0, 12) + 'f'.repeat(52)
      );

      expect((await provider.status(kjvTarget)).state).toBe('stale');
    });

    it('a stale index is still searchable - degrade, never go silent', async () => {
      await provider.build(sample(kjvSource, 2000));
      const before = await searchOnce(provider, kjvTarget, LOVE);
      rewriteMeta(provider.kwiPathFor(kjvTarget), KWI_META_KEYS.tokenizer, 'unicode61');

      const index = await provider.open([kjvTarget]);
      const response = await index.search(LOVE, { targets: [kjvTarget] });
      index.close();

      expect(response.skipped).toEqual([]);
      expect(response.hits.map((hit) => hit.rowId)).toEqual(before.map((hit) => hit.rowId));
    });

    it('rebuilding in place clears the staleness and restores the current tokenizer', async () => {
      const source = sample(kjvSource, 1000);
      await provider.build(source);
      rewriteMeta(provider.kwiPathFor(kjvTarget), KWI_META_KEYS.tokenizer, 'unicode61');
      expect((await provider.status(kjvTarget)).state).toBe('stale');

      await provider.build(source);

      expect((await provider.status(kjvTarget)).state).toBe('ready');
      expect(readMeta(provider.kwiPathFor(kjvTarget)).get(KWI_META_KEYS.tokenizer)).toBe(SIDECAR_TOKENIZER);
      expect(fs.readdirSync(indexDir)).toHaveLength(1);
    });
  });

  // =========================================================================
  // 9. Corrupt / unreadable index
  // =========================================================================
  describe('a corrupt index', () => {
    it('reports unbuilt and deletes the file when the bytes are not a database', async () => {
      await provider.build(sample(kjvSource, 500));
      const kwiPath = provider.kwiPathFor(kjvTarget);
      fs.writeFileSync(kwiPath, 'this is not an SQLite database at all');

      expect(await provider.status(kjvTarget)).toEqual({ state: 'unbuilt', providerId: 'sidecar-fts5' });
      expect(fs.existsSync(kwiPath)).toBe(false);
    });

    it('reports unbuilt and deletes the file when it is truncated mid-database', async () => {
      await provider.build(sample(kjvSource, 2000));
      const kwiPath = provider.kwiPathFor(kjvTarget);
      fs.truncateSync(kwiPath, 4096);

      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');
      expect(fs.existsSync(kwiPath)).toBe(false);
    });

    it('reports unbuilt when kwi_meta is missing its rows', async () => {
      await provider.build(sample(kjvSource, 500));
      const kwiPath = provider.kwiPathFor(kjvTarget);
      const db = openTestSidecarDatabase(kwiPath, { readonly: false, create: false });
      db.execute('DELETE FROM kwi_meta');
      db.close();

      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');
      expect(fs.existsSync(kwiPath)).toBe(false);
    });

    it('a rebuild after the corrupt file is cleaned up works', async () => {
      await provider.build(sample(kjvSource, 2000));
      fs.writeFileSync(provider.kwiPathFor(kjvTarget), 'garbage');
      await provider.status(kjvTarget);

      await provider.build(sample(kjvSource, 2000));

      expect((await provider.status(kjvTarget)).state).toBe('ready');
      expect((await searchOnce(provider, kjvTarget, LOVE)).length).toBeGreaterThan(0);
    });

    it('open() skips a corrupt index instead of throwing', async () => {
      await provider.build(sample(kjvSource, 500));
      fs.writeFileSync(provider.kwiPathFor(kjvTarget), 'garbage');

      const index = await provider.open([kjvTarget]);
      const response = await index.search(LOVE, { targets: [] });
      index.close();

      expect(response.hits).toEqual([]);
      expect(response.skipped).toEqual([
        { target: kjvTarget, reason: { state: 'unbuilt', providerId: 'sidecar-fts5' } },
      ]);
    });
  });

  // =========================================================================
  // 10. A stray .part
  // =========================================================================
  describe('a stray .part from an interrupted build', () => {
    it('is reported unbuilt and is never opened as if it were an index', async () => {
      // A COMPLETE, valid index, sitting under the `.part` name: the file is
      // perfectly readable, and must still count for nothing, because the
      // rename is the only thing that makes an index real.
      await provider.build(sample(kjvSource, 500));
      fs.renameSync(provider.kwiPathFor(kjvTarget), provider.partPathFor(kjvTarget));

      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');

      const index = await provider.open([kjvTarget]);
      const response = await index.search(LOVE, { targets: [] });
      index.close();
      expect(response.hits).toEqual([]);
      expect(response.skipped).toHaveLength(1);
    });

    it('status() leaves a fresh one alone - it may be another process building', async () => {
      const partPath = provider.partPathFor(kjvTarget);
      fs.writeFileSync(partPath, 'in progress');

      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');
      expect(fs.existsSync(partPath)).toBe(true);
    });

    it('status() sweeps one old enough to be a crash leftover', async () => {
      const partPath = provider.partPathFor(kjvTarget);
      fs.writeFileSync(partPath, 'crashed');
      backdate(partPath, 2 * 60 * 60 * 1000);

      expect((await provider.status(kjvTarget)).state).toBe('unbuilt');
      expect(fs.existsSync(partPath)).toBe(false);
    });

    it('honours a configured sweep age', async () => {
      const eager = new SidecarFts5Provider({
        indexDir,
        openDatabase: openTestSidecarDatabase,
        stalePartAgeMs: 0,
      });
      const partPath = eager.partPathFor(kjvTarget);
      fs.writeFileSync(partPath, 'crashed');

      expect((await eager.status(kjvTarget)).state).toBe('unbuilt');
      expect(fs.existsSync(partPath)).toBe(false);
    });

    /**
     * `stalePartAgeMs: 0` makes every `.part` sweepable on sight, so the ONLY
     * thing that can save one here is the in-flight guard. The scans are
     * issued from the progress callback, i.e. genuinely between two batches of
     * a real build. Both `status()` and `pruneExcept()` do their filesystem
     * work in their synchronous prefix, before ever yielding, so by the time
     * the next line runs the sweep has already had its chance; their promises
     * are settled afterwards purely to keep the test tidy.
     */
    it('never sweeps the .part of a build this instance is running', async () => {
      const eager = new SidecarFts5Provider({
        indexDir,
        openDatabase: openTestSidecarDatabase,
        stalePartAgeMs: 0,
      });
      const partPath = eager.partPathFor(kjvTarget);
      const survived: boolean[] = [];
      const scans: Array<Promise<unknown>> = [];

      await eager.build(sample(kjvSource, 5000), () => {
        scans.push(eager.status(kjvTarget), eager.pruneExcept([kjvTarget]));
        survived.push(fs.existsSync(partPath));
      });
      await Promise.all(scans);

      expect(survived.length).toBeGreaterThan(1);
      expect(survived.every(Boolean)).toBe(true);
      expect((await eager.status(kjvTarget)).state).toBe('ready');
    });
  });

  // =========================================================================
  // 11. The schema: no columnsize=0
  // =========================================================================
  describe('the .kwi schema', () => {
    it('does not set columnsize=0', () => {
      expect(SIDECAR_SCHEMA_SQL).not.toMatch(/columnsize/iu);
      expect(SIDECAR_SCHEMA_SQL).toMatch(/contentless_delete\s*=\s*1/u);
      expect(SIDECAR_SCHEMA_SQL).toContain(`tokenize = '${SIDECAR_TOKENIZER}'`);
    });

    /**
     * The design doc's measured warning, checked against what was actually
     * built: with `columnsize=0` these calls fail with SQLite's "malformed"
     * error. Here they must succeed and simply return NULL, because the index
     * is contentless and has no text to quote - which is exactly why
     * `snippetFromIndex` is false and why F7 needs its own transient table.
     */
    it('snippet() and highlight() return NULL rather than raising "malformed"', async () => {
      await provider.build(sample(kjvSource, 500));
      const db = openTestSidecarDatabase(provider.kwiPathFor(kjvTarget), { readonly: true, create: false });
      try {
        const row = db.queryOne<{ s: string | null; h: string | null }>(
          `SELECT snippet(kw, 0, '[', ']', '...', 8) AS s, highlight(kw, 0, '[', ']') AS h
             FROM kw WHERE kw MATCH ? LIMIT 1`,
          ['god']
        );
        expect(row).toBeDefined();
        expect(row!.s).toBeNull();
        expect(row!.h).toBeNull();
      } finally {
        db.close();
      }
    });

    it('kw.rowid and kw_doc.doc_id are the same number for every row', async () => {
      await provider.build(sample(kjvSource, 1000));
      const db = openTestSidecarDatabase(provider.kwiPathFor(kjvTarget), { readonly: true, create: false });
      try {
        const mismatched = db.queryOne<{ c: number }>(
          'SELECT COUNT(*) AS c FROM kw_doc WHERE doc_id != source_rowid'
        );
        const orphans = db.queryOne<{ c: number }>(
          'SELECT COUNT(*) AS c FROM kw_doc d WHERE NOT EXISTS (SELECT 1 FROM kw WHERE kw.rowid = d.doc_id)'
        );
        expect(mismatched?.c).toBe(0);
        expect(orphans?.c).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  // =========================================================================
  // Build failures and the 'failed' state
  // =========================================================================
  describe('a build that cannot run', () => {
    it('throws and then reports failed when the index directory does not exist', async () => {
      const missing = path.join(indexDir, 'no-such-dir');
      const broken = new SidecarFts5Provider({ indexDir: missing, openDatabase: openTestSidecarDatabase });

      await expect(broken.build(sample(kjvSource, 100))).rejects.toThrow(SidecarIndexBuildError);

      const capability = await broken.status(kjvTarget);
      expect(capability.state).toBe('failed');
      expect(capability).toMatchObject({ providerId: 'sidecar-fts5' });
      expect((capability as { reason: string }).reason).toContain('does not exist');
    });

    it('throws when the index directory is a file', async () => {
      const notADir = path.join(indexDir, 'a-file');
      fs.writeFileSync(notADir, 'x');
      const broken = new SidecarFts5Provider({ indexDir: notADir, openDatabase: openTestSidecarDatabase });

      await expect(broken.build(sample(kjvSource, 100))).rejects.toThrow(/not a directory/u);
    });

    // Running as root defeats the permission bits entirely, so this one is
    // only meaningful as an ordinary user - and Windows ignores a directory's
    // mode bits for writes, so chmod cannot make one read-only there at all.
    it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
      'throws and reports failed when the index directory is not writable',
      async () => {
        const readOnlyDir = path.join(indexDir, 'read-only');
        fs.mkdirSync(readOnlyDir);
        fs.chmodSync(readOnlyDir, 0o500);
        const broken = new SidecarFts5Provider({
          indexDir: readOnlyDir,
          openDatabase: openTestSidecarDatabase,
        });

        try {
          await expect(broken.build(sample(kjvSource, 100))).rejects.toThrow(/not writable/u);
          expect((await broken.status(kjvTarget)).state).toBe('failed');
        } finally {
          fs.chmodSync(readOnlyDir, 0o700);
        }
      }
    );

    it('refuses a target it cannot address, naming the reason', async () => {
      const noDigest = { ...sample(kjvSource, 100), target: { ...kjvTarget, contentSha256: '' } };
      await expect(provider.build(noDigest)).rejects.toThrow(/contentSha256 is empty/u);
    });

    it('a later successful build clears the failed state', async () => {
      const laterDir = path.join(indexDir, 'appears-later');
      const recovering = new SidecarFts5Provider({
        indexDir: laterDir,
        openDatabase: openTestSidecarDatabase,
      });

      await expect(recovering.build(sample(kjvSource, 100))).rejects.toThrow(SidecarIndexBuildError);
      expect((await recovering.status(kjvTarget)).state).toBe('failed');

      fs.mkdirSync(laterDir);
      await recovering.build(sample(kjvSource, 100));

      expect((await recovering.status(kjvTarget)).state).toBe('ready');
    });

    it('prune() clears the failed state too', async () => {
      const missing = path.join(indexDir, 'no-such-dir');
      const broken = new SidecarFts5Provider({ indexDir: missing, openDatabase: openTestSidecarDatabase });
      await expect(broken.build(sample(kjvSource, 100))).rejects.toThrow(SidecarIndexBuildError);
      expect((await broken.status(kjvTarget)).state).toBe('failed');

      await broken.prune(kjvTarget);

      expect((await broken.status(kjvTarget)).state).toBe('unbuilt');
    });

    /**
     * `failed` is remembered per provider instance, never written to disk -
     * the durable home for it is `main.db`'s `keyword_index` table, which is
     * F8's to write. A fresh instance therefore reports `unbuilt` again, which
     * is the right default while that wiring does not exist.
     */
    it('is forgotten by a new provider instance - failed is in-process only', async () => {
      const missing = path.join(indexDir, 'no-such-dir');
      const broken = new SidecarFts5Provider({ indexDir: missing, openDatabase: openTestSidecarDatabase });
      await expect(broken.build(sample(kjvSource, 100))).rejects.toThrow(SidecarIndexBuildError);
      expect((await broken.status(kjvTarget)).state).toBe('failed');

      const fresh = new SidecarFts5Provider({ indexDir: missing, openDatabase: openTestSidecarDatabase });
      expect((await fresh.status(kjvTarget)).state).toBe('unbuilt');
    });

    it('an index that is on disk and current beats a remembered failure', async () => {
      await provider.build(sample(kjvSource, 2000));
      // A rebuild that fails leaves the previous index intact, because it only
      // ever writes to the `.part`.
      const broken: IIndexSource = {
        target: kjvTarget,
        count: () => 1,
        documents: function* () {
          yield { rowId: 1, text: 'fine' };
          throw new Error('source blew up mid-stream');
        },
      };

      await expect(provider.build(broken)).rejects.toThrow(SidecarIndexBuildError);

      expect(fs.existsSync(provider.partPathFor(kjvTarget))).toBe(false);
      expect((await provider.status(kjvTarget)).state).toBe('ready');
      expect((await searchOnce(provider, kjvTarget, LOVE)).length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Search behaviour: limits, scope, empty queries, close()
  // =========================================================================
  describe('search()', () => {
    it('honours limit and reports truncation', async () => {
      await provider.build(sample(kjvSource, 2000));

      const index = await provider.open([kjvTarget]);
      const limited = await index.search(LOVE, { targets: [kjvTarget], limit: 3 });
      const all = await index.search(LOVE, { targets: [kjvTarget] });
      index.close();

      expect(limited.hits).toHaveLength(3);
      expect(limited.truncated).toBe(true);
      expect(all.hits.length).toBeGreaterThan(3);
      expect(all.truncated).toBe(false);
    });

    it('pushes a passage scope down to the index for content that has ranges', async () => {
      await provider.build(barnesSource);

      const index = await provider.open([barnesTarget]);
      // Barnes covers Matthew (40) to Revelation (66); scope to John alone.
      const john = await index.search(LOVE, {
        targets: [barnesTarget],
        scope: [{ startVerseId: 43001001, endVerseId: 43022021 }],
      });
      const everywhere = await index.search(LOVE, { targets: [barnesTarget] });
      index.close();

      expect(john.hits.length).toBeGreaterThan(0);
      expect(john.hits.length).toBeLessThan(everywhere.hits.length);
      for (const hit of john.hits) {
        expect(hit.startVerseId).toBeGreaterThanOrEqual(43001001);
        expect(hit.startVerseId).toBeLessThanOrEqual(43022021);
      }
    });

    /**
     * The other half of the scope contract, and the one that matters most
     * here. A document the index cannot place - every Bible verse today, since
     * `CONTENT_MAP['bible']` declares no `range` - must be RETURNED, not
     * silently dropped. `KeywordSearchOptions.scope` is documented as "pushed
     * down where a provider can; filtered after where it cannot", and a
     * confident empty answer is exactly the failure this provider is built to
     * avoid.
     */
    it('returns rather than drops documents it cannot place in a passage scope', async () => {
      await provider.build(sample(kjvSource, 2000));

      const index = await provider.open([kjvTarget]);
      const scoped = await index.search(LOVE, {
        targets: [kjvTarget],
        scope: [{ startVerseId: 43001001, endVerseId: 43022021 }],
      });
      const unscoped = await index.search(LOVE, { targets: [kjvTarget] });
      index.close();

      expect(unscoped.hits.length).toBeGreaterThan(0);
      expect(scoped.hits.map((hit) => hit.rowId)).toEqual(unscoped.hits.map((hit) => hit.rowId));
    });

    it('a boolean query with no FTS5 equivalent is zero results, not a failure', async () => {
      await provider.build(sample(kjvSource, 500));

      const index = await provider.open([kjvTarget]);
      const response = await index.search(
        { kind: 'boolean', expr: { operator: 'NOT', left: 'evil' } },
        { targets: [kjvTarget] }
      );
      index.close();

      expect(response.hits).toEqual([]);
      expect(response.skipped).toEqual([]);
    });

    it('compiles phrase, prefix and boolean queries against the real index', async () => {
      await provider.build(sample(kjvSource, 2000));
      const index = await provider.open([kjvTarget]);
      try {
        expect((await index.search({ kind: 'phrase', phrase: 'the earth' }, { targets: [] })).hits.length)
          .toBeGreaterThan(0);
        expect((await index.search({ kind: 'prefix', stem: 'begin' }, { targets: [] })).hits.length)
          .toBeGreaterThan(0);
        expect(
          (
            await index.search(
              { kind: 'boolean', expr: { operator: 'AND', left: 'light', right: 'darkness' } },
              { targets: [] }
            )
          ).hits.length
        ).toBeGreaterThan(0);
      } finally {
        index.close();
      }
    });

    /**
     * M3's `close()` is a documented no-op (it never opened anything). This
     * provider owns real file handles, so `close()` has to do real work - and
     * the way to prove it did is that the index stops answering afterwards,
     * degrading to `skipped` rather than throwing out of the registry's
     * `finally`.
     */
    it('close() really closes the files it opened', async () => {
      await provider.build(sample(kjvSource, 2000));

      const index = await provider.open([kjvTarget]);
      expect((await index.search(LOVE, { targets: [] })).hits.length).toBeGreaterThan(0);

      index.close();

      const afterClose = await index.search(LOVE, { targets: [] });
      expect(afterClose.hits).toEqual([]);
      expect(afterClose.skipped).toEqual([
        { target: kjvTarget, reason: { state: 'unbuilt', providerId: 'sidecar-fts5' } },
      ]);

      // Closing twice must not throw either - KeywordIndexRegistry calls
      // close() from a `finally`.
      expect(() => index.close()).not.toThrow();
    });
  });
});

/** Open, search, close - the three-line shape half the tests above need. */
async function searchOnce(provider: SidecarFts5Provider, target: IndexTarget, query: KeywordQuery) {
  const index = await provider.open([target]);
  try {
    return (await index.search(query, { targets: [target] })).hits;
  } finally {
    index.close();
  }
}

/** Push a file's mtime back, so an age-based sweep sees it as old. */
function backdate(filePath: string, byMs: number): void {
  const when = new Date(Date.now() - byMs);
  fs.utimesSync(filePath, when, when);
}
