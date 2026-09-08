/**
 * Pure reference-range extraction for the notes editor.
 *
 * If `VerseReferencePlugin` scanned the document and built ProseMirror
 * decorations in a single step, the only way to ask "is there a verse
 * reference at this position?" would be to reach into the DecorationSet and
 * read `deco.type.attrs` - undocumented ProseMirror internals with no types.
 *
 * The scan is split out here instead: it produces typed `VerseRefRange[]`,
 * and the plugin builds decorations from that array. Every consumer that
 * needs to locate a reference (right-click menu, caret preview, expansion)
 * queries the ranges, not the decorations.
 *
 * Everything in this file is pure - no DOM, no layout, no ProseMirror view -
 * so it is directly unit-testable.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReferenceParser, type ParsedReference } from '@bible/core';

const parser = new ReferenceParser();

/** A detected Bible reference and the document range it occupies. */
export interface VerseRefRange {
  /** ProseMirror position of the first character of the reference. */
  from: number;
  /** ProseMirror position immediately after the last character. */
  to: number;
  /** The exact document text covered by `[from, to)`. */
  text: string;
  /** The parsed reference. `verse`/`endChapter`/`endVerse` may be absent. */
  ref: ParsedReference;
}

/**
 * Scan a document for Bible references.
 *
 * Returns ranges in document order.
 *
 * Note that detection only ever sees a *single text node* at a time: a
 * reference split by a mark boundary (`John **3**:16`) becomes two or three
 * text nodes and is not detected at all. That is a pre-existing limitation of
 * `scanText`, but it is load-bearing here - because every range is contained
 * in one text node, a replacement over `[from, to)` can never straddle a node
 * boundary. Do not "fix" cross-node detection without revisiting that.
 */
export function findVerseReferenceRanges(doc: ProseMirrorNode): VerseRefRange[] {
  const ranges: VerseRefRange[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;

    for (const match of parser.scanText(text)) {
      // For a text node, `pos` is the position immediately before the node,
      // so character offset i maps to pos + i exactly.
      const trimmed = trimRange(text, match.start, match.end);
      if (!trimmed) continue;

      ranges.push({
        from: pos + trimmed.start,
        to: pos + trimmed.end,
        text: text.slice(trimmed.start, trimmed.end),
        ref: match,
      });
    }
  });

  return ranges;
}

/**
 * Narrow a raw `scanText` match to the characters that actually form the
 * reference.
 *
 * `scanText` emits an extra result for each comma-continuation, so
 * `John 3:16, 17` yields a second match whose range covers `, 17` - leading
 * comma and space included. Underlining (and, later, replacing) that comma is
 * wrong, so strip any leading separator punctuation and surrounding
 * whitespace. Returns null if nothing is left.
 */
function trimRange(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /[\s,;]/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return e > s ? { start: s, end: e } : null;
}

/**
 * The reference a position sits inside.
 *
 * A position exactly at `to` is *after* the reference, not in it - use
 * {@link findRangeEndingAt} or {@link findRangeAtCaret} for that case.
 */
export function findRangeContainingPos(ranges: readonly VerseRefRange[], pos: number): VerseRefRange | null {
  return ranges.find(r => pos >= r.from && pos < r.to) ?? null;
}

/** The reference that ends exactly at `pos` (i.e. the one just typed). */
export function findRangeEndingAt(ranges: readonly VerseRefRange[], pos: number): VerseRefRange | null {
  return ranges.find(r => r.to === pos) ?? null;
}

/**
 * The reference relevant to a caret at `pos` - inside it, or immediately
 * after it. Prefers a containing range over one merely ending at `pos`.
 */
export function findRangeAtCaret(ranges: readonly VerseRefRange[], pos: number): VerseRefRange | null {
  return findRangeContainingPos(ranges, pos) ?? findRangeEndingAt(ranges, pos);
}
