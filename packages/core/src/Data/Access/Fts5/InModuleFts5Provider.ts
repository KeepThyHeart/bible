/**
 * InModuleFts5Provider
 *
 * The strangler-step {@link IKeywordIndexProvider} (task 0026, revision 2,
 * subtask M3): wraps today's in-module FTS5 tables (`bible_verse_fts`, and -
 * in a future subtask - `commentary_entry_fts`, etc.) behind the M1 provider
 * contract, without moving anything on disk. Nothing here changes what
 * `bible_verse_fts` contains or how it is queried; it changes WHO executes
 * the query - the registry/provider abstraction, in place of the direct
 * per-module repo calls `BibleSearchService` used to make.
 *
 * ## Scope of this pass
 *
 * Only Bible verse search is implemented (the shape `BibleSearchService`
 * exercises today, via {@link IBibleRepository.searchVersesWithHighlighting}).
 * A commentary/dictionary/etc. equivalent is deferred - see the class doc
 * below for what it would need. The `IKeywordIndexProvider` interface itself
 * does not preclude one; this provider instance is simply Bible-only for now.
 *
 * ## `IndexTarget` <-> repository bridging
 *
 * `IndexTarget` (M1) has no way to resolve back to an actual, already-open
 * repository on its own - that requires a real module registry, which is
 * M7/M11, not yet built. This provider bridges the gap the same way M1's own
 * doc comments anticipate a real module registry would: something else
 * (today, `BibleSearchService`) calls {@link register} to tell this provider
 * which repository answers for which `IndexTarget`, before any search
 * reaches it. See `BibleSearchService`'s constructor / `addBibleModule` /
 * `registerModuleWithProvider` for the other half of this bridge (deriving
 * an `IndexTarget` from a repository's `getModuleInfo()`, and the reverse
 * `IndexTarget -> moduleAbbr` lookup `BibleSearchService` needs for
 * `SearchResult.module`).
 */

import { KeywordCapability, KeywordFeatures } from '../Capabilities';
import { IKeywordIndexProvider, RuntimeEnvironment } from '../IKeywordIndexProvider';
import { indexTargetKey } from '../KeywordIndexRegistry';
import {
  IndexTarget,
  IIndexSource,
  IKeywordIndex,
  KeywordQuery,
  KeywordSearchOptions,
  KeywordSearchResponse,
  KeywordHit,
} from '../KeywordTypes';
import { compileKeywordQuery } from './Fts5QueryCompiler';
import { IBibleRepository } from '../../Repositories/IBibleRepository';

/**
 * The capability this provider reports once it decides a target's
 * `bible_verse_fts` table is queryable (see {@link probeFts5Table}). Shared
 * between `status()`'s ready branch and the `capability` an opened
 * {@link InModuleFts5Index} carries.
 *
 * - `phrase` / `prefix` / `booleanOps`: `Fts5QueryCompiler` already compiles
 *   all three shapes into `bible_verse_fts` MATCH syntax today (M2); this
 *   provider just executes what it produces.
 * - `near`: true, but scoped to a single verse row - `bible_verse_fts` is a
 *   per-verse table, so `NEAR(a b, N)` here means "within N tokens inside
 *   ONE verse", not "within N verses" or "within N words across a whole
 *   book". `BibleSearchService.searchProximity` (the `~Nw` word-proximity
 *   feature) needs the latter and deliberately does NOT route through this
 *   provider in this pass - see that method's own comment for why.
 * - `rank`: false. `searchVersesWithHighlighting()` orders by `verse_id`
 *   (Bible order), not FTS5's `bm25()`/`rank`; this provider does not query
 *   or surface a real relevance rank, so every `KeywordHit.rank` below is a
 *   `0` placeholder rather than a claim of real ranking.
 * - `snippetFromIndex`: true. `bible_verse_fts` is external-content FTS5
 *   (indexes `bible_verse.text` without duplicating it), and
 *   `searchVersesWithHighlighting()` already runs FTS5's `highlight()` for
 *   us - correctly highlighting Porter-stemmed variants (searching "walk"
 *   highlights "walking"/"walked"), which a JS-side regex re-highlight
 *   cannot reproduce. That highlighted text is carried on `KeywordHit.snippet`
 *   (despite the field's name, it is the whole highlighted verse text, not a
 *   truncated snippet - `BibleSearchService` builds the shorter display
 *   snippet itself downstream, same as before this refactor).
 */
const IN_MODULE_FTS5_FEATURES: KeywordFeatures = {
  phrase: true,
  prefix: true,
  near: true,
  booleanOps: true,
  rank: false,
  snippetFromIndex: true,
};

