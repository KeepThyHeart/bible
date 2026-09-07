import * as fs from 'fs';
import * as path from 'path';
import { parseMigration } from './MigrationParser';
import { MigrationScript } from './MigrationTypes';

/**
 * Filesystem loading of migration files. Node/Electron only -- import from a
 * main process or a script, never from renderer/browser code.
 */

/** `NNN_snake_case_name.sql`, per `sql/migrations/README.md`. */
const MIGRATION_FILENAME = /^(\d{3})_([A-Za-z0-9_]+)\.sql$/;

/**
 * Read and parse every migration in a directory, ordered by version.
 *
 * Files that do not match `NNN_name.sql` are ignored, so `README.md` and
 * scratch files can live alongside the migrations. A directory holding no
 * migrations at all returns an empty array rather than throwing.
 *
 * @param directory Path to a directory of `NNN_name.sql` files - the caller
 *                  supplies it. `packages/core/sql/migrations` is the
 *                  canonical sequence, but it is NOT shipped in the package,
 *                  so a consumer must resolve a path it controls. Never
 *                  derive one from this module's `__dirname`: `@bible/core`
 *                  is bundled by its Electron/Vite consumers, where that
 *                  resolves into the bundle output and finds nothing.
 */
export function loadMigrationsFromDirectory(directory: string): MigrationScript[] {
  if (!fs.existsSync(directory)) {
    throw new Error(`Migration directory not found: ${directory}`);
  }

  const scripts: MigrationScript[] = [];

  for (const entry of fs.readdirSync(directory).sort()) {
    const match = MIGRATION_FILENAME.exec(entry);
    if (!match) continue;

    const filePath = path.join(directory, entry);
    const source = fs.readFileSync(filePath, 'utf-8');

    // Parse eagerly so a malformed file fails at load, not halfway through a run.
    const parsed = parseMigration(source, filePath);

    const script: MigrationScript = {
      version: match[1]!,
      name: match[2]!,
      target: parsed.target,
      source,
      filePath,
    };
    if (parsed.description !== undefined) script.description = parsed.description;

    scripts.push(script);
  }

  // An empty sequence is legitimate: a release whose initial schemas are still
  // current has nothing to migrate. Callers treat `[]` as "already up to date".
  return scripts;
}
