/**
 * Verse Links Service
 *
 * Queries all linked items for specific verses and aggregates results.
 * Used in Study Mode to display related commentaries, books, notes, and cross-references.
 *
 * All data access is delegated to repository interfaces - no raw SQL lives here.
 */

import { VerseId, VerseIdHelper } from '../Data/Core/Types';
import { getBookName } from './ReferenceCollapser';
import { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';
import { ICommentaryRepository } from '../Data/Repositories/ICommentaryRepository';
import { ICrossReferenceRepository } from '../Data/Repositories/ICrossReferenceRepository';
import { IBookRepository } from '../Data/Repositories/IBookRepository';
import { IUserNoteRepository } from '../Data/Repositories/IUserNoteRepository';
import { IUserCrossReferenceRepository } from '../Data/Repositories/IUserCrossReferenceRepository';

// ============================================================================
// Interface Definitions
// ============================================================================

/**
 * Summary of all verse links for a single verse
 */
export interface VerseLinksSummary {
  verseId: VerseId;
  commentaries: CommentaryLinks;
  crossReferences: CrossReferenceLinks;
  books: BookLink[];
  userContent: UserContentLinks;
  /**
   * Count of user-created cross-references for this verse.
   * Rendered by `CrossReferenceDisplay` as the "My Cross-References (N)" collapsible.
   */
  userRefCount: number;
}

/**
 * Commentary links (direct entries and mentions)
 */
export interface CommentaryLinks {
  direct: CommentaryLink[];      // Has entry on this verse
  mentions: CommentaryLink[];    // Mentions this verse in other entries
}

/**
 * Single commentary link
 */
export interface CommentaryLink {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  entryId: number;
  entryLevel: 'verse' | 'passage' | 'chapter' | 'book';
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  isOpen: boolean;               // Is commentary currently open?
  count?: number;                // Number of mentions (for "as cross-reference")
}

/**
 * Cross-reference links from dedicated modules
 */
export interface CrossReferenceLinks {
  modules: CrossReferenceModule[];
}

/**
 * Single cross-reference module
 */
export interface CrossReferenceModule {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  isOpen: boolean;
  references: CrossReferenceEntry[];
}

/**
 * Single cross-reference entry
 */
export interface CrossReferenceEntry {
  xrefId: number;
  toVerseId: VerseId;
  toVerseReference: string;      // "Romans 5:8"
  relationshipType?: string;      // 'parallel', 'quote', etc.
  notes?: string;
}

/**
 * Book links (study books citing verses)
 */
export interface BookLink {
  moduleId: number;
  moduleName: string;
  abbreviation: string;
  sections: BookSectionReference[];
}

/**
 * Book section reference
 */
export interface BookSectionReference {
  sectionId: number;
  sectionTitle: string;
  context?: string;
  referenceId: number;
}

/**
 * User-generated content links
 */
export interface UserContentLinks {
  notes: UserNoteLink[];
  journals: JournalLink[];
}

/**
 * User note link
 */
export interface UserNoteLink {
  noteId: number;
  title?: string;
  noteType: string;              // 'verse_note', 'sermon', 'study', etc.
  modifiedDate: string;
  contentPreview?: string;
}

/**
 * Journal entry link
 */
export interface JournalLink {
  entryId: number;
  entryDate: string;
  title?: string;
  contentPreview?: string;
}

// ============================================================================
// Service Implementation
// ============================================================================

/** Append `value` to the array stored at `key`, creating it on first use. */
function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * The requested verses that fall inside a record's inclusive passage.
 * A missing end means a single verse, per the canonical range convention.
 */
function versesCoveredBy(
  recordStart: VerseId | undefined,
  recordEnd: VerseId | undefined,
  verseIds: VerseId[]
): VerseId[] {
  const start = recordStart ?? 0;
  const end = recordEnd ?? start;
  return verseIds.filter(v => v >= start && v <= end);
}

/**
 * Service for querying verse links across all content types.
 *
 * All database access is performed through repository interfaces.
 * Module-specific repositories are obtained via provider callbacks,
 * allowing the caller to manage database connections and caching.
 */
export class VerseLinksService {
  constructor(
    private moduleMetadataRepo: IModuleMetadataRepository,
    private userNoteRepo: IUserNoteRepository | undefined,
    private commentaryRepoProvider: (moduleId: number) => ICommentaryRepository | undefined,
    private crossReferenceRepoProvider: (moduleId: number) => ICrossReferenceRepository | undefined,
    private bookRepoProvider: (moduleId: number) => IBookRepository | undefined,
    private userCrossReferenceRepo?: IUserCrossReferenceRepository
  ) {}

  /**
   * Get all linked items for a single verse
   */
  async getVerseLinks(verseId: VerseId, openModuleIds?: Set<number>): Promise<VerseLinksSummary> {
    const openModules = openModuleIds ?? new Set<number>();

    // Query all content types in parallel for better performance
    const [
      directCommentaries,
      commentaryMentions,
      crossReferences,
      books,
      userNotes,
      journals,
      userRefCount
    ] = await Promise.all([
      this.getCommentaryEntries(verseId, openModules),
      this.getCommentaryMentions(verseId, openModules),
      this.getCrossReferences(verseId, openModules),
      this.getBookReferences(verseId),
      this.getUserNotes(verseId),
      this.getJournalEntries(verseId),
      this.getUserCrossReferenceCount(verseId)
    ]);

    return {
      verseId,
      commentaries: {
        direct: directCommentaries,
        mentions: commentaryMentions
      },
      crossReferences: {
        modules: crossReferences
      },
      books,
      userContent: {
        notes: userNotes,
        journals
      },
      userRefCount
    };
  }

  /**
   * Count of user-created cross-references originating at this verse.
   * Falls back to 0 if the user DB isn't open or the table is missing.
   */
  private async getUserCrossReferenceCount(verseId: VerseId): Promise<number> {
    if (!this.userCrossReferenceRepo) return 0;
    try {
      return this.userCrossReferenceRepo.getFromVerse(verseId).length;
    } catch (error) {
      console.error('Error getting user cross-reference count:', error);
      return 0;
    }
  }

  /**
   * Get links for multiple verses in ONE pass per module.
   *
   * The old implementation looped `getVerseLinks` per verse, and each of those
   * calls re-read the module registry three times and then issued a query per
   * installed module: with 24 commentaries and 26 book modules that is ~78 SQL
   * statements per verse, or roughly 2,300 for a chapter of Study mode.
   *
   * This version resolves the module list once, asks each module a single
   * RANGE question spanning `[min(verseIds), max(verseIds)]`, and attributes
   * the rows back to individual verses in memory. The per-verse answers are
   * reconstructed with the same predicates the single-verse repository methods
   * use, so `getBatchVerseLinks([v])` and `getVerseLinks(v)` agree.
   *
   * Verses that were not asked for are dropped even when the range covers
   * them, so a caller passing a sparse list gets exactly the keys it asked for.
   */
  async getBatchVerseLinks(
    verseIds: VerseId[],
    openModuleIds?: Set<number>
  ): Promise<Map<VerseId, VerseLinksSummary>> {
    const results = new Map<VerseId, VerseLinksSummary>();
    if (verseIds.length === 0) return results;

    const openModules = openModuleIds ?? new Set<number>();
    const wanted = [...new Set(verseIds)].sort((a, b) => a - b);
    const start = wanted[0];
    const end = wanted[wanted.length - 1];

    const [
      commentaryByVerse,
      mentionsByVerse,
      crossRefsByVerse,
      booksByVerse,
      notesByVerse,
      journalsByVerse,
      userRefCounts,
    ] = await Promise.all([
      this.batchCommentaryEntries(wanted, start, end, openModules),
      this.batchCommentaryMentions(wanted, start, end, openModules),
      this.batchCrossReferences(wanted, start, end, openModules),
      this.batchBookReferences(wanted, start, end),
      this.batchUserNotes(wanted, start, end),
      this.batchJournalEntries(wanted, start, end),
      this.batchUserCrossReferenceCounts(wanted, start, end),
    ]);

    for (const verseId of wanted) {
      results.set(verseId, {
        verseId,
        commentaries: {
          direct: commentaryByVerse.get(verseId) ?? [],
          mentions: mentionsByVerse.get(verseId) ?? [],
        },
        crossReferences: { modules: crossRefsByVerse.get(verseId) ?? [] },
        books: booksByVerse.get(verseId) ?? [],
        userContent: {
          notes: notesByVerse.get(verseId) ?? [],
          journals: journalsByVerse.get(verseId) ?? [],
        },
        userRefCount: userRefCounts.get(verseId) ?? 0,
      });
    }

    return results;
  }

  // ========================================================================
  // Batch Query Methods
  // ========================================================================

  /**
   * "Which commentaries have an entry on this verse", for every verse at once.
   *
   * Mirrors `ICommentaryRepository.getBestEntryForVerse`: the winning entry is
   * the FIRST one in `verse_id_start` order whose range covers the verse.
   */
  private async batchCommentaryEntries(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId,
    openModules: Set<number>
  ): Promise<Map<VerseId, CommentaryLink[]>> {
    const byVerse = new Map<VerseId, CommentaryLink[]>();
    try {
      for (const module of this.moduleMetadataRepo.getByType('commentary')) {
        const repo = this.commentaryRepoProvider(module.moduleId!);
        if (!repo) continue;

        const anchors = repo.getBestEntryAnchorsForRange(start, end);
        if (anchors.length === 0) continue;

        for (const verseId of verseIds) {
          // `verse_id_end IS NULL` is open-ended here, exactly as in the
          // single-verse SQL - see getBestEntryAnchorsForRange.
          const best = anchors.find(
            a => a.verseIdStart <= verseId && (a.verseIdEnd === undefined || a.verseIdEnd >= verseId)
          );
          if (!best) continue;
          pushInto(byVerse, verseId, {
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            entryId: best.entryId,
            entryLevel: best.entryLevel,
            verseIdStart: best.verseIdStart,
            verseIdEnd: best.verseIdEnd,
            isOpen: openModules.has(module.moduleId!),
          });
        }
      }
    } catch (error) {
      console.error('Error getting commentary entries (batch):', error);
      return new Map();
    }

    for (const [verseId, links] of byVerse) byVerse.set(verseId, this.sortCommentaryLinks(links));
    return byVerse;
  }

  /** Commentary mentions for every verse at once (see getCommentaryMentions). */
  private async batchCommentaryMentions(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId,
    openModules: Set<number>
  ): Promise<Map<VerseId, CommentaryLink[]>> {
    const byVerse = new Map<VerseId, CommentaryLink[]>();
    try {
      for (const module of this.moduleMetadataRepo.getByType('commentary')) {
        const repo = this.commentaryRepoProvider(module.moduleId!);
        if (!repo) continue;

        const rows = repo.getVerseMentionRowsForRange(start, end);
        if (rows.length === 0) continue;

        for (const verseId of verseIds) {
          // An entry that ANCHORS on the verse is not "mentioning" it - the
          // single-verse SQL excludes it with `ce.verse_id_start != ?`.
          const covering = rows.filter(
            r => r.linkVerseIdStart <= verseId && r.linkVerseIdEnd >= verseId && r.entryVerseIdStart !== verseId
          );
          if (covering.length === 0) continue;

          const byEntry = new Map<number, { verseIdStart: VerseId; count: number }>();
          for (const r of covering) {
            const existing = byEntry.get(r.entryId);
            if (existing) existing.count += 1;
            else byEntry.set(r.entryId, { verseIdStart: r.entryVerseIdStart, count: 1 });
          }
          const entries = [...byEntry.entries()].sort((a, b) => a[0] - b[0]);
          const first = entries[0];

          pushInto(byVerse, verseId, {
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            entryId: first[0],
            entryLevel: 'verse',
            verseIdStart: first[1].verseIdStart,
            isOpen: openModules.has(module.moduleId!),
            count: entries.reduce((sum, [, v]) => sum + v.count, 0),
          });
        }
      }
    } catch (error) {
      console.error('Error getting commentary mentions (batch):', error);
      return new Map();
    }

    for (const [verseId, links] of byVerse) byVerse.set(verseId, this.sortCommentaryLinks(links));
    return byVerse;
  }

  /** Module cross-references for every verse at once (see getCrossReferences). */
  private async batchCrossReferences(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId,
    openModules: Set<number>
  ): Promise<Map<VerseId, CrossReferenceModule[]>> {
    const byVerse = new Map<VerseId, CrossReferenceModule[]>();
    try {
      for (const module of this.moduleMetadataRepo.getByType('cross_reference')) {
        const repo = this.crossReferenceRepoProvider(module.moduleId!);
        if (!repo) continue;

        const groups = repo.getGroupsWithEntriesForRange(start, end);
        if (groups.length === 0) continue;

        for (const verseId of verseIds) {
          // Containment on the group's own anchor range - the predicate
          // `getGroupsForVerse` uses - then sort_order, which is the order the
          // per-verse query returns.
          const covering = groups
            .filter(g => g.group.verseId <= verseId && (g.group.verseIdEnd ?? g.group.verseId) >= verseId)
            .sort((a, b) => (a.group.sortOrder ?? 0) - (b.group.sortOrder ?? 0));
          if (covering.length === 0) continue;

          const references: CrossReferenceEntry[] = [];
          for (const { entries } of covering) {
            for (const entry of entries) {
              references.push({
                xrefId: entry.entryId!,
                toVerseId: entry.targetVerseId,
                toVerseReference: this.formatVerseId(entry.targetVerseId),
                notes: entry.note,
              });
            }
          }
          if (references.length === 0) continue;

          pushInto(byVerse, verseId, {
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            isOpen: openModules.has(module.moduleId!),
            references,
          });
        }
      }
    } catch (error) {
      console.error('Error getting cross-references (batch):', error);
      return new Map();
    }
    return byVerse;
  }

  /** Book references for every verse at once (see getBookReferences). */
  private async batchBookReferences(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId
  ): Promise<Map<VerseId, BookLink[]>> {
    const byVerse = new Map<VerseId, BookLink[]>();
    try {
      for (const module of this.moduleMetadataRepo.getByType('book')) {
        const repo = this.bookRepoProvider(module.moduleId!);
        if (!repo) continue;

        const refs = repo.getVerseReferencesWithSectionsForRange(start, end);
        if (refs.length === 0) continue;

        for (const verseId of verseIds) {
          const covering = refs.filter(r => r.verseIdStart <= verseId && r.verseIdEnd >= verseId);
          if (covering.length === 0) continue;
          pushInto(byVerse, verseId, {
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            sections: covering.map(ref => ({
              sectionId: ref.sectionId,
              sectionTitle: ref.sectionTitle,
              context: ref.context,
              referenceId: ref.referenceId,
            })),
          });
        }
      }
    } catch (error) {
      console.error('Error getting book references (batch):', error);
      return new Map();
    }
    return byVerse;
  }

  /** User notes for every verse at once (see getUserNotes). */
  private async batchUserNotes(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId
  ): Promise<Map<VerseId, UserNoteLink[]>> {
    const byVerse = new Map<VerseId, UserNoteLink[]>();
    if (!this.userNoteRepo) return byVerse;

    try {
      for (const note of this.userNoteRepo.getForVerseRange(start, end)) {
        if (note.noteType === 'journal') continue;
        for (const verseId of versesCoveredBy(note.verseIdStart, note.verseIdEnd, verseIds)) {
          pushInto(byVerse, verseId, {
            noteId: note.noteId!,
            title: note.title,
            noteType: note.noteType,
            modifiedDate: note.modifiedDate ?? note.createdDate ?? '',
            contentPreview: note.content ? this.getContentPreview(note.content, 100) : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error getting user notes (batch):', error);
      return new Map();
    }
    return byVerse;
  }

  /** Journal entries for every verse at once (see getJournalEntries). */
  private async batchJournalEntries(
    verseIds: VerseId[],
    start: VerseId,
    end: VerseId
  ): Promise<Map<VerseId, JournalLink[]>> {
    const byVerse = new Map<VerseId, JournalLink[]>();
    if (!this.userNoteRepo) return byVerse;

    try {
      for (const note of this.userNoteRepo.getForVerseRange(start, end)) {
        if (note.noteType !== 'journal') continue;
        for (const verseId of versesCoveredBy(note.verseIdStart, note.verseIdEnd, verseIds)) {
          pushInto(byVerse, verseId, {
            entryId: note.noteId!,
            entryDate: note.entryDate ?? note.createdDate ?? '',
            title: note.title,
            contentPreview: note.content ? this.getContentPreview(note.content, 100) : undefined,
          });
        }
      }
    } catch (error) {
      console.error('Error getting journal entries (batch):', error);
      return new Map();
    }
    return byVerse;
  }

  /**
   * User cross-reference counts for a whole range in one query.
   *
   * A user cross-reference may hang off a PASSAGE, so it counts against every
   * verse it covers - the reader sees the indicator wherever they are inside
   * it, not only on its first verse.
   *
   * Counting walks `wanted` and tests each verse for containment, rather than
   * walking each range's ids. verse_id is book*1000000 + chapter*1000 + verse
   * and so is NOT contiguous: incrementing across it would visit ids no verse
   * has, and a range spanning a book boundary would iterate millions of them.
   * `wanted` is the real verse list and is at most a chapter.
   */
  private async batchUserCrossReferenceCounts(
    wanted: VerseId[],
    start: VerseId,
    end: VerseId
  ): Promise<Map<VerseId, number>> {
    const counts = new Map<VerseId, number>();
    if (!this.userCrossReferenceRepo) return counts;
    try {
      const ranges = this.userCrossReferenceRepo.getFromVerseRange(start, end);
      if (ranges.length === 0) return counts;

      for (const verseId of wanted) {
        let n = 0;
        for (const xref of ranges) {
          if (xref.fromVerseIdStart <= verseId && xref.fromVerseIdEnd >= verseId) n++;
        }
        if (n > 0) counts.set(verseId, n);
      }
    } catch (error) {
      console.error('Error getting user cross-reference counts (batch):', error);
      return new Map();
    }
    return counts;
  }

  // ========================================================================
  // Private Query Methods
  // ========================================================================

  /**
   * Get direct commentary entries for a verse.
   * Queries each commentary module's repository for the best-match entry.
   */
  private async getCommentaryEntries(verseId: VerseId, openModules: Set<number>): Promise<CommentaryLink[]> {
    const links: CommentaryLink[] = [];

    try {
      const modules = this.moduleMetadataRepo.getByType('commentary');

      for (const module of modules) {
        const repo = this.commentaryRepoProvider(module.moduleId!);
        if (!repo) continue;

        const entry = repo.getBestEntryForVerse(verseId);
        if (entry) {
          links.push({
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            entryId: entry.entryId!,
            entryLevel: entry.entryLevel,
            verseIdStart: entry.verseIdStart!,
            verseIdEnd: entry.verseIdEnd ?? undefined,
            isOpen: openModules.has(module.moduleId!)
          });
        }
      }

      return this.sortCommentaryLinks(links);
    } catch (error) {
      console.error('Error getting commentary entries:', error);
      return [];
    }
  }

  /**
   * Get commentary mentions of a verse
   * (commentaries that reference this verse in other entries).
   */
  private async getCommentaryMentions(verseId: VerseId, openModules: Set<number>): Promise<CommentaryLink[]> {
    const links: CommentaryLink[] = [];

    try {
      const modules = this.moduleMetadataRepo.getByType('commentary');

      for (const module of modules) {
        const repo = this.commentaryRepoProvider(module.moduleId!);
        if (!repo) continue;

        const mentions = repo.getVerseMentions(verseId);
        if (mentions.length > 0) {
          links.push({
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            entryId: mentions[0].entryId,
            entryLevel: 'verse',
            verseIdStart: mentions[0].verseIdStart,
            isOpen: openModules.has(module.moduleId!),
            count: mentions.reduce((sum, m) => sum + m.count, 0)
          });
        }
      }

      return this.sortCommentaryLinks(links);
    } catch (error) {
      console.error('Error getting commentary mentions:', error);
      return [];
    }
  }

  /**
   * Get cross-references from dedicated cross-reference modules
   */
  private async getCrossReferences(verseId: VerseId, openModules: Set<number>): Promise<CrossReferenceModule[]> {
    const result: CrossReferenceModule[] = [];

    try {
      const modules = this.moduleMetadataRepo.getByType('cross_reference');

      for (const module of modules) {
        const repo = this.crossReferenceRepoProvider(module.moduleId!);
        if (!repo) continue;

        const groupsWithEntries = repo.getGroupsWithEntries(verseId);
        if (groupsWithEntries.length === 0) continue;

        // Flatten all entries from all groups into a single references list
        const references: CrossReferenceEntry[] = [];
        for (const { entries } of groupsWithEntries) {
          for (const entry of entries) {
            references.push({
              xrefId: entry.entryId!,
              toVerseId: entry.targetVerseId,
              toVerseReference: this.formatVerseId(entry.targetVerseId),
              notes: entry.note
            });
          }
        }

        if (references.length > 0) {
          result.push({
            moduleId: module.moduleId!,
            moduleName: module.moduleName,
            abbreviation: module.abbreviation ?? module.moduleName,
            isOpen: openModules.has(module.moduleId!),
            references
          });
        }
      }

      return result;
    } catch (error) {
      // Graceful degradation: cross-reference modules are optional.
      console.error('Error getting cross-references:', error);
      return [];
    }
  }

  /**
   * Get book references (study books citing this verse)
   */
  private async getBookReferences(verseId: VerseId): Promise<BookLink[]> {
    const links: BookLink[] = [];

    try {
      const modules = this.moduleMetadataRepo.getByType('book');

      for (const module of modules) {
        const repo = this.bookRepoProvider(module.moduleId!);
        if (!repo) continue;

        const refs = repo.getVerseReferencesWithSections(verseId);
        if (refs.length === 0) continue;

        links.push({
          moduleId: module.moduleId!,
          moduleName: module.moduleName,
          abbreviation: module.abbreviation ?? module.moduleName,
          sections: refs.map(ref => ({
            sectionId: ref.sectionId,
            sectionTitle: ref.sectionTitle,
            context: ref.context,
            referenceId: ref.referenceId
          }))
        });
      }

      return links;
    } catch (error) {
      // Graceful degradation: book modules may lack scripture_reference tables.
      console.error('Error getting book references:', error);
      return [];
    }
  }

  /**
   * Get user notes for a verse (excludes journal-type notes)
   */
  private async getUserNotes(verseId: VerseId): Promise<UserNoteLink[]> {
    if (!this.userNoteRepo) return [];

    try {
      const notes = this.userNoteRepo.getForVerse(verseId);

      return notes
        .filter(note => note.noteType !== 'journal')
        .map(note => ({
          noteId: note.noteId!,
          title: note.title,
          noteType: note.noteType,
          modifiedDate: note.modifiedDate ?? note.createdDate ?? '',
          contentPreview: note.content ? this.getContentPreview(note.content, 100) : undefined
        }));
    } catch (error) {
      // Graceful degradation: user DB may not yet have note tables.
      console.error('Error getting user notes:', error);
      return [];
    }
  }

  /**
   * Get journal entries referencing a verse.
   * Journals are UserNote entities with noteType='journal'.
   */
  private async getJournalEntries(verseId: VerseId): Promise<JournalLink[]> {
    if (!this.userNoteRepo) return [];

    try {
      const notes = this.userNoteRepo.getForVerse(verseId);

      return notes
        .filter(note => note.noteType === 'journal')
        .map(note => ({
          entryId: note.noteId!,
          entryDate: note.entryDate ?? note.createdDate ?? '',
          title: note.title,
          contentPreview: note.content ? this.getContentPreview(note.content, 100) : undefined
        }));
    } catch (error) {
      // Graceful degradation: user DB may not yet have note tables.
      console.error('Error getting journal entries:', error);
      return [];
    }
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Sort and prioritize commentary links (open modules first, then alphabetical)
   */
  private sortCommentaryLinks(links: CommentaryLink[]): CommentaryLink[] {
    return links.sort((a, b) => {
      // Open modules first
      if (a.isOpen && !b.isOpen) return -1;
      if (!a.isOpen && b.isOpen) return 1;

      // Then alphabetical
      return a.abbreviation.localeCompare(b.abbreviation);
    });
  }

  /**
   * Format verse ID as a readable reference, e.g. "Rom 5:8".
   *
   * Uses the shared book-name table, never hand-rolled arithmetic: these
   * strings reach the UI verbatim (every cross-reference label in the
   * verse-links row), so a `Book 45` placeholder would be user-visible.
   * `getBookName` still returns `Book <n>` for an out-of-range number, so the
   * degenerate case stays handled without reaching the 66 real books that way.
   */
  private formatVerseId(verseId: VerseId): string {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(verseId);
    // 'medium' - short enough for an inline link, still unambiguous.
    return `${getBookName(bookNumber, 'medium')} ${chapter}:${verse}`;
  }

  /**
   * Get content preview (first N characters, strip HTML)
   */
  private getContentPreview(content: string, maxLength: number): string {
    // Basic HTML stripping (for more robust stripping, use a library)
    const stripped = content.replace(/<[^>]*>/g, '');
    const trimmed = stripped.trim();

    if (trimmed.length <= maxLength) {
      return trimmed;
    }

    return trimmed.substring(0, maxLength) + '...';
  }
}
