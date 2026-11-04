/**
 * Error codes and mappings that sit beside `errorResponse.ts` (W-009, W-011).
 *
 * Kept in their own file so the shared `ErrorCodes` list is untouched; the
 * envelope is the same `{ error: { code, message } }`.
 */
import type { Response } from 'express';

export const ExtraErrorCodes = {
  /** The server gave up on (or is too loaded to answer) a request; retry shortly. */
  SERVICE_BUSY: 'SERVICE_BUSY',
  /** The site password gate wants a login. */
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  /** A download is over the size cap. */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
} as const;

export type ExtraErrorCode = typeof ExtraErrorCodes[keyof typeof ExtraErrorCodes];

/** Same envelope as `sendError`, for the codes above. */
export function sendExtraError(res: Response, status: number, code: ExtraErrorCode, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/** Seconds a client is told to wait before retrying a 503. */
export const RETRY_AFTER_SECONDS = 5;

/**
 * W-009: connect-timeout reports a slow request as an error with `code`
 * 'ETIMEDOUT' and status 503. That is overload, not a server fault: answer 503
 * (with Retry-After) instead of a logged 500.
 */
export function isServiceBusyError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown; timeout?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  return e.code === 'ETIMEDOUT' || e.status === 503 || e.statusCode === 503;
}

/** Send the 503 for `isServiceBusyError`, unless the response has already started. */
export function sendServiceBusy(res: Response): void {
  if (res.headersSent) return;
  res.set('Retry-After', String(RETRY_AFTER_SECONDS));
  sendExtraError(res, 503, ExtraErrorCodes.SERVICE_BUSY, 'The server is busy; please try again shortly');
}
