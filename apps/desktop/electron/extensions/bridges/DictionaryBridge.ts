/**
 * Production `IExtensionDictionaryBridge`.
 *
 * Wraps the desktop's dictionary `ModuleLoader<DictionaryRepository>` and the
 * shared `ModuleMetadataRepository`. Mirrors `BibleBridge` / `CommentaryBridge`.
 */

import type { DictionaryRepository, DictionaryEntry } from '@bible/core';
import type { Extensions } from '@bible/core';

import type { IExtensionDictionaryBridge } from '../api-impl/IExtensionDataBridges';

type DictionaryEntryDto = Extensions.DictionaryEntryDto;
type DictionaryModuleInfoDto = Extensions.DictionaryModuleInfoDto;
type DictionaryIterationResult = Extensions.DictionaryIterationResult;

export interface DictionaryBridgeDeps {
  getDictionaryRepository(abbreviation: string): DictionaryRepository | null;
  listDictionaryModules(): {
    moduleId: string;
    abbreviation?: string;
    moduleName: string;
    languageCode?: string;
    version?: string;
  }[];
}

export class DictionaryBridge implements IExtensionDictionaryBridge {
  private readonly deps: DictionaryBridgeDeps;

  constructor(deps: DictionaryBridgeDeps) {
    this.deps = deps;
  }

  listModules(): DictionaryModuleInfoDto[] {
    return this.deps.listDictionaryModules().map((m) => {
      const abbr = m.abbreviation ?? m.moduleId;
      const dto: DictionaryModuleInfoDto = {
        id: m.moduleId,
        abbreviation: abbr,
        name: m.moduleName,
      };
      if (m.languageCode !== undefined) dto.language = m.languageCode;
      if (m.version !== undefined) dto.version = m.version;
      return dto;
    });
  }

  lookup(moduleId: string, key: string): DictionaryEntryDto | null {
    const repo = this.deps.getDictionaryRepository(moduleId);
    if (!repo) return null;
    const entry = repo.getEntryByKey(key);
    return entry ? toDictionaryEntryDto(moduleId, entry) : null;
  }

  search(moduleId: string, query: string, limit?: number): DictionaryEntryDto[] {
    const repo = this.deps.getDictionaryRepository(moduleId);
    if (!repo) return [];
    const opts = limit !== undefined ? { limit } : undefined;
    return repo.searchEntries(query, opts).map((e) => toDictionaryEntryDto(moduleId, e));
  }
  iterateEntries(
    moduleId: string,
    keyPrefix: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): DictionaryIterationResult {
    const repo = this.deps.getDictionaryRepository(moduleId);
    if (!repo) return { entries: [], hasMore: false };

    // Decode cursor - encodes offset into the sorted entry list.
    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch {
        /* invalid cursor - start from beginning */
      }
    }

    // Fetch all entries (repo sorts by entry_key). Filter by prefix if given.
    let allEntries = repo.getAllEntries();
    if (keyPrefix) {
      const prefix = keyPrefix.toLowerCase();
      allEntries = allEntries.filter((e) => e.entryKey.toLowerCase().startsWith(prefix));
    }

    const page = allEntries.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < allEntries.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;

    return {
      entries: page.map((e) => toDictionaryEntryDto(moduleId, e)),
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

function toDictionaryEntryDto(moduleId: string, e: DictionaryEntry): DictionaryEntryDto {
  const dto: DictionaryEntryDto = {
    key: e.entryKey,
    moduleId,
    headword: e.word ?? e.entryKey,
    content: e.definition,
    isHtml: true,
  };
  if (e.pronunciation !== undefined) dto.pronunciation = e.pronunciation;
  if (e.isStrongsEntry()) dto.strongsNumber = e.entryKey;
  const lang = e.getStrongsLanguage();
  if (lang === 'Hebrew') dto.language = 'he';
  else if (lang === 'Greek') dto.language = 'el';
  if (e.metadata !== undefined) dto.metadata = e.metadata;
  return dto;
}
