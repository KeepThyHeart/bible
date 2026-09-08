/**
 * Production `IExtensionCommentaryBridge`.
 *
 * Wraps the desktop's commentary `ModuleLoader<CommentaryRepository>` and the
 * shared `ModuleMetadataRepository` so an extension worker can read commentary
 * entries through the host's existing plumbing. Mirrors `BibleBridge`.
 *
 * Marshals `CommentaryEntry` model classes into the `CommentaryEntryDto` shape
 * the extension API contract guarantees. The DTO uses string `id` and
 * `moduleId` so the worker side can safely round-trip through JSON.
 */

import type { CommentaryRepository, CommentaryEntry } from '@bible/core';
import type { Extensions } from '@bible/core';

import type { IExtensionCommentaryBridge } from '../api-impl/IExtensionDataBridges';

type CommentaryEntryDto = Extensions.CommentaryEntryDto;
type CommentaryModuleInfoDto = Extensions.CommentaryModuleInfoDto;
type CommentaryIterationResult = Extensions.CommentaryIterationResult;

export interface CommentaryBridgeDeps {
  /** Resolve a commentary repository for the given module abbreviation. */
  getCommentaryRepository(abbreviation: string): CommentaryRepository | null;
  /**
   * Lookup of every registered commentary module's metadata, in display
   * order. Wired from `getSharedModuleMetadataRepo().getByType('commentary')`.
   */
  listCommentaryModules(): {
    moduleId: string;
    abbreviation?: string;
    moduleName: string;
    languageCode?: string;
    version?: string;
  }[];
}

export class CommentaryBridge implements IExtensionCommentaryBridge {
  private readonly deps: CommentaryBridgeDeps;

  constructor(deps: CommentaryBridgeDeps) {
    this.deps = deps;
  }

  listModules(): CommentaryModuleInfoDto[] {
    return this.deps.listCommentaryModules().map((m) => {
      const abbr = m.abbreviation ?? m.moduleId;
      const dto: CommentaryModuleInfoDto = {
        id: m.moduleId,
        abbreviation: abbr,
        name: m.moduleName,
      };
      if (m.languageCode !== undefined) dto.language = m.languageCode;
      if (m.version !== undefined) dto.version = m.version;
      return dto;
    });
  }

  getEntry(moduleId: string, verseId: number): CommentaryEntryDto | null {
    const repo = this.deps.getCommentaryRepository(moduleId);
    if (!repo) return null;
    const entries = repo.getEntriesForVerse(verseId);
    if (entries.length === 0) return null;
    // Prefer the most-specific entry (verse > passage > chapter > book).
    // `getEntriesForVerse` already sorts by entry_level DESC.
    return toCommentaryEntryDto(moduleId, entries[0]!);
  }

  getEntriesForRange(
    moduleId: string,
    startVerseId: number,
    endVerseId: number,
  ): CommentaryEntryDto[] {
    const repo = this.deps.getCommentaryRepository(moduleId);
    if (!repo) return [];
    return repo
      .getEntriesForRange(startVerseId, endVerseId)
      .map((e) => toCommentaryEntryDto(moduleId, e));
  }
  iterateEntries(
    moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): CommentaryIterationResult {
    const repo = this.deps.getCommentaryRepository(moduleId);
    if (!repo) return { entries: [], hasMore: false };

    const start = startVerseId ?? 1001001;
    const end = endVerseId ?? 66022021;

    // Decode cursor - encodes offset into the result set.
    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch {
        /* invalid cursor - start from beginning */
      }
    }

    const allEntries = repo
      .getEntriesForRange(start, end)
      .map((e) => toCommentaryEntryDto(moduleId, e));

    const page = allEntries.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < allEntries.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;

    return {
      entries: page,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

function toCommentaryEntryDto(moduleId: string, e: CommentaryEntry): CommentaryEntryDto {
  const startVerseId = e.verseIdStart ?? 0;
  const endVerseId = e.verseIdEnd ?? startVerseId;
  const dto: CommentaryEntryDto = {
    id: String(e.entryId ?? `${moduleId}:${startVerseId}:${endVerseId}`),
    moduleId,
    startVerseId,
    endVerseId,
    content: e.content,
    isHtml: true,
  };
  if (e.metadata !== undefined) dto.metadata = e.metadata;
  return dto;
}
