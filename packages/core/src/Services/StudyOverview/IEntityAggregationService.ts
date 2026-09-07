import { ITagGraphRepository } from '../../Data/Repositories/ITagGraphRepository';
import { EntitiesByVerse } from './types';

/**
 * Aggregates tag-graph entity references for a given (book, chapter) using a
 * single tag-graph repository instance.
 *
 * Unlike the other StudyOverview services this one takes a single repository
 * (not an array) because there is at most one tag_graph.db per installation.
 */
export interface IEntityAggregationService {
  getChapterEntities(
    book: number,
    chapter: number,
    tagGraph: ITagGraphRepository | null | undefined
  ): EntitiesByVerse;
}
