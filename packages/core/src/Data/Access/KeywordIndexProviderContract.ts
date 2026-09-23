/**
 * KeywordIndexProviderContract
 *
 * A parameterised suite every {@link IKeywordIndexProvider} implementation
 * must pass (task 0026, revision 2, subtask M4). This file exports the
 * shared test BODIES only - {@link runKeywordIndexProviderContract} - and is
 * deliberately named `*.ts`, not `*.test.ts`, so it is never picked up
 * directly by vitest's own `include` glob (`src/**\/*.{test,spec}.{js,ts}`,
 * see `vitest.config.ts`). Each provider instead gets its own small
 * `*.test.ts` file (see `Fts5/InModuleFts5Provider.contract.test.ts` for
 * M3's) that builds a {@link ProviderContractFixture} and calls
 * `runKeywordIndexProviderContract(name, fixture)` - THAT call is what
 * registers the suite with vitest, once per provider, with the test bodies
 * themselves written exactly once here.
 *
 * ## The seven contract bullets, and how build-incapable providers fit
 *
 * All seven bullets from the design doc (task 0026 rev 2 §06) are written
 * as real, executable tests below. Two of them - "rebuild is idempotent"
 * and "an aborted build leaves unbuilt, never ready" - only make sense for
 * a provider that actually builds an index at runtime, which not every
 * provider does. `InModuleFts5Provider` (M3) is the first example: its
 * `build()` always throws (see that class's own doc comment - in-module
 * FTS5 tables ship inside the module file and are never built by this
 * provider at runtime), so there is no in-progress build to rebuild or
 * abort. Those two tests are guarded behind `fixture.supportsBuildLifecycle`
 * and are SKIPPED - visibly, by name, in the test run - for a provider like
 * M3's where they do not apply, rather than silently vanishing or being
 * forced to pass against a fake. A later build-capable provider (M6's
 * sidecar-fts5, M12's shared-fts5) sets `supportsBuildLifecycle: true` and
 * supplies `buildFixture()`, and gets full, real coverage for both bullets
 * with no changes to this file.
 *
 * The "prune() then status() is unbuilt" bullet is subtler: it is not
 * simply inapplicable to a non-build-capable provider, it is
 * *documented-false* for one. `InModuleFts5Provider.prune()` is an
 * intentional no-op (there is no separate on-disk artifact for it to
 * remove), so status is unchanged, not `unbuilt`, after pruning. Both
 * outcomes are real, asserted tests below (mutually exclusive via
 * `supportsBuildLifecycle`), not a skip - this bullet's correct behaviour
 * genuinely differs by provider, and each branch documents why.
 */

import { describe, it, expect } from 'vitest';
import { IKeywordIndexProvider, RuntimeEnvironment } from './IKeywordIndexProvider';
import { KeywordIndexRegistry } from './KeywordIndexRegistry';
import { IndexTarget, IIndexSource, KeywordQuery } from './KeywordTypes';

/** A registered/ready target plus however this provider makes it so. */
export interface ProviderContractTarget {
  target: IndexTarget;
  /**
   * Whatever registration or build step makes `target` supported (and, for
   * a build-capable provider, ready) on the given provider instance.
   * Provider-specific by design - `InModuleFts5Provider`'s is `register()`,
   * a sidecar/shared-index provider's might be `build()` - which is exactly
   * why this is a fixture method rather than something the shared test
   * bodies below assume.
   */
  setup: (provider: IKeywordIndexProvider) => Promise<void> | void;
}

/** A target + {@link IIndexSource} pair for the build()-lifecycle bullets (2, 5). */
export interface ProviderBuildFixture {
  target: IndexTarget;
  source: IIndexSource;
}

