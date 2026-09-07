/**
 * Standardized API error response utilities.
 *
 * Produces a consistent `{ error: { code, message } }` envelope for all
 * error responses across the web API.
 */
import type { Response } from 'express';

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_PARAM: 'INVALID_PARAM',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export function sendError(res: Response, status: number, code: ErrorCode, message: string): void {
  res.status(status).json({ error: { code, message } });
}
