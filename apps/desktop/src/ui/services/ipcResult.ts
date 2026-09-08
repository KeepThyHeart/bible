/**
 * Renderer-side helpers for working with the `Result<T>` envelope returned by
 * `ipcHandler`-wrapped IPC handlers.
 *
 * See `electron/ipc/handler-helper.ts` for the main-process side and the
 * full convention. The TL;DR for callers:
 *
 *   const result = await window.electron.ipcRenderer.invoke('foo:bar', arg);
 *   const value  = unwrap(result);   // throws on { ok: false }
 *
 * `unwrap` re-attaches `code` to the thrown error so call sites can switch
 * on it if they want to:
 *
 *   try {
 *     const note = await unwrap(window.electron.ipcRenderer.invoke('notes:get-by-id', id));
 *   } catch (err) {
 *     if (err instanceof IpcResultError && err.code === 'not_found') {
 *       // expected - show empty state
 *     } else {
 *       throw err;
 *     }
 *   }
 *
 * The `Result<T>` type itself is imported from the electron-side declaration
 * via `import type` so no runtime code is dragged into the renderer bundle.
 */

import type { IpcErrorCode, Result } from '../../../electron/ipc/result';

export type { IpcErrorCode, Result };

/**
 * Error thrown by `unwrap` when an IPC call returns `{ ok: false }`.
 * Carries the classification code so callers can branch on expected
 * failures (e.g. `not_found`) without parsing message strings.
 */
export class IpcResultError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = 'IpcResultError';
    this.code = code;
  }
}

/**
 * Resolve a `Result<T>` envelope to its value, or throw an `IpcResultError`
 * carrying the original code/message. Accepts either the envelope directly
 * or a Promise of one (which is the common case for `ipcRenderer.invoke`).
 */
export async function unwrap<T>(
  source: Result<T> | Promise<Result<T>>
): Promise<T> {
  const result = await source;
  if (result.ok) return result.value;
  throw new IpcResultError(result.error.code, result.error.message);
}

/**
 * Synchronous variant for callers that already have a resolved envelope
 * (e.g., handler-side code or tests).
 */
export function unwrapSync<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new IpcResultError(result.error.code, result.error.message);
}
