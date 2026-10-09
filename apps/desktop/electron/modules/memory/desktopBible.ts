/**
 * The memory core's Bible port on desktop main (task 0114).
 *
 * Built on `BibleBridge`, the same bridge that serves extensions'
 * `api.bible.*`, so memory reads verses, books, chapters and references
 * exactly as the extension did, minus the RPC hop and the permission check.
 * The bridge is constructed here with the same shared repositories `main.ts`
 * hands the extension host, so memory works whether or not the extension host
 * is running.
 */

import type { MemoryBibleApi } from '@bible/memory/core';
import type { IExtensionBibleBridge } from '../../extensions/api-impl/IExtensionDataBridges';
import { BibleBridge } from '../../extensions/bridges/BibleBridge';
import { getBibleRepository } from '../../ipc/bibleHandlers';
import { getSharedBookRepo, getSharedModuleMetadataRepo } from '../../services/sharedMainDb';
import type { ModuleWindow } from '../FeatureMainModule';

/** Adapt the synchronous bridge to the async port the core uses. */
export function bibleApiFromBridge(bridge: Pick<IExtensionBibleBridge, 'getRange' | 'listModules' | 'listBooks' | 'listChapters' | 'parseReference' | 'navigateToVerse'>): MemoryBibleApi {
  return {
    getRange: async (start, end, opts) => bridge.getRange(start, end, opts?.module),
    listModules: async () => bridge.listModules(),
    listBooks: async (moduleId) => bridge.listBooks(moduleId),
    listChapters: async (bookNumber, moduleId) => bridge.listChapters(bookNumber, moduleId),
    parseReference: async (input, locale) => bridge.parseReference(input, locale),
    navigateToVerse: async (verseId) => bridge.navigateToVerse(verseId),
  };
}

/** Production wiring: mirrors the `BibleBridge` deps in `main.ts`. */
export function createDesktopBibleApi(getWindows: () => readonly ModuleWindow[]): MemoryBibleApi {
  const bibles = () => getSharedModuleMetadataRepo().getByType('bible');
  const bridge = new BibleBridge({
    getBibleRepository,
    listBibleModules: () =>
      bibles().map((m) => ({
        moduleId: m.moduleId !== undefined ? String(m.moduleId) : m.abbreviation || m.getAbbreviation(),
        abbreviation: m.abbreviation || m.getAbbreviation(),
        moduleName: m.moduleName,
        languageCode: m.languageCode,
        version: m.version,
      })),
    listAllBooks: () => getSharedBookRepo().getAll(),
    listChapterVerseCounts: (bookNumber: number) =>
      getSharedBookRepo()
        .getChapterInfoByBookNumber(bookNumber)
        .map((info) => ({ chapter: info.chapter, verseCount: info.verseCount })),
    getDefaultModuleAbbreviation: () => {
      const first = bibles()[0];
      return first ? first.abbreviation || first.getAbbreviation() || null : null;
    },
    sendNavigateToVerse: (verseId: number) => {
      for (const w of getWindows()) if (!w.isDestroyed()) w.webContents.send('extension:navigate-to-verse', verseId);
    },
  });
  return bibleApiFromBridge(bridge);
}
