/**
 * Remembering how the user likes each passage-insertion format.
 *
 * The point of keying by format is that the settings are not interchangeable.
 * Someone who quotes with H2 headings and drops verse numbers from their
 * inline quotes wants *both* back, and a single shared option set makes them
 * re-choose every time they switch shape. So each format id gets its own
 * record, plus one "which format was I last using" so the picker opens where
 * they left it.
 *
 * What a valid record *is* belongs to `@bible/core`
 * (`normalizePassageMarkupOptions`), because the web client stores the same
 * shape; what is desktop's is the keys. Storage follows the precedent of
 * `advancedOptions.ts` and `verseCopyService.ts`: best-effort writes, and
 * per-field validation on read so a stale field, a format id that no longer
 * exists, malformed JSON, or a localStorage that throws (private mode, quota)
 * all degrade to the defaults rather than break inserting. These are
 * disposable UI preferences, deliberately kept out of the cross-package
 * `SessionData` type - the same reasoning the copy formats' persistence
 * records.
 */

import {
  DEFAULT_PASSAGE_FORMAT_ID,
  getPassageFormatEntry,
  normalizePassageMarkupOptions,
  remapLegacyFormatId,
  type PassageMarkupFormatId,
  type PassageMarkupOptions,
} from '@bible/core';

const PASSAGE_INSERT_OPTIONS_KEY = 'bible-desktop-passage-insert-options';
const LAST_INSERT_FORMAT_KEY = 'bible-desktop-last-insert-format';
const SKIP_FORMAT_MENU_KEY = 'bible-desktop-passage-insert-skip-menu';

/**
 * What Tab offers first in a note that has never had a passage inserted.
 *
 * The plain block quote, which is also what the copy dialog opens on: one
 * default for one list of formats. Being Numbered quote here and Standard
 * there would be precisely the kind of "the same dialog behaves differently
 * depending on where you opened it" the consolidation removes. Someone who
 * prefers the numbers picks the format once and it is remembered.
 */
export const DEFAULT_INSERT_FORMAT_ID: string = DEFAULT_PASSAGE_FORMAT_ID;

function readStore(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PASSAGE_INSERT_OPTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed JSON or an unavailable localStorage: treat as empty.
  }
  return {};
}

/**
 * The saved options for one format, with every field falling back
 * independently to that format's own defaults.
 */
export function loadPassageMarkupOptions(formatId: PassageMarkupFormatId): PassageMarkupOptions {
  return normalizePassageMarkupOptions(formatId, readStore()[formatId]);
}

/**
 * Persist one format's options, leaving every other format's alone.
 *
 * Read-modify-write rather than holding the map in memory: a detached notes
 * window is a separate renderer with its own module instances, and the last
 * write should not wipe what the other window saved.
 */
export function savePassageMarkupOptions(
  formatId: PassageMarkupFormatId,
  options: PassageMarkupOptions,
): void {
  const store = readStore();
  store[formatId] = options;
  try {
    localStorage.setItem(PASSAGE_INSERT_OPTIONS_KEY, JSON.stringify(store));
  } catch {
    // Best-effort; losing it costs the user one re-selection.
  }
}

/**
 * The format the insert picker should open on.
 *
 * Validated against the catalog rather than one family's registry, and a
 * *retired* id is remapped rather than kept: someone whose last insertion was
 * "Standard" should open on the shape closest to it, not on a format the
 * picker no longer lists. An id belonging to nothing at all (a downgrade, a
 * hand-edited value) falls back to the default.
 */
export function getLastInsertFormatId(): string {
  try {
    const raw = localStorage.getItem(LAST_INSERT_FORMAT_KEY);
    if (raw) {
      const remapped = remapLegacyFormatId(raw);
      if (getPassageFormatEntry(remapped)) return remapped;
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_INSERT_FORMAT_ID;
}

export function setLastInsertFormatId(formatId: string): void {
  try {
    localStorage.setItem(LAST_INSERT_FORMAT_KEY, formatId);
  } catch {
    // Best-effort.
  }
}

/**
 * "Don't ask again" - Tab inserts straight away in the remembered format
 * instead of opening the picker.
 *
 * The picker is the default because a passage can be laid out four quite
 * different ways and the right one depends on what is being written. Once
 * someone has settled on one, though, being asked every time is friction, so
 * the popover offers the escape hatch. Right-click -> "Expand to full text..."
 * always opens the picker, which is how they get it back.
 */
export function getSkipFormatMenu(): boolean {
  try {
    return localStorage.getItem(SKIP_FORMAT_MENU_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSkipFormatMenu(skip: boolean): void {
  try {
    localStorage.setItem(SKIP_FORMAT_MENU_KEY, skip ? 'true' : 'false');
  } catch {
    // Best-effort.
  }
}

/** Exported for tests, so they do not hardcode the storage keys. */
export const PASSAGE_INSERT_KEYS = {
  options: PASSAGE_INSERT_OPTIONS_KEY,
  lastFormat: LAST_INSERT_FORMAT_KEY,
  skipMenu: SKIP_FORMAT_MENU_KEY,
} as const;
