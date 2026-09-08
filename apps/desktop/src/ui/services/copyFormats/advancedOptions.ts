/**
 * Where the desktop app keeps the advanced copy options.
 *
 * The options themselves - what they mean, what they default to, and how a
 * stored record is validated field by field - belong to `@bible/core`'s
 * passage-format engine, because the web client renders the same formats from
 * the same record. What is *desktop's* is the key it lives under: the two apps
 * write to different stores, so the read and the write stay here.
 *
 * They deliberately live outside `FormatOptions`. `FormatOptions` is the
 * two-flag set every format understands (translation label, red letter), and it
 * is serialised into note content by the verse-expansion mark
 * (`VerseExpansionMark.ts`) - widening it would push a blob of shape settings
 * into every saved `.bn` file.
 *
 * Instead this follows the precedent already set by `savedTemplates.ts`: the
 * copy path reads its extra state from storage and hands it to the format,
 * while the dialog renders the live (possibly unsaved) state directly through
 * `renderPassageCopy()`. One storage key, read and written the same
 * best-effort, per-field-validated way as the last-used format in
 * `verseCopyService.ts` - a malformed blob, a stale field, or a localStorage
 * that throws must degrade to the defaults rather than break copying.
 */

import {
  DEFAULT_ADVANCED_COPY_OPTIONS,
  normalizeAdvancedCopyOptions,
  type AdvancedCopyOptions,
} from '@bible/core';

export type { AdvancedCopyOptions, ReferencePosition, VerseTextFormat } from '@bible/core';
export { DEFAULT_ADVANCED_COPY_OPTIONS };

const ADVANCED_OPTIONS_KEY = 'bible-desktop-copy-advanced-options';

/**
 * Read the saved advanced options. Every field falls back independently, so one
 * bad value cannot discard the rest of the user's settings.
 */
export function loadAdvancedCopyOptions(): AdvancedCopyOptions {
  let stored: unknown = null;
  try {
    const raw = localStorage.getItem(ADVANCED_OPTIONS_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    // Malformed JSON, or a localStorage that throws (private mode, quota):
    // fall through to the defaults.
  }

  return normalizeAdvancedCopyOptions(stored);
}

/** Persist the advanced options. Best-effort: losing them costs the user a few clicks. */
export function saveAdvancedCopyOptions(options: AdvancedCopyOptions): void {
  try {
    localStorage.setItem(ADVANCED_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Best-effort.
  }
}

/** Exported for tests, so they do not hardcode the storage key. */
export const ADVANCED_COPY_OPTIONS_KEY = ADVANCED_OPTIONS_KEY;
