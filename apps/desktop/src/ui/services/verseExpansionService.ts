/**
 * Turning a detected verse reference into the verse text itself.
 *
 * This is the shared core behind every "expand this reference" entry point in
 * the notes editor (right-click menu today; a Tab shortcut later). Every
 * decision that can be made without a DOM lives here as a pure function, so
 * the parts that need an editor are as thin as possible.
 *
 * Output goes through the shared format engine in `@bible/core` rather than a
 * bespoke HTML builder. Two families live there: the five clipboard formats
 * (plain lines) and the four note-insertion formats in `passageMarkup.ts`
 * (block quotes, per-verse headings). `buildInsertHtml` is the single door on
 * to both, and both are built from the same `formatHelpers` - so a passage
 * quoted into a note and the same passage on the clipboard agree about verse
 * text, red letters and how a reference is written.
 */
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { ReferenceParser, VerseIdHelper, type ParsedReference } from '@bible/core';
import { sanitizeHtml } from '../utils/sanitize';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { formatVersesWithFormat, getLastUsedFormatOptions, type VerseContext } from './verseCopyService';
import {
  isPassageMarkupFormat,
  renderPassageMarkup,
  passageMarkupToHtml,
  passageMarkupToText,
  type PassageInsertOptions,
  type PassageMarkupLabels,
} from '@bible/core';
import { loadPassageMarkupOptions } from './copyFormats/passageMarkupPreferences';
import { getVersesCached, type CachedVerse } from './verseFetchCache';

const parser = new ReferenceParser();

/**
 * Upper bound on how many verses a single expansion may insert.
 *
 * Silently truncating scripture is unacceptable, and silently dumping all 176
 * verses of Psalm 119 into a note is worse, so an over-cap expansion is
 * refused with a reason rather than trimmed. The right-click path may choose
 * to confirm and proceed anyway - the user picked it explicitly there.
 */
export const MAX_EXPAND_VERSES = 50;

/** An inclusive verse-id range ready to hand to `bible:getVerses`. */
export interface ResolvedRange {
  startId: number;
  endId: number;
}

export type ExpandFailureReason =
  | 'invalid-reference'
  | 'no-translation'
  | 'not-found'
  | 'too-large'
  | 'fetch-failed';

export type ExpandResult =
  | { ok: true; verseCount: number }
  | { ok: false; reason: ExpandFailureReason; verseCount?: number };

/**
 * Map a parsed reference onto an inclusive verse-id range.
 *
 * The interesting case is a reference with no verse at all. `John 3` means the
 * whole chapter, and `John 3-5` means chapters 3 through 5 - note that the
 * parser reports that second form as `{ chapter: 3, endVerse: 5 }`, because
 * the regex has no way to know the trailing number is a chapter. When `verse`
 * is absent, `endVerse` is therefore read as an end *chapter*.
 *
 * The `...999` upper bound is the same trick `BibleRepository.getChapter` uses:
 * the fetch is an inclusive `BETWEEN` on the numeric id, so a chapter's verses
 * are exactly the ids below the next chapter's.
 *
 * Chapter 1 verse 1 is used as the lower bound of a whole-chapter reference
 * rather than verse 0. Verse 0 carries legacy chapter prefaces in some
 * modules, but `Genesis 1:0` computes to 1001000, which is below the IPC
 * layer's minimum valid verse id and would throw.
 */
export function resolveReferenceRange(ref: ParsedReference): ResolvedRange | null {
  const { book, chapter } = ref;
  if (!book || !chapter) return null;
  if (!inRange(book, 1, 66) || !inRange(chapter, 1, 999)) return null;

  let startId: number;
  let endId: number;

  if (ref.wholeBook) {
    // "John" - every chapter. The parser has no chapter counts, so the upper
    // bound is the same open-ended one a whole-chapter reference uses: no book
    // has a 999th chapter, and the query is a range scan either way.
    startId = VerseIdHelper.calculate(book, 1, 1);
    endId = VerseIdHelper.calculate(book, 999, 999);
  } else if (ref.verse === undefined) {
    const endChapter = ref.endChapter ?? ref.endVerse ?? chapter;
    if (!inRange(endChapter, 1, 999)) return null;
    startId = VerseIdHelper.calculate(book, chapter, 1);
    endId = VerseIdHelper.calculate(book, endChapter, 999);
  } else {
    if (!inRange(ref.verse, 1, 999)) return null;
    const endChapter = ref.endChapter ?? chapter;
    // "John 3:16-4" (an end chapter with no end verse) means through the end
    // of chapter 4; "John 3:16" alone is a single verse.
    const endVerse = ref.endVerse ?? (ref.endChapter ? 999 : ref.verse);
    if (!inRange(endChapter, 1, 999) || !inRange(endVerse, 1, 999)) return null;
    startId = VerseIdHelper.calculate(book, chapter, ref.verse);
    endId = VerseIdHelper.calculate(book, endChapter, endVerse);
  }

  // A backwards range ("John 3:16-2") is a typo, not a request for nothing.
  // Collapse it to the start verse instead of fetching an empty span.
  return { startId, endId: Math.max(startId, endId) };
}

