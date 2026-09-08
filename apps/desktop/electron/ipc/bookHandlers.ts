import { IpcMain } from 'electron';
import log from 'electron-log/main';
import { BookRepository } from '@bible/core';
import { listInstalledModules } from '../services/installedModules';
import { ModuleLoader } from '../services/ModuleLoader';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { validateAbbreviation, validatePositiveInt, validateString, validateVerseId } from '../utils/validation';

const loader = new ModuleLoader('book', (db) => new BookRepository(db));

export function getBookRepository(abbreviation: string): BookRepository | null {
  return loader.get(abbreviation);
}

/**
 * Resolve a book repo by abbreviation or raise a classified `not_found` error
 * so the renderer can branch cleanly.
 */
function requireBookRepository(abbreviation: string): BookRepository {
  const repo = getBookRepository(abbreviation);
  if (!repo) {
    throw new IpcKnownError('not_found', `Book not found: ${abbreviation}`);
  }
  return repo;
}

interface AvailableBook {
  module_id: number | undefined;
  abbreviation: string;
  name: string;
  language_code: string | undefined;
  version: string | undefined;
  database_path: string;
}

interface BookInfoDto {
  abbreviation: string | undefined;
  full_name: string | undefined;
  author: string | undefined;
  year_published: number | undefined;
  copyright: string | undefined;
  description: string | undefined;
  language_code: string | undefined;
  publisher: string | undefined;
  version: string | undefined;
}

interface BookSectionDto {
  section_id: number | undefined;
  parent_section_id: number | undefined;
  section_number: string | undefined;
  title: string;
  content: string | undefined;
  content_file: string | undefined;
  word_count: number | undefined;
}

interface BookSectionListItemDto {
  section_id: number | undefined;
  parent_section_id: number | undefined;
  section_number: string | undefined;
  title: string;
  content: string | undefined;
  word_count: number | undefined;
}

interface BookSectionSummaryDto {
  section_id: number | undefined;
  parent_section_id: number | undefined;
  section_number: string | undefined;
  title: string;
  word_count: number | undefined;
  has_children: boolean | undefined;
}

interface BookSectionRefSummaryDto {
  section_id: number | undefined;
  parent_section_id: number | undefined;
  section_number: string | undefined;
  title: string;
  word_count: number | undefined;
}

interface BookScriptureReferenceDto {
  reference_id: number | undefined;
  content_id: number | undefined;
  verse_id_start: number;
  verse_id_end: number | undefined;
  context: string | undefined;
}

