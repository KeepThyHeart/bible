/**
 * Wires the shared {@link runKeywordIndexProviderContract} suite (M4) up
 * against `SidecarFts5Provider` (task 0027, subtask F6) - the first provider
 * to run it with `supportsBuildLifecycle: true`.
 *
 * That flag is the point of this file. Three of the contract's bullets could
 * only ever be skipped for `InModuleFts5Provider`, whose `build()` always
 * throws and whose `prune()` is a documented no-op:
 *
 *   2. "build() called twice does not corrupt state"
 *   3. "status() reports unbuilt after prune() of a built target"
 *   5. "aborting build() leaves status() unbuilt, never ready"
 *
 * Against this provider all three are real, executed assertions over real
 * files: a `.kwi` built from a real module, replaced by a second build, then
 * deleted from disk by `prune()`, and a build refused outright by an aborted
 * signal. M4's file-level doc comment anticipated exactly this - "a later
 * build-capable provider (M6's sidecar-fts5) sets `supportsBuildLifecycle:
 * true` and supplies `buildFixture()`, and gets full, real coverage for both
 * bullets with no changes to this file" - and no change to that file was in
 * fact needed.
 *
 * `SidecarFts5Provider.test.ts` holds this provider's own, much longer
 * state-machine suite (staleness, corruption, stray `.part` files, failure
 * reporting). This file runs only the provider-neutral contract.
 *
 * ## Fixture choices
 *
 * - **A fresh index directory per provider instance.** `createProvider()` is
 *   called once per contract test, and each call gets its own `mkdtemp`
 *   directory. Sharing one would let bullet 2's rebuilt index survive into
 *   bullet 5, where a leftover `.kwi` would make an aborted build's target
 *   look `ready` - a test that passes or fails on execution order is worse
 *   than no test.
 * - **`buildFixture()` uses a target `supportedTarget()` never touches.** The
 *   contract documents that requirement; here it is the KJV module's content
 *   under a second, distinct content digest, which is a genuinely different
 *   `.kwi` filename.
 * - **`unsupportedTarget()` is a target with no content digest.** For a
 *   build-capable provider, "unsupported" cannot mean "not built yet" -
 *   `supports()` has to say yes to an unbuilt module or nothing could ever
 *   build one. What this provider genuinely cannot address is a target with
 *   no `content_sha256`, since the digest IS the index's filename key; see
 *   `SidecarFts5Provider.unsupportedReason`.
 */

import { describe, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TestSqliteProvider } from '../../../__tests__/helpers/TestSqliteProvider';
import { openTestSidecarDatabase } from '../../../__tests__/helpers/TestSidecarDatabase';
import { moduleDb, testDataAvailable } from '../../../__tests__/helpers/testData';
import { BibleRepository } from '../../Repositories/BibleRepository';
import { CommentaryRepository } from '../../Repositories/CommentaryRepository';
import { RuntimeEnvironment } from '../IKeywordIndexProvider';
import { IIndexSource, IndexDocument, IndexTarget, KeywordQuery } from '../KeywordTypes';
import { ProviderContractFixture, runKeywordIndexProviderContract } from '../KeywordIndexProviderContract';
import { SidecarFts5Provider } from './SidecarFts5Provider';

const KJV_DB_PATH = moduleDb('bible_kjv.db');
const BARNES_DB_PATH = moduleDb('commentary_barnes.db');

const DATA_AVAILABLE = testDataAvailable(
  'SidecarFts5Provider contract (bible_kjv.db + commentary_barnes.db)',
  KJV_DB_PATH,
  BARNES_DB_PATH
);

const ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: false },
  codecs: new Set(['none']),
  // Non-null: this provider refuses an environment with no writable
  // derived-data location. Each provider instance is configured with its own
  // real directory below; this field is the environment's assertion that such
  // a location exists at all.
  indexDir: os.tmpdir(),
};

/** Matches many verses in the KJV and many entries in Barnes. */
const MULTI_HIT_QUERY: KeywordQuery = { kind: 'terms', terms: ['love'], all: false };

/** The first `max` documents of a real source - real content, quicker builds. */
function sample(source: IIndexSource, max: number, target?: IndexTarget): IIndexSource {
  return {
    target: target ?? source.target,
    count: () => Math.min(source.count(), max),
    documents: function* (): Iterable<IndexDocument> {
      let taken = 0;
      for (const document of source.documents()) {
        if (taken >= max) return;
        taken += 1;
        yield document;
      }
    },
  };
}

describe.skipIf(!DATA_AVAILABLE)('SidecarFts5Provider contract wiring', () => {
  let kjvDb: TestSqliteProvider;
  let barnesDb: TestSqliteProvider;
  let kjvSource: IIndexSource;
  let barnesSource: IIndexSource;

  const indexDirs: string[] = [];

  beforeAll(() => {
    kjvDb = new TestSqliteProvider(KJV_DB_PATH, { readonly: true, fileMustExist: true });
    barnesDb = new TestSqliteProvider(BARNES_DB_PATH, { readonly: true, fileMustExist: true });
    kjvSource = new BibleRepository(kjvDb).getIndexSource();
    barnesSource = new CommentaryRepository(barnesDb).getIndexSource();
  });

  afterAll(() => {
    kjvDb.close();
    barnesDb.close();
    for (const dir of indexDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A second revision of the KJV module: same content, a different digest. */
  function rebuiltKjvTarget(): IndexTarget {
    return { ...kjvSource.target, contentSha256: 'c0ffee'.repeat(10) + 'abcd' };
  }

  const fixture: ProviderContractFixture = {
    createProvider: () => {
      const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwi-contract-'));
      indexDirs.push(indexDir);
      return new SidecarFts5Provider({ indexDir, openDatabase: openTestSidecarDatabase });
    },

    supportedTarget: () => ({
      target: kjvSource.target,
      // For a build-capable provider, "make this target supported and ready"
      // IS a build - which is what the contract's `setup` hook exists for.
      setup: (provider) => provider.build(sample(kjvSource, 2000)),
    }),

    secondSupportedTarget: () => ({
      target: barnesSource.target,
      setup: (provider) => provider.build(sample(barnesSource, 500)),
    }),

    unsupportedTarget: () => ({ ...kjvSource.target, contentSha256: '' }),

    multiHitQuery: () => MULTI_HIT_QUERY,

    supportsBuildLifecycle: true,

    buildFixture: () => {
      const target = rebuiltKjvTarget();
      return { target, source: sample(kjvSource, 2000, target) };
    },

    env: ENV,
  };

  runKeywordIndexProviderContract('SidecarFts5Provider', fixture);
});
