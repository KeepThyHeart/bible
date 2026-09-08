/**
 * Verse Copy Service
 *
 * Utilities for formatting and copying Bible verses in various formats
 */

// Re-export format system types and functions
export * from './copyFormats';

import {
  BibleVerse as FormatBibleVerse,
  VerseContext as FormatVerseContext,
  FormatOptions,
  DEFAULT_FORMAT_OPTIONS,
  getCleanVerseText,
  getDefaultFormat,
  getFormatById,
  getPassageFormatEntry,
  loadCopyFormatSettings,
  remapLegacyFormatId,
  DEFAULT_FORMAT_ID,
  DEFAULT_PASSAGE_FORMAT_ID
} from './copyFormats';

export interface BibleVerse extends FormatBibleVerse {
  is_paragraph_start?: boolean;
}

export interface VerseContext extends FormatVerseContext {}

export interface CopyOptions {
  includeReference: boolean;
  includeVerseNumbers: boolean;
  includeTranslation: boolean;
}

export const DEFAULT_COPY_OPTIONS: CopyOptions = {
  includeReference: true,
  includeVerseNumbers: true,
  includeTranslation: true
};

/**
 * Last-used copy/format settings, persisted to localStorage.
 *
 * These were module-level variables, so the user's format choice reset on
 * every app restart. localStorage matches how the sibling
 * `copyFormats/savedTemplates.ts` already persists the active template - same
 * domain, same mechanism - and keeps a disposable UI preference out of the
 * cross-package `SessionData` type.
 *
 * Every read is validated and falls back per-field: a format id that no
 * longer exists, malformed JSON, or a localStorage that throws (private mode,
 * quota) must all degrade to the defaults rather than break copying.
 */
const LAST_COPY_OPTIONS_KEY = 'bible-desktop-last-copy-options';
const LAST_FORMAT_KEY = 'bible-desktop-last-copy-format';
const LAST_FORMAT_OPTIONS_KEY = 'bible-desktop-last-copy-format-options';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is best-effort; losing it costs the user one click.
  }
}

function readBoolean(source: unknown, field: string, fallback: boolean): boolean {
  const value = (source as Record<string, unknown> | null)?.[field];
  return typeof value === 'boolean' ? value : fallback;
}

export function getLastUsedCopyOptions(): CopyOptions {
  const stored = readJson(LAST_COPY_OPTIONS_KEY);
  return {
    includeReference: readBoolean(stored, 'includeReference', DEFAULT_COPY_OPTIONS.includeReference),
    includeVerseNumbers: readBoolean(stored, 'includeVerseNumbers', DEFAULT_COPY_OPTIONS.includeVerseNumbers),
    includeTranslation: readBoolean(stored, 'includeTranslation', DEFAULT_COPY_OPTIONS.includeTranslation),
  };
}

export function setLastUsedCopyOptions(options: CopyOptions): void {
  writeJson(LAST_COPY_OPTIONS_KEY, options);
}

/**
 * Get the last used format ID. Falls back to the default when the stored id
 * names a format that no longer exists.
 */
export function getLastUsedFormatId(): string {
  try {
    const raw = localStorage.getItem(LAST_FORMAT_KEY);
    if (raw && getFormatById(raw)) return raw;
  } catch {
    // fall through to the default
  }
  return DEFAULT_FORMAT_ID;
}

/**
 * The last used format id, read against the **offered catalog**.
 *
 * `getLastUsedFormatId()` above validates against the clipboard registry alone
 * and falls back to Standard, which is exactly right for its consumers - the
 * export utility can only render a clipboard format, so a note-insertion id
 * must degrade there rather than resolve to nothing. The copy dialog offers
 * the whole catalog, so it needs the wider read; it shares the storage key
 * deliberately.
 *
 * A **retired** id (`standard`, `combined`) is remapped rather than returned.
 * Those two are still renderable, so that notes and exports written with them
 * keep their shape, but the dialog no longer lists them - opening on one would
 * show a picker with nothing selected. {@link remapLegacyFormatId} lands the
 * user on the surviving shape closest to what they were using.
 */
