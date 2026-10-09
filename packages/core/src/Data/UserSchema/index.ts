/**
 * The user database schema, created and migrated the same way on every platform.
 *
 * Desktop (better-sqlite3 + SQLCipher) and the web (sqlite-wasm on OPFS) both call `createUserSchema`
 * when they open a user database, so the two hold exactly the same tables. Pure `ISql`, string-constant
 * DDL: no `node:fs`, no globals at module load, safe in the browser bundle.
 */
import type { ISql } from '../Core/ISql';
import { repairUserSchema } from '../Migration/repairUserSchema';
import { USER_SCHEMA_VERSION, readUserSchemaVersion, stampUserSchemaVersion } from '../../Backup/Registry';
import { USER_SCHEMA_DDL } from './ddl';
import { MEMORY_DDL } from './memory';

export { USER_SCHEMA_DDL, DESKTOP_USER_DDL, CORE_USER_DDL } from './ddl';
export { MEMORY_DDL, MEMORY_TABLES, MEMORY_IMPORT_TABLE, installMemorySchema } from './memory';
export type { MemoryTable } from './memory';

function runDdl(db: ISql): void {
  for (const statement of USER_SCHEMA_DDL) db.execute(statement);
  for (const statement of MEMORY_DDL) db.execute(statement);
}

/**
 * Create every user table, index, trigger and FTS table that is missing, repair shapes older builds
 * left behind, then bring the schema version stamp up to date. Safe to call on every open: a current
 * database is untouched.
 */
export function createUserSchema(db: ISql): void {
  runDdl(db);
  // CREATE ... IF NOT EXISTS is a no-op on a table an older build created, so an upgraded profile keeps
  // that build's constraints; the repair fixes the shapes that matter. It runs once the tables exist.
  repairUserSchema(db);
  migrateUserSchema(db);
}

/**
 * Bring a database whose stamp is below `USER_SCHEMA_VERSION` up to it. Versions 0, 1 and 2 need no row
 * upgraders: the only difference between them and 3 is tables that did not exist yet, and re-running the
 * `IF NOT EXISTS` DDL adds exactly those (never an ALTER). One transaction, so a failure leaves the
 * stamp, and therefore the next open's retry, intact. Idempotent, and a database stamped higher by a
 * newer build is left alone (the stamp is never lowered).
 */
export function migrateUserSchema(db: ISql): { from: number; to: number } {
  const from = readUserSchemaVersion(db);
  if (from >= USER_SCHEMA_VERSION) return { from, to: from };
  db.transaction(() => {
    runDdl(db);
    stampUserSchemaVersion(db);
  });
  return { from, to: readUserSchemaVersion(db) };
}
