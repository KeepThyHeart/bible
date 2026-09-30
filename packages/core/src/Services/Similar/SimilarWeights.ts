/**
 * Configurable ranking weights for similar passages (task 0070).
 *
 * One JSON-serialisable object drives both live ranking and the neighbour table
 * builder (which records it, and its hash, in the table's meta). It lets the
 * human weigh the embeddings of the raw verse text against the LLM-written
 * explanation rows while testing, without code changes.
 */

import type { SemanticLevel } from '../SemanticSearchService';

/** text = raw verse/passage text embedding; explanation = LLM-written description; facet = terse sub-facet phrase. */
export type SimilarRowKind = 'text' | 'explanation' | 'facet';

/** `idPattern` is a RegExp source; the first matching rule wins; no match means 'explanation'. */
export interface SimilarKindRule {
  kind: SimilarRowKind;
  idPattern: string;
}

export interface SimilarWeights {
  schema: 1;
  kindRules: SimilarKindRule[];
  /** Weight of same-channel pairs. 0 disables a channel. */
  channels: { text: number; meaning: number };
  /** Weight of text<->meaning pairs. Default 0 (off). */
  crossChannel: number;
  /** Multiplies any pair that involves a facet row. */
  facetDamping: number;
  combine: 'max' | 'blend';
  maxQueryVectors: number;
  perQueryTopK: number;
  /** Additive score bias per level. */
  levelBias: Record<SemanticLevel, number>;
}

export const DEFAULT_SIMILAR_WEIGHTS: SimilarWeights = {
  schema: 1,
  kindRules: [{ kind: 'facet', idPattern: '_s\\d+$' }],
  channels: { text: 1, meaning: 1 },
  crossChannel: 0,
  facetDamping: 0.92,
  combine: 'max',
  maxQueryVectors: 12,
  perQueryTopK: 200,
  levelBias: { verse: 0, paragraph: 0, chapter: 0 },
};

/** Deep-merge and validate an override; bad keys are ignored with a console.warn; never throws. */
export function resolveSimilarWeights(_override?: unknown): SimilarWeights {
  throw new Error('todo');
}

export function compileKindClassifier(_w: SimilarWeights): (rowId: string) => SimilarRowKind {
  throw new Error('todo');
}

export function channelOf(kind: SimilarRowKind): 'text' | 'meaning' {
  return kind === 'text' ? 'text' : 'meaning';
}

/** Stable hash (sorted-key JSON, FNV-1a, hex). */
export function similarWeightsHash(_w: SimilarWeights): string {
  throw new Error('todo');
}
