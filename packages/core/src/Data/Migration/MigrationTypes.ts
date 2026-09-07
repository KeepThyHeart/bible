/**
 * Types for the SQL migration system.
 *
 * See `packages/core/sql/migrations/README.md` for the file convention
 * these types mirror.
 */

/**
 * Which database a migration targets.
 *
 * One ordered migration sequence covers both `main.db` and `user_*.db`, so a
 * runner attached to one database skips the files aimed at the other. `'both'`
 * is for migrations that apply to either (e.g. recording the schema version).
 */
export type MigrationTarget = 'main' | 'user' | 'both';

/**
 * A guard evaluated immediately before its statement runs. If the condition
 * holds, the statement is skipped rather than executed.
 *
 * These exist because SQLite has neither `ADD COLUMN IF NOT EXISTS` nor any way
 * to drop a CHECK constraint, and because a database may arrive at a migration
 * already partly advanced by the older hard-coded migrator.
 */
export interface MigrationGuard {
  kind: 'table-exists' | 'table-missing' | 'column-exists' | 'column-missing';
  /** Table the guard inspects. */
  table: string;
  /** Column the guard inspects; only set for the column-* kinds. */
  column?: string;
}

/** One executable statement from a migration file, with its guards. */
export interface MigrationStatement {
  sql: string;
  guards: MigrationGuard[];
  /** 1-based line number of the statement's first line, for error messages. */
  line: number;
}

/** A parsed migration file, ready to run. */
export interface MigrationScript {
  /** Zero-padded ordinal from the filename, e.g. `'007'`. Identity in the ledger. */
  version: string;
  /** Remainder of the filename, e.g. `'markup_color_hex'`. */
  name: string;
  /** Which database this migration targets. */
  target: MigrationTarget;
  /** Free-text `@description` from the header, if present. */
  description?: string;
  /** Raw file contents. Used for the checksum. */
  source: string;
  /** Where it was loaded from, for error messages. Absent for inline scripts. */
  filePath?: string;
}

/** A row of the `schema_migration` ledger. */
export interface AppliedMigration {
  version: string;
  name: string;
  appliedDate: string;
  checksum: string;
}

/** What happened to a single migration during a run. */
export interface MigrationOutcome {
  version: string;
  name: string;
  status: 'applied' | 'already-applied' | 'skipped-other-database' | 'baselined';
  /** Statements executed (0 for anything but `applied`). */
  statementsExecuted?: number;
  /** Statements a guard suppressed. */
  statementsSkipped?: number;
}

/** Summary of a `run()` or `baseline()` call. */
export interface MigrationRunResult {
  target: Exclude<MigrationTarget, 'both'>;
  applied: string[];
  outcomes: MigrationOutcome[];
  /**
   * Migrations already recorded as applied whose file no longer matches the
   * recorded checksum. Never fatal on its own -- reported so a caller can log
   * it -- but it means someone edited a shipped migration.
   */
  checksumMismatches: string[];
}
