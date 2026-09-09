/**
 * Builds the data directory the e2e server runs against.
 *
 * The suite used to point `BIBLE_MODULES_DIR` at the desktop app's `data` and
 * leave `BIBLE_DATA_DIR` alone, which meant the server read its module registry
 * from `apps/web/data/main.db`. On a machine where the modules live under
 * the desktop package — the arrangement `npm run init` produces when the shared
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
 * Called from `playwright.config.ts` at module scope rather than from
 * `globalSetup`, because Playwright starts `webServer` as a plugin, and plugin
 * setup runs before global setup — by the time a global setup ran, the server
 * would already have read the directory.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import Database from 'better-sqlite3-web';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

/**
 * Modules the specs name directly. Anything else in the fixture is there to
 * give the pickers something to show and may be missing without failing a run.
 */
const REQUIRED_MODULES = ['KJV', 'ASV', 'Barnes', 'AmTract'];

/**
 * Places a module registry may live, in the order the server itself would
 * prefer them. `modulesDir` is the root the `database_path` column resolves
 * against, so it is the parent of `modules/`, not `modules/` itself.
 */
const REGISTRY_CANDIDATES = [
  // The server's own defaults: its registry beside the app, modules in the
  // shared store. See `dataDir`/`modulesDir` in server/index.ts.
  { dataDir: join(packageRoot, 'data'), modulesDir: join(repoRoot, 'data') },
  // The shared store holding its own registry. This is what a fresh clone gets
  // when the module data is dropped in one place for every workspace to use --
  // the same directory the core and server test helpers fall back to -- and
  // without it the suite refused to start on a checkout that could run every
  // other test.
  { dataDir: join(repoRoot, 'data'), modulesDir: join(repoRoot, 'data') },
  { dataDir: join(repoRoot, 'apps', 'desktop', 'data'), modulesDir: join(repoRoot, 'apps', 'desktop', 'data') },
];

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

function describeCandidates(): string {
  return REGISTRY_CANDIDATES.map(c => `  - ${c.dataDir} (modules under ${join(c.modulesDir, 'modules')})`).join('\n');
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
      'Run: npm run build:client -w @bible/web',
    );
  }

  const source = REGISTRY_CANDIDATES
    .map(candidate => {
      const mainDb = join(candidate.dataDir, 'main.db');
      if (!existsSync(mainDb)) return null;
      const installed = readInstalledModules(mainDb, candidate.modulesDir);
      return installed.length > 0 ? { ...candidate, mainDb, installed } : null;
    })
    .find(candidate => candidate !== null);

  if (!source) {
    throw new Error(
      'E2E: no module registry with installed modules was found. Looked in:\n' +
      `${describeCandidates()}\n` +
      'Put the module .db files in one of those modules/ directories, then run: npm run init',
    );
  }

  const installedAbbrs = new Set(source.installed.map(m => m.abbreviation.toLowerCase()));
  const missing = REQUIRED_MODULES.filter(abbr => !installedAbbrs.has(abbr.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `E2E: ${source.mainDb} is missing modules the specs depend on: ${missing.join(', ')}.\n` +
      `Install them under ${join(source.modulesDir, 'modules')} and run: npm run init`,
    );
  }

  const dataDir = join(packageRoot, 'e2e', '.data');
  mkdirSync(dataDir, { recursive: true });
  snapshotRegistry(source.mainDb, join(dataDir, 'main.db'));

  const fixture = join(packageRoot, 'e2e', 'fixtures', 'site-config.json');
  writeFileSync(join(dataDir, 'site-config.json'), readFileSync(fixture, 'utf-8'));

  return { dataDir, modulesDir: source.modulesDir };
}