export interface ProviderContractFixture {
  /** A fresh provider instance for this test run. */
  createProvider(): IKeywordIndexProvider;
  /** A target this provider CAN answer for, backed by real data. */
  supportedTarget(): ProviderContractTarget;
  /**
   * A second, independently-supported target, for the subset-search bullet
   * (6). May be a second real module, or the same module registered under a
   * second `IndexTarget` - either is a legitimate choice for a given
   * provider; the point of the bullet is two distinct provider-recognised
   * targets, not necessarily two different underlying databases.
   */
  secondSupportedTarget(): ProviderContractTarget;
  /** A target this provider CANNOT answer for (never registered/built). */
  unsupportedTarget(): IndexTarget;
  /** A query guaranteed to match >= 2 results against `supportedTarget()`'s real data. */
  multiHitQuery(): KeywordQuery;
  /**
   * False when `build()`/`prune()` are not meaningfully testable for this
   * provider (e.g. `InModuleFts5Provider`, whose `build()` always throws and
   * whose `prune()` is a documented no-op). Gates bullets 2, 3's
   * build-capable branch, and 5.
   */
  supportsBuildLifecycle: boolean;
  /**
   * Required when `supportsBuildLifecycle` is true: a target + source pair
   * that `build()` can build from scratch (i.e. NOT already set up by
   * `supportedTarget()`). Unused, and may be omitted, when
   * `supportsBuildLifecycle` is false.
   */
  buildFixture?(): ProviderBuildFixture;
  /** Runtime env passed to `supports()` and the registry. A generic default is used when omitted. */
  env?: RuntimeEnvironment;
}

const DEFAULT_ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: true },
  codecs: new Set(['none']),
  indexDir: null,
};

