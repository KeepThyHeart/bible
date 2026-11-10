/**
 * Builds the data directory the e2e server runs against.
 *
 * The suite used to point `BIBLE_MODULES_DIR` at the desktop app's `data` and
 * leave `BIBLE_DATA_DIR` alone, which meant the server read its module registry
 * from `apps/web/data/main.db`. On a machine where the modules live under
 * the desktop package — the arrangement `pnpm run init` produces when the shared
 * `data/modules/` directory is empty — that registry has no rows, so the server
 * came up with no Bibles and every test that waits for a verse timed out. The
 * only clue was one line on the server's stdout, which Playwright swallows.
 *
 * The registry (`main.db`) and the module visibility config live in the same
 * directory, so pointing at a real one has a second problem: the suite would
 * pass or fail according to which modules a developer happened to switch on,
 * and writing a config in there would trample their choices.
 *
 * So this builds a third directory, `e2e/.data`, holding a snapshot of whatever
 * registry it can find plus the checked-in `fixtures/site-config.json`. Tests
 * get a fixed set of modules; the developer's own data is only ever read.
 *
 * With no `BIBLE_E2E_DATA_DIR` the data is the committed fixture (`fixtures/bible-data`, public domain):
 * it is copied to `e2e/.data/fixture` (never used in place; the server writes there) and that copy is both
 * the registry and the module store. With `BIBLE_E2E_DATA_DIR` (a directory holding `main.db` and
 * `modules/`) the real data is snapshotted as described above. Specs that need modules the fixture lacks
 * should skip when `usingFixtureData()` is true.
 *
 * Called from `playwright.config.ts` at module scope rather than from
 * `globalSetup`, because Playwright starts `webServer` as a plugin, and plugin
 * setup runs before global setup — by the time a global setup ran, the server
 * would already have read the directory.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import Database from 'better-sqlite3-web';
import { writeAudioFixture } from './audioFixture';
import { copyFixture } from '../../../fixtures/bible-data/copy.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

/**
 * Modules the specs name directly. Anything else in the fixture is there to
 * give the pickers something to show and may be missing without failing a run.
 */
const REQUIRED_MODULES = ['KJV', 'ASV', 'Barnes', 'AmTract'];

/**
 * Real data the caller chose, if any. `modulesDir` is the root the `database_path` column resolves
 * against, so it is the parent of `modules/`, not `modules/` itself.
 * - `BIBLE_E2E_DATA_DIR`: a directory holding `main.db` and `modules/`.
 * - `BIBLE_DATA_DIR` / `BIBLE_MODULES_DIR`: the server's own variables, as the server reads them.
 * Neither: undefined, and the run uses the committed fixture.
 */
function chosenData(): { dataDir: string; modulesDir: string } | undefined {
  const e2e = process.env.BIBLE_E2E_DATA_DIR;
  if (e2e) return { dataDir: resolve(e2e), modulesDir: resolve(e2e) };
  const data = process.env.BIBLE_DATA_DIR;
  const modules = process.env.BIBLE_MODULES_DIR;
  if (data || modules) {
    return { dataDir: resolve(data ?? modules!), modulesDir: resolve(modules ?? data!) };
  }
  return undefined;
}

/** True when the run uses the committed fixture (specs needing other modules should skip). */
export function usingFixtureData(): boolean {
  return chosenData() === undefined;
}

export interface E2eDataPaths {
  /** Holds the snapshot registry and the fixture config. Handed to the server as BIBLE_DATA_DIR. */
  dataDir: string;
  /** Where the module .db files actually are. Handed to the server as BIBLE_MODULES_DIR. */
  modulesDir: string;
}

interface RegisteredModule {
  abbreviation: string;
  database_path: string;
}

/** Registered modules whose .db file is actually present under `modulesDir`. */
function readInstalledModules(mainDbPath: string, modulesDir: string): RegisteredModule[] {
  const db = new Database(mainDbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare('SELECT abbreviation, database_path FROM module_metadata')
      .all() as RegisteredModule[];
    return rows.filter(row => row.database_path && existsSync(join(modulesDir, row.database_path)));
  } finally {
    db.close();
  }
}

