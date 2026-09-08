/**
 * Types for the smoke-test corpus bundle.
 *
 * A `SmokeCorpus` is the concrete per-shape fixture pool the harness will
 * iterate. Defaults ship with `@bible/extension-testing`; extension authors
 * may supply overrides via `smoke.corpus.json` at their package root, which
 * the harness merges via `mergeCorpus()`.
 */

import type { VerseId, VerseRange } from '@bible/core';
import type { StorageStateFixture } from './storage';
import type { NetworkFixture } from './network';

export interface SmokeCorpus {
  verseIds: readonly VerseId[];
  verseRanges: readonly VerseRange[];
  referenceStrings: readonly string[];
  dictionaryKeys: readonly string[];
  sectionIds: readonly string[];
  commandArgs: readonly unknown[];
  eventPayloads: readonly unknown[];
  storage: readonly StorageStateFixture[];
  network: readonly NetworkFixture[];
  /** Sentinel for `HookInputShape === 'none'`. Always contains one `undefined`. */
  none: readonly unknown[];
}

/**
 * The JSON shape accepted by `smoke.corpus.json`. Every field is optional
 * and either **replaces** or **extends** the matching default corpus, as
 * chosen by the author at the top level via `mode`. Per-field `append`
 * entries always extend.
 *
 * ```json
 * {
 *   "mode": "extend",
 *   "verseIds": [43003016, 45008028],
 *   "referenceStrings": { "append": ["Jn iii 16"] },
 *   "storage": { "replace": [{ "id": "custom", "entries": [] }] }
 * }
 * ```
 */
export interface UserCorpusFile {
  mode?: 'extend' | 'replace';
  verseIds?: readonly VerseId[] | CorpusOverride<VerseId>;
  verseRanges?: readonly VerseRange[] | CorpusOverride<VerseRange>;
  referenceStrings?: readonly string[] | CorpusOverride<string>;
  dictionaryKeys?: readonly string[] | CorpusOverride<string>;
  sectionIds?: readonly string[] | CorpusOverride<string>;
  commandArgs?: readonly unknown[] | CorpusOverride<unknown>;
  eventPayloads?: readonly unknown[] | CorpusOverride<unknown>;
  storage?: readonly StorageStateFixture[] | CorpusOverride<StorageStateFixture>;
  network?: readonly NetworkFixture[] | CorpusOverride<NetworkFixture>;
}

export interface CorpusOverride<T> {
  append?: readonly T[];
  replace?: readonly T[];
}

export class CorpusValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`smoke.corpus.json[${path}]: ${message}`);
    this.name = 'CorpusValidationError';
    this.path = path;
  }
}
