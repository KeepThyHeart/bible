/**
 * Where the data-backed core tests find real module databases.
 *
 * A dozen suites here exercise real SQLite behaviour -- FTS5 ranking, collation,
 * genuine verse and commentary rows -- against actual module databases. That
 * data is deployment content, not repo content, so a clean checkout has none.
 *
 * Set `BIBLE_DATA_DIR` (and `BIBLE_MODULES_DIR`, when `modules/` lives
 * elsewhere) to point these suites at a populated data directory. They are the
 * same two variables the apps read, so a directory that runs an app runs the
 * tests. The fallback is the repo-root `data/` directory -- the shared module
 * store both apps resolve their module files against, so one drop of `main.db`
 * plus `modules/` there serves every workspace. It used to point into
 * `packages/desktop/data`, a path that has not existed since the apps moved
 * under `apps/`, so these suites skipped on every machine.
 *
 * The suites skip when the data is absent rather than failing -- a contributor
 * without module databases should still get a useful run. But they skip
 * *loudly*: see `testDataAvailable()`.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

const fallbackDataDir = resolve(__dirname, '../../../../../data');

/** Data directory: holds `main.db` and, by default, `modules/`. */
export const TEST_DATA_DIR = process.env.BIBLE_DATA_DIR
  ? resolve(process.env.BIBLE_DATA_DIR)
  : fallbackDataDir;

/** Parent of `modules/`. */
export const TEST_MODULES_DIR = process.env.BIBLE_MODULES_DIR
  ? resolve(process.env.BIBLE_MODULES_DIR)
  : TEST_DATA_DIR;

/** The module registry. */
export const MAIN_DB = resolve(TEST_DATA_DIR, 'main.db');

/** Absolute path to a module database by file name. */
export function moduleDb(fileName: string): string {
  return resolve(TEST_MODULES_DIR, 'modules', fileName);
}

/**
 * True when every path exists. When one does not, this says so on stderr and
 * returns false, so the caller can `describe.skipIf(...)`.
 *
 * The warning is the point. These suites used to vanish in silence, which made
 * a run with no module data look identical to a fully covered one -- hundreds
 * of skipped tests scroll past unread, and the only place real SQLite behaviour
 * is checked had quietly not run at all.
 */
export function testDataAvailable(suite: string, ...paths: string[]): boolean {
  const missing = paths.filter((path) => !existsSync(path));
  if (missing.length === 0) return true;

  console.warn(
    `\n[core tests] SKIPPING "${suite}" -- module data not found:\n` +
      missing.map((path) => `    ${path}`).join('\n') +
      `\n  This suite tests real database behaviour, so that coverage did NOT run.` +
      `\n  Set BIBLE_DATA_DIR to a populated data directory to enable it.\n`
  );
  return false;
}
