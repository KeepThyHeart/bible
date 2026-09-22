import { readdirSync, statSync, existsSync, mkdirSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';
import { getDataPath, getUserModulesPath, resolveMainDbPath } from './appPaths';
import { SqliteProvider } from '../providers/SqliteProvider';
import {
  ModuleMetadataRepository,
  BibleRepository,
  CommentaryRepository,
  DictionaryRepository,
  TopicalIndexRepository,
  CrossReferenceRepository,
  ModuleMetadata,
  ModuleType,
  crossReferenceSlugs,
  isCrossReferenceSourceCommentary,
  isCrossReferenceSourceCommentaryPath,
  hasSqliteHeader,
  validateModuleFile,
  nodeCodecRegistry,
  SQLITE_MODULE_EXTENSIONS
} from '@bible/core';
import type { FormatVersionKind } from '@bible/core';

/**
 * First 16 bytes of `path`, or `null` if fewer than 16 could be read at all.
 * Never throws - this scan is best-effort over a directory that may contain
 * anything, including a truncated download or a non-module file a user
 * dropped in by hand. The byte comparison itself is `hasSqliteHeader()`, in
 * `@bible/core` - kept in exactly one place so this file and
 * `InstallationService.ts`'s equivalent helper can never drift against each
 * other (see F5, task 0027).
 */
function readHeaderBytes(path: string): Uint8Array | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = readSync(fd, buffer, 0, 16, 0);
    return bytesRead < 16 ? null : buffer;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/**
 * Module detection and registration helper
 * Scans the data/modules folder and registers discovered modules in main.db
 */

interface ModuleDetectionResult {
  detected: number;
  registered: number;
  updated: number;
  /** Rows removed because they should never have been registered. */
  deregistered: number;
  errors: string[];
}

/**
 * Extract module type from filename
 * @example
 * - "bible_kjv.db" -> "bible"
 * - "commentary_wesley.db" -> "commentary"
 *
 * M11 (task 0026, revision 2) moved the accepted FILE EXTENSION off a literal
 * onto `IModuleStore.extensions` (see the `.filter()` call above), but
 * deliberately leaves this prefix -> `ModuleType` mapping as it is: nothing in
 * `IModuleStore` names a filename-prefix convention (only `extensions` and
 * `canOpen()`/`open()`, which operate on a whole locator, not a type
 * decision), and only one store exists to ask today, so adding a speculative
 * "which store claims this prefix" concept here would be new surface with no
 * real second implementation to justify its shape yet. This stays a small,
 * self-contained, well-tested mapping.
 */
function getModuleTypeFromFilename(filename: string): ModuleType | null {
  // tag_graph.db carries no abbreviation segment, so match it before splitting.
  if (filename.startsWith('tag_graph')) return 'tag_graph';

  const prefix = filename.split('_')[0];

  // Map filename prefixes to module types
  const prefixMap: Record<string, ModuleType> = {
    bible: 'bible',
    commentary: 'commentary',
    dictionary: 'dictionary',
    book: 'book',
    devotional: 'devotional',
    lexicon: 'lexicon',
    topical: 'topical_index',
    xref: 'cross_reference',
  };

  return prefixMap[prefix] ?? null;
}

/** What `getModuleInfoFromDatabase` reports about a module file. */
interface DetectedModuleInfo {
  moduleUuid?: string;
  moduleName: string;
  abbreviation: string;
  version?: string;
  languageCode?: string;
  /**
   * `module_info.format_version`'s classification, from the same F5 rule
   * table `InstallationService.validateModuleForInstall` uses - `undefined`
   * only if `module_info` itself could not be read (which the `moduleUuid`
   * check just above this field's one call site already guards against, so
   * in practice this is always set whenever `moduleUuid` is too). See
   * `validateModuleFile`'s doc comment in `@bible/core`.
   */
  formatVersionKind?: FormatVersionKind;
}

/**
 * Read module info from a module database
 */
function getModuleInfoFromDatabase(
  moduleType: ModuleType,
  dbPath: string
): DetectedModuleInfo | null {
  try {
    const db = new SqliteProvider(dbPath);

    let result: DetectedModuleInfo | null = null;

    // Read module_info based on module type
    switch (moduleType) {
      case 'bible': {
        const repo = new BibleRepository(db);
        const info = repo.getModuleInfo();
        if (info) {
          result = {
            moduleUuid: info.moduleUuid,
            moduleName: info.fullName,
            abbreviation: info.abbreviation,
            version: info.version,
            languageCode: info.languageCode
          };
        }
        break;
      }

      case 'commentary': {
        const repo = new CommentaryRepository(db);
        const info = repo.getModuleInfo();
        if (info) {
          result = {
            moduleUuid: info.moduleUuid,
            moduleName: info.fullName,
            abbreviation: info.abbreviation,
            version: info.version,
            languageCode: info.languageCode
          };
        }
        break;
      }

      case 'dictionary':
      case 'lexicon': {
        const repo = new DictionaryRepository(db);
        const info = repo.getModuleInfo();
        if (info) {
          result = {
            moduleUuid: info.moduleUuid,
            moduleName: info.fullName,
            abbreviation: info.abbreviation,
            version: info.version,
            languageCode: info.languageTo
          };
        }
        break;
      }

      case 'topical_index': {
        const repo = new TopicalIndexRepository(db);
        const info = repo.getModuleInfo();
        if (info) {
          result = {
            moduleUuid: info.moduleUuid,
            moduleName: info.fullName,
            abbreviation: info.abbreviation,
            version: info.version,
            languageCode: info.languageCode
          };
        }
        break;
      }

      case 'cross_reference': {
        const repo = new CrossReferenceRepository(db);
        const info = repo.getModuleInfo();
        if (info) {
          result = {
            moduleUuid: info.moduleUuid,
            moduleName: info.fullName,
            abbreviation: info.abbreviation,
            version: info.version,
            languageCode: info.languageCode
          };
        }
        break;
      }

      case 'book':
      case 'devotional':
      case 'tag_graph': {
        // For now, we'll extract basic info from the database
        // TODO: Implement DevotionalRepository with getModuleInfo()
        //
        // M11 (task 0026, revision 2) considered routing the 'book' branch
        // through the now-implemented `BookRepository.getModuleInfo()`
        // (`@bible/core`) instead of this raw query, and deliberately left it
        // as is: `BaseModuleInfo` has no fallback for a missing `full_name`
        // ("Unknown"), a missing `abbreviation` (derived from the name here)
        // or a missing `language_code` ("en") the way this defensive branch
        // does, so swapping would be an observable behavior change for any
        // legacy/malformed book file that is missing one of those columns -
        // exactly the input this fallback exists to tolerate. 'devotional'
        // has no repository class at all, and 'tag_graph' (`TagGraphRepository`)
        // has no `getModuleInfo()`/module_info concept whatsoever, so neither
        // of those two can route through a repository regardless.
        const row = db.queryOne('SELECT * FROM module_info WHERE info_id = 1');
        if (row) {
          const fullName = String(row.full_name || row.title || 'Unknown');
          result = {
            moduleUuid: row.module_uuid != null ? String(row.module_uuid) : undefined,
            moduleName: fullName,
            abbreviation: String(row.abbreviation || fullName.split(' ')[0]?.toUpperCase() || 'UNK'),
            version: row.content_version != null ? String(row.content_version)
              : (row.version != null ? String(row.version) : undefined),
            languageCode: String(row.language_code || 'en')
          };
        }
        break;
      }
    }

    // F5 (task 0027): the boot scan's format_version gap. Reuses the SAME
    // open connection above rather than a second query written by hand here
    // - `validateModuleFile()` is the one place the allow-list check lives
    // (never re-implemented locally, per its doc comment). Only the
    // classification is carried out; `moduleUuid`'s presence just below this
    // function's one call site is still that separate, pre-existing check -
    // and `compression`/codec availability is not this call site's concern
    // at all (blank cell for the boot scan in the F5 design doc's table).
    if (result) {
      const validation = validateModuleFile(db, nodeCodecRegistry());
      result.formatVersionKind = validation.formatVersionKind;
    }

    db.close();
    return result;
  } catch (error) {
    log.error(`Error reading module info from ${dbPath}:`, error);
    return null;
  }
}

/**
 * Detect and register modules from the data/modules folder
 * @returns Detection result summary
 */
/**
 * Canonical form of a `module_metadata.database_path`.
 *
 * The registry stores POSIX-style relative paths on every platform, so that a
 * database written on one OS is readable on another and so path comparison is
 * separator-independent. Always route a path through here before storing it or
 * comparing it against a stored one.
 */
export function toRegistryPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function detectAndRegisterModules(): ModuleDetectionResult {
  const result: ModuleDetectionResult = {
    detected: 0,
    registered: 0,
    updated: 0,
    deregistered: 0,
    errors: []
  };

  // Compute paths based on environment. `dataPath` locates the BUNDLED module
  // files (read-only, in the install prefix); the database this writes the
  // registrations into is user-writable and resolved separately.
  const dataPath = getDataPath();
  const mainDbPath = resolveMainDbPath();

  log.info('Starting module detection...');
  log.info(`Data path: ${dataPath}`);
  log.info(`Main DB path: ${mainDbPath}`);

  const bundledModulesPath = join(dataPath, 'modules');
  const userModulesPath = getUserModulesPath();

  // Ensure user modules directory exists
  if (!existsSync(userModulesPath)) {
    mkdirSync(userModulesPath, { recursive: true });
  }

  // Collect module files from both locations
  // Bundled modules (read-only, shipped with app) and user modules (downloaded)
  const moduleDirs: { path: string; label: string }[] = [];
  if (existsSync(bundledModulesPath)) {
    moduleDirs.push({ path: bundledModulesPath, label: 'bundled' });
  }
  // Only add user dir if it's different from bundled (production mode)
  if (userModulesPath !== bundledModulesPath && existsSync(userModulesPath)) {
    moduleDirs.push({ path: userModulesPath, label: 'user' });
  }

  try {
    // Open main database
    const mainDb = new SqliteProvider(mainDbPath);
    const metadataRepo = new ModuleMetadataRepository(mainDb);

    // Modules installed from the catalog by earlier builds were registered as
    // `topical` / `xref`, which nothing looks up. Rename them in place.
    for (const [legacy, canonical] of [['topical', 'topical_index'], ['xref', 'cross_reference']]) {
      try {
        mainDb.execute('UPDATE module_metadata SET module_type = ? WHERE module_type = ?', [canonical, legacy]);
      } catch (error) {
        // An old main.db whose CHECK rejects the canonical name is rebuilt by
        // migration 005; there is nothing to repair until then.
        log.warn(`[moduleDetector] Could not rename ${legacy} modules to ${canonical}: ${error}`);
      }
    }

    // Build a set of already-registered database paths so we can skip known modules
    // This avoids opening every .db file on every startup just to re-read metadata
    //
    // Paths are compared with FORWARD SLASHES on every platform. `path.join`
    // yields `modules\x.db` on Windows while the registry stores `modules/x.db`,
    // so an un-normalised comparison never matched and every launch re-registered
    // all 131 modules -- main.db had grown to exactly 2x the module count, one
    // row per separator style.
    const allRegistered = metadataRepo.getAll();
    const registeredPaths = new Set(
      allRegistered.map(m => toRegistryPath(m.databasePath))
    );

    // Every module filename across BOTH directories, gathered before any
    // registration decision: a `commentary_<slug>.db` and its generated
    // `xref_<slug>.db` need not live in the same directory (one can be bundled
    // and the other downloaded), so the shadowing rule cannot be evaluated one
    // directory at a time.
    // M11 (task 0026, revision 2): the accepted extension list is
    // `SQLITE_MODULE_EXTENSIONS` (`@bible/core`, currently just `['.db']`) -
    // the same constant `SqliteModuleStore.extensions` is built from -
    // rather than a literal repeated here. Every module file this app can
    // currently open is SQLite, so this resolves to exactly the old
    // `f.endsWith('.db')` today; a second store (a CSV/JSON backend) would
    // extend the accepted set in one place instead of here.
    const filesByDir = moduleDirs.map(dir => ({
      dir,
      moduleFiles: readdirSync(dir.path).filter(f => {
        const lower = f.toLowerCase();
        return SQLITE_MODULE_EXTENSIONS.some(ext => lower.endsWith(ext)) &&
          !f.startsWith('main') &&
          !f.startsWith('user');
      })
    }));
    const xrefSlugs = crossReferenceSlugs(filesByDir.flatMap(entry => entry.moduleFiles));

    // Drop any row an older build registered that the rule now excludes, so an
    // existing install converges on the same registry a fresh one produces.
    // Without this, dev machines would keep the duplicate TSK commentary
    // (module_id 100 here) forever while fresh installs never had it.
    for (const registered of allRegistered) {
      if (registered.moduleType !== 'commentary') continue;
      if (!isCrossReferenceSourceCommentaryPath(registered.databasePath, xrefSlugs)) continue;
      if (registered.moduleId === undefined) continue;
      try {
        metadataRepo.delete(registered.moduleId);
        registeredPaths.delete(toRegistryPath(registered.databasePath));
        result.deregistered++;
        log.info(
          `De-registered ${registered.databasePath}: it is the source of an installed ` +
          `cross-reference module, not a browsable commentary`
        );
      } catch (error) {
        const errorMsg = `Error de-registering ${registered.databasePath}: ${error}`;
        log.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    for (const { dir: moduleDir, moduleFiles } of filesByDir) {
      log.info(`Found ${moduleFiles.length} potential module files in ${moduleDir.label} dir`);

      for (const file of moduleFiles) {
        const relativePath = toRegistryPath(join('modules', file));

        // Skip modules that are already registered - no need to open the .db
        if (registeredPaths.has(relativePath)) {
          result.detected++;
          continue;
        }

        const fullPath = join(moduleDir.path, file);
        const moduleType = getModuleTypeFromFilename(file);

        if (!moduleType) {
          log.warn(`Skipping ${file}: unable to determine module type`);
          continue;
        }

        // A commentary that is only the import source of an installed
        // cross-reference module is not a module the user should browse. The
        // file stays on disk and stays usable as an import source; it just
        // never becomes a registry row. See ModuleRegistrationPolicy.
        if (isCrossReferenceSourceCommentary(file, xrefSlugs)) {
          log.info(`Skipping ${file}: source of an installed cross-reference module`);
          continue;
        }

        result.detected++;

        try {
          // F5 (task 0027): the SQLite header, checked BEFORE anything opens
          // the file - a real byte comparison, not "did opening throw". This
          // is the gap the boot scan had: a truncated download or a
          // non-SQLite file dropped into the modules folder used to either
          // crash this scan or fall through to a confusing error out of
          // `getModuleInfoFromDatabase` below. See `hasSqliteHeader`'s doc
          // comment in `@bible/core`.
          const header = readHeaderBytes(fullPath);
          if (!header || !hasSqliteHeader(header)) {
            const error = `Skipping ${file}: does not begin with the SQLite file header (corrupt file, or not a module database)`;
            log.error(error);
            result.errors.push(error);
            continue;
          }

          // Only open .db files for NEW modules not yet registered
          const moduleInfo = getModuleInfoFromDatabase(moduleType, fullPath);

          if (!moduleInfo) {
            const error = `Unable to read module info from ${file}`;
            log.error(error);
            result.errors.push(error);
            continue;
          }

          // Stable identity gate, matching InstallationService. Core's schema
          // makes `module_metadata.module_uuid` NOT NULL with a full UNIQUE
          // index and says a module file without a UUID is not installable --
          // reject it rather than registering it with a NULL (see the 2.1
          // Module Metadata note in
          // packages/core/sql/schemas/initial/MainDatabase.sql). Pre-2.0 files
          // dropped into the modules directory land here.
          if (!moduleInfo.moduleUuid) {
            const error = `Skipping ${file}: no module_info.module_uuid (pre-2.0 module; re-export in the current format)`;
            log.error(error);
            result.errors.push(error);
            continue;
          }

          // F5: format_version, skip + report rather than crash or silently
          // mis-register - see this function's `validateModuleFile()` call
          // above. A legacy '2.0' module classifies as 'legacy', not
          // 'unsupported', and registers normally; only a genuinely unknown
          // or newer-than-this-build version is skipped here.
          if (moduleInfo.formatVersionKind === 'unsupported') {
            const error = `Skipping ${file}: unsupported module format_version (this build cannot read it; re-export in a supported format)`;
            log.error(error);
            result.errors.push(error);
            continue;
          }

          log.info(`Registering new ${moduleDir.label} module: ${moduleInfo.moduleName} (${moduleInfo.abbreviation})`);

          const stats = statSync(fullPath);
          const sizeBytes = stats.size;

          const metadata = new ModuleMetadata({
            moduleType,
            moduleUuid: moduleInfo.moduleUuid,
            moduleName: moduleInfo.moduleName,
            abbreviation: moduleInfo.abbreviation,
            version: moduleInfo.version,
            languageCode: moduleInfo.languageCode,
            installedDate: new Date().toISOString(),
            databasePath: relativePath,
            sizeBytes,
            isIndexed: false,
            features: []
          });

          metadataRepo.create(metadata);
          result.registered++;
        } catch (error) {
          const errorMsg = `Error processing ${file}: ${error}`;
          log.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }
    }

    mainDb.close();
    log.info(`Module detection complete: ${result.detected} detected, ${result.registered} registered, ${result.updated} updated, ${result.deregistered} de-registered, ${result.errors.length} errors`);
  } catch (error) {
    const errorMsg = `Fatal error during module detection: ${error}`;
    log.error(errorMsg);
    result.errors.push(errorMsg);
  }

  return result;
}
