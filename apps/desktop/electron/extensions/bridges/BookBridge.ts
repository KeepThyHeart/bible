/**
 * Production `IExtensionBookBridge`.
 *
 * Wraps the desktop's book `ModuleLoader<BookRepository>` and the shared
 * `ModuleMetadataRepository`. Mirrors `BibleBridge`.
 *
 * `BookSection` model uses numeric IDs internally; the DTO uses strings so an
 * extension never has to know about the storage representation. We round-trip
 * via `String(sectionId)`.
 */

import type { BookRepository, BookSection } from '@bible/core';
import type { Extensions } from '@bible/core';

import type { IExtensionBookBridge } from '../api-impl/IExtensionDataBridges';

type BookSectionDto = Extensions.BookSectionDto;
type BookSectionSummaryDto = Extensions.BookSectionSummaryDto;
type BookModuleInfoDto = Extensions.BookModuleInfoDto;
type BookIterationResult = Extensions.BookIterationResult;

export interface BookBridgeDeps {
  getBookRepository(abbreviation: string): BookRepository | null;
  listBookModules(): {
    moduleId: string;
    abbreviation?: string;
    moduleName: string;
    languageCode?: string;
    version?: string;
  }[];
}

export class BookBridge implements IExtensionBookBridge {
  private readonly deps: BookBridgeDeps;

  constructor(deps: BookBridgeDeps) {
    this.deps = deps;
  }

  listModules(): BookModuleInfoDto[] {
    return this.deps.listBookModules().map((m) => {
      const abbr = m.abbreviation ?? m.moduleId;
      const dto: BookModuleInfoDto = {
        id: m.moduleId,
        abbreviation: abbr,
        name: m.moduleName,
      };
      if (m.languageCode !== undefined) dto.language = m.languageCode;
      if (m.version !== undefined) dto.version = m.version;
      return dto;
    });
  }

  getSection(moduleId: string, sectionId: string): BookSectionDto | null {
    const repo = this.deps.getBookRepository(moduleId);
    if (!repo) return null;
    const numericId = Number(sectionId);
    if (!Number.isFinite(numericId)) return null;
    const section = repo.getSection(numericId);
    if (!section) return null;
    const hasChildren = repo.getSectionsByParent(numericId).length > 0;
    return toBookSectionDto(moduleId, section, hasChildren);
  }

  listSections(moduleId: string, parentId?: string): BookSectionSummaryDto[] {
    const repo = this.deps.getBookRepository(moduleId);
    if (!repo) return [];
    const sections =
      parentId === undefined
        ? repo.getTopLevelSections()
        : (() => {
            const numericParent = Number(parentId);
            if (!Number.isFinite(numericParent)) return [];
            return repo.getSectionsByParent(numericParent);
          })();
    return sections.map((s, i) => {
      const hasChildren =
        s.sectionId !== undefined ? repo.getSectionsByParent(s.sectionId).length > 0 : false;
      return toBookSectionSummary(moduleId, s, hasChildren, i);
    });
  }
  iterateSections(
    moduleId: string,
    rootSectionId: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): BookIterationResult {
    const repo = this.deps.getBookRepository(moduleId);
    if (!repo) return { sections: [], hasMore: false };

    // Decode cursor - encodes offset into the flat section list.
    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch {
        /* invalid cursor - start from beginning */
      }
    }

    // Get sections - either descendants of rootSectionId or all sections.
    let allSections: BookSection[];
    if (rootSectionId !== undefined) {
      const numericRoot = Number(rootSectionId);
      if (!Number.isFinite(numericRoot)) return { sections: [], hasMore: false };
      allSections = repo.getAllSections().filter((s) => {
        // Walk up from s to see if rootSectionId is an ancestor.
        let current: BookSection | undefined = s;
        while (current) {
          if (current.parentSectionId === numericRoot) return true;
          if (current.sectionId === numericRoot) return true;
          current = current.parentSectionId != null
            ? repo.getSection(current.parentSectionId)
            : undefined;
        }
        return false;
      });
    } else {
      allSections = repo.getAllSections();
    }

    const page = allSections.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < allSections.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;

    const sections = page.map((s) => {
      const hasChildren =
        s.sectionId !== undefined ? repo.getSectionsByParent(s.sectionId).length > 0 : false;
      return toBookSectionDto(moduleId, s, hasChildren);
    });

    return {
      sections,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

function toBookSectionSummary(
  moduleId: string,
  s: BookSection,
  hasChildren: boolean,
  order: number,
): BookSectionSummaryDto {
  const dto: BookSectionSummaryDto = {
    id: String(s.sectionId ?? ''),
    moduleId,
    title: s.title,
    depth: s.getDepth(),
    hasChildren,
    order,
  };
  if (s.parentSectionId !== undefined && s.parentSectionId !== null) {
    dto.parentId = String(s.parentSectionId);
  }
  return dto;
}

function toBookSectionDto(
  moduleId: string,
  s: BookSection,
  hasChildren: boolean,
): BookSectionDto {
  const summary = toBookSectionSummary(moduleId, s, hasChildren, 0);
  const dto: BookSectionDto = {
    ...summary,
    content: s.content,
    isHtml: true,
  };
  if (s.metadata !== undefined) dto.metadata = s.metadata;
  return dto;
}