/**
 * Copy `main.db` into the e2e directory.
 *
 * `VACUUM INTO` rather than a file copy: the source is a WAL database that a
 * dev server may have open, and copying the `.db` alone would silently drop
 * anything still sitting in its `-wal`. This takes a consistent snapshot
 * without writing to the source.
 */
function snapshotRegistry(sourceDb: string, destDb: string): void {
  if (existsSync(destDb) && statSync(destDb).mtimeMs >= statSync(sourceDb).mtimeMs) return;

  for (const suffix of ['', '-wal', '-shm']) rmSync(`${destDb}${suffix}`, { force: true });

  const db = new Database(sourceDb, { readonly: true, fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(destDb);
  } catch {
    // Older SQLite builds have no VACUUM INTO. A plain copy is a good enough
    // fallback: main.db is reference data that is rarely mid-write.
    copyFileSync(sourceDb, destDb);
  } finally {
    db.close();
  }
}


/**
 * Assemble `e2e/.data` and return the paths the server should be given.
 * Throws with a fixable message rather than letting the run fail later as a
 * wall of selector timeouts.
 */
export function prepareE2eData(): E2eDataPaths {
  const clientIndex = join(packageRoot, 'dist', 'client', 'index.html');
  if (!existsSync(clientIndex)) {
    throw new Error(
      `E2E: no built client at ${clientIndex}.\n` +
      'The e2e server serves the production bundle, not the Vite dev server.\n' +
      'Run: pnpm --filter @bible/web run build:client',
    );
  }

  const dataDir = join(packageRoot, 'e2e', '.data');
  const chosen = chosenData();
  const fixtureDir = join(dataDir, 'fixture');
  if (!chosen) {
    // The server writes into its data dir, so it gets a copy. Playwright loads this config in the main
    // process AND in every worker (and remote-semantic.spec.ts calls this too) while the servers run:
    // only the main process (re)creates the copy; the others reuse it.
    if (!process.env.TEST_WORKER_INDEX || !existsSync(join(fixtureDir, 'main.db'))) {
      rmSync(fixtureDir, { recursive: true, force: true });
      copyFixture(fixtureDir);
    }
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'site-config.json'), readFileSync(join(packageRoot, 'e2e', 'fixtures', 'site-config.json'), 'utf-8'));
    writeAudioFixture(fixtureDir);
    return { dataDir: fixtureDir, modulesDir: fixtureDir };
  }

  const mainDb = join(chosen.dataDir, 'main.db');
  const source = existsSync(mainDb)
    ? { ...chosen, mainDb, installed: readInstalledModules(mainDb, chosen.modulesDir) }
    : undefined;

  if (!source || source.installed.length === 0) {
    throw new Error(
      `E2E: no module registry with installed modules at ${mainDb} (modules under ${join(chosen.modulesDir, 'modules')}).\n` +
      'Check BIBLE_E2E_DATA_DIR (or BIBLE_DATA_DIR / BIBLE_MODULES_DIR), or unset them to use the committed fixture.',
    );
  }

  const installedAbbrs = new Set(source.installed.map(m => m.abbreviation.toLowerCase()));
  const missing = REQUIRED_MODULES.filter(abbr => !installedAbbrs.has(abbr.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `E2E: ${source.mainDb} is missing modules the specs depend on: ${missing.join(', ')}.\n` +
      `Install them under ${join(source.modulesDir, 'modules')} and run: pnpm run init`,
    );
  }

  mkdirSync(dataDir, { recursive: true });
  snapshotRegistry(source.mainDb, join(dataDir, 'main.db'));

  const fixture = join(packageRoot, 'e2e', 'fixtures', 'site-config.json');
  writeFileSync(join(dataDir, 'site-config.json'), readFileSync(fixture, 'utf-8'));
  // One recorded chapter (John 3, KJV) for the Audio Bible specs; the fixture config turns the feature on.
  writeAudioFixture(dataDir);

  return { dataDir, modulesDir: source.modulesDir };
}
