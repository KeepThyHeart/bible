import { ISql } from '../Core/ISql';
import { parseMigration } from './MigrationParser';
import {
  AppliedMigration,
  MigrationGuard,
  MigrationOutcome,
  MigrationRunResult,
  MigrationScript,
  MigrationStatement,
  MigrationTarget,
} from './MigrationTypes';

/** Name of the ledger table. The single authority on what has been applied. */
export const MIGRATION_TABLE = 'schema_migration';

/**
 * Applies the ordered migration sequence in `packages/core/sql/migrations/`
 * to a database, exactly once each, and records what it did.
 *
 * Design points that matter:
 *
 * * **Idempotent.** Every migration is recorded in `schema_migration` and never
 *   re-run. Individual statements additionally carry `@skip-if` guards, so even
 *   a database whose ledger was lost -- or one dragged partway forward by the
 *   older hard-coded migrator in `electron/utils/initMainDatabase.ts` -- lands
 *   in the same place.
 *
 * * **Atomic per migration.** Each migration runs inside one transaction. A
 *   failure rolls that migration back entirely; migrations that already
 *   succeeded stay applied and are not repeated.
 *
 * * **Foreign keys off, then verified.** Dropping a CHECK in SQLite means
 *   rebuilding the table, which is only safe with `foreign_keys` disabled.
 *   `PRAGMA foreign_keys` is a no-op inside a transaction, so it is toggled
 *   around it, and `PRAGMA foreign_key_check` runs *inside* the transaction
 *   before commit -- a violation therefore rolls back rather than persisting.
 */
export class MigrationRunner {
  private readonly target: Exclude<MigrationTarget, 'both'>;

  /**
   * @param sql Database to migrate.
   * @param target Which database this connection is -- `'main'` or `'user'`.
   *               Migrations aimed at the other one are skipped.
   */
  constructor(private readonly sql: ISql, target: Exclude<MigrationTarget, 'both'>) {
    this.target = target;
  }

  /**
   * Apply every migration in `scripts` that targets this database and has not
   * been applied yet, in `version` order.
   */
  run(scripts: MigrationScript[]): MigrationRunResult {
    this.ensureLedger();

    const ordered = this.order(scripts);
    const applied = this.getAppliedMap();
    const outcomes: MigrationOutcome[] = [];
    const appliedNow: string[] = [];
    const checksumMismatches: string[] = [];

    for (const script of ordered) {
      if (!this.targets(script)) {
        outcomes.push({
          version: script.version,
          name: script.name,
          status: 'skipped-other-database',
        });
        continue;
      }

      const previous = applied.get(script.version);
      if (previous) {
        if (previous.checksum !== fingerprint(script.source)) {
          checksumMismatches.push(`${script.version}_${script.name}`);
        }
        outcomes.push({
          version: script.version,
          name: script.name,
          status: 'already-applied',
        });
        continue;
      }

      outcomes.push(this.apply(script));
      appliedNow.push(script.version);
    }

    return { target: this.target, applied: appliedNow, outcomes, checksumMismatches };
  }

  /**
   * Record every migration as applied without running any of it.
   *
   * For a database just created from `sql/schemas/initial/`, which already has
   * the current structure. Replaying history against it would be wasted work at
   * best. Migrations added *after* the baseline still run normally on the next
   * `run()`.
   */
  baseline(scripts: MigrationScript[]): MigrationRunResult {
    this.ensureLedger();

    const applied = this.getAppliedMap();
    const outcomes: MigrationOutcome[] = [];
    const appliedNow: string[] = [];

    this.sql.transaction(() => {
      for (const script of this.order(scripts)) {
        if (!this.targets(script)) {
          outcomes.push({
            version: script.version,
            name: script.name,
            status: 'skipped-other-database',
          });
          continue;
        }
        if (applied.has(script.version)) {
          outcomes.push({
            version: script.version,
            name: script.name,
            status: 'already-applied',
          });
          continue;
        }
        this.record(script);
        appliedNow.push(script.version);
        outcomes.push({ version: script.version, name: script.name, status: 'baselined' });
      }
    });

    return { target: this.target, applied: appliedNow, outcomes, checksumMismatches: [] };
  }

  /** Rows of the ledger, oldest first. */
  getApplied(): AppliedMigration[] {
    this.ensureLedger();
    return this.sql
      .queryAll<{ version: string; name: string; applied_date: string; checksum: string }>(
        `SELECT version, name, applied_date, checksum FROM ${MIGRATION_TABLE} ORDER BY version`
      )
      .map(row => ({
        version: row.version,
        name: row.name,
        appliedDate: row.applied_date,
        checksum: row.checksum,
      }));
  }

  /** Migrations targeting this database that `run()` would apply. */
  getPending(scripts: MigrationScript[]): MigrationScript[] {
    this.ensureLedger();
    const applied = this.getAppliedMap();
    return this.order(scripts).filter(s => this.targets(s) && !applied.has(s.version));
  }

