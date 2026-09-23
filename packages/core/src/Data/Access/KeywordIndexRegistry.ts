/**
 * Concrete {@link IKeywordIndexRegistry}: the library-wide façade over every
 * registered {@link IKeywordIndexProvider}.
 *
 * Behaviour notes (M1 judgement calls - later subtasks build on these, so
 * they are documented here rather than left implicit):
 *
 * - **Empty-target fan-out.** `search()` with an empty `options.targets`
 *   returns `{ hits: [], skipped: [], truncated: false }` immediately,
 *   without touching any provider. M1 has no module registry to ask for
 *   "every ready target", so it cannot resolve that expansion yet; a later
 *   step (M7/F8) wires a real resolution in once a module registry exists.
 *   This is a deliberate no-op, not an error.
 *
 * - **Degrade rather than fail.** If a provider's `open()` or `search()`
 *   throws, that provider's whole target group is moved to `skipped` with
 *   `{ state: 'unavailable', reason: 'no-provider' }` and every other
 *   provider's results are still returned. One bad module (or a provider
 *   with a bug) never sinks a multi-module search.
 *
 * - **`truncated` semantics.** Provider groups are queried in the order
 *   their targets first appear in `options.targets` (`Map` preserves
 *   insertion order). After merging each group's hits, if a numeric
 *   `options.limit` has been reached or exceeded, `truncated` is set and no
 *   further provider groups are queried - "asked in order, stopped early".
 *   This is deliberately not exact: a group's response is merged in whole
 *   (never sliced down to precisely `limit`), and `truncated` is also true
 *   whenever any individual provider response itself reported `truncated`.
 *   Simple and correct beats clever here.
 *
 * - **`status()` key format.** The returned `Map` is keyed by
 *   `` `${moduleUuid}:${contentSha256}` `` (see {@link indexTargetKey}).
 *   Any later code that looks a target up in this map must reconstruct the
 *   same key from the same two fields.
 *
 * - **`build()` with no provider.** A target with no matching provider is
 *   silently skipped, not reported as an error: there's nothing to build
 *   against. `build()` is best-effort for M1.
 *
 * - **`build()` concurrency.** Targets are built sequentially, in the order
 *   given. Parallel building (e.g. per-provider) is out of scope for M1 and
 *   left to a later step.
 */

import { KeywordCapability } from './Capabilities';
import { IKeywordIndexProvider, RuntimeEnvironment } from './IKeywordIndexProvider';
import { IKeywordIndexRegistry, IndexProgressHandler } from './IKeywordIndexRegistry';
import {
  IndexTarget,
  IIndexSource,
  IKeywordIndex,
  KeywordQuery,
  KeywordSearchOptions,
  KeywordSearchResponse,
} from './KeywordTypes';

/**
 * Stable string key for an {@link IndexTarget}, used by `status()`'s
 * returned `Map`. An index is scoped to exactly one module revision, so
 * this pair is the natural staleness-aware identity. Exported so later code
 * that needs to look a target up in that map can reconstruct the same key.
 */
export function indexTargetKey(target: IndexTarget): string {
  return `${target.moduleUuid}:${target.contentSha256}`;
}

interface RegistryEntry {
  id: number;
  provider: IKeywordIndexProvider;
}

export class KeywordIndexRegistry implements IKeywordIndexRegistry {
  private entries: RegistryEntry[] = [];
  private nextId = 0;

  constructor(private readonly env: RuntimeEnvironment) {}

  register(provider: IKeywordIndexProvider): () => void {
    const id = this.nextId++;
    this.entries.push({ id, provider });
    return () => {
      const index = this.entries.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        this.entries.splice(index, 1);
      }
    };
  }

  providerFor(target: IndexTarget): IKeywordIndexProvider | null {
    for (const entry of this.entries) {
      if (entry.provider.supports(target, this.env)) {
        return entry.provider;
      }
    }
    return null;
  }

  async search(query: KeywordQuery, options: KeywordSearchOptions): Promise<KeywordSearchResponse> {
    // Empty-target fan-out: see class doc comment. No module registry exists
    // yet to expand this into "every ready target".
    if (options.targets.length === 0) {
      return { hits: [], skipped: [], truncated: false };
    }

    const groups = new Map<IKeywordIndexProvider, IndexTarget[]>();
    const skipped: KeywordSearchResponse['skipped'] = [];

    for (const target of options.targets) {
      const provider = this.providerFor(target);
      if (!provider) {
        skipped.push({ target, reason: { state: 'unavailable', reason: 'no-provider' } });
        continue;
      }
      const group = groups.get(provider);
      if (group) {
        group.push(target);
      } else {
        groups.set(provider, [target]);
      }
    }

    const hits: KeywordSearchResponse['hits'] = [];
    let truncated = false;

    for (const [provider, groupTargets] of groups) {
      let index: IKeywordIndex | null = null;
      try {
        index = await provider.open(groupTargets);
        const response = await index.search(query, { ...options, targets: groupTargets });
        hits.push(...response.hits);
        skipped.push(...response.skipped);
        if (response.truncated) {
          truncated = true;
        }
      } catch {
        // Degrade rather than fail: a throwing provider must never sink the
        // whole multi-module search.
        for (const target of groupTargets) {
          skipped.push({ target, reason: { state: 'unavailable', reason: 'no-provider' } });
        }
      } finally {
        index?.close();
      }

      if (options.limit !== undefined && hits.length >= options.limit) {
        truncated = true;
        break;
      }
    }

    return { hits, skipped, truncated };
  }

  async status(targets: IndexTarget[]): Promise<Map<string, KeywordCapability>> {
    const result = new Map<string, KeywordCapability>();
    for (const target of targets) {
      const key = indexTargetKey(target);
      const provider = this.providerFor(target);
      if (!provider) {
        result.set(key, { state: 'unavailable', reason: 'no-provider' });
        continue;
      }
      result.set(key, await provider.status(target));
    }
    return result;
  }

  async build(
    targets: IndexTarget[],
    sources: (t: IndexTarget) => IIndexSource,
    onProgress?: IndexProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    // Sequential, not parallel: see class doc comment. Best-effort: a target
    // with no provider is silently skipped, not an error.
    for (const target of targets) {
      const provider = this.providerFor(target);
      if (!provider) {
        continue;
      }
      await provider.build(
        sources(target),
        (done, total) => onProgress?.(target, done, total),
        signal
      );
    }
  }
}
