import { app } from 'electron';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import log from 'electron-log';

/**
 * Returns the path to the bundled data directory.
 * In development, this is apps/desktop/data/.
 * In production, data is in extraResources at resources/data/.
 */
export function getDataPath(): string {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return join(__dirname, '..', '..', 'data');
  }
  return join(process.resourcesPath, 'data');
}

/**
 * Returns the path to the window icon, or `undefined` when it cannot be found.
 *
 * On Linux the `BrowserWindow` `icon` option is the ONLY thing that sets the
 * taskbar/window icon - there is no executable resource section to read one
 * from, as there is on Windows, and no bundle, as on macOS. So a wrong path
 * here is not cosmetic: Electron silently falls back to its own default
 * (the gears), which is what shipped.
 *
 * The path differs by mode. In development the icon sits next to the sources
 * at `apps/desktop/resources/icon.png`, two levels up from `out/main`. In
 * a packaged app `resources/` is NOT inside the asar - only `out` and
 * `package.json` are - so the same relative walk lands on a path that does not
 * exist. The packaged copy is placed in `process.resourcesPath` by the
 * `extraResources` entry in both electron-builder configs.
 *
 * Returns `undefined` rather than a bad path so the caller can omit the option
 * entirely; handing Electron a non-existent file is what produced the fallback
 * in the first place.
 */
export function resolveAppIconPath(): string | undefined {
  const candidates =
    process.env.NODE_ENV === 'development' || !app.isPackaged
      ? [join(__dirname, '..', '..', 'resources', 'icon.png')]
      : [
          join(process.resourcesPath, 'icon.png'),
          // Fallback for any packaging profile that keeps the build-resources
          // folder structure rather than flattening it.
          join(process.resourcesPath, 'resources', 'icon.png')
        ];

  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Returns the path to the user-writable data directory.
 * In development, same as getDataPath() (apps/desktop/data/).
 * In production, uses app.getPath('userData') so downloaded modules
 * persist across app updates and reinstalls.
 *
 * Structure: <userData>/data/modules/
 */
export function getUserDataPath(): string {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return join(__dirname, '..', '..', 'data');
  }
  return join(app.getPath('userData'), 'data');
}

/**
 * Returns the path to the user-writable modules directory.
 * Downloaded modules are stored here to survive app updates.
 */
export function getUserModulesPath(): string {
  return join(getUserDataPath(), 'modules');
}

/**
 * Absolute path to the persisted main-window geometry.
 *
 * Deliberately NOT under `getUserDataPath()`. That helper resolves to the
 * repository's `apps/desktop/data/` in development and under e2e (where
 * `app.isPackaged` is false), so window geometry would be written into the
 * source tree and shared by every run. `app.getPath('userData')` is the real
 * per-install directory in every mode, and it honours the `ELECTRON_USER_DATA`
 * override `main.ts` applies for the e2e suite.
 */
export function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

/**
 * Fixed in-pack layout for a `semantic_search` pack. The catalog supplies each
 * artifact's relative path, but the app pins where those paths must land: the
 * index at the root under this name, the model tree under `models/`. The
 * installer enforces it, so a catalog cannot rearrange the pack into a shape
 * the resolvers below would not find.
 */
export const SEMANTIC_INDEX_FILENAME = 'semantic_index.db';
export const SEMANTIC_MODELS_DIRNAME = 'models';

/**
 * Root directory for an installed feature pack.
 *
 * Feature packs are optional downloaded *capabilities* (see
 * `FeaturePackTypes.ts` in @bible/core), not modules, so they live outside
 * `modules/` and are never registered in `module_metadata`. One directory per
 * pack type: a semantic index and the embedding model that queries it are a
 * matched set, so installing a new pack replaces the old one wholesale rather
 * than accumulating versions.
 *
 * Always under `getUserDataPath()` - `getDataPath()` points at the packaged
 * `resources/` tree, which is read-only on a real install.
 */
export function getFeaturePackRoot(packType: string): string {
  return join(getUserDataPath(), 'feature-packs', packType);
}

/**
 * Absolute path to the semantic index, or `null` if semantic search is not
 * installed.
 *
 * A downloaded pack wins over a bundled index: if a build ever ships one under
 * `resources/data/`, an explicitly installed pack is the user's more recent
 * choice. Mirrors the userData-first ordering `resolveModulePath` uses.
 */
export function resolveSemanticIndexPath(): string | null {
  const fromPack = join(getFeaturePackRoot('semantic_search'), SEMANTIC_INDEX_FILENAME);
  if (existsSync(fromPack)) return fromPack;

  const bundled = join(getDataPath(), SEMANTIC_INDEX_FILENAME);
  if (existsSync(bundled)) return bundled;

  return null;
}

/**
 * Directory to hand `@huggingface/transformers` as `env.localModelPath`, or
 * `null` when no embedding model is present.
 *
 * Returning `null` matters: the transformers env is configured with
 * `allowRemoteModels = false`, so a missing model must fail closed at
 * the call site rather than pointing the library at a non-existent directory
 * and letting it decide what to do.
 */
export function resolveSemanticModelsPath(): string | null {
  const fromPack = join(getFeaturePackRoot('semantic_search'), SEMANTIC_MODELS_DIRNAME);
  if (existsSync(fromPack)) return fromPack;

  const bundled = join(getDataPath(), SEMANTIC_MODELS_DIRNAME);
  if (existsSync(bundled)) return bundled;

  return null;
}