  // -- internals -----------------------------------------------------------

  private ensureLedger(): void {
    this.sql.execute(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        version       TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        applied_date  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum      TEXT NOT NULL
      )
    `);
  }

  private targets(script: MigrationScript): boolean {
    return script.target === 'both' || script.target === this.target;
  }

  private order(scripts: MigrationScript[]): MigrationScript[] {
    const seen = new Map<string, MigrationScript>();
    for (const script of scripts) {
      const existing = seen.get(script.version);
      if (existing) {
        throw new Error(
          `Duplicate migration version "${script.version}": ` +
            `${existing.name} and ${script.name}. Version numbers are identities and must be unique.`
        );
      }
      seen.set(script.version, script);
    }
    return [...scripts].sort((a, b) => a.version.localeCompare(b.version));
  }

  private getAppliedMap(): Map<string, AppliedMigration> {
    const map = new Map<string, AppliedMigration>();
    for (const row of this.getApplied()) map.set(row.version, row);
    return map;
  }

  private apply(script: MigrationScript): MigrationOutcome {
    const parsed = parseMigration(script.source, script.filePath ?? `${script.version}_${script.name}`);

    // PRAGMA foreign_keys is a no-op inside a transaction, so it must be
    // toggled around it. Table rebuilds (the only way to drop a CHECK in
    // SQLite) are unsafe with it on.
    const fkWasOn = this.foreignKeysEnabled();
    if (fkWasOn) this.sql.execute('PRAGMA foreign_keys = OFF');

    try {
      let executed = 0;
      let skipped = 0;

      this.sql.transaction(() => {
        for (const statement of parsed.statements) {
          if (this.shouldSkip(statement)) {
            skipped++;
            continue;
          }
          try {
            this.sql.execute(statement.sql);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Migration ${script.version}_${script.name} failed at ` +
                `${script.filePath ?? 'inline'}:${statement.line}: ${message}\n` +
                `Statement: ${statement.sql.slice(0, 400)}`
            );
          }
          executed++;
        }

        // Inside the transaction, so a violation rolls the migration back.
        const violations = this.sql.queryAll('PRAGMA foreign_key_check');
        if (violations.length > 0) {
          throw new Error(
            `Migration ${script.version}_${script.name} left ${violations.length} ` +
              `foreign key violation(s); rolled back. First: ${JSON.stringify(violations[0])}`
          );
        }

        this.record(script);
      });

      return {
        version: script.version,
        name: script.name,
        status: 'applied',
        statementsExecuted: executed,
        statementsSkipped: skipped,
      };
    } finally {
      if (fkWasOn) this.sql.execute('PRAGMA foreign_keys = ON');
    }
  }

  private record(script: MigrationScript): void {
    this.sql.execute(
      `INSERT OR REPLACE INTO ${MIGRATION_TABLE} (version, name, applied_date, checksum)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
      [script.version, script.name, fingerprint(script.source)]
    );
  }

  private foreignKeysEnabled(): boolean {
    const row = this.sql.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys');
    return row?.foreign_keys === 1;
  }

  private shouldSkip(statement: MigrationStatement): boolean {
    return statement.guards.some(guard => this.guardHolds(guard));
  }

  private guardHolds(guard: MigrationGuard): boolean {
    switch (guard.kind) {
      case 'table-exists':
        return this.tableExists(guard.table);
      case 'table-missing':
        return !this.tableExists(guard.table);
      case 'column-exists':
        return this.columnExists(guard.table, guard.column!);
      case 'column-missing':
        return !this.columnExists(guard.table, guard.column!);
    }
  }

  private tableExists(table: string): boolean {
    const row = this.sql.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`,
      [table]
    );
    return row !== undefined;
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.tableExists(table)) return false;
    // PRAGMA table_info takes an identifier, not a bind parameter. The table
    // name comes from a migration file we ship, never from user input, and is
    // additionally restricted to identifier characters here.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name in migration guard: "${table}"`);
    }
    const columns = this.sql.queryAll<{ name: string }>(`PRAGMA table_info("${table}")`);
    return columns.some(c => c.name === column);
  }
}

/**
 * Content fingerprint of a migration file, stored in the ledger so an edit to
 * an already-applied migration can be detected.
 *
 * FNV-1a (64-bit, as two 32-bit halves) rather than SHA-256: this detects
 * accidental drift, it is not a security boundary, and a pure-TS implementation
 * keeps `@bible/core` free of a `node:crypto` import.
 */
export function fingerprint(source: string): string {
  // Normalise line endings so a checkout with different EOLs is not flagged.
  const normalized = source.replace(/\r\n/g, '\n');

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((code << 5) | (code >>> 3)), 0x85ebca6b) >>> 0;
  }

  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
