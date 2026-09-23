/**
 * The library-wide façade over every registered {@link IKeywordIndexProvider}.
 * See `KeywordIndexRegistry.ts` for the concrete implementation.
 */

import { IKeywordIndexProvider } from './IKeywordIndexProvider';
import { KeywordCapability } from './Capabilities';
import {
  IndexTarget,
  IIndexSource,
  KeywordQuery,
  KeywordSearchOptions,
  KeywordSearchResponse,
} from './KeywordTypes';

export interface IKeywordIndexRegistry {
  register(p: IKeywordIndexProvider): () => void;
  providerFor(t: IndexTarget): IKeywordIndexProvider | null;
  /** Groups targets by provider, opens once per provider, merges, reports skips. */
  search(q: KeywordQuery, o: KeywordSearchOptions): Promise<KeywordSearchResponse>;
  status(ts: IndexTarget[]): Promise<Map<string, KeywordCapability>>;
  build(
    ts: IndexTarget[],
    sources: (t: IndexTarget) => IIndexSource,
    onProgress?: IndexProgressHandler,
    signal?: AbortSignal
  ): Promise<void>;
}

export type IndexProgressHandler = (target: IndexTarget, done: number, total: number) => void;
