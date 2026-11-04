import type { Request, Response, NextFunction } from 'express';

/**
 * Query values arrive as string | string[] | object, but handlers cast them to
 * `string`. A repeated parameter (?q=a&q=b) or a NUL byte (%00) then crashed a
 * handler (500) or truncated a SQLite term (B-172, B-174). Normalise once, up
 * front: first value wins, NUL bytes are dropped, nested objects become "".
 */
export function sanitizeQuery(req: Request, _res: Response, next: NextFunction): void {
  const query = req.query as Record<string, unknown>;
  for (const key of Object.keys(query)) {
    let value = query[key];
    if (Array.isArray(value)) value = value[0];
    query[key] = typeof value === 'string' ? value.replace(/\0/g, '') : '';
  }
  next();
}

/** 4xx status carried by an error from Express/body-parser (bad %-escape, bad JSON, ...), else null. */
export function clientErrorStatus(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : null;
  return status !== null && status >= 400 && status < 500 ? status : null;
}

/** A user-input mistake in a search query (unmatched quote/parenthesis, bad regex, empty) rather than a server fault. */
export function isQuerySyntaxError(err: unknown): boolean {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string'
    && /^(Unmatched (quote|closing parenthesis|opening parenthesis)|Invalid regular expression|Search query cannot be empty)/.test(message);
}

/** Clamp a user-supplied page size / offset to [min, max]; garbage gives the fallback. */
export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
