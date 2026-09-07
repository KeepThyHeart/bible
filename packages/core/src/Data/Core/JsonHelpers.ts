/**
 * Safe field-conversion helpers for database row mapping.
 *
 * SQLite stores JSON as text columns and booleans as 0/1 integers.
 * These helpers centralize the null-safe conversion patterns used across
 * all repositories, avoiding repeated inline ternaries and providing
 * consistent handling at the database boundary.
 */

/**
 * Parse a JSON text column from a database row.
 * Returns undefined if the value is null/undefined/empty, avoiding JSON.parse(null) errors.
 */
export function parseJsonField<T = Record<string, unknown>>(value: string | null | undefined): T | undefined {
  if (value == null || value === '') return undefined;
  return JSON.parse(value) as T;
}

/**
 * Stringify a value for storage in a JSON text column.
 * Returns null for undefined/null values (SQLite NULL), matching the
 * `entity.metadata ?? null` pattern used throughout the data layer.
 */
export function stringifyJsonField(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

// --- Boolean helpers ------------------------------------------------

/**
 * Convert a SQLite integer (0/1) to a boolean.
 * Returns `false` for 0, null, or undefined; `true` for 1 (or any truthy number).
 */
export function parseBoolField(value: number | null | undefined): boolean {
  return value === 1;
}

/**
 * Convert a boolean to a SQLite integer (0 or 1) for storage.
 */
export function toBoolInt(value: boolean): number {
  return value ? 1 : 0;
}
