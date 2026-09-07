/**
 * Error class hierarchy for the extension API.
 *
 * Spec A section "DTO Schemas -> Errors". The host throws these over RPC; the worker
 * runtime re-raises them inside the extension's promise rejection. Both
 * sides import from this file so `instanceof PermissionDeniedError` works
 * across the host/worker boundary (each side has its own constructor, but
 * the `code` property is the wire-stable identifier - extensions should
 * branch on `error.code`, not on identity).
 *
 * The full set of stable codes lives in `EXTENSION_API_ERROR_CODES` in
 * `ExtensionApiDtos.ts`. Adding a new error here means adding the code there
 * too - `ensureErrorCodesAreSynced` enforces that at runtime via the smoke
 * test.
 */

import {
  EXTENSION_API_ERROR_CODES,
  type ExtensionApiErrorCode,
} from './ExtensionApiDtos';

/**
 * Base class for every error the extension API surfaces. The `code` property
 * is the wire-stable identifier; extensions should branch on it rather than
 * on `instanceof` because host and worker have separate class identities.
 */
export class ExtensionApiError extends Error {
  readonly code: ExtensionApiErrorCode;
  /** Optional structured detail attached to the error. */
  readonly data?: unknown;

  constructor(code: ExtensionApiErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.data = data;
    // Restore prototype chain for ES5 targets - required for `instanceof`
    // to work across class extension boundaries.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Concrete subclasses (one per stable code) -----------------------------

/** API call lacked the required permission. */
export class PermissionDeniedError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('PermissionDeniedError', message, data);
  }
}

/** URL host not in the manifest allowlist. */
export class NetworkHostNotAllowedError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('NetworkHostNotAllowedError', message, data);
  }
}

/** Network response exceeded `maxResponseBytes`. */
export class ResponseTooLargeError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('ResponseTooLargeError', message, data);
  }
}

/** KV storage exceeded quota. */
export class QuotaExceededError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('QuotaExceededError', message, data);
  }
}

/** Inter-extension call to an undeclared method. */
export class ApiExportNotFoundError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('ApiExportNotFoundError', message, data);
  }
}

/** Reverse-RPC endpoint not declared by the extension. */
export class ProviderNotRegisteredError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('ProviderNotRegisteredError', message, data);
  }
}

/** Malformed RPC envelope. */
export class RpcProtocolError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('RpcProtocolError', message, data);
  }
}

/** Reverse-RPC handler exceeded its timeout. */
export class RpcTimeoutError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('RpcTimeoutError', message, data);
  }
}

/** The host or worker disposed the call before it resolved. */
export class RpcCancelledError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('RpcCancelledError', message, data);
  }
}

/** Inter-extension call to an inactive extension. */
export class ExtensionNotActiveError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('ExtensionNotActiveError', message, data);
  }
}

/** Activation blocked by missing required setting. */
export class SettingRequiredError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('SettingRequiredError', message, data);
  }
}

/** Manifest engines.bibleApp range does not match the host API version. */
export class IncompatibleApiVersionError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('IncompatibleApiVersionError', message, data);
  }
}

/** Method removed in the current major API version. */
export class MethodRemovedError extends ExtensionApiError {
  constructor(message: string, data?: unknown) {
    super('MethodRemovedError', message, data);
  }
}

// --- Constructor lookup for re-raising over RPC ----------------------------

/**
 * Map from stable code to constructor. The worker runtime uses this to
 * re-raise an error received over RPC as the matching subclass - so
 * extension code that does `try { ... } catch (e) { if (e instanceof
 * PermissionDeniedError) ... }` works.
 *
 * Codes that arrive without a matching entry fall back to plain
 * `ExtensionApiError`.
 */
export const EXTENSION_API_ERROR_CONSTRUCTORS: Record<
  ExtensionApiErrorCode,
  new (message: string, data?: unknown) => ExtensionApiError
> = {
  PermissionDeniedError,
  NetworkHostNotAllowedError,
  ResponseTooLargeError,
  QuotaExceededError,
  ApiExportNotFoundError,
  ProviderNotRegisteredError,
  RpcProtocolError,
  RpcTimeoutError,
  RpcCancelledError,
  ExtensionNotActiveError,
  SettingRequiredError,
  IncompatibleApiVersionError,
  MethodRemovedError,
};

/**
 * Construct an `ExtensionApiError` (or appropriate subclass) from a wire
 * payload. Used by the worker runtime when it receives an error response.
 */
export function reviveExtensionApiError(payload: {
  code: string;
  message: string;
  data?: unknown;
}): ExtensionApiError {
  const Ctor = (EXTENSION_API_ERROR_CONSTRUCTORS as Record<string, typeof PermissionDeniedError>)[
    payload.code
  ];
  if (Ctor) return new Ctor(payload.message, payload.data);
  // Unknown code - wrap in the base class with the original code preserved.
  return new ExtensionApiError(
    payload.code as ExtensionApiErrorCode,
    payload.message,
    payload.data,
  );
}

/**
 * Runtime self-check that every code in `EXTENSION_API_ERROR_CODES` has a
 * matching constructor in `EXTENSION_API_ERROR_CONSTRUCTORS`. Called by the
 * smoke test; throws if the two are out of sync (i.e. a code was added but
 * a class wasn't, or vice versa).
 */
export function assertErrorCodesInSync(): void {
  const ctorKeys = new Set(Object.keys(EXTENSION_API_ERROR_CONSTRUCTORS));
  const codeSet = new Set<string>(EXTENSION_API_ERROR_CODES);
  for (const code of codeSet) {
    if (!ctorKeys.has(code)) {
      throw new Error(
        `EXTENSION_API_ERROR_CODES contains '${code}' but no constructor exists in EXTENSION_API_ERROR_CONSTRUCTORS`,
      );
    }
  }
  for (const ctorKey of ctorKeys) {
    if (!codeSet.has(ctorKey)) {
      throw new Error(
        `EXTENSION_API_ERROR_CONSTRUCTORS has '${ctorKey}' but it is missing from EXTENSION_API_ERROR_CODES`,
      );
    }
  }
}