export function getLastUsedPassageFormatId(): string {
  try {
    const raw = localStorage.getItem(LAST_FORMAT_KEY);
    if (raw) {
      const remapped = remapLegacyFormatId(raw);
      if (getPassageFormatEntry(remapped)) return remapped;
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_PASSAGE_FORMAT_ID;
}

/**
 * Set the last used format ID
 */
export function setLastUsedFormatId(formatId: string): void {
  try {
    localStorage.setItem(LAST_FORMAT_KEY, formatId);
  } catch {
    // best-effort
  }
}

/**
 * Get the last used format options
 */
export function getLastUsedFormatOptions(): FormatOptions {
  const stored = readJson(LAST_FORMAT_OPTIONS_KEY);
  return {
    displayVersionNumber: readBoolean(stored, 'displayVersionNumber', DEFAULT_FORMAT_OPTIONS.displayVersionNumber),
    wordsOfChristInRed: readBoolean(stored, 'wordsOfChristInRed', DEFAULT_FORMAT_OPTIONS.wordsOfChristInRed),
  };
}

/**
 * Set the last used format options
 */
export function setLastUsedFormatOptions(options: FormatOptions): void {
  writeJson(LAST_FORMAT_OPTIONS_KEY, options);
}

/**
 * Format verses using the specified format ID.
 *
 * The format's stored state (the advanced shape options, the active custom
 * template) is read here and handed over: core's formats do not reach for
 * storage themselves, which is what let the engine leave this package.
 */
export function formatVersesWithFormat(
  verses: BibleVerse | BibleVerse[],
  context: VerseContext,
  formatId: string,
  options: FormatOptions
): string {
  const format = getFormatById(formatId) || getDefaultFormat();
  return format.format(verses, context, options, loadCopyFormatSettings());
}

/**
 * Format a single verse as plain text (no reference)
 *
 * @example
 * "For God so loved the world, that he gave his only begotten Son..."
 */
export function formatPlainVerse(verse: BibleVerse): string {
  return getCleanVerseText(verse);
}

/**
 * Format a single verse with reference
 *
 * @example
 * "John 3:16 (KJV) For God so loved the world..."
 */
export function formatVerseWithReference(
  verse: BibleVerse,
  context: VerseContext
): string {
  const text = getCleanVerseText(verse);
  const reference = `${context.bookName} ${context.chapter}:${verse.verse}`;
  const translation = context.translation ? ` (${context.translation})` : '';

  return `${reference}${translation} ${text}`;
}

/**
 * Format a single verse with formatting (includes verse number)
 *
 * @example
 * "16 For God so loved the world..."
 */
export function formatFormattedVerse(verse: BibleVerse): string {
  const text = getCleanVerseText(verse);
  return `${verse.verse} ${text}`;
}

/**
 * Format multiple verses as a passage
 *
 * @example
 * "John 3:16-17 (KJV)
 * 16 For God so loved the world...
 * 17 For God sent not his Son..."
 */
export function formatMultipleVerses(
  verses: BibleVerse[],
  context: VerseContext,
  options: {
    includeReference?: boolean;
    includeVerseNumbers?: boolean;
  } = {}
): string {
  const {
    includeReference = true,
    includeVerseNumbers = true
  } = options;

  if (verses.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Add reference header if requested
  if (includeReference) {
    const firstVerse = verses[0];
    const lastVerse = verses[verses.length - 1];

    let reference: string;
    if (verses.length === 1) {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}`;
    } else if (firstVerse.verse === lastVerse.verse) {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}`;
    } else {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}-${lastVerse.verse}`;
    }

    const translation = context.translation ? ` (${context.translation})` : '';
    lines.push(`${reference}${translation}`);
  }

  // Add verses
  for (const verse of verses) {
    const text = getCleanVerseText(verse);
    if (includeVerseNumbers) {
      lines.push(`${verse.verse} ${text}`);
    } else {
      lines.push(text);
    }
  }

  return lines.join('\n');
}

/**
 * Format verses with full copy options
 *
 * @param verses - Single verse or array of verses
 * @param context - Verse context (book name, chapter, translation)
 * @param options - Copy options
 * @returns Formatted text ready for copying
 */
export function formatVersesWithOptions(
  verses: BibleVerse | BibleVerse[],
  context: VerseContext,
  options: CopyOptions
): string {
  const versesArray = Array.isArray(verses) ? verses : [verses];

  if (versesArray.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Add reference header if requested
  if (options.includeReference) {
    const firstVerse = versesArray[0];
    const lastVerse = versesArray[versesArray.length - 1];

    let reference: string;
    if (versesArray.length === 1) {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}`;
    } else if (firstVerse.verse === lastVerse.verse) {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}`;
    } else {
      reference = `${context.bookName} ${context.chapter}:${firstVerse.verse}-${lastVerse.verse}`;
    }

    const translation = options.includeTranslation && context.translation
      ? ` (${context.translation})`
      : '';
    lines.push(`${reference}${translation}`);
  }

  // Add verses
  for (const verse of versesArray) {
    const text = getCleanVerseText(verse);
    if (options.includeVerseNumbers) {
      lines.push(`${verse.verse} ${text}`);
    } else {
      lines.push(text);
    }
  }

  return lines.join('\n');
}

/**
 * Copy text to clipboard, optionally with HTML formatting.
 *
 * When `html` is provided, both `text/html` and `text/plain` are written
 * to the clipboard so that rich-text editors (Word, Google Docs, etc.)
 * receive the formatted version while plain-text editors get the fallback.
 *
 * @param text  - Plain text to copy
 * @param html  - Optional HTML string (e.g. with inline red-letter styles)
 * @returns Promise<boolean> - true if successful, false if failed
 */
export async function copyToClipboard(text: string, html?: string): Promise<boolean> {
  try {
    // Modern clipboard API with rich-text support
    if (html && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([text], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        })
      ]);
      return true;
    }

    // Plain-text only path (no HTML or ClipboardItem not available)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Fallback: use older execCommand method
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      document.body.removeChild(textArea);
      return false;
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Detect verses from current text selection
 *
 * @returns Array of verse elements that are fully or partially selected
 */
export function getSelectedVerses(): HTMLElement[] {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return [];
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // Get all verse elements within the selection
  let parentElement: HTMLElement | null = null;

  if (container.nodeType === Node.ELEMENT_NODE) {
    parentElement = container as HTMLElement;
  } else if (container.parentElement) {
    parentElement = container.parentElement;
  }

  if (!parentElement) {
    return [];
  }

  // Find all verse elements (look for data-verse-id attribute)
  const verseElements: HTMLElement[] = [];

  // Check if the selection is within a verse container
  const verseContainer = parentElement.closest('[data-verse-id]');
  if (verseContainer) {
    verseElements.push(verseContainer as HTMLElement);
  }

  // Look for other verses in the selection
  const allVerses = parentElement.querySelectorAll('[data-verse-id]');
  allVerses.forEach((element) => {
    if (selection.containsNode(element, true) && !verseElements.includes(element as HTMLElement)) {
      verseElements.push(element as HTMLElement);
    }
  });

  return verseElements;
}

/**
 * Check if there is active text selection
 */
export function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && selection.toString().length > 0;
}

/**
 * Result of analyzing the current text selection
 */
export interface SelectionAnalysis {
  /** Type of selection detected */
  type: 'none' | 'partial-single-verse' | 'full-verse' | 'multi-verse';
  /** The selected text (if any) */
  selectedText: string;
  /** Verse IDs involved in the selection */
  verseIds: number[];
}

/**
 * Normalize text for comparison by trimming, collapsing whitespace, and removing special chars
 */
function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[¶]/g, '')
    .toLowerCase();
}

/**
 * Get the full text content of a verse element
 */
function getVerseElementText(verseElement: Element): string {
  return verseElement.textContent || '';
}

/**
 * Analyze the current DOM selection to determine its type
 *
 * This is used to decide whether Ctrl+C should:
 * - Copy text directly (partial-single-verse)
 * - Show the copy dialog (full-verse, multi-verse, or none with verse selection)
 */
export function analyzeSelection(): SelectionAnalysis {
  const selection = window.getSelection();

  // No selection at all
  if (!selection || selection.rangeCount === 0) {
    return { type: 'none', selectedText: '', verseIds: [] };
  }

  const selectedText = selection.toString();

  // No text selected
  if (selectedText.length === 0) {
    return { type: 'none', selectedText: '', verseIds: [] };
  }

  const range = selection.getRangeAt(0);

  // Find the verse elements at start and end of selection
  const startVerseElement = (range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer as Element)?.closest('[data-verse-id]');

  const endVerseElement = (range.endContainer.nodeType === Node.TEXT_NODE
    ? range.endContainer.parentElement
    : range.endContainer as Element)?.closest('[data-verse-id]');

  // If we can't find verse elements, return none
  if (!startVerseElement || !endVerseElement) {
    return { type: 'none', selectedText, verseIds: [] };
  }

  const startVerseId = parseInt(startVerseElement.getAttribute('data-verse-id') ?? '', 10);
  const endVerseId = parseInt(endVerseElement.getAttribute('data-verse-id') ?? '', 10);

  if (isNaN(startVerseId) || isNaN(endVerseId)) {
    return { type: 'none', selectedText, verseIds: [] };
  }

  // Multi-verse selection
  if (startVerseId !== endVerseId) {
    const verseIds = getSelectedVerseIds();
    return { type: 'multi-verse', selectedText, verseIds };
  }

  // Single verse - determine if full or partial
  const verseFullText = getVerseElementText(startVerseElement);
  const normalizedSelection = normalizeText(selectedText);
  const normalizedVerseText = normalizeText(verseFullText);

  // Check if the selected text matches the full verse text
  if (normalizedSelection === normalizedVerseText) {
    return { type: 'full-verse', selectedText, verseIds: [startVerseId] };
  }

  // Partial selection within a single verse
  return { type: 'partial-single-verse', selectedText, verseIds: [startVerseId] };
}

/**
 * Get verse IDs for all verses that are part of the current DOM selection
 *
 * Finds the start and end verse elements from the selection, then returns
 * all verse IDs between them (inclusive). This is more efficient and accurate
 * than checking every verse element in the document.
 *
 * @returns Array of verse IDs (as numbers), in order
 */
export function getSelectedVerseIds(): number[] {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) {
    return [];
  }

  const range = selection.getRangeAt(0);

  // Find the closest verse elements for start and end of selection (using optional chaining)
  const startVerseElement = (range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer as Element)?.closest('[data-verse-id]');

  const endVerseElement = (range.endContainer.nodeType === Node.TEXT_NODE
    ? range.endContainer.parentElement
    : range.endContainer as Element)?.closest('[data-verse-id]');

  // Get verse IDs from elements
  const startVerseId = parseInt(startVerseElement?.getAttribute('data-verse-id') ?? '', 10);
  const endVerseId = parseInt(endVerseElement?.getAttribute('data-verse-id') ?? '', 10);

  if (isNaN(startVerseId) || isNaN(endVerseId)) {
    return [];
  }

  // If only one verse is selected, return it
  if (startVerseId === endVerseId) {
    return [startVerseId];
  }

  // Find the common ancestor that contains both verse elements
  const containerElement = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement) as Element | null;

  if (!containerElement) {
    return [];
  }

  // Query all verse elements within the common ancestor and collect verses between start and end
  const allVerseElements = containerElement.querySelectorAll('[data-verse-id]');
  const verseIds: number[] = [];
  let collecting = false;

  for (const element of allVerseElements) {
    const verseId = parseInt(element.getAttribute('data-verse-id') ?? '', 10);
    if (isNaN(verseId)) continue;

    // Start collecting when we hit the start verse
    if (verseId === startVerseId) collecting = true;

    // Collect all verses between start and end (inclusive)
    if (collecting) verseIds.push(verseId);

    // Stop collecting after we hit the end verse
    if (verseId === endVerseId) break;
  }

  return verseIds;
}
