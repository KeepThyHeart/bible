import { existsSync } from 'fs';
import log from 'electron-log';
import type { ModuleMetadata, ModuleType } from '@bible/core';
import { getSharedModuleMetadataRepo } from './sharedMainDb';
import { resolveModulePath } from '../utils/appPaths';

/**
 * Abbreviations already reported as registered-but-absent, so a module that is
 * missing on disk produces one log line rather than one per list request. The
 * list is fetched whenever a pane mounts, which on a busy layout is often.
 */
const reportedMissing = new Set<string>();

/**
 * Every module of `moduleType` that is registered in `main.db` **and** whose
 * database file is actually on disk.
 *
 * `module_metadata` is a registry, not an inventory: a row survives the file
 * being deleted, a partial install, or a data directory that was populated on
 * another machine. Listing straight from it therefore offered modules that
 * cannot be opened - the reported case was `Webster's Dictionary 1828` showing
 * in the dictionary picker on a machine where `dictionary_webster1828.db` was
 * never installed, so choosing it and typing a word produced an error instead
 * of a definition.
 *
 * Filtering here rather than marking the entry "not installed" in the UI is the
 * least surprising of the two: the picker's job is to list what can be opened
 * now, and the Module Manager is the place that already lists what *could* be
 * installed. A greyed-out row in the picker would only raise the question of
 * how to install it, which is the Module Manager's answer.
 *
 * The `existsSync` cost is one stat per registered module of the type - tens,
 * not thousands - and it has to be a live check rather than a cached one so a
 * module installed while the app is running shows up on the next fetch.
 */
export function listInstalledModules(moduleType: ModuleType): ModuleMetadata[] {
  const registered = getSharedModuleMetadataRepo().getByType(moduleType);

  return registered.filter((module) => {
    const key = `${moduleType}:${module.abbreviation || module.getAbbreviation()}`;

    if (existsSync(resolveModulePath(module.databasePath))) {
      // Reinstalled since it was last reported: let it be reported again if it
      // ever goes missing a second time.
      reportedMissing.delete(key);
      return true;
    }

    if (!reportedMissing.has(key)) {
      reportedMissing.add(key);
      log.warn(
        `[installedModules] ${key} is registered in main.db but ${module.databasePath} ` +
          `is not on disk — omitting it from the available ${moduleType} list.`
      );
    }
    return false;
  });
}