/**
 * A query guaranteed to match no real verse, used purely to probe whether
 * `bible_verse_fts` exists and is queryable (see {@link probeFts5Table}).
 * Computed once, through the same compiler every real query goes through,
 * so it is never mistaken for FTS5 syntax.
 */
const STATUS_PROBE_QUERY = compileKeywordQuery({
  kind: 'terms',
  terms: ['xyzzy_in_module_fts5_status_probe_9f3a1c'],
  all: true,
});

interface RegisteredEntry {
  readonly target: IndexTarget;
  readonly repo: IBibleRepository;
}

/**
 * The strangler-step keyword-index provider over `bible_verse_fts` (task
 * 0026, revision 2, subtask M3). See the file-level doc comment above.
 */
export class InModuleFts5Provider implements IKeywordIndexProvider {
  readonly id = 'in-module-fts5';

  private readonly entries = new Map<string, RegisteredEntry>();

  /**
   * Tell this provider which repository answers for a given `IndexTarget`.
   * Idempotent: registering the same target again replaces the repository
   * it points at (last write wins), which is the behaviour a module reload
   * needs and does no harm for a first-time registration.
   */
  register(target: IndexTarget, repo: IBibleRepository): void {
    this.entries.set(indexTargetKey(target), { target, repo });
  }

  /** The inverse of {@link register}, for a module being closed/removed. */
  unregister(target: IndexTarget): void {
    this.entries.delete(indexTargetKey(target));
  }

  /**
   * True exactly when {@link register} has been called for this target on
   * THIS provider instance. This is deliberately the whole check - a target
   * nobody registered (or whose module has, say, no FTS5 table at all)
   * simply is not "supported" by this provider, which is what makes
   * `KeywordIndexRegistry.search()` route it straight to `skipped` with
   * `{ state: 'unavailable', reason: 'no-provider' }` (M1's existing
   * degrade-rather-than-fail logic) with no new plumbing needed here. A
   * target that IS registered but whose table turns out to be missing or
   * broken is instead caught per-target inside {@link InModuleFts5Index.search}
   * (see that class) and reported with a more specific reason,
   * `'no-fts-engine'`.
   */
  supports(target: IndexTarget, _env: RuntimeEnvironment): boolean {
    return this.entries.has(indexTargetKey(target));
  }

  /**
   * Cheap existence probe, never a build. `IBibleRepository` has no direct
   * "does bible_verse_fts exist" method - `ensureSearchTablesExist()` is
   * the WRONG table for this (it creates/checks `book_search_index`, the
   * derived word-proximity cache `searchProximity` uses, not the verse-level
   * `bible_verse_fts` this provider actually queries) - so this runs a real
   * MATCH query for a term guaranteed to match nothing. If `bible_verse_fts`
   * is missing (or genuinely broken), SQLite raises and this method reports
   * `false`; otherwise the query succeeds (typically with zero rows) and it
   * reports `true`. One indexed MATCH lookup for 0-1 rows is the "lighter
   * existence check" the design calls for, not a build.
   */
  async status(target: IndexTarget): Promise<KeywordCapability> {
    const entry = this.entries.get(indexTargetKey(target));
    if (!entry) {
      return { state: 'unavailable', reason: 'no-provider' };
    }

    if (!this.probeFts5Table(entry.repo)) {
      return { state: 'unavailable', reason: 'no-fts-engine' };
    }

    return { state: 'ready', providerId: this.id, supports: IN_MODULE_FTS5_FEATURES };
  }

