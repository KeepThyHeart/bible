/**
 * Production `IExtensionBibleBridge`.
 *
 * Wraps the desktop's `ModuleLoader<BibleRepository>` and the shared
 * `ModuleMetadataRepository` so an extension worker can read verses, books,
 * and module info through the host's existing Bible plumbing.
 *
 * The bridge does no caching of its own - both the module loader and the
 * shared repos already have caches - and it converts internal `BibleVerse` /
 * `BibleBook` model classes into the plain JSON DTOs the extension API
 * contract guarantees.
 *
 * Active-verse subscriptions are driven by the existing
 * `window:broadcast-verse-change` IPC handler in `main.ts`. The bridge
 * exposes `notifyActiveVerse(verseId, moduleId)` so the IPC handler can
 * fan out the change to every subscribed extension worker.
 */

import type { BibleRepository, BibleVerse, BibleBook, InterlinearWord } from '@bible/core';
import { ReferenceParser, VerseIdHelper } from '@bible/core';
import type { Extensions } from '@bible/core';

import type { IExtensionBibleBridge } from '../api-impl/IExtensionDataBridges';

type BibleVerseDto = Extensions.BibleVerseDto;
type BibleBookDto = Extensions.BibleBookDto;
type BibleModuleInfoDto = Extensions.BibleModuleInfoDto;
type ParsedReferenceDto = Extensions.ParsedReferenceDto;
type VerseIterationResult = Extensions.VerseIterationResult;
type VerseTokenDto = Extensions.VerseTokenDto;
type VerseWordSelection = Extensions.VerseWordSelection;

export interface BibleBridgeDeps {
  /**
   * Resolve a Bible repository for the given abbreviation. Wired in
   * production from `getBibleRepository` in `bibleHandlers.ts`.
   */
  getBibleRepository(abbreviation: string): BibleRepository | null;
  /**
   * Lookup of every registered Bible module's metadata, in display order.
   * Wired from `getSharedModuleMetadataRepo().getByType('bible')`.
   */
  listBibleModules(): {
    moduleId: string;
    abbreviation?: string;
    moduleName: string;
    languageCode?: string;
    version?: string;
  }[];
  /** Lookup of all 66 Bible books for the listBooks() call. */
  listAllBooks(): BibleBook[];
  /**
   * Default module abbreviation when an extension omits the `moduleId`
   * argument. The host picks "the first available Bible" today; the
   * Settings -> Default Bible preference will replace this in 6b.
   */
  getDefaultModuleAbbreviation(): string | null;

  /**
   * Send an IPC message to the renderer to navigate the primary Bible pane
   * to a specific verse. Wired in production to
   * `mainWindow.webContents.send('extension:navigate-to-verse', verseId)`.
   */
  sendNavigateToVerse(verseId: number): void;
}

export class BibleBridge implements IExtensionBibleBridge {
  private readonly deps: BibleBridgeDeps;
  private readonly parser = new ReferenceParser();
  private readonly activeVerseHandlers = new Set<
    (payload: { verseId: number; module: string } | null) => void
  >();
  private readonly wordSelectionHandlers = new Set<
    (payload: VerseWordSelection) => void
  >();

  constructor(deps: BibleBridgeDeps) {
    this.deps = deps;
  }

  // --- IExtensionBibleBridge --------------------------------------------

  getVerse(verseId: number, moduleId?: string): BibleVerseDto | null {
    const repo = this.resolveRepo(moduleId);
    if (!repo) return null;
    const verse = repo.getVerse(verseId);
    return verse ? toVerseDto(verse) : null;
  }

  getRange(start: number, end: number, moduleId?: string): BibleVerseDto[] {
    const repo = this.resolveRepo(moduleId);
    if (!repo) return [];
    return repo.getVerseRange(start, end).map(toVerseDto);
  }

  listModules(): BibleModuleInfoDto[] {
    return this.deps.listBibleModules().map((m) => {
      const abbr = m.abbreviation ?? m.moduleId;
      const dto: BibleModuleInfoDto = {
        id: m.moduleId,
        abbreviation: abbr,
        name: m.moduleName,
      };
      if (m.languageCode !== undefined) dto.language = m.languageCode;
      if (m.version !== undefined) dto.version = m.version;
      return dto;
    });
  }

  listBooks(_moduleId?: string): BibleBookDto[] {
    return this.deps.listAllBooks().map((b) => ({
      bookNumber: b.bookNumber,
      shortName: b.bookAbbreviation ?? b.bookName.slice(0, 3),
      name: b.bookName,
      testament: b.testament === 'OT' ? 'old' : 'new',
      chapterCount: b.chapterCount,
    }));
  }

