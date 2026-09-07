/**
 * Input validation utilities for web API routes.
 *
 * Each validator returns the parsed value on success or null on failure.
 * Routes call these early and return 400 on null.
 */

import { MAX_SEARCH_QUERY_CHARS } from '../core.js';

// Item #7: Shared pagination limit across routes
export const MAX_PAGE_SIZE = 200;

/**
 * Maximum accepted length of a user search query, in characters.
 *
 * Sourced from `@bible/core` so that every embedding path — this server, the
 * browser worker, and the desktop app — enforces one number. See
 * `SearchQueryLimits.ts` in core for the measurements behind it.
 */
export const MAX_SEARCH_QUERY_LENGTH = MAX_SEARCH_QUERY_CHARS;

/**
 * Validate a user-supplied search query.
 * Rejects missing, empty, and over-long queries.
 */
export function validateSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SEARCH_QUERY_LENGTH) return null;
  return trimmed;
}

/** Validate a book number (integer 1-66) */
export function validateBookNumber(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 66) return null;
  return n;
}

/** Validate a chapter number (integer >= 1, <= 999) */
export function validateChapter(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  return n;
}

/** Validate a verse number (integer >= 0, <= 200) */
export function validateVerse(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 200) return null;
  return n;
}

/** Validate a verse ID (integer in valid range) */
export function validateVerseId(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1001001 || n > 66999999) return null;
  return n;
}

/**
 * Validate a module name.
 * Rejects path traversal attempts and non-alphanumeric characters.
 * Allows: letters, digits, underscores, hyphens.
 */
export function validateModuleName(value: string): string | null {
  if (!value || value.length > 100) return null;
  if (/[^a-zA-Z0-9_-]/.test(value)) return null;
  if (value.includes('..')) return null;
  return value;
}

/**
 * Validate a Strong's number format (e.g., G2316, H1234, A1234).
 */
export function validateStrongsNumber(value: string): string | null {
  if (!value) return null;
  if (!/^[GHA]\d+$/i.test(value)) return null;
  return value;
}
