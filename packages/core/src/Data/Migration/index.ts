/**
 * SQL migration system.
 *
 * One ordered sequence of `NNN_name.sql` files under
 * `packages/core/sql/migrations/`, applied exactly once each and recorded in
 * a `schema_migration` ledger. See that directory's README.md for the
 * convention and the full sequence.
 *
 * The `.sql` files are repo-only: they are deliberately NOT in the package's
 * `files`, so the caller owns locating them. Core does not resolve them from
 * `__dirname` - that cannot work for the Electron/Vite consumers that bundle
 * `@bible/core` into a single file.
 *
 * ```ts
 * const migrations = loadMigrationsFromDirectory(myMigrationsPath);
 * const result = new MigrationRunner(userDb, 'user').run(migrations);
 * ```
 */

export type {
  AppliedMigration,
  MigrationGuard,
  MigrationOutcome,
  MigrationRunResult,
  MigrationScript,
  MigrationStatement,
  MigrationTarget,
} from './MigrationTypes';

export type { ParsedMigration } from './MigrationParser';
export { parseMigration } from './MigrationParser';

export { MigrationRunner, MIGRATION_TABLE, fingerprint } from './MigrationRunner';
export { loadMigrationsFromDirectory } from './loadMigrations';

export type { UserSchemaRepairReport } from './repairUserSchema';
export { repairUserSchema, repairUserTextMarkup } from './repairUserSchema';
