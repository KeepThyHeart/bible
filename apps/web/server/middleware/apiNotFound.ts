import type { Request, Response } from 'express';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';

/**
 * Answer for an `/api/...` path no route claimed (B-176): a JSON 404 in the
 * API's own `{ error: { code, message } }` shape, whatever the request's
 * Accept header or whether a client build is present. Mount it after every
 * `/api` route and before the static/SPA fallback, so non-API paths still get
 * the shell.
 */
export function apiNotFound(req: Request, res: Response): void {
  sendError(res, 404, ErrorCodes.NOT_FOUND, `No such API endpoint: ${req.method} ${req.originalUrl.split('?')[0]}`);
}
