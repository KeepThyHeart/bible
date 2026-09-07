import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { UserCrossReference } from '../Data/Models/User/UserCrossReference';
import { VerseId } from '../Data/Core/Types';
import { getBookName } from '../Data/Core/BookNames';

/**
 * Cross-reference information with verse text
 */
export interface EnrichedCrossReference {
  /**
   * Source passage. `fromVerseIdEnd` equals `fromVerseId` for a single verse,
   * which is every built-in reference and most user ones.
   */
  fromVerseId: VerseId;
  fromVerseIdEnd: VerseId;
  /** Target passage, same convention. */
  toVerseId: VerseId;
  toVerseIdEnd: VerseId;
  verseText?: string;
  verseReference: string;
  isUserCreated: boolean;
  notes?: string;
}

/**
 * Service for managing and enriching cross-references
 * Combines built-in cross-references with user-created ones
 */
export class CrossReferenceService {
  /**
   * Extract cross-references from verse formatting data
   */
  static extractBuiltInCrossRefs(verse: BibleVerse): VerseId[] {
    if (!verse.formattingData?.crossReferences) {
      return [];
    }

    const allRefs: VerseId[] = [];
    for (const xref of verse.formattingData.crossReferences) {
      allRefs.push(...xref.references);
    }

    return allRefs;
  }

  /**
   * Merge built-in and user cross-references, removing duplicates
   */
  static mergeCrossReferences(
    builtInRefs: VerseId[],
    userRefs: UserCrossReference[]
  ): VerseId[] {
    const allRefs = new Set<VerseId>();

    // Add built-in refs
    builtInRefs.forEach(ref => allRefs.add(ref));

    // Add user refs. A user cross-reference may target a passage; this list is
    // of single verse ids, so the passage is represented by its first verse --
    // which is where following the link should land the reader anyway.
    userRefs.forEach(xref => allRefs.add(xref.toVerseIdStart));

    return Array.from(allRefs).sort((a, b) => a - b);
  }

  /**
   * Enrich cross-references with verse text and metadata
   */
  static enrichCrossReferences(
    verseId: VerseId,
    builtInRefs: VerseId[],
    userRefs: UserCrossReference[],
    verseTextMap?: Map<VerseId, string>
  ): EnrichedCrossReference[] {
    const enriched: EnrichedCrossReference[] = [];
    const builtInSet = new Set(builtInRefs);

    // Add built-in cross-references. These are single verses on both ends, so
    // each range collapses to end === start.
    for (const toVerseId of builtInRefs) {
      enriched.push({
        fromVerseId: verseId,
        fromVerseIdEnd: verseId,
        toVerseId,
        toVerseIdEnd: toVerseId,
        verseText: verseTextMap?.get(toVerseId),
        verseReference: this.formatVerseReference(toVerseId),
        isUserCreated: false
      });
    }

    // Add user cross-references (if not already included). Deduplication is by
    // the target's FIRST verse: a user link to a passage duplicates a built-in
    // link to that passage's opening verse, and showing both would be noise.
    for (const xref of userRefs) {
      if (!builtInSet.has(xref.toVerseIdStart)) {
        enriched.push({
          fromVerseId: xref.fromVerseIdStart,
          fromVerseIdEnd: xref.fromVerseIdEnd,
          toVerseId: xref.toVerseIdStart,
          toVerseIdEnd: xref.toVerseIdEnd,
          verseText: verseTextMap?.get(xref.toVerseIdStart),
          verseReference: this.formatVerseReference(xref.toVerseIdStart),
          isUserCreated: true,
          notes: xref.notes
        });
      }
    }

    return enriched;
  }

  /**
   * Format verse ID as readable reference
   */
  static formatVerseReference(verseId: VerseId): string {
    const bookNumber = Math.floor(verseId / 1000000);
    const chapter = Math.floor((verseId % 1000000) / 1000);
    const verse = verseId % 1000;

    const bookName = this.getBookName(bookNumber);
    return `${bookName} ${chapter}:${verse}`;
  }

  /**
   * Get book name from book number
   */
  private static getBookName(bookNumber: number): string {
    // getBookName applies the same `Book <n>` fallback this used inline.
    return getBookName(bookNumber);
  }

  /**
   * Group cross-references by source verse
   */
  static groupByVerse(refs: EnrichedCrossReference[]): Map<VerseId, EnrichedCrossReference[]> {
    const grouped = new Map<VerseId, EnrichedCrossReference[]>();

    for (const ref of refs) {
      const existing = grouped.get(ref.fromVerseId) || [];
      existing.push(ref);
      grouped.set(ref.fromVerseId, existing);
    }

    return grouped;
  }
}
