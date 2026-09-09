/**
 * One numbered list of every passage format the app offers.
 *
 * There are two rendering families - the **note-insertion** shapes in
 * `passageMarkup.ts`, which produce a block tree, and the **clipboard**
 * formats in `formatRegistry.ts`, which produce newline-separated lines - and
 * until now each dialog knew about a different subset in a different order.
 * That made "format 2" meaningless: it named a different thing depending on
 * which dialog you were looking at. This module is the single source of truth
 * for *which* formats exist, in *what* order, and under *what* number, so `2`
 * is the same shape whether the user is copying a passage to the clipboard or
 * inserting one into a note.
 *
 * **Five formats, because seven were four.** The offered list was Block quote,
 * Numbered quote, Verse headings, Inline quote, Standard, Combined and Custom
 * Template - and the product owner's question ("what *is* the difference
 * between Standard and Numbered Quote? is Combined really necessary?") had no
 * good answer: Standard is a numbered quote written as lines, and Combined is
 * an inline quote written as lines. Two of the seven were restatements of two
 * others in a weaker engine. The offered set is now:
 *
 *   1. Block quote      2. Numbered quote      3. Inline quote
 *   4. Verse headings   5. Custom template
 *
 * Block quote leads because it is the default and the plainest thing a
 * quotation can be; the two per-verse shapes follow it; Custom template is
 * last because it is the escape hatch rather than a choice among peers.
 *
 * **`standard` and `combined` still resolve - they are just not offered.**
 * They are `LEGACY_PASSAGE_FORMAT_IDS`: notes already written to disk carry
 * `data-expansion-format="standard"` in their `verseExpansion` mark, and the
 * export utility still renders through the clipboard registry, so deleting
 * them would break re-formatting an old passage and empty the export format
 * list. They are excluded from the catalog by default and included on request
 * (see {@link getPassageFormatCatalog}) so that a dialog re-formatting a
 * legacy passage can still *show* what that passage currently is.
 * {@link remapLegacyFormatId} maps them onto the closest surviving shape for
 * everywhere that has to choose one.
 *
 * **Numbers come from the declared order, not from array position.**
 * {@link PASSAGE_FORMAT_ORDER} is the contract; a format's number is its place
 * in that list and nothing else. A format the registry no longer resolves
 * simply drops out of the catalog without renumbering the ones after it, and a
 * format added to the registry but not to the order is appended past the end
 * rather than shuffling the existing numbers. Users learn "3 is inline quote";
 * a number that moves is worse than no number at all.
 */

import { getAllFormats } from './formatRegistry';
import { PASSAGE_MARKUP_FORMATS, isPassageMarkupFormat } from './passageMarkup';

/** Which engine renders a format: a block tree, or newline-separated lines. */
export type PassageFormatFamily = 'markup' | 'clipboard';

export interface PassageFormatEntry {
  id: string;
  /**
   * 1-based, stable, and the same number in every dialog - or `0` for a
   * legacy format, which has no digit shortcut because it is not on the list
   * the digits index.
   */
  number: number;
  family: PassageFormatFamily;
  /** English name, used when the catalog has no entry for `labelKey`. */
  name: string;
  description: string;
  /** i18n key prefix: `${labelKey}.name` and `${labelKey}.description`. */
  labelKey: string;
  /**
   * Retired: still renderable, so an existing note keeps its shape, but never
   * offered as a choice.
   */
  legacy?: boolean;
}

/**
 * The declared order - and the whole of what either dialog offers.
 *
 * Block quote first (it is the default), then the two other quotation shapes,
 * then the per-verse heading layout, then the template.
 */
export const PASSAGE_FORMAT_ORDER: readonly string[] = [
  'blockquote',
  'blockquote-numbered',
  'inline-quote',
  'heading-per-verse',
  'template',
];

/** What the dialogs open on when nothing has been chosen before. */
export const DEFAULT_PASSAGE_FORMAT_ID = 'blockquote';

/**
 * Formats that still render but are no longer offered.
 *
 * Kept registered rather than deleted: `formatVersesWithFormat` is what
 * re-formats a passage already sitting in a saved note. Removing them would
 * turn that note's passage into an unrenderable id.
 */
export const LEGACY_PASSAGE_FORMAT_IDS: readonly string[] = ['standard', 'combined'];

/**
 * The surviving format closest to a retired one.
 *
 * Standard is a reference line above numbered verses - that is Numbered quote
 * with the quotation drawn properly. Combined runs the whole passage together
 * with the reference inline - that is Inline quote. Chosen so that a stored
 * preference or a legacy note lands somewhere recognisable rather than on
 * whatever happens to be first.
 */
