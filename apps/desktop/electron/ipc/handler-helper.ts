/**
 * `ipcHandler` - opinionated wrapper around `ipcMain.handle` that produces a
 * standard `Result<T>` envelope for every reply, classifies errors, and logs
 * each class at the appropriate severity.
 *
 * ## Why this shape?
 *
 * A handler must distinguish "user did something invalid" from "the database
 * is on fire", and must not log every failure at the same severity, or log
 * files end up either noisy or silent and the renderer has no way to handle
 * expected failures (e.g., "note not found") differently from genuine bugs.
 *
 * `ipcHandler` is the only registration helper - every handler in this folder
 * uses it, so the renderer sees exactly one envelope shape.
 *
 * ## Convention enforced by this helper
 *
 *   - All replies are `Result<T> = { ok: true, value } | { ok: false, error }`.
 *   - Every handler body is wrapped in try/catch.
 *   - Throwing an `IpcKnownError(code, message)` is the canonical way to
 *     surface an expected user-facing failure. Logged at `warn`, no stack.
 *   - Anything else is treated as an unexpected error, classified as
 *     `code: 'internal'`, and logged at `error` with the full stack.
 *
 * The renderer-side counterpart is `unwrap` in
 * `src/ui/services/ipcResult.ts`, which converts an `ok: false` envelope back
 * into a thrown `Error` so call sites can use ordinary `try/catch`.
 *
 * @example
 *   ipcHandler<[number], SerializedNote>('notes:get-by-id', async (id) => {
 *     const note = await repo.getById(id);
 *     if (!note) throw new IpcKnownError('not_found', `Note ${id} not found`);
 *     return serializeNote(note);
 *   });
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import type { IpcError, Result } from './result';
import { IpcKnownError } from './result';

/**
 * Register an IPC handler whose response is wrapped in a `Result<T>` envelope.
 *
 * @param channel - IPC channel name (e.g. 'highlights:get-by-id')
 * @param fn      - Handler body. Receives the raw IPC args (event stripped).
 *                  Should return the success payload, or throw an
 *                  `IpcKnownError` for classified failures.
 */
export function ipcHandler<Args extends unknown[], T>(
  channel: string,
  fn: (...args: Args) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      const value = await fn(...(args as Args));
      return { ok: true, value };
    } catch (err) {
      const error = classifyError(channel, err);
      return { ok: false, error };
    }
  });
}

/** How long an identical known-error line is collapsed before it is logged again. */
const KNOWN_ERROR_LOG_WINDOW_MS = 30_000;

/**
 * Cap on distinct known-error keys held for de-duplication. Messages embed ids
 * ("Note 412 not found"), so the key space is open-ended; the table is dropped
 * wholesale rather than grown without bound. Losing the counts only means the
 * next occurrence of a stale key logs immediately, which is harmless.
 */
const KNOWN_ERROR_LOG_MAX_KEYS = 500;

const knownErrorLog = new Map<string, { lastLoggedAt: number; suppressed: number }>();

/**
 * Log a known error, collapsing identical repeats.
 *
 * A classified failure is usually a state the UI asks about repeatedly rather
 * than a one-off event: a commentary that is not installed is re-requested once
 * per rendered entry, so a single missing module wrote the same line dozens of
 * times within a few milliseconds and buried everything else in the log. The
 * first occurrence still logs immediately; identical repeats inside the window
 * are counted and reported on the next line that gets through, so the condition
 * is still visible and its frequency is not lost.
 */
function logKnownError(channel: string, err: IpcKnownError): void {
  const key = `${channel}|${err.code}|${err.message}`;
  const now = Date.now();
  const entry = knownErrorLog.get(key);

  if (entry && now - entry.lastLoggedAt < KNOWN_ERROR_LOG_WINDOW_MS) {
    entry.suppressed += 1;
    return;
  }

  const suppressed = entry?.suppressed ?? 0;
  const suffix =
    suppressed > 0
      ? ` (+${suppressed} identical in the last ${Math.round((now - (entry?.lastLoggedAt ?? now)) / 1000)}s)`
      : '';

  if (!entry && knownErrorLog.size >= KNOWN_ERROR_LOG_MAX_KEYS) {
    knownErrorLog.clear();
  }
  knownErrorLog.set(key, { lastLoggedAt: now, suppressed: 0 });
  log.warn(`[${channel}] ${err.code}: ${err.message}${suffix}`);
}

/**
 * Classify a thrown value into an `IpcError` and log it at the appropriate
 * level. Known errors (`IpcKnownError`) get a single-line `warn`, collapsed if
 * identical lines repeat; everything else is treated as unexpected and logged
 * at `error` with stack trace.
 */
function classifyError(channel: string, err: unknown): IpcError {
  if (err instanceof IpcKnownError) {
    logKnownError(channel, err);
    return { code: err.code, message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);
  // Pass the Error object to log.error so electron-log captures the full
  // stack trace via its file transport.
  log.error(`[${channel}] internal error:`, err);
  return { code: 'internal', message };
}

// Re-export for convenience so handlers only need one import.
export { IpcKnownError } from './result';
export type { IpcError, IpcErrorCode, Result } from './result';
