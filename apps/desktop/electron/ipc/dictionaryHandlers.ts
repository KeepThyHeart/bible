import { IpcMain } from 'electron';
import { DictionaryRepository, readNewlineHandling, type NewlineHandling } from '@bible/core';
import { listInstalledModules } from '../services/installedModules';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validatePositiveInt, validateString, validateVerseId } from '../utils/validation';

const loader = new ModuleLoader('dictionary', (db) => new DictionaryRepository(db));

export function getDictionaryRepository(abbreviation: string): DictionaryRepository | null {
  return loader.get(abbreviation);
}

/**
 * Resolve a dictionary repo by abbreviation or raise a classified
 * `not_found` error so the renderer can branch cleanly.
 */
function requireDictionaryRepository(abbreviation: string): DictionaryRepository {
  const repo = getDictionaryRepository(abbreviation);
  if (!repo) {
    // Phrased for the pane, which shows this string verbatim in its error
    // state. The available-dictionaries list is filtered to what is on disk,
    // so reaching this means a restored session tab or a module removed while
    // the app was running - both recoverable by reinstalling.
    throw new IpcKnownError(
      'not_found',
      `The dictionary “${abbreviation}” is not installed. You can reinstall it from the Module Manager.`
    );
  }
  return repo;
}

/**
 * How this module wants its definitions' newlines treated, per its
 * `module_info.metadata.newline_handling` declaration - `undefined` when it
 * does not declare one, which leaves the decision to the renderer's per-entry
 * fallback (`resolveNewlineHandling`).
 *
 * Sent with the entry rather than left to a separate `getDictionaryInfo` call
 * so the definition and the rule for rendering it always travel together.
 * Cached per abbreviation: it is one row from an already-open connection, but
 * it never changes for the life of the process and every entry lookup needs it.
 */
const newlineHandlingCache = new Map<string, NewlineHandling | undefined>();

function moduleNewlineHandling(abbreviation: string, repo: DictionaryRepository):
  NewlineHandling | undefined {
  if (newlineHandlingCache.has(abbreviation)) return newlineHandlingCache.get(abbreviation);
  const handling = readNewlineHandling(repo.getModuleInfo()?.metadata);
  newlineHandlingCache.set(abbreviation, handling);
  return handling;
}

interface AvailableDictionary {
  module_id: number | undefined;
  abbreviation: string;
  name: string;
  language_code: string | undefined;
  version: string | undefined;
  database_path: string;
}

interface DictionaryInfoDto {
  abbreviation: string | undefined;
  full_name: string | undefined;
  dictionary_type: string | undefined;
  language_from: string | undefined;
  language_to: string | undefined;
  author: string | undefined;
  year_published: number | undefined;
  copyright: string | undefined;
  description: string | undefined;
  version: string | undefined;
}

interface DictionaryEntryDto {
  entry_id: number | undefined;
  entry_key: string;
  word: string | undefined;
  transliteration: string | undefined;
  pronunciation: string | undefined;
  part_of_speech: string | undefined;
  definition: string;
  etymology: string | undefined;
  usage_notes: string | undefined;
  semantic_range: string | undefined;
  related_words: string[] | undefined;
  example_verses: Array<{ verseId: number; text?: string }> | undefined;
  content_file: string | undefined;
  metadata: unknown;
  /** The module's declared newline handling; absent when it declares none. */
  newline_handling: NewlineHandling | undefined;
}

interface DictionaryEntrySummaryDto {
  entry_id: number | undefined;
  entry_key: string;
  word: string | undefined;
  definition: string;
  transliteration: string | undefined;
  part_of_speech: string | undefined;
}

interface DictionaryOccurrenceDto {
  occurrence_id: number | undefined;
  entry_key: string;
  verse_id: number;
  bible_module: string | undefined;
  translation_word: string | undefined;
  metadata: unknown;
}

