import { ICrossReferenceRepository } from '../../Data/Repositories/ICrossReferenceRepository';
import { AggregationModule, CrossRefsByVerse } from './types';

/**
 * Aggregates cross-reference groups + entries across multiple modules for a
 * given (book, chapter), keyed by verse id.
 */
export interface ICrossRefAggregationService {
  getChapterCrossRefs(
    book: number,
    chapter: number,
    modules: AggregationModule<ICrossReferenceRepository>[]
  ): CrossRefsByVerse;
}
