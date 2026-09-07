import { ICommentaryRepository } from '../../Data/Repositories/ICommentaryRepository';
import { ICommentaryAggregationService } from './ICommentaryAggregationService';
import {
  AggregationModule,
  ChapterCommentaryEntryOverview,
  ChapterCommentaryOverview,
  chapterStart,
  chapterEnd,
} from './types';

/**
 * Default implementation of {@link ICommentaryAggregationService}.
 *
 * Wraps {@link ICommentaryRepository.getEntriesForRange} for each module and
 * flattens the results into the wire shape used by the study cache.
 */
export class CommentaryAggregationService implements ICommentaryAggregationService {
  getChapterOverview(
    book: number,
    chapter: number,
    modules: AggregationModule<ICommentaryRepository>[]
  ): ChapterCommentaryOverview {
    const start = chapterStart(book, chapter);
    const end = chapterEnd(book, chapter);
    const entries: ChapterCommentaryEntryOverview[] = [];

    for (const mod of modules) {
      const rows = mod.repository.getEntriesForRange(start, end);
      for (const r of rows) {
        // verse_id_start is non-null for any row matched by the range query.
        const verseStart = r.verseIdStart ?? 0;
        // Property order matches the script's wire format byte-for-byte.
        entries.push({
          m: mod.abbreviation,
          mn: mod.moduleName,
          s: verseStart,
          e: r.verseIdEnd || verseStart,
          l: r.entryLevel,
          w: r.wordCount || 0,
        });
      }
    }

    return entries;
  }
}
