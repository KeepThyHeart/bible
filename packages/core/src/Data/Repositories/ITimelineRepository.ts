import type { TimelineDataset } from '../../Timeline/types';

/** Read access to a timeline module (`timeline_*.db`). */
export interface ITimelineRepository {
  /** The whole module as one JSON-serialisable document. */
  getDataset(): TimelineDataset;
  /** Item slugs whose passages overlap a verse (reverse lookup). */
  getItemIdsForVerse(verseId: number): number[];
}
