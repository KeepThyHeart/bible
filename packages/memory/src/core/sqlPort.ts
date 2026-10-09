/**
 * `MemorySql` over a synchronous host `ISql` (better-sqlite3 on desktop).
 *
 * The store is async (it was written against the extension's RPC database);
 * the user database is synchronous and shared with the rest of the app. Two
 * things make that safe:
 *
 * - A transaction holds a lock. Calls on the outer port wait while one is
 *   open, so two memory requests never interleave inside one transaction.
 *   The work function gets its own handle (`tx`) that bypasses the lock;
 *   nested `tx.transaction` calls become savepoints.
 * - The work function awaits only `tx` calls, which resolve as microtasks.
 *   No other IPC handler can run between them, so other features' writes on
 *   the shared connection can never land inside a memory transaction.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, as the extension host did.
 */

import type { ISql, SqlParameter } from '@bible/core';
import type { MemorySql } from './ports';

type RunResult = { changes: number; lastInsertRowid: number | string };

function params(p: unknown[] | undefined): SqlParameter[] | undefined {
  return p === undefined ? undefined : (p as SqlParameter[]);
}

/**
 * A failure of the database itself (not a message for the user). The core's
 * own errors are plain `Error`s with readable text; marking storage failures
 * lets the host tell the two apart.
 */
export class MemoryStorageError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'MemoryStorageError';
    this.cause = cause;
  }
}

function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw err instanceof MemoryStorageError ? err : new MemoryStorageError(err);
  }
}

/** Undo after a failure without letting a failing undo hide the original error. */
function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    /* SQLite may already have rolled back on its own (full disk, I/O error) */
  }
}

class TxHandle implements MemorySql {
  private savepoints = 0;
  constructor(private readonly sql: ISql) {}

  async exec(statement: string): Promise<void> {
    guarded(() => this.sql.execute(statement));
  }
  async query<T = unknown>(statement: string, p?: unknown[]): Promise<T[]> {
    return guarded(() => this.sql.queryAll(statement, params(p)) as T[]);
  }
  async queryOne<T = unknown>(statement: string, p?: unknown[]): Promise<T | undefined> {
    return guarded(() => this.sql.queryOne(statement, params(p)) as T | undefined);
  }
  async run(statement: string, p?: unknown[]): Promise<RunResult> {
    const r = guarded(() => this.sql.execute(statement, params(p)));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowId ?? 0 };
  }
  async transaction<T>(work: (tx: MemorySql) => Promise<T>): Promise<T> {
    const name = `memory_sp_${this.savepoints++}`;
    guarded(() => this.sql.execute(`SAVEPOINT ${name}`));
    try {
      const out = await work(this);
      guarded(() => this.sql.execute(`RELEASE ${name}`));
      return out;
    } catch (err) {
      quietly(() => this.sql.execute(`ROLLBACK TO ${name}`));
      quietly(() => this.sql.execute(`RELEASE ${name}`));
      throw err;
    }
  }
}

export class SqlPort implements MemorySql {
  private readonly direct: TxHandle;
  /** Resolves when no transaction is open (or queued before the caller). */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly sql: ISql) {
    this.direct = new TxHandle(sql);
  }

  async exec(statement: string): Promise<void> {
    await this.tail;
    return this.direct.exec(statement);
  }
  async query<T = unknown>(statement: string, p?: unknown[]): Promise<T[]> {
    await this.tail;
    return this.direct.query<T>(statement, p);
  }
  async queryOne<T = unknown>(statement: string, p?: unknown[]): Promise<T | undefined> {
    await this.tail;
    return this.direct.queryOne<T>(statement, p);
  }
  async run(statement: string, p?: unknown[]): Promise<RunResult> {
    await this.tail;
    return this.direct.run(statement, p);
  }

  async transaction<T>(work: (tx: MemorySql) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      guarded(() => this.sql.execute('BEGIN IMMEDIATE'));
      try {
        const out = await work(new TxHandle(this.sql));
        guarded(() => this.sql.execute('COMMIT'));
        return out;
      } catch (err) {
        quietly(() => this.sql.execute('ROLLBACK'));
        throw err;
      }
    } finally {
      release();
    }
  }
}

export function createSqlPort(sql: ISql): MemorySql {
  return new SqlPort(sql);
}
