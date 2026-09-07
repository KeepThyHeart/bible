/**
 * Custom error classes for the data layer.
 *
 * These enable callers to distinguish error types programmatically
 * (e.g., showing "not found" vs. a generic error toast in the UI)
 * rather than parsing error message strings.
 */

/** Base class for all data layer errors, enabling `instanceof` checks */
export class DataLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataLayerError';
  }
}

/** Input failed validation (e.g., missing required field, invalid format) */
export class ValidationError extends DataLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Requested entity does not exist */
export class NotFoundError extends DataLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Operation conflicts with existing state (e.g., duplicate key) */
export class ConflictError extends DataLayerError {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Database operation failed (query error, constraint violation, etc.) */
export class DatabaseError extends DataLayerError {
  /** The original error from the database driver, if available */
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
    this.cause = cause;
  }
}

/**
 * True when an error is SQLite refusing a write because the database is
 * read-only.
 *
 * This is a normal, expected condition rather than a fault: a shipped module
 * is an immutable artifact, and on macOS (inside a `.app`) or Linux (inside a
 * mounted AppImage) the whole resources directory is read-only. Callers that
 * write opportunistically - search-index caches, for instance - should degrade
 * quietly rather than fail the user's query.
 *
 * Matches on both the driver's `SQLITE_READONLY` code and the message text,
 * because `better-sqlite3` surfaces the code while some wrappers only preserve
 * the message.
 */
export function isReadOnlyDatabaseError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_READONLY')) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /readonly|attempt to write a readonly database/i.test(message);
}
