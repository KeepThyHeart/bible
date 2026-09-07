import { ICommentaryRepository } from '../../Data/Repositories/ICommentaryRepository';
import { AggregationModule, ChapterCommentaryOverview } from './types';

/**
 * Aggregates commentary entry metadata across multiple commentary modules
 * for a given (book, chapter). Returns the same wire shape used by
 * `study_cache.db`.
 */
export interface ICommentaryAggregationService {
  /**
   * Build a chapter-scoped overview of commentary entries from the given
   * modules. Each entry carries verse range, level, and word count - but no
   * body text. Modules are visited in array order; output preserves that order.
   */
  getChapterOverview(
    book: number,
    chapter: number,
    modules: AggregationModule<ICommentaryRepository>[]
  ): ChapterCommentaryOverview;
}
