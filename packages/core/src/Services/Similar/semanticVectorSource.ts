/**
 * Adapter from the Node-side SemanticSearchService to the vector source the similar
 * passages service scans (task 0070). Not browser-safe (the service sits on the SQLite
 * layer), so it is exported from the main entry only, never from `Similar/index.ts`.
 */

import type { SemanticSearchService } from '../SemanticSearchService';
import { compileKindClassifier, resolveSimilarWeights } from './SimilarWeights';
import type { SimilarRowKind } from './SimilarWeights';
import type { IPassageVectorSource, PassageRange, QueryRow, RowHit, SemanticLevel } from './SimilarTypes';

export function createSemanticVectorSource(
  svc: SemanticSearchService,
  classify: (id: string) => SimilarRowKind = compileKindClassifier(resolveSimilarWeights())
): IPassageVectorSource {
  return {
    neighbourFloor: () => svc.neighbourMinSimilarity(),

    getPassageRows(r: PassageRange, levels: SemanticLevel[]): QueryRow[] {
      return svc.getPassageRows(r.startVerseId, r.endVerseId, levels).map(row => ({
        id: row.id,
        kind: classify(row.id),
        level: row.level,
        vector: row.vector,
      }));
    },

    searchRows(queries: Float32Array[], o: { levels: SemanticLevel[]; topK: number }): RowHit[][] {
      return svc.searchByVectors(queries, o).map(hits =>
        hits.map(h => ({
          id: h.id,
          level: h.level,
          startVerseId: h.startVerseId,
          endVerseId: h.endVerseId,
          similarity: h.similarity,
        }))
      );
    },
  };
}