export function registerBookHandlers(_ipcMain: IpcMain): void {

  // Handler: Get list of available book modules
  ipcHandler<[], AvailableBook[]>('book:getAvailableBooks', () => {
    // Registered *and* present on disk - see `listInstalledModules`. Books
    // share the Library shelf and tab strip with dictionaries, so an entry
    // here that cannot be opened is the same defect in the same pane.
    const books = listInstalledModules('book');

    return books.map(module => ({
      module_id: module.moduleId,
      abbreviation: module.abbreviation || module.getAbbreviation(),
      name: module.moduleName,
      language_code: module.languageCode,
      version: module.version,
      database_path: module.databasePath
    }));
  });

  // Handler: Get book module info
  ipcHandler<[string], BookInfoDto>('book:getBookInfo', (abbreviation) => {
    validateAbbreviation(abbreviation);
    const repo = requireBookRepository(abbreviation);

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
      publisher: info.publisher,
      version: info.version
    };
  });

  // Handler: Get a specific book section by ID
  ipcHandler<[string, number], BookSectionDto | null>(
    'book:getSection',
    (abbreviation, sectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(sectionId, 'sectionId');
      const repo = requireBookRepository(abbreviation);

      const section = repo.getSection(sectionId);
      if (!section) {
        return null;
      }

      return {
        section_id: section.sectionId,
        parent_section_id: section.parentSectionId,
        section_number: section.sectionNumber,
        title: section.title,
        content: section.content,
        content_file: section.contentFile,
        word_count: section.wordCount
      };
    }
  );

  // Handler: Get top-level sections (table of contents root)
  ipcHandler<[string], BookSectionListItemDto[]>(
    'book:getTopLevelSections',
    (abbreviation) => {
      validateAbbreviation(abbreviation);
      const repo = requireBookRepository(abbreviation);

      const sections = repo.getTopLevelSections();

      return sections.map(section => ({
        section_id: section.sectionId,
        parent_section_id: section.parentSectionId,
        section_number: section.sectionNumber,
        title: section.title,
        content: section.content,
        word_count: section.wordCount
      }));
    }
  );

  // Handler: Get child sections of a parent section
  ipcHandler<[string, number], BookSectionListItemDto[]>(
    'book:getSectionsByParent',
    (abbreviation, parentSectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(parentSectionId, 'parentSectionId');
      const repo = requireBookRepository(abbreviation);

      const sections = repo.getSectionsByParent(parentSectionId);

      return sections.map(section => ({
        section_id: section.sectionId,
        parent_section_id: section.parentSectionId,
        section_number: section.sectionNumber,
        title: section.title,
        content: section.content,
        word_count: section.wordCount
      }));
    }
  );

  // Handler: Get all section summaries for tree view
  ipcHandler<[string], BookSectionSummaryDto[]>(
    'book:getAllSectionSummaries',
    (abbreviation) => {
      validateAbbreviation(abbreviation);
      const repo = requireBookRepository(abbreviation);

      const summaries = repo.getAllSectionSummaries();

      return summaries.map(summary => ({
        section_id: summary.sectionId,
        parent_section_id: summary.parentSectionId,
        section_number: summary.sectionNumber,
        title: summary.title,
        word_count: summary.wordCount,
        has_children: summary.hasChildren
      }));
    }
  );

  // Handler: Get next section in reading order (returns null on missing repo /
  // missing section / unexpected error - navigation should degrade silently).
  ipcHandler<[string, number], BookSectionListItemDto | null>(
    'book:getNextSection',
    (abbreviation, currentSectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(currentSectionId, 'currentSectionId');
      try {
        const repo = getBookRepository(abbreviation);
        if (!repo) {
          return null;
        }

        const nextSection = repo.getNextSection(currentSectionId);
        if (!nextSection) {
          return null;
        }

        return {
          section_id: nextSection.sectionId,
          parent_section_id: nextSection.parentSectionId,
          section_number: nextSection.sectionNumber,
          title: nextSection.title,
          content: nextSection.content,
          word_count: nextSection.wordCount
        };
      } catch (error) {
        log.error(`Error getting next section for ${abbreviation}, current section ${currentSectionId}:`, error);
        return null;
      }
    }
  );

  // Handler: Get previous section in reading order (returns null on missing
  // repo / missing section / unexpected error - navigation degrades silently).
  ipcHandler<[string, number], BookSectionListItemDto | null>(
    'book:getPreviousSection',
    (abbreviation, currentSectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(currentSectionId, 'currentSectionId');
      try {
        const repo = getBookRepository(abbreviation);
        if (!repo) {
          return null;
        }

        const prevSection = repo.getPreviousSection(currentSectionId);
        if (!prevSection) {
          return null;
        }

        return {
          section_id: prevSection.sectionId,
          parent_section_id: prevSection.parentSectionId,
          section_number: prevSection.sectionNumber,
          title: prevSection.title,
          content: prevSection.content,
          word_count: prevSection.wordCount
        };
      } catch (error) {
        log.error(`Error getting previous section for ${abbreviation}, current section ${currentSectionId}:`, error);
        return null;
      }
    }
  );

  // Handler: Get parent section (returns null on missing repo / missing
  // section / unexpected error - navigation degrades silently).
  ipcHandler<[string, number], BookSectionListItemDto | null>(
    'book:getParentSection',
    (abbreviation, currentSectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(currentSectionId, 'currentSectionId');
      try {
        const repo = getBookRepository(abbreviation);
        if (!repo) {
          return null;
        }

        const parentSection = repo.getParentSection(currentSectionId);
        if (!parentSection) {
          return null;
        }

        return {
          section_id: parentSection.sectionId,
          parent_section_id: parentSection.parentSectionId,
          section_number: parentSection.sectionNumber,
          title: parentSection.title,
          content: parentSection.content,
          word_count: parentSection.wordCount
        };
      } catch (error) {
        log.error(`Error getting parent section for ${abbreviation}, current section ${currentSectionId}:`, error);
        return null;
      }
    }
  );

  // Handler: Search book sections
  ipcHandler<[string, string, number | undefined], BookSectionListItemDto[]>(
    'book:searchSections',
    (abbreviation, query, limit) => {
      validateAbbreviation(abbreviation);
      validateString(query, 'search query', 1000);
      const repo = requireBookRepository(abbreviation);

      const sections = repo.searchSections(query, { limit });

      return sections.map(section => ({
        section_id: section.sectionId,
        parent_section_id: section.parentSectionId,
        section_number: section.sectionNumber,
        title: section.title,
        content: section.content,
        word_count: section.wordCount
      }));
    }
  );

  // Handler: Get scripture references mentioned in a section
  ipcHandler<[string, number], BookScriptureReferenceDto[]>(
    'book:getScriptureReferences',
    (abbreviation, sectionId) => {
      validateAbbreviation(abbreviation);
      validatePositiveInt(sectionId, 'sectionId');
      const repo = requireBookRepository(abbreviation);

      const references = repo.getScriptureReferences(sectionId);

      return references.map(ref => ({
        reference_id: ref.referenceId,
        content_id: ref.contentId,
        verse_id_start: ref.verseIdStart,
        verse_id_end: ref.verseIdEnd,
        context: ref.context
      }));
    }
  );

  // Handler: Get sections that reference a specific verse
  ipcHandler<[string, number], BookSectionRefSummaryDto[]>(
    'book:getSectionsReferencingVerse',
    (abbreviation, verseId) => {
      validateAbbreviation(abbreviation);
      validateVerseId(verseId);
      const repo = requireBookRepository(abbreviation);

      const sections = repo.getSectionsReferencingVerse(verseId);

      return sections.map(section => ({
        section_id: section.sectionId,
        parent_section_id: section.parentSectionId,
        section_number: section.sectionNumber,
        title: section.title,
        word_count: section.wordCount
      }));
    }
  );
}

/**
 * Clean up book database connections
 */
export function closeBookDbs(): void {
  loader.closeAll();
}