export function registerDictionaryHandlers(_ipcMain: IpcMain): void {

  // Handler: Get list of available dictionary modules
  ipcHandler<[], AvailableDictionary[]>(
    'dictionary:getAvailableDictionaries',
    () => {
      // Registered *and* present on disk. A `module_metadata` row outlives its
      // file, and a dictionary offered here but missing underneath fails at
      // the first lookup rather than at the point of choosing it.
      const dictionaries = listInstalledModules('dictionary');

      return dictionaries.map(module => ({
        module_id: module.moduleId,
        abbreviation: module.abbreviation || module.getAbbreviation(),
        name: module.moduleName,
        language_code: module.languageCode,
        version: module.version,
        database_path: module.databasePath
      }));
    }
  );

  // Handler: Get dictionary module info
  ipcHandler<[string], DictionaryInfoDto>(
    'dictionary:getDictionaryInfo',
    (abbreviation) => {
      validateAbbreviation(abbreviation);
      const repo = requireDictionaryRepository(abbreviation);

      const info = repo.getModuleInfo();
      if (!info) {
        throw new IpcKnownError('not_found', `No module info found for: ${abbreviation}`);
      }

      return {
        abbreviation: info.abbreviation,
        full_name: info.fullName,
        dictionary_type: info.dictionaryType,
        language_from: info.languageFrom,
        language_to: info.languageTo,
        author: info.author,
        year_published: info.yearPublished,
        copyright: info.copyright,
        description: info.description,
        version: info.version
      };
    }
  );

  // Handler: Get dictionary entry by ID
  ipcHandler<[string, number], DictionaryEntryDto | null>(
    'dictionary:getEntry',
    (abbreviation, entryId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(entryId, 'entryId');
      const repo = requireDictionaryRepository(abbreviation);

      const entry = repo.getEntry(entryId);
      if (!entry) {
        return null;
      }

      return {
        entry_id: entry.entryId,
        entry_key: entry.entryKey,
        word: entry.word,
        transliteration: entry.transliteration,
        pronunciation: entry.pronunciation,
        part_of_speech: entry.partOfSpeech,
        definition: entry.definition,
        etymology: entry.etymology,
        usage_notes: entry.usageNotes,
        semantic_range: entry.semanticRange,
        related_words: entry.relatedWords,
        example_verses: entry.exampleVerses,
        content_file: entry.contentFile,
        metadata: entry.metadata,
        newline_handling: moduleNewlineHandling(abbreviation, repo)
      };
    }
  );

  // Handler: Get dictionary entry by key
  ipcHandler<[string, string], DictionaryEntryDto | null>(
    'dictionary:getEntryByKey',
    (abbreviation, entryKey) => {
      validateAbbreviation(abbreviation);
      validateString(entryKey, 'entryKey', 200);
      const repo = requireDictionaryRepository(abbreviation);

      const entry = repo.getEntryByKey(entryKey);
      if (!entry) {
        return null;
      }

      return {
        entry_id: entry.entryId,
        entry_key: entry.entryKey,
        word: entry.word,
        transliteration: entry.transliteration,
        pronunciation: entry.pronunciation,
        part_of_speech: entry.partOfSpeech,
        definition: entry.definition,
        etymology: entry.etymology,
        usage_notes: entry.usageNotes,
        semantic_range: entry.semanticRange,
        related_words: entry.relatedWords,
        example_verses: entry.exampleVerses,
        content_file: entry.contentFile,
        metadata: entry.metadata,
        newline_handling: moduleNewlineHandling(abbreviation, repo)
      };
    }
  );

  // Handler: Search dictionary entries
  ipcHandler<[string, string, number | undefined], DictionaryEntrySummaryDto[]>(
    'dictionary:searchEntries',
    (abbreviation, query, limit) => {
      validateAbbreviation(abbreviation);
      validateString(query, 'search query', 500);
      const repo = requireDictionaryRepository(abbreviation);

      const entries = repo.searchEntries(query, { limit });

      return entries.map(entry => ({
        entry_id: entry.entryId,
        entry_key: entry.entryKey,
        word: entry.word,
        definition: entry.definition,
        transliteration: entry.transliteration,
        part_of_speech: entry.partOfSpeech
      }));
    }
  );

  // Handler: Get all dictionary entries (paginated)
  ipcHandler<[string, number | undefined, number | undefined], DictionaryEntrySummaryDto[]>(
    'dictionary:getAllEntries',
    (abbreviation, limit, offset) => {
      validateAbbreviation(abbreviation);
      const repo = requireDictionaryRepository(abbreviation);

      const entries = repo.getAllEntries({ limit, offset });

      return entries.map(entry => ({
        entry_id: entry.entryId,
        entry_key: entry.entryKey,
        word: entry.word,
        definition: entry.definition,
        transliteration: entry.transliteration,
        part_of_speech: entry.partOfSpeech
      }));
    }
  );

  // Handler: Get word occurrences for a Strong's number
  ipcHandler<[string, string], DictionaryOccurrenceDto[]>(
    'dictionary:getOccurrences',
    (abbreviation, entryKey) => {
      validateAbbreviation(abbreviation);
      validateString(entryKey, 'entryKey', 200);
      const repo = requireDictionaryRepository(abbreviation);

      const occurrences = repo.getOccurrences(entryKey);

      return occurrences.map(occ => ({
        occurrence_id: occ.occurrenceId,
        entry_key: occ.entryKey,
        verse_id: occ.verseId,
        bible_module: occ.bibleModule,
        translation_word: occ.translationWord,
        metadata: occ.metadata
      }));
    }
  );

  // Handler: Get occurrences for a specific verse
  ipcHandler<[string, number], DictionaryOccurrenceDto[]>(
    'dictionary:getOccurrencesForVerse',
    (abbreviation, verseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(verseId);
      const repo = requireDictionaryRepository(abbreviation);

      const occurrences = repo.getOccurrencesForVerse(verseId);

      return occurrences.map(occ => ({
        occurrence_id: occ.occurrenceId,
        entry_key: occ.entryKey,
        verse_id: occ.verseId,
        bible_module: occ.bibleModule,
        translation_word: occ.translationWord,
        metadata: occ.metadata
      }));
    }
  );
}

/**
 * Clean up dictionary database connections
 */
export function closeDictionaryDbs(): void {
  loader.closeAll();
}
