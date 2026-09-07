/**
 * Utilities for safe dynamic SQL construction.
 *
 * Column names and sort directions cannot be parameterized in SQL
 * (they are identifiers, not values). These helpers whitelist-validate
 * dynamic identifiers before interpolation, preventing SQL injection
 * through ORDER BY, GROUP BY, or similar clauses.
 */

const VALID_DIRECTIONS = new Set(['ASC', 'DESC']);

/**
 * Validate and return a safe ORDER BY column name.
 * Throws if the column is not in the allowed set.
 *
 * @param column - The requested column name
 * @param allowedColumns - Set of column names that are safe to use
 * @param fallback - Default column if `column` is undefined
 */
export function safeOrderByColumn(
  column: string | undefined,
  allowedColumns: ReadonlySet<string>,
  fallback: string
): string {
  const col = column ?? fallback;
  if (!allowedColumns.has(col)) {
    throw new Error(
      `Invalid ORDER BY column "${col}". Allowed: ${[...allowedColumns].join(', ')}`
    );
  }
  return col;
}

/**
 * Validate and return a safe sort direction (ASC or DESC).
 */
export function safeSortDirection(direction: string | undefined, fallback: 'ASC' | 'DESC' = 'ASC'): 'ASC' | 'DESC' {
  const dir = (direction ?? fallback).toUpperCase();
  if (!VALID_DIRECTIONS.has(dir)) {
    throw new Error(`Invalid sort direction "${direction}". Allowed: ASC, DESC`);
  }
  return dir as 'ASC' | 'DESC';
}

/**
 * Build a safe ORDER BY clause from query options.
 * Validates column and direction before interpolation.
 *
 * @param orderBy - Requested column name
 * @param direction - Requested sort direction
 * @param allowedColumns - Set of column names that are safe to use
 * @param defaults - Default column and direction
 * @returns SQL fragment like " ORDER BY column_name ASC"
 */
export function buildSafeOrderBy(
  orderBy: string | undefined,
  direction: string | undefined,
  allowedColumns: ReadonlySet<string>,
  defaults: { column: string; direction: 'ASC' | 'DESC' }
): string {
  const col = safeOrderByColumn(orderBy, allowedColumns, defaults.column);
  const dir = safeSortDirection(direction, defaults.direction);
  return ` ORDER BY ${col} ${dir}`;
}

/**
 * Build a safe LIMIT/OFFSET clause from pagination options.
 * Values are validated as non-negative integers before interpolation.
 *
 * @param limit - Maximum rows to return (undefined = no limit)
 * @param offset - Rows to skip (undefined = no offset)
 * @returns SQL fragment like " LIMIT 10 OFFSET 20", or empty string if no pagination
 */
export function buildPagination(limit: number | undefined, offset: number | undefined): string {
  let sql = '';
  if (limit != null) {
    sql += ` LIMIT ${Math.max(0, Math.trunc(limit))}`;
  }
  if (offset != null) {
    sql += ` OFFSET ${Math.max(0, Math.trunc(offset))}`;
  }
  return sql;
}
