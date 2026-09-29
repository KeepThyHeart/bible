/**
 * The notes detection contract: what the editor hands the detector, and what
 * the detector hands back.
 *
 * Client-only, and deliberately editor-independent. The ProseMirror adapter
 * (see the editor folder) flattens the document into `NotesBlock`s; the
 * detector (`detect.ts`) never sees a ProseMirror node, so it can be tested
 * with plain objects and could be pointed at a different editor -- or at the
 * phone's plain plan list -- without change.
 *
 * Offsets are always **relative to the block**: `from`/`to` index into
 * `NotesBlock.text`, half-open. A ProseMirror adapter turns them back into
 * document positions with `block.pos + 1 + offset` (the `+ 1` steps over the
 * textblock's opening token).
 */

import type { HighlightRange, PresentItem } from '../../../present/protocol';
import type { HymnalReference } from '../../../present/hymns';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** What kind of textblock this is. A list item's paragraph is `listItem`. */
export type NotesBlockKind = 'paragraph' | 'heading' | 'listItem' | 'blockquote';

export type NotesMarkType = 'bold' | 'pin' | 'unlink';

/**
 * What a `pin` mark stores: the explicit choice the user made in a chooser.
 *
 * - `item` pins the span to exactly that item (a different hymn, a different
 *   verse order, a passage the detector did not see). Detected items the pin
 *   overlaps are replaced by it.
 * - `range` pins a bold span to exactly that highlight, overriding the word
 *   match. `null` means "this bold is not a highlight".
 */
export interface PinAttrs {
  item?: PresentItem;
  range?: HighlightRange | null;
}

export interface NotesMark {
  from: number;
  to: number;
  type: NotesMarkType;
  /** Only meaningful on `pin`. */
  attrs?: PinAttrs;
}

/**
 * One textblock of the notes, in document order.
 *
 * `text` must be the block's text with every inline leaf (a hard break) as
 * exactly one character -- `'\n'` for a hard break -- so offsets line up with
 * document positions. ProseMirror's `node.textBetween(0, node.content.size,
 * undefined, leaf => leaf.type.name === 'hard_break' ? '\n' : ' ')` does that.
 */
export interface NotesBlock {
  /** Document position of the textblock (before its opening token). */
  pos: number;
  /**
   * A stable identity for the block that survives edits elsewhere in the
   * document (e.g. a `blockId` node attribute kept by a plugin). Item ids are
   * built from it, so highlights and plan entries stay attached while the
   * user types above them. Falls back to `pos` when absent.
   */
  id?: string;
  text: string;
  kind: NotesBlockKind;
  /**
   * For `blockquote` blocks: the same value for every paragraph of one
   * blockquote (its node position will do). Consecutive blockquote blocks with
   * equal `group` form one quote; without a group each block is its own quote.
   */
  group?: number | string;
  /** Marks as ranges over `text`. Adjacent ranges of one type may be split or merged; both work. */
  marks: NotesMark[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** A translatable explanation: an i18n key under `present.notes.reason` plus its params. */
export interface NotesReason {
  key: string;
  params?: Record<string, string | number>;
}

export type NotesItemKind = 'passage' | 'hymn' | 'quote';

export interface NotesItem {
  /** Stable across edits elsewhere in the document; see `NotesBlock.id`. */
  id: string;
  blockPos: number;
  from: number;
  to: number;
  /** For a quote spanning several blockquote paragraphs: where it ends. */
  endBlockPos?: number;
  endTo?: number;
  kind: NotesItemKind;
  /**
   * What ▶ shows. Null when there is nothing showable yet (an unknown or
   * ambiguous hymn); `status` is then always `'choose'`.
   */
  item: PresentItem | null;
  status: 'ok' | 'choose';
  /** Why the item needs a choice. Present iff `status === 'choose'`. */
  reason?: NotesReason;
  source: 'detected' | 'pinned';
  /** The text as written, for chips and reasons ("John 3:16", "Amazing Grace"). */
  label: string;
  /** For an ambiguous hymn: the ids to offer first in the chooser, best first. */
  candidates?: string[];
  /** For `v. 18`: the id of the passage it continues. */
  continuationOf?: string;
}

/** A bold span, matched (or not) to words of a passage above it. */
export interface NoteHighlight {
  id: string;
  blockPos: number;
  from: number;
  to: number;
  /** The bold text as written. */
  text: string;
  /** The passage item it was matched against; null when there is none in reach. */
  itemId: string | null;
  range: HighlightRange | null;
  /**
   * `pending` means the verse text is not loaded yet: see
   * `DetectResult.needsChapters`. Treat it like `ok` visually (or not at all);
   * it is not an error.
   */
  status: 'ok' | 'choose' | 'pending';
  reason?: NotesReason;
  source: 'detected' | 'pinned';
}

/**
 * The block containing an item plus the blocks after it up to the next block
 * containing an item. Blocks before the first item form a leading section
 * with no items. Reordering the plan moves whole sections.
 */
export interface NotesSection {
  /** Block positions, in order. */
  blocks: number[];
  itemIds: string[];
}

/** A chapter whose verse text bold matching needs. */
export interface ChapterRef {
  module: string;
  book: number;
  chapter: number;
}

export interface DetectResult {
  items: NotesItem[];
  highlights: NoteHighlight[];
  sections: NotesSection[];
  /**
   * Chapters that were not available from `getChapter`. Load them, then run
   * detection again: only the highlights change, and every block is a cache hit.
   */
  needsChapters: ChapterRef[];
}

// ---------------------------------------------------------------------------
// Injected data
// ---------------------------------------------------------------------------

/** One verse as the viewer renders it: `verse_id`/`verse`/`text_html` from the chapter API. */
export interface VerseText {
  verseId: number;
  verse: number;
  html: string;
}

/**
 * Synchronous lookup into whatever chapter cache the caller keeps. Return
 * `undefined` for "not loaded"; the detector reports it in `needsChapters`.
 */
export type ChapterLookup = (module: string, book: number, chapter: number) => readonly VerseText[] | undefined;

/**
 * What the hymn matcher needs from the library. `HymnSummary` (from
 * `/api/hymns`) satisfies it; `altTitles` is used when present.
 */
export interface HymnLibraryEntry {
  id: string;
  title: string;
  firstLine?: string;
  altTitles?: readonly string[];
  hymnals: readonly HymnalReference[];
  verseCount: number;
  hasRefrain: boolean;
}

export interface DetectOptions {
  /** The service's default translation (module id). */
  module: string;
  /**
   * Known module ids, for recognising a trailing `(ESV)`/`ESV`. Without it a
   * parenthesised code of 2-10 letters/digits, or a bare all-capitals one, is accepted.
   */
  modules?: readonly string[];
  /** The hymn library. Without it every hymn line is `'choose'`. */
  hymns?: readonly HymnLibraryEntry[];
  /** Preferred hymnal name for `Hymn 23`, when numbers collide across hymnals. */
  hymnal?: string;
  /** Verse text for bold matching. Without it every bold highlight is `pending`. */
  getChapter?: ChapterLookup;
}
