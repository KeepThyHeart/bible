import { IpcMain } from 'electron';
import log from 'electron-log/main';
import { CommentaryRepository, VerseIdHelper, getBookName } from '@bible/core';
import { getSharedModuleMetadataRepo } from '../services/sharedMainDb';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validateVerseId, validateString } from '../utils/validation';

const commentaryLoader = new ModuleLoader('commentary', (db) => new CommentaryRepository(db));

export function getCommentaryRepository(abbreviation: string): CommentaryRepository | null {
  return commentaryLoader.get(abbreviation);
}

/**
 * Resolve a commentary repo by abbreviation or raise a classified
 * `not_found` error so the renderer can branch cleanly.
 */
function requireCommentaryRepository(abbreviation: string): CommentaryRepository {
  const repo = getCommentaryRepository(abbreviation);
  if (!repo) {
    throw new IpcKnownError('not_found', `Commentary not found: ${abbreviation}`);
  }
  return repo;
}

interface AvailableCommentaryDto {
  module_id: number | undefined;
  abbreviation: string;
  name: string;
  language_code: string | undefined;
  version: string | undefined;
  database_path: string;
}

interface CommentaryInfoDto {
  abbreviation: string | undefined;
  full_name: string | undefined;
  author: string | undefined;
  year_published: number | undefined;
  copyright: string | undefined;
  description: string | undefined;
  language_code: string | undefined;
  version: string | undefined;
}

interface CommentaryEntryDto {
  entry_id: number | undefined;
  verse_id_start: number | undefined;
  verse_id_end: number | undefined;
  entry_level: string | undefined;
  content: string | undefined;
  word_count: number | undefined;
}

interface CommentaryEntrySummaryDto {
  verse_id_start: number | undefined;
  verse_id_end: number | undefined;
  entry_level: string | undefined;
  word_count: number | undefined;
}

interface CommentarySearchResultDto {
  entryId: number | undefined;
  verseIdStart: number | undefined;
  verseIdEnd: number | undefined;
  module: string;
  moduleName: string;
  reference: string;
  text: string;
  snippet: string;
  entryLevel: string | undefined;
  type: 'commentary';
}

interface BatchRestoreSessionRequest {
  abbreviations: string[];
  verseId: number;
  browseModeByTab?: Record<string, boolean>;
}

interface BatchRestoreSessionResultDto {
  availableCommentaries: AvailableCommentaryDto[];
  entriesByTab: Record<string, CommentaryEntryDto[]>;
  summariesByTab: Record<string, CommentaryEntrySummaryDto[]>;
}

function listAvailableCommentaries(): AvailableCommentaryDto[] {
  const moduleMetadataRepo = getSharedModuleMetadataRepo();
  const commentaries = moduleMetadataRepo.getByType('commentary');

  return commentaries.map(module => ({
    module_id: module.moduleId,
    abbreviation: module.abbreviation || module.getAbbreviation(),
    name: module.moduleName,
    language_code: module.languageCode,
    version: module.version,
    database_path: module.databasePath
  }));
}

