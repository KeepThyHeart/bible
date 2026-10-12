/**
 * The `memory.bible` host API: what the worker's `MemoryService` calls (through the leader tab) to read the Bible.
 * Built on the web's own providers: verse text from the Bible data provider, modules and books from `moduleStore`,
 * chapter extents from core's static KJV versification (the same table desktop derives from `chapter_info`; every
 * installed module is normalised to it), references from core's `ReferenceParser`, navigation through `bibleStore`.
 * Main thread, lazy chunk only. Every method takes and returns structured-clonable data.
 */
import { getLocalizer, ReadingPlans, ReferenceParser } from '@bible/core/browser';
import type { BibleBookDto, BibleChapterDto, BibleModuleInfoDto, BibleVerseDto, ParsedReferenceDto } from '@bible/memory/core';
import i18n from '../../i18n';
import { getShellContext } from '../../host/appHost';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { getLocalizedBookName } from '../../utils/bookNames';
import { parseVerseId } from '../../utils/verseId';

type VerseDto = BibleVerseDto;
type ModuleDto = BibleModuleInfoDto;
type BookDto = BibleBookDto;
type ChapterDto = BibleChapterDto;
type ParsedDto = ParsedReferenceDto;

/** Same ceiling as the extension API's `getRange`. */
export const MAX_RANGE_VERSES = 500;

function defaultModule(): string {
  return bibleStore.getActiveTab()?.moduleAbbr || settingsStore.getDefaultBible();
}

/** Verse ids from `start` to `end` inclusive in canonical order, capped. */
function idsBetween(start: number, end: number): number[] {
  const ids: number[] = [];
  for (let id: number | null = start; id !== null && id <= end && ids.length < MAX_RANGE_VERSES; id = ReadingPlans.nextVerse(id)) {
    ids.push(id);
  }
  return ids;
}

export interface WebBibleDeps {
  getTexts(module: string, ids: number[]): Promise<Record<string, { verse_id: number; text: string }>>;
  modules(): Array<{ abbreviation: string; name: string; language_code: string }>;
  bookName(book: number): string;
  chapterCount(book: number): number;
  testament(book: number): 'old' | 'new';
  parser(locale?: string): { parse(text: string): ReturnType<ReferenceParser['parse']> };
  navigate(verseId: number): Promise<void>;
  defaultModule(): string;
}

const realDeps: WebBibleDeps = {
  getTexts: async (module, ids) => (await getShellContext().providers.bible.getVerseTexts(module, ids)).verses,
  modules: () => moduleStore.getBibleModules(),
  bookName: (book) => moduleStore.getBookName(book) || getLocalizedBookName(book),
  chapterCount: (book) => moduleStore.getBookByNumber(book)?.chapter_count ?? ReadingPlans.chapterCount(book),
  testament: (book) => (book <= 39 ? 'old' : 'new'),
  parser: (locale) => new ReferenceParser(getLocalizer(locale || i18n.language).referenceParserConfig),
  navigate: async (verseId) => {
    const { bookNumber, chapter, verse } = parseVerseId(verseId);
    await bibleStore.navigateTo(bookNumber, chapter, verse);
  },
  defaultModule,
};

export function createWebBible(deps: WebBibleDeps = realDeps) {
  return {
    async getRange(start: number, end: number, opts?: { module?: string }): Promise<VerseDto[]> {
      const ids = idsBetween(start, end);
      if (ids.length === 0) return [];
      const texts = await deps.getTexts(opts?.module || deps.defaultModule(), ids);
      const out: VerseDto[] = [];
      for (const id of ids) {
        const v = texts[String(id)];
        if (v) out.push({ verseId: id, text: v.text });
      }
      return out;
    },

    async listModules(): Promise<ModuleDto[]> {
      return deps.modules().map((m) => ({
        id: m.abbreviation,
        abbreviation: m.abbreviation,
        name: m.name,
        ...(m.language_code ? { language: m.language_code } : {}),
      }));
    },

    async listBooks(_moduleId?: string): Promise<BookDto[]> {
      void _moduleId;
      return Array.from({ length: 66 }, (_, i) => i + 1).map((book) => ({
        bookNumber: book,
        shortName: deps.bookName(book).slice(0, 3),
        name: deps.bookName(book),
        testament: deps.testament(book),
        chapterCount: deps.chapterCount(book),
      }));
    },

    async listChapters(bookNumber: number, _moduleId?: string): Promise<ChapterDto[]> {
      void _moduleId;
      const chapters = ReadingPlans.chapterCount(bookNumber);
      return Array.from({ length: chapters }, (_, i) => {
        const chapter = i + 1;
        const verseCount = ReadingPlans.versesInChapter(bookNumber, chapter);
        return {
          bookNumber,
          chapter,
          verseCount,
          firstVerseId: ReadingPlans.vid(bookNumber, chapter, 1),
          lastVerseId: ReadingPlans.vid(bookNumber, chapter, verseCount),
        };
      });
    },

    async parseReference(input: string, locale?: string): Promise<ParsedDto | null> {
      const parsed = deps.parser(locale).parse(input);
      if (!parsed.isValid || parsed.book === undefined) return null;
      const chapter = parsed.chapter ?? 1;
      const dto: ParsedDto = { bookNumber: parsed.book, chapter, input };
      if (parsed.verse !== undefined) {
        dto.startVerse = parsed.verse;
        dto.startVerseId = ReadingPlans.vid(parsed.book, chapter, parsed.verse);
      }
      if (parsed.endVerse !== undefined) {
        dto.endVerse = parsed.endVerse;
        dto.endVerseId = ReadingPlans.vid(parsed.book, parsed.endChapter ?? chapter, parsed.endVerse);
      }
      return dto;
    },

    async navigateToVerse(verseId: number): Promise<void> {
      await deps.navigate(verseId);
    },
  };
}

export const webBible = createWebBible();
