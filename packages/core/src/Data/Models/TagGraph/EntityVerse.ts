import { EntityCategory } from './TagGraphEntity';

/**
 * A verse reference associated with a tag graph entity.
 * Populated from topical indexes (Nave's/Torrey's) and Bible text search.
 */
export interface EntityVerse {
  entityId: string;
  entityCategory: EntityCategory;
  startVerseId: number;
  endVerseId: number;
  source: string;
}
