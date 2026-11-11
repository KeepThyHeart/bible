/**
 * Worker side: open the OPFS user database (sqlite-wasm, `opfs-sahpool` VFS: no COOP/COEP needed), turn on
 * foreign keys and bring the schema up to date with core `createUserSchema`.
 */
import { createUserSchema, type Sync } from '@bible/core/browser';
import { createWasmSql } from './createWasmSql';

export const USER_DB_VFS_NAME = 'kth-userdb';
export const USER_DB_PATH = '/user.db';

export interface OpenedUserDb {
  sql: Sync.ISql;
  /** Close and delete the database files (sign-out with wipe, delete account). The handle is unusable afterwards. */
  wipe(): Promise<void>;
  close(): void;
}

/** Shared tail of every open: pragmas + schema. Takes an already created oo1 DB (OPFS in the worker, memory in tests). */
export function finishOpen(db: unknown, path: string, wipeFiles?: () => Promise<void>): OpenedUserDb {
  const sql = createWasmSql(db, path);
  sql.execute('PRAGMA foreign_keys = ON');
  createUserSchema(sql);
  return {
    sql,
    close: () => sql.close(),
    async wipe() {
      sql.close();
      if (wipeFiles) await wipeFiles();
    },
  };
}

export interface SahPool {
  OpfsSAHPoolDb: new (filename: string) => unknown;
  wipeFiles(): Promise<void>;
}

async function initSahPool(): Promise<SahPool> {
  const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await sqlite3InitModule();
  const install = (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: { name: string }): Promise<SahPool> }).installOpfsSAHPoolVfs;
  return install.call(sqlite3, { name: USER_DB_VFS_NAME });
}

/**
 * One sqlite3 module and one installed SAH pool per worker. A second init (after a wipe) would create another wasm
 * instance whose pool fights the first for the OPFS access handles; `wipeFiles()` leaves the pool's handles reusable,
 * so a reopen simply creates a new `OpfsSAHPoolDb` on the same pool. A failed init is not remembered (a retry can run).
 */
let poolPromise: Promise<SahPool> | undefined;

export function getSahPool(init: () => Promise<SahPool> = initSahPool): Promise<SahPool> {
  poolPromise ??= init().catch((e) => {
    poolPromise = undefined;
    throw e;
  });
  return poolPromise;
}

/** Tests only. */
export function resetSahPoolForTests(): void {
  poolPromise = undefined;
}

export async function openUserDb(init?: () => Promise<SahPool>): Promise<OpenedUserDb> {
  const pool = await getSahPool(init);
  return finishOpen(new pool.OpfsSAHPoolDb(USER_DB_PATH), USER_DB_PATH, () => pool.wipeFiles());
}
