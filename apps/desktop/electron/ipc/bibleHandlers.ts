import { IpcMain } from 'electron';
import log from 'electron-log/main';
import { BibleRepository, VerseIdHelper, formatVerseText } from '@bible/core';
import { getSharedModuleMetadataRepo, getSharedBookRepo } from '../services/sharedMainDb';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validateBookNumber, validateChapter, validateVerseId, validateString } from '../utils/validation';

const bibleLoader = new ModuleLoader('bible', (db) => new BibleRepository(db), (repo) => {
  repo.ensureSearchTablesExist();
});

/**
 * Get or create a Bible repository for a specific module.
 * Exported so it can be used in other handlers (e.g., search).
 */
export function getBibleRepository(abbreviation: string): BibleRepository | null {
  return bibleLoader.get(abbreviation);
}

/**
 * Resolve a Bible repo by abbreviation or raise a classified
 * `not_found` error so the renderer can branch cleanly.
 */
function requireBibleRepository(abbreviation: string): BibleRepository {
  const repo = getBibleRepository(abbreviation);
  if (!repo) {
    throw new IpcKnownError('not_found', `Bible not found: ${abbreviation}`);
  }
  return repo;
}

export function registerBibleHandlers(_ipcMain: IpcMain): void {

  // Handler: Get list of available Bible modules
  ipcHandler<[], any[]>('bible:getAvailableBibles', () => {
    const moduleMetadataRepo = getSharedModuleMetadataRepo();
    const bibles = moduleMetadataRepo.getByType('bible');

    return bibles.map(module => ({
      module_id: module.moduleId,
      abbreviation: module.abbreviation || module.getAbbreviation(),
      name: module.moduleName,
      language_code: module.languageCode,
      version: module.version,
      database_path: module.databasePath
    }));
  });

  // Handler: Get book name (returns fallback on error)
  ipcHandler<[number], string>('bible:getBookName', (bookNumber) => {
    validateBookNumber(bookNumber);
    try {
      const bookRepo = getSharedBookRepo();
      const book = bookRepo.getByBookNumber(bookNumber);
      return book?.bookName ?? 'Unknown';
    } catch (error) {
      log.error('Error getting book name:', error);
      return 'Unknown';
    }
  });

  // Handler: Get all books (returns fallback on error)
  ipcHandler<[], any[]>('bible:getAllBooks', () => {
    try {
      const bookRepo = getSharedBookRepo();
      const books = bookRepo.getAll();
      return books.map(book => ({
        book_number: book.bookNumber,
        book_name: book.bookName,
        book_abbreviation: book.bookAbbreviation,
        testament: book.testament,
        chapter_count: book.chapterCount
      }));
    } catch (error) {
      log.error('Error getting all books:', error);
      return [];
    }
  });

  // Handler: Get a single verse
  ipcHandler<[string, number], any>('bible:getVerse', (abbreviation, verseId) => {
    validateAbbreviation(abbreviation);
    validateVerseId(verseId);
    const bibleRepo = requireBibleRepository(abbreviation);

    const verse = bibleRepo.getVerse(verseId);
    if (!verse) return null;

    // Parse verseId to get book_number, chapter, verse
    const parsed = VerseIdHelper.parse(verse.verseId);

    // Format verse text with HTML
    const { textHtml, isParagraphStart } = formatVerseText(verse);

    return {
      verse_id: verse.verseId,
      book_number: parsed.bookNumber,
      chapter: parsed.chapter,
      verse: parsed.verse,
      text: verse.text,
      text_html: textHtml,
      is_paragraph_start: isParagraphStart,
      words_of_christ: verse.hasWordsOfChrist(),
      formatting: verse.formattingData,
      metadata: verse.metadata
    };
  });

  // Handler: Get multiple verses
  ipcHandler<[string, number, number], any[]>('bible:getVerses', (abbreviation, startId, endId) => {
    validateAbbreviation(abbreviation);
    validateVerseId(startId);
    validateVerseId(endId);
    const bibleRepo = requireBibleRepository(abbreviation);

    const verses = bibleRepo.getVerseRange(startId, endId);

    return verses.map(verse => {
      const parsed = VerseIdHelper.parse(verse.verseId);
      const { textHtml, isParagraphStart } = formatVerseText(verse);
      return {
        verse_id: verse.verseId,
        book_number: parsed.bookNumber,
        chapter: parsed.chapter,
        verse: parsed.verse,
        text: verse.text,
        text_html: textHtml,
        is_paragraph_start: isParagraphStart,
        words_of_christ: verse.hasWordsOfChrist(),
        formatting: verse.formattingData,
        metadata: verse.metadata
      };
    });
  });

  // Handler: Get chapter
  // Cache of which modules have interlinear data (checked once per module)
  const interlinearCache = new Map<string, boolean>();

  ipcHandler<[string, number, number], { verses: any[]; hasInterlinearData: boolean }>(
    'bible:getChapter',
    (abbreviation, bookNumber, chapter) => {
      validateAbbreviation(abbreviation);
      validateBookNumber(bookNumber);
      validateChapter(chapter);

      const bibleRepo = requireBibleRepository(abbreviation);
      const verses = bibleRepo.getChapter(bookNumber, chapter);

      // Check interlinear data availability (cached per module, avoids separate IPC call)
      if (!interlinearCache.has(abbreviation)) {
        interlinearCache.set(abbreviation, bibleRepo.hasInterlinearData());
      }

      const result = verses.map(verse => {
        const parsed = VerseIdHelper.parse(verse.verseId);
        const { textHtml, isParagraphStart } = formatVerseText(verse);
        return {
          verse_id: verse.verseId,
          book_number: parsed.bookNumber,
          chapter: parsed.chapter,
          verse: parsed.verse,
          text: verse.text,
          text_html: textHtml,
          is_paragraph_start: isParagraphStart,
          words_of_christ: verse.hasWordsOfChrist(),
          formatting: verse.formattingData,
          metadata: verse.metadata
        };
      });

      return {
        verses: result,
        hasInterlinearData: interlinearCache.get(abbreviation) || false
      };
    }
  );

  // Handler: Get initial Bible data in one call (for faster startup)
  // Returns available Bibles, default chapter verses, and book name
  ipcHandler<[string | undefined, number | undefined, number | undefined], any>(
    'bible:getInitialData',
    (defaultAbbreviation = 'KJV', defaultBook = 43, defaultChapter = 3) => {
      validateAbbreviation(defaultAbbreviation);
      validateBookNumber(defaultBook);
      validateChapter(defaultChapter);

      // Get available Bibles
      let availableBibles: any[] = [];
      {
        const moduleMetadataRepo = getSharedModuleMetadataRepo();
        const bibles = moduleMetadataRepo.getByType('bible');
        availableBibles = bibles.map(module => ({
          module_id: module.moduleId,
          abbreviation: module.abbreviation || module.getAbbreviation(),
          name: module.moduleName,
          language_code: module.languageCode,
          version: module.version,
          database_path: module.databasePath
        }));
      }

      // Find the default Bible (or first available)
      const targetAbbr = availableBibles.find(b => b.abbreviation === defaultAbbreviation)
        ? defaultAbbreviation
        : availableBibles[0]?.abbreviation;

      let defaultVerses: any[] = [];
      let bookName = 'John';
      let hasInterlinear = false;

      if (targetAbbr) {
        // Get default chapter verses
        const bibleRepo = getBibleRepository(targetAbbr);
        if (bibleRepo) {
          const verses = bibleRepo.getChapter(defaultBook, defaultChapter);
          defaultVerses = verses.map(verse => {
            const parsed = VerseIdHelper.parse(verse.verseId);
            const { textHtml, isParagraphStart } = formatVerseText(verse);
            return {
              verse_id: verse.verseId,
              book_number: parsed.bookNumber,
              chapter: parsed.chapter,
              verse: parsed.verse,
              text: verse.text,
              text_html: textHtml,
              is_paragraph_start: isParagraphStart,
              words_of_christ: verse.hasWordsOfChrist(),
              formatting: verse.formattingData,
              metadata: verse.metadata
            };
          });

          // Check interlinear data availability (piggybacked, avoids separate IPC)
          if (!interlinearCache.has(targetAbbr)) {
            interlinearCache.set(targetAbbr, bibleRepo.hasInterlinearData());
          }
          hasInterlinear = interlinearCache.get(targetAbbr) || false;
        }

        // Get book name
        {
          const bookRepo = getSharedBookRepo();
          const book = bookRepo.getByBookNumber(defaultBook);
          bookName = book?.bookName ?? 'Unknown';
        }
      }

      return {
        availableBibles,
        defaultBible: targetAbbr ? availableBibles.find(b => b.abbreviation === targetAbbr) : null,
        defaultVerses,
        hasInterlinearData: hasInterlinear,
        bookName,
        bookNumber: defaultBook,
        chapter: defaultChapter
      };
    }
  );

  // Handler: Search
  ipcHandler<[string, string], any[]>('bible:search', (abbreviation, query) => {
    validateAbbreviation(abbreviation);
    validateString(query, 'search query', 1000);
    const bibleRepo = requireBibleRepository(abbreviation);

    const results = bibleRepo.searchVerses(query);

    return results.map(verse => {
      const parsed = VerseIdHelper.parse(verse.verseId);
      const { textHtml, isParagraphStart } = formatVerseText(verse);
      return {
        verse_id: verse.verseId,
        book_number: parsed.bookNumber,
        chapter: parsed.chapter,
        verse: parsed.verse,
        text: verse.text,
        text_html: textHtml,
        is_paragraph_start: isParagraphStart,
        words_of_christ: verse.hasWordsOfChrist(),
        formatting: verse.formattingData,
        metadata: verse.metadata
      };
    });
  });
}

/**
 * Clean up Bible database connections
 */
export function closeBibleDb(): void {
  bibleLoader.closeAll();
}