const LEGACY_REMAP: Readonly<Record<string, string>> = {
  standard: 'blockquote-numbered',
  combined: 'inline-quote',
};

export function isLegacyPassageFormat(id: string): boolean {
  return LEGACY_PASSAGE_FORMAT_IDS.includes(id);
}

/**
 * Map a retired format id onto the offered one closest to it; anything else
 * is returned untouched.
 */
export function remapLegacyFormatId(id: string): string {
  return LEGACY_REMAP[id] ?? id;
}

/**
 * Digit keys only go up to 9, so only the first nine formats get a shortcut.
 * Everything past that is still selectable by mouse and by arrow key.
 */
export const MAX_FORMAT_SHORTCUT = 9;

function markupEntry(id: string, number: number): PassageFormatEntry | null {
  const meta = PASSAGE_MARKUP_FORMATS.find(f => f.id === id);
  if (!meta) return null;
  return {
    id: meta.id,
    number,
    family: 'markup',
    name: meta.name,
    description: meta.description,
    labelKey: `ui.passageInsert.format.${meta.id}`,
  };
}

function clipboardEntry(id: string, number: number): PassageFormatEntry | null {
  const format = getAllFormats().find(f => f.id === id);
  if (!format) return null;
  return {
    id: format.id,
    number,
    family: 'clipboard',
    name: format.name,
    description: format.description,
    labelKey: `copyOptionsDialog.format.${format.id}`,
  };
}

function buildEntry(id: string, number: number): PassageFormatEntry | null {
  return isPassageMarkupFormat(id) ? markupEntry(id, number) : clipboardEntry(id, number);
}

export interface PassageFormatCatalogOptions {
  /**
   * Ids to include even though they are retired.
   *
   * Only ever the format a passage is *currently* in: re-formatting a note
   * written before the list was cut has to show what that passage is now, or
   * the picker opens with nothing selected and the user cannot tell what
   * pressing Apply would preserve. A legacy entry appears last, carries
   * `legacy: true` and number `0`, and cannot be reached by a digit.
   */
  includeIds?: readonly string[];
}

/**
 * Every offered format, in order, each carrying its number.
 *
 * Recomputed per call rather than cached, because the clipboard registry is
 * built at import time from modules a test may have mocked, and a cached list
 * would freeze whichever variant happened to load first.
 */
export function getPassageFormatCatalog(
  options: PassageFormatCatalogOptions = {},
): PassageFormatEntry[] {
  const entries: PassageFormatEntry[] = [];

  PASSAGE_FORMAT_ORDER.forEach((id, index) => {
    const entry = buildEntry(id, index + 1);
    if (entry) entries.push(entry);
  });

  // A clipboard format registered without being added to the declared order
  // still has to be offered - it is just numbered past the end, so it cannot
  // renumber anything above it. Retired ids are the exception: they are
  // registered on purpose and must stay off the list.
  let next = PASSAGE_FORMAT_ORDER.length + 1;
  for (const format of getAllFormats()) {
    if (PASSAGE_FORMAT_ORDER.includes(format.id)) continue;
    if (isLegacyPassageFormat(format.id)) continue;
    const entry = clipboardEntry(format.id, next);
    if (entry) {
      entries.push(entry);
      next += 1;
    }
  }

  for (const id of options.includeIds ?? []) {
    if (!isLegacyPassageFormat(id)) continue;
    if (entries.some(e => e.id === id)) continue;
    const entry = buildEntry(id, 0);
    if (entry) entries.push({ ...entry, legacy: true });
  }

  return entries;
}

/**
 * One entry by id, retired formats included - this is a lookup, not an offer,
 * and callers validating a stored or note-borne id need the legacy ones to
 * resolve.
 */
export function getPassageFormatEntry(id: string): PassageFormatEntry | undefined {
  return getPassageFormatCatalog({ includeIds: LEGACY_PASSAGE_FORMAT_IDS }).find(
    entry => entry.id === id,
  );
}

/** The number shown beside a format, or undefined if it no longer resolves. */
export function getPassageFormatNumber(id: string): number | undefined {
  const entry = getPassageFormatCatalog().find(e => e.id === id);
  return entry?.number;
}

export function getPassageFormatByNumber(number: number): PassageFormatEntry | undefined {
  if (number < 1) return undefined;
  return getPassageFormatCatalog().find(entry => entry.number === number);
}

/**
 * Turn a keypress into a format, or nothing.
 *
 * Only bare `1`-`9`: a modifier means the user is reaching for something else
 * (Ctrl+1 switches tabs, Alt+digit opens a menu on some platforms), and
 * claiming those would take a shortcut away to add one.
 */
export function resolveFormatShortcut(key: string): PassageFormatEntry | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  return getPassageFormatByNumber(Number(key));
}