  private probeFts5Table(repo: IBibleRepository): boolean {
    try {
      repo.searchVersesWithHighlighting(STATUS_PROBE_QUERY, { limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Every registered target already maps to an already-open repository
   * (owned by whoever called {@link register}, today `BibleSearchService`) -
   * there is no separate "open a file" step for this provider, unlike a
   * sidecar/shared-index provider that would open its own index file here.
   * This just narrows `entries` down to the requested targets and hands them
   * to a thin {@link InModuleFts5Index}.
   */
  async open(targets: IndexTarget[]): Promise<IKeywordIndex> {
    const scoped: RegisteredEntry[] = [];
    for (const target of targets) {
      const entry = this.entries.get(indexTargetKey(target));
      // Defensive only: KeywordIndexRegistry only ever calls open() with
      // targets this provider's own supports() just accepted, so every
      // target here is expected to resolve. A target that somehow doesn't
      // (e.g. unregistered between supports() and open()) is silently
      // dropped rather than crashing the whole multi-module open() - the
      // same "degrade, don't fail" posture as everywhere else in this file.
      if (entry) scoped.push(entry);
    }
    return new InModuleFts5Index(this.id, scoped);
  }

  /**
   * Not supported by this provider. `bible_verse_fts` is part of the
   * shipped module file, populated when the module is authored (see F1/F2),
   * not something this provider builds at runtime - and a module is an
   * immutable artifact (R-12), so there would usually be nowhere writable to
   * build into even if it tried. Throwing here (rather than a silent no-op)
   * means a caller that mistakenly expects this provider to build an index
   * finds out immediately, instead of the build silently doing nothing.
   */
  async build(
    _src: IIndexSource,
    _onProgress?: (d: number, t: number) => void,
    _signal?: AbortSignal
  ): Promise<void> {
    throw new Error(
      'InModuleFts5Provider.build(): not supported. In-module FTS5 tables ' +
      '(bible_verse_fts, ...) ship inside the module file itself and cannot ' +
      'be built at runtime by this provider.'
    );
  }

  /**
   * No-ops. Unlike `build()` above, a no-op prune is not misleading: there
   * is no separate on-disk artifact for this provider to remove (the FTS5
   * table lives inside the module file, which this provider never owns the
   * lifecycle of), so "prune" genuinely has nothing to do.
   */
  async prune(_target: IndexTarget): Promise<void> {
    // Intentional no-op; see doc comment above.
  }

  async pruneExcept(_keep: IndexTarget[]): Promise<void> {
    // Intentional no-op; see doc comment above.
  }
}

/**
 * The `IKeywordIndex` this provider's `open()` returns. Closes over the
 * subset of `{ target, repo }` entries it was opened with.
 */
class InModuleFts5Index implements IKeywordIndex {
  readonly capability: KeywordCapability;

  constructor(
    readonly providerId: string,
    private readonly entries: RegisteredEntry[]
  ) {
    this.capability = { state: 'ready', providerId, supports: IN_MODULE_FTS5_FEATURES };
  }

  /**
   * Compile `query` once (the ONE place this provider writes FTS5 syntax,
   * via `Fts5QueryCompiler` - M2), then run it against every target this
   * index was opened with, via `searchVersesWithHighlighting()`.
   *
   * Each target is tried independently and wrapped in its own try/catch: a
   * missing or broken `bible_verse_fts` table throws from the repo call
   * below, and that exception is caught HERE, per target, rather than being
   * allowed to propagate up through `KeywordIndexRegistry.search()` (which
   * would otherwise mark this whole provider's entire group of targets as
   * skipped - including targets that are perfectly fine - since the
   * registry only knows "this provider's open()/search() threw", not which
   * target inside it was the problem). This is the authorised new
   * behaviour for this subtask: one bad module degrades to `skipped`
   * instead of killing the whole multi-module search.
   */
  async search(query: KeywordQuery, options: KeywordSearchOptions): Promise<KeywordSearchResponse> {
    const hits: KeywordHit[] = [];
    const skipped: KeywordSearchResponse['skipped'] = [];
    let truncated = false;

    const compiled = compileKeywordQuery(query);

    // A boolean query with no FTS5 equivalent (a bare negation with nothing
    // to exclude from, e.g. `NOT evil` alone) compiles to '' - see
    // Fts5QueryCompiler's doc comment. That is genuinely zero results for
    // EVERY target, not a per-target failure, so this returns cleanly
    // rather than running `MATCH ''` (which SQLite would reject) or
    // reporting every target as skipped.
    if (compiled === '') {
      return { hits, skipped, truncated };
    }

    for (const { target, repo } of this.entries) {
      try {
        const rows = repo.searchVersesWithHighlighting(
          compiled,
          options.limit !== undefined ? { limit: options.limit } : undefined
        );

        for (const row of rows) {
          hits.push({
            target,
            rowId: row.verse.verseId,
            rank: 0,
            snippet: row.highlightedPlainText,
          });
        }

        if (options.limit !== undefined && rows.length >= options.limit) {
          truncated = true;
        }
      } catch {
        // Missing/broken bible_verse_fts (or any other repo-level failure)
        // for this ONE target - degrade rather than fail. 'no-fts-engine'
        // is the specific reason (as opposed to `supports()`'s coarser
        // 'no-provider' for a target nobody registered at all).
        skipped.push({ target, reason: { state: 'unavailable', reason: 'no-fts-engine' } });
      }
    }

    return { hits, skipped, truncated };
  }

  /**
   * No-op. This index never opened anything of its own - every entry's
   * repository connection is owned and closed by whoever registered it with
   * the provider (today, `BibleSearchService`), not by this per-search
   * index object.
   */
  close(): void {
    // Intentional no-op; see doc comment above.
  }
}
