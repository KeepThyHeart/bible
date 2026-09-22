/**
 * Wires the shared {@link runKeywordIndexProviderContract} suite (M4) up
 * against `InModuleFts5Provider` (M3). See `../KeywordIndexProviderContract.ts`
 * for the shared test bodies and the file-level doc comment there for how
 * the two build-lifecycle bullets (rebuild-idempotent, aborted-build) and
 * the prune()-then-status() bullet are handled for a provider whose
 * `build()` always throws and whose `prune()` is a documented no-op.
 *
 * This is deliberately a SEPARATE file from `InModuleFts5Provider.test.ts`
 * (M3's own hand-written unit tests for `supports`/`status`/`open`/`build`/
 * `prune` individually): that file tests this provider's own behaviour in
 * detail, this one runs the provider-neutral contract every
 * `IKeywordIndexProvider` must satisfy, against this one concrete provider.
 *
 * Backed by two real, distinct modules (`bible_kjv.db` and `bible_asv.db`
 * from `data/modules/`) rather than the same module opened twice, so the
 * subset-search bullet (6) is a genuine two-module assertion.
 */

import { describe, beforeAll, afterAll } from 'vitest';
import { InModuleFts5Provider } from './InModuleFts5Provider';
import { TestSqliteProvider } from '../../../__tests__/helpers/TestSqliteProvider';
import { moduleDb, testDataAvailable } from '../../../__tests__/helpers/testData';
import { BibleRepository } from '../../Repositories/BibleRepository';
import { IBibleRepository } from '../../Repositories/IBibleRepository';
import { IndexTarget, KeywordQuery } from '../KeywordTypes';
import { RuntimeEnvironment } from '../IKeywordIndexProvider';
import { runKeywordIndexProviderContract, ProviderContractFixture } from '../KeywordIndexProviderContract';

const KJV_DB_PATH = moduleDb('bible_kjv.db');
const ASV_DB_PATH = moduleDb('bible_asv.db');

// Gated so a checkout without module data skips with a warning rather than
// erroring in beforeAll - see __tests__/helpers/testData.ts, same posture
// as InModuleFts5Provider.test.ts.
const DATA_AVAILABLE = testDataAvailable(
  'InModuleFts5Provider contract (bible_kjv.db + bible_asv.db)',
  KJV_DB_PATH,
  ASV_DB_PATH
);

const ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: false },
  codecs: new Set(),
  indexDir: null,
};

function target(moduleUuid: string): IndexTarget {
  return { moduleUuid, moduleType: 'bible', contentSha256: `sha-${moduleUuid}` };
}

/** A query that matches many verses in both KJV and ASV - for multi-hit and subset-search assertions. */
const MULTI_HIT_QUERY: KeywordQuery = { kind: 'terms', terms: ['love'], all: false };

describe.skipIf(!DATA_AVAILABLE)('InModuleFts5Provider contract wiring', () => {
  let kjvProvider: TestSqliteProvider;
  let asvProvider: TestSqliteProvider;
  let kjvRepo: IBibleRepository;
  let asvRepo: IBibleRepository;

  beforeAll(() => {
    kjvProvider = new TestSqliteProvider(KJV_DB_PATH, { readonly: true, fileMustExist: true });
    asvProvider = new TestSqliteProvider(ASV_DB_PATH, { readonly: true, fileMustExist: true });
    kjvRepo = new BibleRepository(kjvProvider);
    asvRepo = new BibleRepository(asvProvider);
  });

  afterAll(() => {
    kjvProvider.close();
    asvProvider.close();
  });

  const fixture: ProviderContractFixture = {
    createProvider: () => new InModuleFts5Provider(),

    supportedTarget: () => {
      const t = target('kjv');
      return {
        target: t,
        setup: (provider) => {
          (provider as InModuleFts5Provider).register(t, kjvRepo);
        },
      };
    },

    secondSupportedTarget: () => {
      const t = target('asv');
      return {
        target: t,
        setup: (provider) => {
          (provider as InModuleFts5Provider).register(t, asvRepo);
        },
      };
    },

    unsupportedTarget: () => target('never-registered'),

    multiHitQuery: () => MULTI_HIT_QUERY,

    // InModuleFts5Provider.build() always throws (in-module FTS5 tables ship
    // inside the module file and are never built by this provider at
    // runtime - see InModuleFts5Provider.ts's own doc comment), and
    // prune()/pruneExcept() are documented no-ops for the same reason. Both
    // build-lifecycle bullets (2, 5) are therefore inapplicable here; bullet
    // 3 takes its "documented exception" branch instead of its
    // build-capable one.
    supportsBuildLifecycle: false,

    env: ENV,
  };

  runKeywordIndexProviderContract('InModuleFts5Provider', fixture);
});