export function registerCommentaryHandlers(_ipcMain: IpcMain): void {

  // Handler: Batch load for session restore - loads available commentaries + entries + summaries in one IPC call
  ipcHandler<[BatchRestoreSessionRequest], BatchRestoreSessionResultDto>(
    'commentary:batchRestoreSession',
    (request) => {
      validateVerseId(request.verseId);
      for (const abbr of request.abbreviations) {
        validateAbbreviation(abbr);
      }
      const startTime = Date.now();

      const availableCommentaries = listAvailableCommentaries();

      const entriesByTab: Record<string, CommentaryEntryDto[]> = {};
      const summariesByTab: Record<string, CommentaryEntrySummaryDto[]> = {};

      for (const abbreviation of request.abbreviations) {
        const repo = getCommentaryRepository(abbreviation);
        if (!repo) continue;

        const inBrowseMode = request.browseModeByTab?.[abbreviation];
        if (!inBrowseMode) {
          const entries = repo.getEntriesForVerse(request.verseId);
          entriesByTab[abbreviation] = entries.map(entry => ({
            entry_id: entry.entryId,
            verse_id_start: entry.verseIdStart,
            verse_id_end: entry.verseIdEnd,
            entry_level: entry.entryLevel,
            content: entry.content,
            word_count: entry.wordCount
          }));
        }

        // Summaries intentionally not loaded here. `getAllEntrySummaries`
        // is a full GROUP BY over commentary_entry (31k rows for MHC) whose only
        // consumer is the empty-verse fallback grid -- and CommentaryPane
        // already lazy-loads it via `loadEntrySummaries` exactly when that grid
        // is about to render. Eagerly shipping it made session restore 320ms
        // slower for something the reader usually never sees.
      }

      const elapsed = Date.now() - startTime;
      log.info(`[commentary:batchRestoreSession] Loaded ${request.abbreviations.length} modules in ${elapsed}ms`);

      return { availableCommentaries, entriesByTab, summariesByTab };
    }
  );

  // Handler: Get list of available commentary modules
  ipcHandler<[], AvailableCommentaryDto[]>(
    'commentary:getAvailableCommentaries',
    () => listAvailableCommentaries()
  );

  // Handler: Get commentary module info
  ipcHandler<[string], CommentaryInfoDto>(
    'commentary:getCommentaryInfo',
    (abbreviation) => {
      validateAbbreviation(abbreviation);
      const repo = requireCommentaryRepository(abbreviation);

      const info = repo.getModuleInfo();
      if (!info) {
        throw new IpcKnownError('not_found', `No module info found for: ${abbreviation}`);
      }

      return {
        abbreviation: info.abbreviation,
        full_name: info.fullName,
        author: info.author,
        year_published: info.yearPublished,
        copyright: info.copyright,
        description: info.description,
        language_code: info.languageCode,
        version: info.version
      };
    }
  );

  // Handler: Get commentary entries for a specific verse
  ipcHandler<[string, number], CommentaryEntryDto[]>(
    'commentary:getEntriesForVerse',
    (abbreviation, verseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(verseId);
      const repo = requireCommentaryRepository(abbreviation);

      const entries = repo.getEntriesForVerse(verseId);

      return entries.map(entry => ({
        entry_id: entry.entryId,
        verse_id_start: entry.verseIdStart,
        verse_id_end: entry.verseIdEnd,
        entry_level: entry.entryLevel,
        content: entry.content,
        word_count: entry.wordCount
      }));
    }
  );

  // Handler: Check if commentary has content for a specific verse (returns fallback on error)
  ipcHandler<[string, number], boolean>(
    'commentary:hasContentForVerse',
    (abbreviation, verseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(verseId);
      try {
        const repo = getCommentaryRepository(abbreviation);
        if (!repo) {
          return false;
        }

        const entries = repo.getEntriesForVerse(verseId);
        return entries.length > 0;
      } catch (error) {
        log.error(`Error checking content availability for ${abbreviation}, verse ${verseId}:`, error);
        return false;
      }
    }
  );

  // Handler: Get next verse with commentary content (returns fallback on error)
  ipcHandler<[string, number], number | null>(
    'commentary:getNextVerseWithContent',
    (abbreviation, currentVerseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(currentVerseId);
      try {
        const repo = getCommentaryRepository(abbreviation);
        if (!repo) {
          return null;
        }

        return repo.getNextVerseWithContent(currentVerseId) ?? null;
      } catch (error) {
        log.error(`Error getting next verse for ${abbreviation}, current verse ${currentVerseId}:`, error);
        return null;
      }
    }
  );

  // Handler: Get previous verse with commentary content (returns fallback on error)
  ipcHandler<[string, number], number | null>(
    'commentary:getPreviousVerseWithContent',
    (abbreviation, currentVerseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(currentVerseId);
      try {
        const repo = getCommentaryRepository(abbreviation);
        if (!repo) {
          return null;
        }

        return repo.getPreviousVerseWithContent(currentVerseId) ?? null;
      } catch (error) {
        log.error(`Error getting previous verse for ${abbreviation}, current verse ${currentVerseId}:`, error);
        return null;
      }
    }
  );

  // Handler: Get all entry summaries for tree view
  ipcHandler<[string], CommentaryEntrySummaryDto[]>(
    'commentary:getAllEntrySummaries',
    (abbreviation) => {
      validateAbbreviation(abbreviation);
      const repo = requireCommentaryRepository(abbreviation);

      const summaries = repo.getAllEntrySummaries();

      return summaries.map(summary => ({
        verse_id_start: summary.verseIdStart,
        verse_id_end: summary.verseIdEnd,
        entry_level: summary.entryLevel,
        word_count: summary.wordCount
      }));
    }
  );

  // Handler: Search commentary entries
  ipcHandler<[string, string, { limit?: number } | undefined], CommentarySearchResultDto[]>(
    'commentary:search',
    (abbreviation, query, options) => {
      validateAbbreviation(abbreviation);
      validateString(query, 'search query', 1000);
      const repo = requireCommentaryRepository(abbreviation);

      const entries = repo.searchEntries(query, options);
      const moduleInfo = repo.getModuleInfo();
      const moduleName = moduleInfo?.fullName || abbreviation;

      // Convert entries to search result format
      return entries.map(entry => {
        // Create a snippet from the content
        const text = entry.content || '';
        const plainText = text.replace(/<[^>]*>/g, ''); // Strip HTML
        const snippet = createCommentarySnippet(plainText, query, 200);

        // Create reference from verse ID
        const reference = entry.verseIdStart
          ? formatVerseReference(entry.verseIdStart, entry.verseIdEnd)
          : 'Unknown';

        return {
          entryId: entry.entryId,
          verseIdStart: entry.verseIdStart,
          verseIdEnd: entry.verseIdEnd,
          module: abbreviation,
          moduleName: moduleName,
          reference: reference,
          text: text,
          snippet: highlightSearchTerms(snippet, query),
          entryLevel: entry.entryLevel,
          type: 'commentary'
        };
      });
    }
  );
}

