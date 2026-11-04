/**
 * Scripture memory's tables in the host user database.
 *
 * The DDL moved into core (`Data/UserSchema/memory.ts`, task 0150) so the core user schema can create
 * every user table on every platform without importing this package. This file re-exports it, so
 * existing imports (`@bible/memory/schema`) keep working. `installMemorySchema` is still here for the
 * callers and tests that use it on its own; core's `createUserSchema` runs the same statements.
 */

export { MEMORY_TABLES, MEMORY_IMPORT_TABLE, MEMORY_DDL, installMemorySchema } from '@bible/core/browser';
export type { MemoryTable } from '@bible/core/browser';
