/**
 * The interactive viewer's gesture rules, as plain functions.
 *
 * A word is addressed as (verse id, word index) -- the index being the one
 * `tokenizeVerse` assigns and `VerseText` renders as `data-word-index`, so a
 * range built here lights exactly the words that were clicked, on every
 * screen. Indices are 0-based and inclusive, as everywhere in the presenter.
 *
 * Nothing here touches the DOM beyond reading two data attributes, so the
 * rules are tested without a pointer.
 */

import type { HighlightRange, PresentIntent } from '../protocol';

export interface WordAddress {
  verseId: number;
  index: number;
}

/** What a click or tap landed on: a word (if any) and the verse it is in (if any). */
export interface TapTarget {
  word: WordAddress | null;
  /** The verse *number* (`position.index` for a passage), not its id. */
  verse: number | null;
}

/** Document order: verse ids ascend through a passage, word indices within a verse. */
export function compareWords(a: WordAddress, b: WordAddress): number {
  return a.verseId - b.verseId || a.index - b.index;
}

/**
 * The highlight from one word to another, whichever order they were picked
 * in. Always carries `textEnd`, and `verseIdEnd` only when the range leaves
 * its first verse -- the minimal form `validateHighlight` accepts.
 */
export function rangeBetween(a: WordAddress, b: WordAddress): HighlightRange {
  const [first, last] = compareWords(a, b) <= 0 ? [a, b] : [b, a];
  const range: HighlightRange = { verseIdStart: first.verseId, textStart: first.index };
  if (last.verseId !== first.verseId) range.verseIdEnd = last.verseId;
  range.textEnd = last.index;
  return range;
}

export function singleWordRange(word: WordAddress): HighlightRange {
  return rangeBetween(word, word);
}

/**
 * Whether any of the wall's highlights covers this word.
 *
 * Needs no word count: a verse strictly inside a multi-verse range is lit
 * throughout, and the two end verses are bounded by the range's own indices.
 * (`highlightSpanForVerse` clamps to the word count for rendering; a click can
 * only land on a word that exists, so no clamp is needed here.)
 */
export function wordIsHighlighted(highlights: HighlightRange[], word: WordAddress): boolean {
  return highlights.some(h => {
    const firstVerse = h.verseIdStart;
    const lastVerse = h.verseIdEnd ?? h.verseIdStart;
    if (word.verseId < firstVerse || word.verseId > lastVerse) return false;
    const from = word.verseId === firstVerse ? h.textStart : 0;
    const to = word.verseId === lastVerse
      ? (h.textEnd ?? (firstVerse === lastVerse ? h.textStart : Number.POSITIVE_INFINITY))
      : Number.POSITIVE_INFINITY;
    return word.index >= from && word.index <= to;
  });
}

/**
 * A single click or tap:
 *
 *  - on a lit word: remove the highlight it belongs to (the reducer removes
 *    any range overlapping the one word sent, i.e. the whole phrase);
 *  - otherwise, on a verse other than the current one: move to it (Q10 --
 *    single click, since highlighting needs a double-click, so they never
 *    clash);
 *  - otherwise nothing.
 */
export function tapIntent(
  target: TapTarget,
  highlights: HighlightRange[],
  anchor: number,
): PresentIntent | null {
  if (target.word && wordIsHighlighted(highlights, target.word)) {
    return { type: 'removeHighlight', highlight: singleWordRange(target.word) };
  }
  if (target.verse !== null && target.verse !== anchor) {
    return { type: 'goTo', index: target.verse };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading addresses off the rendered markup
// ---------------------------------------------------------------------------

function intAttribute(el: Element | null, name: string): number | null {
  if (!el) return null;
  const value = el.getAttribute(name);
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** The word element at or around `node`, if it is one. */
export function wordElementOf(node: Node | null): Element | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return el?.closest('[data-word-index]') ?? null;
}

/** The word a rendered word element (`VerseText`'s `.pv-w`) stands for. */
export function readWordAddress(el: Element | null): WordAddress | null {
  const index = intAttribute(el, 'data-word-index');
  const verseId = intAttribute(el?.closest('[data-verse-id]') ?? null, 'data-verse-id');
  return index === null || verseId === null ? null : { verseId, index };
}

/** What a pointer event's target landed on. */
export function readTapTarget(target: EventTarget | null): TapTarget {
  const node = target instanceof Node ? target : null;
  const verseEl = (node instanceof Element ? node : node?.parentElement ?? null)?.closest('[data-verse]') ?? null;
  return {
    word: readWordAddress(wordElementOf(node)),
    verse: intAttribute(verseEl, 'data-verse'),
  };
}
