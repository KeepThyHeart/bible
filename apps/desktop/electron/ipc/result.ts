/**
 * Shared `Result<T>` envelope used by IPC handlers and the renderer.
 *
 * This type is intentionally pure (no Electron / Node imports) so it can be
 * imported from both the Electron main process and the Vite-bundled renderer
 * without dragging Node modules into the browser bundle.
 *
 * Convention (see ./README.md and ./handler-helper.ts):
 *   - `ok: true`  -> successful response, payload in `value`.
 *   - `ok: false` -> failure, `error.code` classifies the failure and
 *                   `error.message` is a human-readable description.
 *
 * Standard error codes:
 *   - `not_found` - entity does not exist (handled in UI as empty/404)
 *   - `invalid_input` - caller passed bad arguments
 *   - `unauthorized` - caller lacks permission
 *   - `conflict` - state conflict (e.g., duplicate insert)
 *   - `unavailable` - required service / DB not initialized yet
 *   - `network_blocked` - refused by the master "Allow web requests" switch,
 *     not a failure (see `NetworkBlockedError` in `../services/NetworkGateway`)
 *   - `pack_signature_invalid` - a `.biblepack`'s `pack.json.sig` is present
 *     but does not verify, only one of `pack.json`/`pack.json.sig` is
 *     present, or the manifest is malformed. No override (see
 *     `ModulePackService.ts`, `ModulePackError`).
 *   - `pack_unverified` - a `.biblepack` is unsigned or signed by an
 *     untrusted key, and the caller did not pass `acceptUnverified: true`.
 *   - `pack_tampered` - a verified `.biblepack`'s manifest does not match the
 *     archive's actual file bytes (wrong hash/size, an unlisted module, or a
 *     listed one that never showed up). Nothing was installed.
 *   - `internal` - unexpected error (DB failure, FS failure, bug)
 *
 * Handlers should classify expected user-facing errors with one of the codes
 * above other than `internal`; anything unexpected falls back to `internal`.
 */

export type IpcErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'unauthorized'
  | 'conflict'
  | 'unavailable'
  | 'network_blocked'
  | 'pack_signature_invalid'
  | 'pack_unverified'
  | 'pack_tampered'
  | 'internal';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };

/**
 * Error class that handlers can throw to produce a known/classified failure
 * envelope. The handler-helper catches this and emits a `warn` log instead
 * of an `error` log with stack trace.
 */
export class IpcKnownError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: Exclude<IpcErrorCode, 'internal'>, message: string) {
    super(message);
    this.name = 'IpcKnownError';
    this.code = code;
  }
}
