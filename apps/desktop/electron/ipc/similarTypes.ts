/**
 * Similar passages (task 0070): the IPC payload shapes shared by main, preload and the
 * renderer. Type-only; the renderer may import it with `import type`.
 */
import type { PassageRange, SimilarOptions, SimilarPassage, SimilarResult, MatchReason } from '@bible/core';

export type { PassageRange, SimilarOptions, SimilarPassage, SimilarResult, MatchReason };

/** A result row with the display fields the main process fills in. */
export type SimilarRowDto = SimilarPassage & {
  /** Stable key: `level|start|end`. */
  key: string;
  /** Localised reference, e.g. "John 3:16-17". */
  reference: string;
  /** HTML text of the passage; paragraphs show the first two verses plus an ellipsis. */
  text: string;
};

export type SimilarUnavailableReason = 'no-table-no-pack' | 'no-data' | 'range-needs-live';

export interface SimilarFindResponse {
  status: 'ok' | 'preparing' | 'unavailable';
  unavailableReason?: SimilarUnavailableReason;
  result?: SimilarResult & { rows: SimilarRowDto[] };
}

export type SimilarTableState = 'ready' | 'downloading' | 'available' | 'missing';

export interface SimilarStatus {
  table: SimilarTableState;
  /** True when the semantic search pack is installed, so a live scan is possible. */
  live: boolean;
}
