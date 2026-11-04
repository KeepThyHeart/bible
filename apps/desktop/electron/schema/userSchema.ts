/**
 * Centralized user database schema.
 *
 * The DDL lives in core (`createUserSchema`, `Data/UserSchema`) so the desktop and the web create the
 * same tables from the same statements. This file keeps the desktop's entry point and its name:
 * handlers and modules call `initializeUserSchema(db)` and get every user table, index, trigger and FTS
 * table (including the Scripture memory tables), the shape repairs, and the schema version stamp.
 */
import type { ISql } from '@bible/core';
import { createUserSchema } from '@bible/core';

/**
 * Create all user database tables, indexes, triggers, and FTS tables.
 * Safe to call multiple times (idempotent via IF NOT EXISTS).
 */
export function initializeUserSchema(db: ISql): void {
  createUserSchema(db);
}