export function runKeywordIndexProviderContract(name: string, fixture: ProviderContractFixture): void {
  const env = fixture.env ?? DEFAULT_ENV;

  describe(`IKeywordIndexProvider contract: ${name}`, () => {
    // ------------------------------------------------------------------
    // 1. "build then search". The SEARCH half applies to every provider,
    // build-capable or not, and is the real test below. The BUILD half
    // only makes sense once something was actually built at runtime - that
    // is exercised by bullets 2 and 5, both gated on
    // `supportsBuildLifecycle`, rather than duplicated here.
    // ------------------------------------------------------------------
    describe('search on a supported target', () => {
      it('returns real hits for a query guaranteed to match', async () => {
        const provider = fixture.createProvider();
        const { target, setup } = fixture.supportedTarget();
        await setup(provider);

        const index = await provider.open([target]);
        const response = await index.search(fixture.multiHitQuery(), { targets: [target] });
        index.close();

        expect(response.hits.length).toBeGreaterThanOrEqual(2);
        expect(response.hits.every((h) => h.target.moduleUuid === target.moduleUuid)).toBe(true);
        expect(response.skipped).toEqual([]);
      });
    });

    // ------------------------------------------------------------------
    // 2. "rebuild is idempotent" - see file-level doc comment. Only
    // exercisable for a build-capable provider.
    // ------------------------------------------------------------------
    it.skipIf(!fixture.supportsBuildLifecycle)(
      'build() called twice does not corrupt state - the same queryable result comes back both times',
      async () => {
        const provider = fixture.createProvider();
        const { target, source } = fixture.buildFixture!();

        await provider.build(source);
        const index1 = await provider.open([target]);
        const first = await index1.search(fixture.multiHitQuery(), { targets: [target] });
        index1.close();

        await provider.build(source);
        const index2 = await provider.open([target]);
        const second = await index2.search(fixture.multiHitQuery(), { targets: [target] });
        index2.close();

        expect(second.hits.map((h) => h.rowId)).toEqual(first.hits.map((h) => h.rowId));
      }
    );

    // ------------------------------------------------------------------
    // 3. "prune() then status() is unbuilt" - see file-level doc comment.
    // Both branches are real, asserted tests; exactly one runs for a given
    // fixture.
    // ------------------------------------------------------------------
    describe('prune()', () => {
      it.skipIf(!fixture.supportsBuildLifecycle)(
        'status() reports unbuilt after prune() of a built target',
        async () => {
          const provider = fixture.createProvider();
          const { target, source } = fixture.buildFixture!();
          await provider.build(source);

          expect((await provider.status(target)).state).toBe('ready');
          await provider.prune(target);
          expect((await provider.status(target)).state).toBe('unbuilt');
        }
      );

      it.skipIf(fixture.supportsBuildLifecycle)(
        'documented exception: prune() is a no-op, so status() is unchanged (no build-time artifact to remove)',
        async () => {
          const provider = fixture.createProvider();
          const { target, setup } = fixture.supportedTarget();
          await setup(provider);

          const before = await provider.status(target);
          expect(before.state).toBe('ready');

          await provider.prune(target);

          const after = await provider.status(target);
          expect(after).toEqual(before);
        }
      );
    });

    // ------------------------------------------------------------------
    // 4. "unsupported target yields skipped" - applies to every provider.
    // Verified at the KeywordIndexRegistry level: an unsupported target
    // must land in `skipped` with `reason.state === 'unavailable'`, never
    // throw. Also checked directly against `provider.supports()`.
    // ------------------------------------------------------------------
    describe('unsupported target', () => {
      it('provider.supports() is false', () => {
        const provider = fixture.createProvider();
        expect(provider.supports(fixture.unsupportedTarget(), env)).toBe(false);
      });

      it('KeywordIndexRegistry.search() reports it skipped/unavailable, not a throw', async () => {
        const provider = fixture.createProvider();
        const { target: supported, setup } = fixture.supportedTarget();
        await setup(provider);

        const registry = new KeywordIndexRegistry(env);
        registry.register(provider);

        const unsupported = fixture.unsupportedTarget();
        const response = await registry.search(fixture.multiHitQuery(), {
          targets: [supported, unsupported],
        });

        const skip = response.skipped.find((s) => s.target === unsupported);
        expect(skip).toBeDefined();
        expect(skip!.reason.state).toBe('unavailable');
      });
    });

    // ------------------------------------------------------------------
    // 5. "an aborted build leaves unbuilt, never ready" - see file-level
    // doc comment. Only exercisable for a build-capable provider.
    // ------------------------------------------------------------------
    it.skipIf(!fixture.supportsBuildLifecycle)(
      'aborting build() leaves status() unbuilt, never ready',
      async () => {
        const provider = fixture.createProvider();
        const { target, source } = fixture.buildFixture!();
        const controller = new AbortController();
        controller.abort();

        await expect(provider.build(source, undefined, controller.signal)).rejects.toThrow();
        expect((await provider.status(target)).state).not.toBe('ready');
      }
    );

    // ------------------------------------------------------------------
    // 6. "subset search returns hits only from the given targets" -
    // applies to every provider. Registers two independently-supported
    // targets, searches with `options.targets` naming only one, and
    // confirms every returned hit is tagged with that one target.
    // ------------------------------------------------------------------
    it(
      'subset search (options.targets naming one of two supported targets) returns hits only from that target',
      async () => {
        const provider = fixture.createProvider();
        const first = fixture.supportedTarget();
        const second = fixture.secondSupportedTarget();
        await first.setup(provider);
        await second.setup(provider);

        const registry = new KeywordIndexRegistry(env);
        registry.register(provider);

        const response = await registry.search(fixture.multiHitQuery(), { targets: [first.target] });

        expect(response.hits.length).toBeGreaterThan(0);
        expect(response.hits.every((h) => h.target.moduleUuid === first.target.moduleUuid)).toBe(true);
        expect(response.hits.some((h) => h.target.moduleUuid === second.target.moduleUuid)).toBe(false);
      }
    );

    // ------------------------------------------------------------------
    // 7. "rank ordering is stable" - applies regardless of whether the
    // provider reports real relevance ranking or a fixed placeholder
    // (InModuleFts5Provider reports `rank: false` and always returns `0` -
    // see `IN_MODULE_FTS5_FEATURES`). "Stable" here means
    // deterministic/repeatable, not necessarily meaningful.
    // ------------------------------------------------------------------
    it('running the same query twice returns hits in the same order both times', async () => {
      const provider = fixture.createProvider();
      const { target, setup } = fixture.supportedTarget();
      await setup(provider);

      const index = await provider.open([target]);
      const first = await index.search(fixture.multiHitQuery(), { targets: [target] });
      const second = await index.search(fixture.multiHitQuery(), { targets: [target] });
      index.close();

      expect(second.hits.map((h) => ({ rowId: h.rowId, rank: h.rank }))).toEqual(
        first.hits.map((h) => ({ rowId: h.rowId, rank: h.rank }))
      );
    });
  });
}
