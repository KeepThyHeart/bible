import { ITagGraphRepository } from '../../Data/Repositories/ITagGraphRepository';
import { IEntityAggregationService } from './IEntityAggregationService';
import {
  EntitiesByVerse,
  VerseEntityEntry,
  chapterStart,
  chapterEnd,
} from './types';

/**
 * Default implementation of {@link IEntityAggregationService}.
 *
 * Wraps {@link ITagGraphRepository.getEntityRangesForVerseRange} and emits the
 * verse-keyed dictionary used by the study cache. Each row is indexed under
 * its `start_verse_id` (the client handles range expansion).
 */
export class EntityAggregationService implements IEntityAggregationService {
  getChapterEntities(
    book: number,
    chapter: number,
    tagGraph: ITagGraphRepository | null | undefined
  ): EntitiesByVerse {
    if (!tagGraph) return {};

    const start = chapterStart(book, chapter);
    const end = chapterEnd(book, chapter);
    const result: EntitiesByVerse = {};

    const rows = tagGraph.getEntityRangesForVerseRange(start, end);

    for (const r of rows) {
      const key = String(r.startVerseId);
      let bucket = result[key];
      if (!bucket) {
        bucket = [];
        result[key] = bucket;
      }
      const entry: VerseEntityEntry = {
        eid: r.entityId,
        cat: r.entityCategory,
        n: r.entityName ?? '',
        // eve, src must be omitted (not null) when absent
        ...(r.endVerseId ? { eve: r.endVerseId } : {}),
        ...(r.source ? { src: r.source } : {}),
      };
      bucket.push(entry);
    }

    return result;
  }
}
