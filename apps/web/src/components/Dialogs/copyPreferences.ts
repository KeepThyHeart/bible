/**
 * Where the copy dialog's preferences live.
 *
 * The *meaning* of these settings — which fields exist, what counts as a valid
 * value, which format id is the default — belongs to `@bible/core`'s passage
 * format engine, which both apps share. What is web-specific is only the
 * storage: these `bible-reader-copy-*` keys, and the fact that they are read
 * out of `localStorage` rather than out of a settings store. Kept in its own
 * module for the same reason the desktop app keeps
 * `copyFormats/advancedOptions.ts` beside the engine rather than inside it —
 * the dialog should not have to know how a preference is spelled on disk.
 *
 * Everything read back goes through core's normalizers, so a blob written by
 * an older build, hand-edited, or corrupted costs the user one setting rather
 * than all of them.
 */

import {
  DEFAULT_PASSAGE_FORMAT_ID,
  isPassageMarkupFormat,
  normalizeAdvancedCopyOptions,
  normalizePassageMarkupOptions,
  remapLegacyFormatId,
  type AdvancedCopyOptions,
  type PassageMarkupFormatId,
  type PassageMarkupOptions,
} from '@bible/core/browser';

/**
 * The selected format id. Predates the shared catalogue, so it may hold one of
 * the web client's own retired ids — see {@link loadFormatId}.
 */
const FORMAT_KEY = 'bible-reader-copy-format';

/** The `AdvancedCopyOptions` blob, minus `markdown` (see below). */
const ADVANCED_KEY = 'bible-reader-copy-options';

/**
 * Markdown, on its own key.
 *
 * It restyles whichever format is selected rather than being a format of its
 * own, so it was given a key of its own rather than riding in the options blob
 * — and it stays there, because that is where existing users' preference is.
 */
const MARKDOWN_KEY = 'bible-reader-copy-markdown';

/**
 * `{ [formatId]: PassageMarkupOptions }` — one record per shape.
 *
 * Per format rather than shared, for the reason core's defaults differ per
 * format: heading level means nothing to an inline quotation and quote marks
 * mean nothing to a heading, so one shared record would make the user
 * re-choose every time they switched shape.
 */
const MARKUP_KEY = 'bible-reader-copy-markup-options';

/**
 * `localStorage` is not always there. Safari's private mode, a browser set to
 * block site data, and a storage quota that is already full all throw on access
 * rather than returning nothing — and a preference is never worth taking the
 * dialog down for. This is the one place that catch lives.
 */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a preference that cannot be saved is not an error worth showing */
  }
}

/** Parse stored JSON into something the normalizers can chew on. */
function readJson(key: string): unknown {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The stored format, migrated onto the shared catalogue.
 *
 * Before the engine moved into core the web client had its own list —
 * `standard`, `plain`, `paragraph`, `full`, `advanced`, `template` — none of
 * which is the same thing as a catalogue id. Two steps handle that:
 *
 * 1. {@link remapLegacyFormatId} moves core's own retired ids onto the shape
 *    each was a weaker restatement of (`standard` → `blockquote-numbered`).
 *    The web's `standard` was a different layout under the same name, but a
 *    numbered quote is the closest offered shape to it either way.
 * 2. Anything that still does not resolve — `plain`, `paragraph`, `full`,
 *    `advanced`, or a format not on this app's offered list — falls back to
 *    the catalogue default rather than leaving the dialog with nothing
 *    selected and a blank preview.
 *
 * @param offered - the ids this app actually offers, so a format that exists
 *   in core but is not shown here cannot be restored from storage.
 */
export function loadFormatId(offered: readonly string[]): PassageMarkupFormatId {
  const stored = readRaw(FORMAT_KEY);
  const remapped = stored ? remapLegacyFormatId(stored) : '';
  const chosen = offered.includes(remapped) ? remapped : DEFAULT_PASSAGE_FORMAT_ID;
  // The offered list is markup-only (see `CopyDialog`), so this narrowing holds
  // for every id that reaches it; the guard is what makes that a type fact
  // rather than a comment.
  return isPassageMarkupFormat(chosen) ? chosen : 'blockquote';
}

export function saveFormatId(id: string): void {
  writeRaw(FORMAT_KEY, id);
}

/**
 * The advanced options, with `markdown` folded back in from its own key.
 *
 * Only two of these fields are still editable here — `markdown` and
 * `textFormat`, the two questions that are about the *clipboard* rather than
 * about the shape. The rest belong to core's retired Standard/Combined
 * renderer; they are normalized and round-tripped so that nothing is silently
 * thrown away, but no control writes them.
 */
export function loadAdvancedOptions(): AdvancedCopyOptions {
  return {
    ...normalizeAdvancedCopyOptions(readJson(ADVANCED_KEY)),
    markdown: readRaw(MARKDOWN_KEY) === '1',
  };
}

export function saveAdvancedOptions(options: AdvancedCopyOptions): void {
  writeRaw(ADVANCED_KEY, JSON.stringify(options));
  writeRaw(MARKDOWN_KEY, options.markdown ? '1' : '0');
}

/** One format's shape options, defaulted from core's per-format defaults. */
export function loadMarkupOptions(formatId: PassageMarkupFormatId): PassageMarkupOptions {
  const all = readJson(MARKUP_KEY);
  const stored =
    typeof all === 'object' && all !== null && !Array.isArray(all)
      ? (all as Record<string, unknown>)[formatId]
      : null;
  return normalizePassageMarkupOptions(formatId, stored);
}

export function saveMarkupOptions(
  formatId: PassageMarkupFormatId,
  options: PassageMarkupOptions,
): void {
  const all = readJson(MARKUP_KEY);
  const existing =
    typeof all === 'object' && all !== null && !Array.isArray(all)
      ? (all as Record<string, unknown>)
      : {};
  writeRaw(MARKUP_KEY, JSON.stringify({ ...existing, [formatId]: options }));
}

/** Exported for the tests that pin the migration; not part of the dialog's API. */
export const COPY_PREFERENCE_KEYS = {
  format: FORMAT_KEY,
  advanced: ADVANCED_KEY,
  markdown: MARKDOWN_KEY,
  markup: MARKUP_KEY,
} as const;
