import { IpcMain } from 'electron';
import log from 'electron-log';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  SqliteModuleRepositoryFactory,
  nodeCodecRegistry,
  wrapSqlConnection,
} from '@bible/core';
import type {
  ICodecRegistry,
  IModuleRepositoryFactory,
  ITimelineRepository,
} from '@bible/core';
import type { TimelineDataset } from '@bible/core/browser';
import { getDataPath, getUserModulesPath, resolveModulePath } from '../utils/appPaths';
import { ipcHandler } from './handler-helper';
import { getModuleDatabaseRegistry } from '../services/ModuleDatabaseRegistry';
import { listInstalledModules } from '../services/installedModules';

/**
 * Timeline module (module_type 'timeline'): one read-only file holding items,
 * dates per chronology, lanes and passage links. The whole module is served to
 * the renderer as a single `TimelineDataset` (a few thousand rows at most), so
 * there is one channel and the dataset is cached after the first read.
 */

const repositoryFactory: IModuleRepositoryFactory = new SqliteModuleRepositoryFactory();
const codecs: ICodecRegistry = nodeCodecRegistry();

/** Cached dataset. `null` is deliberately not cached: a module installed later is picked up. */
let cachedDataset: TimelineDataset | null = null;
let openedPath: string | null = null;

const TIMELINE_FILE = /^timeline.*\.db$/i;

function timelineFilesIn(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => TIMELINE_FILE.test(name))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Candidate database paths, best first: modules registered in `main.db` with
 * type 'timeline', then any `timeline*.db` file in the user modules and bundled
 * data directories (a fresh dev checkout has the file but no registry row).
 */
export function findTimelineModulePaths(): string[] {
  const paths: string[] = [];
  try {
    for (const module of listInstalledModules('timeline')) {
      paths.push(resolveModulePath(module.databasePath));
    }
  } catch (error) {
    log.debug('[timeline] module registry lookup failed, probing files:', error);
  }
  paths.push(...timelineFilesIn(getUserModulesPath()), ...timelineFilesIn(getDataPath()));
  return [...new Set(paths)];
}

function loadDataset(): TimelineDataset | null {
  if (cachedDataset) return cachedDataset;

  for (const dbPath of findTimelineModulePaths()) {
    const db = getModuleDatabaseRegistry().openByPath(dbPath, { readonly: true });
    if (!db) continue;
    const repo = repositoryFactory.create(wrapSqlConnection(db), 'timeline', codecs) as ITimelineRepository | null;
    if (!repo) continue;
    try {
      cachedDataset = repo.getDataset();
      openedPath = dbPath;
      log.info('Timeline module loaded:', dbPath);
      return cachedDataset;
    } catch (error) {
      log.warn(`[timeline] ${dbPath} is not a readable timeline module:`, error);
    }
  }
  return null;
}

export function registerTimelineHandlers(_ipcMain: IpcMain): void {
  ipcHandler<[], TimelineDataset | null>('timeline:getDataset', () => loadDataset());
}

export function closeTimelineDb(): void {
  // The handle is owned by ModuleDatabaseRegistry (closed on `will-quit`);
  // drop only our cached copy.
  if (openedPath) getModuleDatabaseRegistry().close(openedPath);
  openedPath = null;
  cachedDataset = null;
}
