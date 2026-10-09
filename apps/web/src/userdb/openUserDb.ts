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

interface SahPool {
  OpfsSAHPoolDb: new (filename: string) => unknown;
  wipeFiles(): Promise<void>;
}

export async function openUserDb(): Promise<OpenedUserDb> {
  const { default: sqlite3InitModule } = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await sqlite3InitModule();
  const install = (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: { name: string }): Promise<SahPool> }).installOpfsSAHPoolVfs;
  const pool = await install.call(sqlite3, { name: USER_DB_VFS_NAME });
  return finishOpen(new pool.OpfsSAHPoolDb(USER_DB_PATH), USER_DB_PATH, () => pool.wipeFiles());
}
