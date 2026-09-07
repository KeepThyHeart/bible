/**
 * Where the API integration tests look for their module databases.
 *
 * These suites exercise real routes against real Bible, commentary and
 * dictionary .db files. That data is deployment content, not repo content: each
 * app's `data/` directory is gitignored in its entirety, so a fresh clone has
 * none and these tests cannot run until it is supplied.
 *
 * Set `BIBLE_DATA_DIR` (and `BIBLE_MODULES_DIR`, when the `modules/` directory
 * lives somewhere else) to point them at a populated data directory. These are
 * the same two variables the server itself reads, so any directory that runs
 * the app runs the tests.
 *
 * With neither set, the suites fall back to this app's own data directory and
 * fail fast with that message. They used to hardcode a path into the desktop
 * package instead, which resolved somewhere different once the web app moved
 * under `apps/`, and which this app has no business reaching into either way.
 */
import { resolve } from 'path';

const fallbackDataDir = resolve(__dirname, '../../data');

/** Data directory: holds `main.db` and, by default, `modules/`. */
export const TEST_DATA_DIR = process.env.BIBLE_DATA_DIR
  ? resolve(process.env.BIBLE_DATA_DIR)
  : fallbackDataDir;

/** Parent of `modules/`, from which each module's `database_path` resolves. */
export const TEST_MODULES_DIR = process.env.BIBLE_MODULES_DIR
  ? resolve(process.env.BIBLE_MODULES_DIR)
  : TEST_DATA_DIR;