  parseReference(input: string, _locale?: string): ParsedReferenceDto | null {
    const parsed = this.parser.parse(input);
    if (!parsed.isValid || parsed.book === undefined) return null;
    const dto: ParsedReferenceDto = {
      bookNumber: parsed.book,
      chapter: parsed.chapter ?? 1,
      input,
    };
    if (parsed.verse !== undefined) {
      dto.startVerse = parsed.verse;
      dto.startVerseId = VerseIdHelper.calculate(parsed.book, parsed.chapter ?? 1, parsed.verse);
    }
    if (parsed.endVerse !== undefined) {
      dto.endVerse = parsed.endVerse;
      dto.endVerseId = VerseIdHelper.calculate(
        parsed.book,
        parsed.endChapter ?? parsed.chapter ?? 1,
        parsed.endVerse,
      );
    }
    return dto;
  }

  iterateVerses(
    moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): VerseIterationResult {
    const repo = this.deps.getBibleRepository(moduleId);
    if (!repo) return { verses: [], hasMore: false };

    // Decode cursor - the cursor encodes the last-seen verse ID.
    let afterVerseId = startVerseId ?? 1001001; // Genesis 1:1
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { v: number };
        afterVerseId = decoded.v + 1;
      } catch {
        // Invalid cursor - start from the beginning of the range.
      }
    }

    const upperBound = endVerseId ?? 66022021; // Revelation 22:21
    // Fetch one extra row to detect hasMore without a separate COUNT query.
    const verses = repo.getVerseRange(afterVerseId, upperBound);
    const page = verses.slice(0, pageSize);
    const hasMore = verses.length > pageSize;
    const nextCursor =
      hasMore && page.length > 0
        ? Buffer.from(JSON.stringify({ v: page[page.length - 1]!.verseId })).toString('base64url')
        : undefined;

    return {
      verses: page.map(toVerseDto),
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  getVerseTokens(verseId: number, moduleId?: string): VerseTokenDto[] | null {
    const repo = this.resolveRepo(moduleId);
    if (!repo) return null;
    if (!repo.hasInterlinearData()) return null;
    const words = repo.getInterlinearWords(verseId);
    if (words.length === 0) return null;
    return words.map(toTokenDto);
  }

  async navigateToVerse(verseId: number): Promise<void> {
    this.deps.sendNavigateToVerse(verseId);
  }

  subscribeActiveVerse(
    handler: (payload: { verseId: number; module: string } | null) => void,
  ): () => void {
    this.activeVerseHandlers.add(handler);
    return () => {
      this.activeVerseHandlers.delete(handler);
    };
  }

  subscribeWordSelection(
    handler: (payload: VerseWordSelection) => void,
  ): () => void {
    this.wordSelectionHandlers.add(handler);
    return () => {
      this.wordSelectionHandlers.delete(handler);
    };
  }

  // --- Host-side fan-out ------------------------------------------------

  /**
   * Called by the `window:broadcast-verse-change` IPC handler in `main.ts`
   * whenever the active verse changes in the main window. Errors thrown by
   * one subscriber never block the others.
   */
  notifyActiveVerse(verseId: number, moduleId?: string): void {
    const payload = { verseId, module: moduleId ?? this.deps.getDefaultModuleAbbreviation() ?? '' };
    for (const h of this.activeVerseHandlers) {
      try {
        h(payload);
      } catch {
        /* swallow - one bad subscriber must not break the others */
      }
    }
  }

  /**
   * Called by the renderer when the user selects a word in the Bible pane.
   * Fans out to all subscribed extension workers.
   */
  notifyWordSelection(payload: VerseWordSelection): void {
    for (const h of this.wordSelectionHandlers) {
      try {
        h(payload);
      } catch {
        /* swallow - one bad subscriber must not break the others */
      }
    }
  }

  // --- Private ----------------------------------------------------------

  private resolveRepo(moduleId?: string): BibleRepository | null {
    const abbr = moduleId ?? this.deps.getDefaultModuleAbbreviation();
    if (!abbr) return null;
    return this.deps.getBibleRepository(abbr);
  }
}

// --- Marshaling ---------------------------------------------------------

function toVerseDto(v: BibleVerse): BibleVerseDto {
  const dto: BibleVerseDto = {
    verseId: v.verseId,
    text: v.text,
  };
  if (v.textPlain !== undefined) dto.textPlain = v.textPlain;
  if (v.formattingData !== undefined) {
    dto.formattingData = v.formattingData as BibleVerseDto['formattingData'];
  }
  if (v.wordCount !== undefined) dto.wordCount = v.wordCount;
  if (v.metadata !== undefined) dto.metadata = v.metadata;
  return dto;
}

function toTokenDto(w: InterlinearWord): VerseTokenDto {
  const dto: VerseTokenDto = {
    index: w.wordPositionStart,
    text: w.originalWord ?? '',
    startOffset: w.wordPositionStart,
    endOffset: w.wordPositionEnd,
  };
  if (w.lemma !== undefined) dto.lemma = w.lemma;
  if (w.strongsNumber !== undefined) dto.strongsNumber = w.strongsNumber;
  if (w.morphology !== undefined) dto.morphology = w.morphology;
  return dto;
}