/**
 * Resolve a module's database path.
 * Checks user-data directory first (downloaded modules), then bundled data (shipped modules).
 * In development, both resolve to the same directory.
 *
 * @param relativeDatabasePath - Relative path from module_metadata (e.g., "modules/bible_kjv.db")
 * @returns Absolute path to the module database file
 */
export function resolveModulePath(relativeDatabasePath: string): string {
  // In development, everything is in one place
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return join(getDataPath(), relativeDatabasePath);
  }

  // In production, check user-data first (downloaded modules), then bundled
  const userPath = join(getUserDataPath(), relativeDatabasePath);
  if (existsSync(userPath)) {
    return userPath;
  }

  return join(getDataPath(), relativeDatabasePath);
}

/** Filename of the shared reference/state database, in both trees. */
const MAIN_DB_FILENAME = 'main.db';

/**
 * Absolute path to the read-only `main.db` template shipped with the app.
 *
 * This is the ONLY source of the 66 `bible_book` rows (and the matching
 * `bible_verse_ref` / `chapter_info` reference space) on a user's machine -
 * `initializeMainDatabase()` creates those tables but never fills them. Both
 * the first-run seed in `resolveMainDbPath()` and the repair in
 * `ensureReferenceData()` copy the rows from here.
 */
export function getBundledMainDbPath(): string {
  return join(getDataPath(), MAIN_DB_FILENAME);
}

/**
 * Absolute path to `main.db`, seeding it into user-writable storage on first
 * use.
 *
 * ## Why this is not `join(getDataPath(), 'main.db')`
 *
 * That would be a bug on every platform except Windows.
 *
 * `main.db` is NOT read-only reference data. It holds `module_metadata`,
 * `module_repository`, `module_download_queue`, `saved_search`,
 * `search_history` and `setting` - state the app writes during normal use.
 * `getDataPath()` points at `process.resourcesPath/data` in a packaged app,
 * which is:
 *
 *   - root-owned under `/opt/<Name>/` for a `.deb`/`.rpm` install,
 *   - inside `<App>.app/Contents/Resources/` on macOS, where writing also
 *     invalidates the code signature and trips Gatekeeper,
 *   - a read-only squashfs mount for an AppImage,
 *   - and a package-owned file on ALL platforms, so every upgrade - `dpkg`
 *     replacing package files, or the NSIS uninstall/reinstall cycle - silently
 *     restores the pristine copy over the user's.
 *
 * Windows with `perMachine: false` installs into a writable
 * `%LocalAppData%\Programs\...`, so the writes appear to work there: the
 * failure is invisible on that platform and total on the other two.
 *
 * `module_metadata` recovers on its own - `detectAndRegisterModules()` rescans
 * both module directories at startup - but saved searches, search history,
 * settings, the download queue and any user-added repository do not.
 *
 * ## The seed copy is mandatory, not an optimisation
 *
 * `initializeMainDatabase()` creates the *schema* but seeds no rows: the 66
 * `bible_book` records (and `bible_verse_ref` / `chapter_info`) exist only in
 * the bundled template, which is populated when the reference data is built -
 * never at runtime. A packaged app that starts from an empty `main.db` has no
 * book list at all. So the bundled copy under `resources/data/` is the
 * template, and this function's job is to place it where it can be written.
 *
 * On an upgrade from a build that kept `main.db` in the prefix, the same copy
 * doubles as the one-time migration - but only if the installer has not already
 * overwritten the prefix copy, which it usually has. That is acceptable
 * pre-1.0; it is called out in `docs/ReleaseArtifacts.md`.
 *
 * ## Why the `existsSync` guard is not the whole story
 *
 * A file at `userPath` is NOT evidence that it was ever seeded. Any build that
 * called `initializeMainDatabase()` against a user-data path - including one
 * run months earlier and then abandoned - leaves a schema-only database with
 * zero `bible_book` rows, and this function then hands that empty file back
 * forever, because the seed is skipped whenever the file exists. The visible
 * result is a book list of "Unknown" and reference menus full of placeholders.
 *
 * Seeding cannot simply overwrite in that case: by then the file may also hold
 * settings, saved searches and search history that the bundled template does
 * not have. So the emptiness is repaired one level down, in
 * `ensureReferenceData()`, which copies the reference tables INTO the existing
 * database and leaves every user-owned row alone.
 *
 * In development both trees are the same directory, so this is a plain join and
 * nothing is copied.
 */
export function resolveMainDbPath(): string {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return join(getDataPath(), MAIN_DB_FILENAME);
  }

  const userPath = join(getUserDataPath(), MAIN_DB_FILENAME);
  if (existsSync(userPath)) return userPath;

  const bundled = getBundledMainDbPath();
  if (!existsSync(bundled)) {
    // Nothing to seed from. Return the user path anyway so the caller creates
    // the schema there rather than in the read-only prefix; the book list will
    // be empty, which is a louder and more diagnosable failure than a database
    // that cannot be written to.
    log.error(`[appPaths] No bundled ${MAIN_DB_FILENAME} at ${bundled}; starting from an empty database.`);
    mkdirSync(dirname(userPath), { recursive: true });
    return userPath;
  }

  try {
    mkdirSync(dirname(userPath), { recursive: true });
    copyFileSync(bundled, userPath);
    log.info(`[appPaths] Seeded ${MAIN_DB_FILENAME} into user data from ${bundled}`);
  } catch (error) {
    // Fall back to the bundled path rather than crashing. The app is degraded
    // (writes will fail as they did before) but still readable, and the log
    // names the cause.
    log.error(`[appPaths] Failed to seed ${MAIN_DB_FILENAME} into ${userPath}:`, error);
    return bundled;
  }

  return userPath;
}
