import { ICrossReferenceRepository } from '../../Data/Repositories/ICrossReferenceRepository';
import { ICrossRefAggregationService } from './ICrossRefAggregationService';
import {
  AggregationModule,
  CrossRefsByVerse,
  VerseCrossRefBlock,
  VerseCrossRefEntry,
  chapterStart,
  chapterEnd,
} from './types';

/**
 * Default implementation of {@link ICrossRefAggregationService}.
 *
 * Wraps {@link ICrossReferenceRepository.getGroupsWithEntriesForRange} so each
 * module is queried with two SQL statements (groups + batched entries) per
 * chapter, matching the legacy generation script byte-for-byte.
 */
export class CrossRefAggregationService implements ICrossRefAggregationService {
  getChapterCrossRefs(
    book: number,
    chapter: number,
    modules: AggregationModule<ICrossReferenceRepository>[]
  ): CrossRefsByVerse {
    const start = chapterStart(book, chapter);
    const end = chapterEnd(book, chapter);
    const result: CrossRefsByVerse = {};

    for (const mod of modules) {
      const groups = mod.repository.getGroupsWithEntriesForRange(start, end);
      if (groups.length === 0) continue;

      for (const { group, entries } of groups) {
        if (group.verseId == null || group.groupId == null) continue;
        const key = String(group.verseId);
        let bucket = result[key];
        if (!bucket) {
          bucket = [];
          result[key] = bucket;
        }

        const mappedEntries: VerseCrossRefEntry[] = entries.map(e => {
          const entry: VerseCrossRefEntry = {
            tv: e.targetVerseId,
            // tve, n must be omitted (not present) when absent
            ...(e.targetVerseEndId ? { tve: e.targetVerseEndId } : {}),
            ...(e.note ? { n: e.note } : {}),
            so: e.sortOrder ?? 0,
          };
          return entry;
        });

        const block: VerseCrossRefBlock = {
          src: mod.abbreviation,
          g: {
            id: group.groupId,
            // ph must be omitted when phrase is empty/absent
            ...(group.phrase ? { ph: group.phrase } : {}),
            so: group.sortOrder ?? 0,
          },
          e: mappedEntries,
        };
        bucket.push(block);
      }
    }

    return result;
  }
}