function inRange(n: number, lo: number, hi: number): boolean {
  return Number.isInteger(n) && n >= lo && n <= hi;
}

/**
 * Identity stamped onto expanded content so it can be re-formatted later.
 * See `notes/editor/VerseExpansionMark.ts`.
 */
export interface ExpansionMeta {
  expansionId: string;
  /** The reference text that produced this passage, e.g. "John 3:16". */
  reference: string;
  formatId: string;
  options: PassageInsertOptions;
}

/**
 * Fingerprint of an expansion's text, so a passage the user has since edited
 * can be told apart from a pristine one.
 *
 * This matters because re-formatting *replaces* the passage. Expanded text is
 * ordinary editable document content - a user may well type a parenthetical
 * into the middle of it - and silently discarding that on a format change
 * would be data loss. Comparing this fingerprint against the passage's current
 * text is what lets the editor withdraw the "change format" offer instead.
 *
 * All whitespace is stripped before hashing: the formatted string separates
 * lines with `\n` while the document separates them with paragraph
 * boundaries, so whitespace cannot be compared meaningfully across the two.
 * Any real edit changes non-whitespace characters.
 */
export function expansionContentHash(formatted: string): string {
  const plain = formatted.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  // FNV-1a, 32-bit. Not cryptographic - this only needs to notice edits.
  let hash = 0x811c9dc5;
  for (let i = 0; i < plain.length; i++) {
    hash ^= plain.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The `<span data-expansion-*>` that stamps inserted content with its
 * identity, so "change this passage's format" can find it again.
 *
 * A function per insertion rather than a string, because the mark is *inline*:
 * a multi-block passage carries one span inside each block, all sharing the
 * expansion id. Returns identity when there is no meta - a preview is not
 * going into a document and needs no stamp.
 */
function expansionWrapper(
  meta: ExpansionMeta | undefined,
  contentHash: string,
): (inner: string) => string {
  if (!meta) return (inner: string) => inner;
  const attrs = [
    `data-expansion-id="${escapeAttr(meta.expansionId)}"`,
    `data-expansion-ref="${escapeAttr(meta.reference)}"`,
    `data-expansion-format="${escapeAttr(meta.formatId)}"`,
    `data-expansion-options="${escapeAttr(JSON.stringify(meta.options))}"`,
    `data-expansion-hash="${escapeAttr(contentHash)}"`,
  ].join(' ');
  return (inner: string) => `<span ${attrs}>${inner}</span>`;
}

/**
 * Wrap the copy engine's output as HTML suitable for `insertContentAt`.
 *
 * `formatVersesWithFormat` returns a newline-separated string whose escaping
 * depends on `wordsOfChristInRed`: with it on, verse text is already HTML
 * (`<span style="color: ...">`); with it off, it is raw text. Both are run
 * through the sanitiser, which is also what makes the raw-text case safe.
 *
 * Single-line formats (`inline`, `plain`) stay inline so an expansion inside a
 * sentence - "as Paul says in Rom 8:28, we know..." - does not tear the sentence
 * into paragraphs. Multi-line formats (`standard`, `combined`) legitimately
 * become block paragraphs. `asBlock` forces the block form regardless: Tab
 * uses it when it appends a passage beneath a sentence, where even a one-line
 * format has to be its own paragraph.
 *
 * When `meta` is supplied every line is wrapped in the expansion span, which
 * is what makes "change this passage's format" possible after the fact.
 */
export function buildExpandedHtml(
  formatted: string,
  opts: { asBlock?: boolean; meta?: ExpansionMeta } = {},
): string {
  const { asBlock = false, meta } = opts;
  const lines = formatted.split('\n');

  const wrap = expansionWrapper(meta, expansionContentHash(formatted));

  if (lines.length <= 1 && !asBlock) return sanitizeHtml(wrap(formatted));
  // An empty line renders as a break; there is nothing to mark inside it.
  return sanitizeHtml(lines.map(line => `<p>${line ? wrap(line) : '<br>'}</p>`).join(''));
}

/**
 * The remembered options for one format, from whichever store that format's
 * family keeps them in.
 *
 * The four markup formats each have their own record (heading level, quote
 * marks - settings that only make sense per shape); the clipboard formats
 * share the copy dialog's single `FormatOptions`. Callers should not have to
 * know which is which, so they ask here.
 */
export function loadInsertOptions(formatId: string): PassageInsertOptions {
  return isPassageMarkupFormat(formatId)
    ? loadPassageMarkupOptions(formatId)
    : getLastUsedFormatOptions();
}

/**
 * The translation to expand against: the active tab of the primary Bible
 * panel.
 *
 * The notes pane has no translation of its own, so it borrows the Bible
 * pane's. Returns null rather than defaulting to KJV - inserting text from a
 * translation the user is not reading, without saying so, is worse than
 * refusing.
 */
export function getActiveTranslation(): string | null {
  // allow-getstate: called from event handlers and services, not during render
  const panels = useBibleStore.getState().panels;
  // `DEFAULT_PANEL_ID` is the *fallback* key ('_default'); a Bible pane opened
  // through dockview registers under its own panel id ('bible_default', and
  // further ids for split panes). Looking only under DEFAULT_PANEL_ID
  // therefore found nothing in a normal session and reported "no translation"
  // with a Bible plainly on screen. Same first-panel fallback the store's own
  // `publishBibleWhenContext` and `storeSync` use.
  let panel = panels.get(DEFAULT_PANEL_ID);
  if (!panel) {
    const firstKey = panels.keys().next().value;
    if (firstKey) panel = panels.get(firstKey);
  }
  return panel?.openTabs[panel.activeTabIndex]?.abbreviation ?? null;
}

/** Fetch the verses a reference covers, or null if it cannot be resolved. */
export async function fetchVersesForReference(
  ref: ParsedReference,
  translation: string,
): Promise<CachedVerse[] | null> {
  const range = resolveReferenceRange(ref);
  if (!range) return null;
  return getVersesCached(translation, range.startId, range.endId);
}

/** Build the `VerseContext` the copy formats expect. */
export function buildVerseContext(verses: CachedVerse[], translation: string): VerseContext {
  const first = verses[0];
  return {
    bookName: parser.getBookName(first.book_number),
    chapter: first.chapter,
    translation,
  };
}

/**
 * Format a fetched range without touching an editor. Exposed so the
 * right-click popover can render a live preview of exactly what Insert will
 * produce.
 */
export function formatExpansion(
  verses: CachedVerse[],
  translation: string,
  formatId: string,
  options: PassageInsertOptions,
): string {
  return formatVersesWithFormat(verses, buildVerseContext(verses, translation), formatId, options);
}

/**
 * The one call that turns a fetched passage into the HTML a note receives -
 * whichever family the chosen format belongs to.
 *
 * Two engines meet here. The clipboard formats produce newline-separated
 * *lines*, which `buildExpandedHtml` wraps into paragraphs; the four
 * `passageMarkup` formats produce a block tree (quotes, headings) that already
 * knows its own structure. Everything either family shares - verse-text
 * extraction, red letters, reference building, the two universal options -
 * lives in core's `PassageFormat/formatHelpers`, which both go through.
 *
 * Both branches stamp the same expansion span on every line, so a passage
 * inserted in any of these formats can be re-formatted into any other later.
 */
export function buildInsertHtml(
  verses: CachedVerse[],
  translation: string,
  formatId: string,
  options: PassageInsertOptions,
  opts: {
    asBlock?: boolean;
    meta?: Omit<ExpansionMeta, 'formatId' | 'options'>;
    labels?: PassageMarkupLabels;
  } = {},
): string {
  const meta: ExpansionMeta | undefined = opts.meta
    ? { ...opts.meta, formatId, options }
    : undefined;

  if (isPassageMarkupFormat(formatId)) {
    const markup = renderPassageMarkup(
      verses,
      buildVerseContext(verses, translation),
      formatId,
      options,
      opts.labels,
    );
    // The fingerprint is taken over the text the *document* will hold, not the
    // markup: `findExpansionRange` can only ever see the marked runs' text, so
    // hashing anything else would make every fresh passage look edited.
    const wrap = expansionWrapper(meta, expansionContentHash(passageMarkupToText(markup)));
    return sanitizeHtml(passageMarkupToHtml(markup, { wrapInner: wrap, forceBlock: opts.asBlock }));
  }

  return buildExpandedHtml(formatExpansion(verses, translation, formatId, options), {
    asBlock: opts.asBlock,
    meta,
  });
}

/**
 * Replace `[from, to)` in the editor with the formatted verse text.
 *
 * `closeHistory` is what makes undo behave: without it, prosemirror-history
 * groups the expansion with the keystrokes that typed the reference, and a
 * single Ctrl+Z eats both. With it, one Ctrl+Z restores exactly the reference
 * the user started from. `insertContentAt` performs the delete and the insert
 * inside one transaction, so there is no intermediate state to land on.
 */
export function replaceRangeWithHtml(
  editor: Editor,
  from: number,
  to: number,
  html: string,
): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContentAt({ from, to }, html)
    .run();
}

/**
 * Insert a block of content immediately after `blockEnd`, leaving everything
 * before it untouched. Same one-transaction/one-undo contract as
 * {@link replaceRangeWithHtml}.
 */
export function insertBlockAfter(editor: Editor, blockEnd: number, html: string): void {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContentAt(blockEnd, html)
    .run();
}

/**
 * Expand a detected reference: fetch, format, and put the result in the
 * document.
 *
 * `allowOverCap` is the difference between the two entry points. An automatic
 * path (a keystroke) refuses an over-cap expansion; an explicit one (choosing
 * "Expand" from a menu, having been shown the verse count) may proceed.
 *
 * `placement` decides what happens to the reference itself. `'replace'`
 * substitutes the passage for it. `'after-block'` leaves the reference where
 * it is and puts the passage in a new paragraph below - which is the only
 * sane behaviour when the reference is part of a sentence, since replacing it
 * would destroy the sentence.
 */
export async function expandReference(
  editor: Editor,
  range: { from: number; to: number; ref: ParsedReference },
  formatId: string,
  options: PassageInsertOptions,
  opts: {
    allowOverCap?: boolean;
    placement?: 'replace' | 'after-block';
    /** Position to insert after; required for `'after-block'`. */
    blockEnd?: number;
    meta?: Omit<ExpansionMeta, 'formatId' | 'options'>;
    /** Localized labels for the markup formats (e.g. the per-verse heading). */
    labels?: PassageMarkupLabels;
  } = {},
): Promise<ExpandResult> {
  const translation = getActiveTranslation();
  if (!translation) return { ok: false, reason: 'no-translation' };

  const resolved = resolveReferenceRange(range.ref);
  if (!resolved) return { ok: false, reason: 'invalid-reference' };

  let verses: CachedVerse[];
  try {
    verses = await getVersesCached(translation, resolved.startId, resolved.endId);
  } catch (error) {
    console.error('Verse expansion fetch failed:', error);
    return { ok: false, reason: 'fetch-failed' };
  }

  if (verses.length === 0) return { ok: false, reason: 'not-found' };
  if (verses.length > MAX_EXPAND_VERSES && !opts.allowOverCap) {
    return { ok: false, reason: 'too-large', verseCount: verses.length };
  }

  const asBlock = opts.placement === 'after-block';
  const html = buildInsertHtml(verses, translation, formatId, options, {
    asBlock,
    meta: opts.meta,
    labels: opts.labels,
  });

  if (asBlock) {
    if (opts.blockEnd === undefined) return { ok: false, reason: 'invalid-reference' };
    insertBlockAfter(editor, opts.blockEnd, html);
  } else {
    replaceRangeWithHtml(editor, range.from, range.to, html);
  }
  return { ok: true, verseCount: verses.length };
}