/**
 * Format a verse ID to a human-readable reference
 */
function formatVerseReference(verseIdStart: number, verseIdEnd?: number | null): string {
  const { bookNumber, chapter, verse } = VerseIdHelper.parse(verseIdStart);

  // getBookName supplies the same `Book <n>` fallback this used inline.
  const bookName = getBookName(bookNumber);

  if (verseIdEnd && verseIdEnd !== verseIdStart) {
    const end = VerseIdHelper.parse(verseIdEnd);
    if (end.chapter === chapter) {
      return `${bookName} ${chapter}:${verse}-${end.verse}`;
    } else {
      return `${bookName} ${chapter}:${verse}-${end.chapter}:${end.verse}`;
    }
  }

  return `${bookName} ${chapter}:${verse}`;
}

/**
 * Create a snippet with context around matched terms
 */
function createCommentarySnippet(text: string, query: string, maxLength: number): string {
  // Check if this is a phrase search (quoted)
  const isPhraseSearch = query.startsWith('"') && query.endsWith('"');
  const cleanQuery = query.replace(/["']/g, '');
  const terms = cleanQuery.split(/\s+/).filter(t => t.length > 0);

  if (terms.length === 0) {
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  }

  let firstMatchIndex = -1;

  // For phrase searches, try to find the complete phrase first (allowing for some variation)
  if (isPhraseSearch && terms.length > 1) {
    // Create a regex that allows for whitespace/punctuation between words
    const phrasePattern = terms
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s.,;:!?\\-]{0,10}');
    const phraseRegex = new RegExp(phrasePattern, 'i');
    const phraseMatch = phraseRegex.exec(text);
    if (phraseMatch) {
      firstMatchIndex = phraseMatch.index;
    }
  }

  // Fallback: find first occurrence of any term
  if (firstMatchIndex === -1) {
    for (const term of terms) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const match = regex.exec(text);
      if (match && (firstMatchIndex === -1 || match.index < firstMatchIndex)) {
        firstMatchIndex = match.index;
      }
    }
  }

  if (firstMatchIndex === -1) {
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  }

  // Create snippet centered around the match
  const contextBefore = Math.floor(maxLength / 3);
  let start = Math.max(0, firstMatchIndex - contextBefore);
  let end = Math.min(text.length, start + maxLength);

  // Adjust to word boundaries
  if (start > 0) {
    const wordStart = text.indexOf(' ', start);
    if (wordStart !== -1 && wordStart < firstMatchIndex) {
      start = wordStart + 1;
    }
  }

  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Highlight search terms in text
 */
function highlightSearchTerms(text: string, query: string): string {
  const terms = query.replace(/["']/g, '').split(/\s+/).filter(t => t.length > 0);
  let result = text;

  for (const term of terms) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, '<strong><u>$1</u></strong>');
  }

  return result;
}

/**
 * Search across multiple commentary modules
 * Used by searchHandlers for combined search
 */
export async function searchCommentaryModules(query: string, modules: string[]): Promise<any[]> {
  const allResults: any[] = [];

  for (const abbreviation of modules) {
    try {
      const repo = getCommentaryRepository(abbreviation);
      if (!repo) {
        log.warn(`Commentary module not found: ${abbreviation}`);
        continue;
      }

      const entries = repo.searchEntries(query, { limit: 50 });
      const moduleInfo = repo.getModuleInfo();
      const moduleName = moduleInfo?.fullName || abbreviation;

      // Convert entries to search result format
      for (const entry of entries) {
        const text = entry.content || '';
        const plainText = text.replace(/<[^>]*>/g, ''); // Strip HTML
        const snippet = createCommentarySnippet(plainText, query, 200);

        // Create reference from verse ID
        const reference = entry.verseIdStart
          ? formatVerseReference(entry.verseIdStart, entry.verseIdEnd)
          : 'Unknown';

        allResults.push({
          entryId: entry.entryId,
          verseId: entry.verseIdStart || 0,
          verseIdStart: entry.verseIdStart,
          verseIdEnd: entry.verseIdEnd,
          module: abbreviation,
          moduleName: moduleName,
          reference: `${moduleName} - ${reference}`,
          text: text,
          snippet: highlightSearchTerms(snippet, query),
          entryLevel: entry.entryLevel,
          type: 'commentary',
          matches: extractSearchMatches(plainText, query)
        });
      }
    } catch (error) {
      log.error(`Error searching commentary ${abbreviation}:`, error);
    }
  }

  return allResults;
}

/**
 * Extract search matches from text for highlighting
 */
function extractSearchMatches(text: string, query: string): Array<{ term: string; startPos: number; endPos: number }> {
  const terms = query.replace(/["']/g, '').split(/\s+/).filter(t => t.length > 0);
  const matches: Array<{ term: string; startPos: number; endPos: number }> = [];

  for (const term of terms) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        term: match[0],
        startPos: match.index,
        endPos: match.index + match[0].length
      });
    }
  }

  return matches;
}

/**
 * Clean up commentary database connections
 */
export function closeCommentaryDbs(): void {
  commentaryLoader.closeAll();
}
