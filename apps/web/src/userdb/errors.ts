/** Worker error mapping: whatever was thrown becomes the wire's `{ name, message, code }`. */
import type { UserDbResponse } from './protocol';

export type WireError = Extract<UserDbResponse, { ok: false }>['error'];

/** Primary SQLite result codes (sqlite3.h), for oo1 errors that carry only the number. */
const RESULT_CODE_NAMES: Record<number, string> = {
  1: 'SQLITE_ERROR', 2: 'SQLITE_INTERNAL', 3: 'SQLITE_PERM', 4: 'SQLITE_ABORT', 5: 'SQLITE_BUSY', 6: 'SQLITE_LOCKED',
  7: 'SQLITE_NOMEM', 8: 'SQLITE_READONLY', 9: 'SQLITE_INTERRUPT', 10: 'SQLITE_IOERR', 11: 'SQLITE_CORRUPT',
  12: 'SQLITE_NOTFOUND', 13: 'SQLITE_FULL', 14: 'SQLITE_CANTOPEN', 15: 'SQLITE_PROTOCOL', 16: 'SQLITE_EMPTY',
  17: 'SQLITE_SCHEMA', 18: 'SQLITE_TOOBIG', 19: 'SQLITE_CONSTRAINT', 20: 'SQLITE_MISMATCH', 21: 'SQLITE_MISUSE',
  22: 'SQLITE_NOLFS', 23: 'SQLITE_AUTH', 24: 'SQLITE_FORMAT', 25: 'SQLITE_RANGE', 26: 'SQLITE_NOTADB',
};

export function toWireError(error: unknown): WireError {
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const e = error as { name?: unknown; message?: unknown; code?: unknown; resultCode?: unknown };
    const out: WireError = {
      name: typeof e.name === 'string' && e.name ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : String(e.message),
    };
    if (typeof e.code === 'string') out.code = e.code;
    else if (typeof e.resultCode === 'number') {
      out.code = RESULT_CODE_NAMES[e.resultCode & 0xff] ?? `SQLITE_${e.resultCode}`;
    }
    return out;
  }
  return { name: 'Error', message: String(error) };
}

/** Rebuild an Error on the main-thread side so callers can `catch (e) { e.code }`. */
export class UserDbError extends Error {
  readonly code?: string;
  constructor(wire: WireError) {
    super(wire.message);
    this.name = wire.name;
    this.code = wire.code;
  }
}
