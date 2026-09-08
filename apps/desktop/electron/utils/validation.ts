/**
 * IPC Input Validation Helpers
 *
 * Validates parameters received from the renderer process at the IPC boundary.
 */

import { normalizeMarkupColor, HIGHLIGHT_COLOR_NAMES } from '@bible/core';
import { IpcKnownError } from '../ipc/result';

/**
 * Longest module abbreviation accepted. Well past any real one - the longest in
 * the shipped set is 18 characters - but bounded so a pathological string never
 * reaches the metadata query or a log line.
 */
const ABBREVIATION_MAX_LENGTH = 64;

/**
 * Characters an abbreviation may never contain: every Unicode control/format
 * character (`\p{C}`, which covers NUL and the bidi overrides), both path
 * separators, and the Windows-reserved filename set.
 *
 * Everything else is allowed on purpose. An abbreviation is **module data**,
 * not an identifier this app mints: it is read out of the module's own
 * `module_info` row at import time, so it carries whatever the publisher wrote.
 * The shipped dictionary set already contains `Webster 1828` - a space - and
 * the previous `^[A-Za-z0-9_-]{1,30}$` rule rejected it, so every dictionary
 * IPC call for that module failed with a raw `Invalid module abbreviation`
 * exception and the module was simply unusable.
 *
 * Widening this is safe because the abbreviation is never concatenated into
 * anything: `ModuleMetadataRepository.getByAbbreviation` binds it as a SQL
 * parameter, and the database file path comes back *from that row*
 * (`database_path`) rather than being built out of the abbreviation. The
 * traversal-shaped checks below are defence in depth, not the only barrier.
 */
const FORBIDDEN_ABBREVIATION_CHARS = /[\p{C}/\\:*?"<>|]/u;

/**
 * Validate a module abbreviation arriving from the renderer.
 *
 * Throws an `IpcKnownError` rather than a bare `Error` so a bad value is
 * classified as `invalid_input` and logged as a one-line warning - a raw stack
 * trace would read as a crash for what is an ordinary "no such module"
 * condition.
 */
export function validateAbbreviation(abbr: unknown): string {
  if (
    typeof abbr !== 'string' ||
    abbr.length === 0 ||
    abbr.length > ABBREVIATION_MAX_LENGTH ||
    abbr.trim().length === 0 ||
    abbr.includes('..') ||
    FORBIDDEN_ABBREVIATION_CHARS.test(abbr)
  ) {
    const shown = typeof abbr === 'string' ? abbr.slice(0, ABBREVIATION_MAX_LENGTH) : typeof abbr;
    throw new IpcKnownError('invalid_input', `“${shown}” is not a valid module name.`);
  }
  return abbr;
}

export function validateBookNumber(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 66) {
    throw new Error(`Invalid book number: ${n}`);
  }
  return n;
}

export function validateChapter(n: unknown): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 150) {
    throw new Error(`Invalid chapter number: ${n}`);
  }
  return n;
}

export function validateVerseId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1001001 || id > 66999999) {
    throw new Error(`Invalid verse ID: ${id}`);
  }
  return id;
}

export function validateString(val: unknown, fieldName: string, maxLength = 500): string {
  if (typeof val !== 'string' || val.length === 0 || val.length > maxLength) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string (max ${maxLength} chars)`);
  }
  return val;
}

export function validatePositiveInt(n: unknown, fieldName: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${fieldName}: must be a positive integer`);
  }
  return n;
}

/**
 * Schemes `shell.openExternal` is allowed to act on.
 *
 * `shell.openExternal` hands the string to the OS shell, so on Windows a
 * `file:`, `smb:` or custom-handler URL would launch a local program or mount a
 * remote share. Only two schemes have a legitimate caller in this app:
 *   - `https:` - documentation and the configured issue tracker.
 *   - `mailto:` - the issue-report target may be an email address
 *     (`buildIssueReportUrl()` in `config/appConfig.ts`).
 *
 * `http:` is deliberately NOT allowed: nothing the app links to needs plaintext
 * transport, and permitting it would let a renderer-side injection send the
 * user to an interceptable page. Add it here only if a real requirement shows
 * up.
 */
export const ALLOWED_EXTERNAL_URL_SCHEMES: readonly string[] = ['https:', 'mailto:'];

/** Upper bound on an external URL, well past any real issue-tracker link. */
const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Validate a URL the renderer wants opened in the user's browser/mail client
 * and return it in canonical form.
 *
 * Parsing goes through the `URL` constructor rather than a string-prefix test
 * so that tricks like `https:/\evil` or a leading-whitespace `\thttps://...`
 * cannot smuggle a different scheme past the check. Callers are expected to
 * log the rejection - see `utils/windowSecurity.ts#openExternalUrl`.
 */
export function validateExternalUrl(value: unknown, fieldName = 'external URL'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: must be a non-empty string (max ${MAX_EXTERNAL_URL_LENGTH} chars)`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${fieldName}: not a well-formed URL`);
  }

  if (!ALLOWED_EXTERNAL_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(
      `Invalid ${fieldName}: scheme "${parsed.protocol}" is not allowed ` +
        `(expected one of ${ALLOWED_EXTERNAL_URL_SCHEMES.join(', ')})`
    );
  }

  // Return the parsed form so what we validated is exactly what gets opened;
  // `URL` round-trips `mailto:` targets (including the `?subject=` query
  // `buildIssueReportUrl()` appends) unchanged.
  return parsed.toString();
}

/**
 * Validate a markup/highlight colour arriving from the renderer and return it
 * as canonical `#RRGGBB` hex.
 *
 * Accepts the encodings `@bible/core` recognises: hex `#RRGGBB`, short
 * hex `#RGB`, or one of the six v1 palette names in `HIGHLIGHT_COLOR_NAMES` -
 * which is the single source of truth for the palette, shared with
 * `HighlightColor`. Anything else is rejected rather than silently coerced to
 * the yellow default, so a malformed value from the renderer cannot be written
 * to the user database.
 */
export function validateMarkupColor(value: unknown, fieldName = 'markup color'): string {
  if (typeof value === 'string') {
    // '' is a sentinel fallback: a non-empty result means core recognised the
    // input, so there is no second copy of the accepted-colour rules here.
    const normalized = normalizeMarkupColor(value, '');
    if (normalized !== '') {
      return normalized;
    }
  }

  throw new Error(
    `Invalid ${fieldName}: expected "#RRGGBB" hex or one of ${HIGHLIGHT_COLOR_NAMES.join(', ')}`
  );
}
