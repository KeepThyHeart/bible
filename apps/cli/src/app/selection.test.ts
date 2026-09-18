/**
 * Selection and ranges.
 *
 * Driven against the real KJV wherever the answer depends on the module's own
 * data: the summary's word count and the highlighting of real laid-out rows.
 * The pure range arithmetic is tested without a module, because there is
 * nothing in it a module could contradict.
 *
 * The tests worth reading are the shrink cases. Extending a selection is easy
 * and every implementation gets it right; coming back the other way is where a
 * start/end pair inverts the range, and it is the reason the anchor exists.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import { classifyInput } from './input';
import { Library } from './library';
import { DEFAULT_TAB, type TabState } from './state';
import { toDisplayVerse, type DisplayVerse } from './verseText';
import { discoverModules } from '../data/modules';
import { createTheme, stripAnsi, renderStyledLine } from '../term/style';
import { layoutReading } from '../term/reading';
import {
  beginSelection,
  clearSelection,
  countWords,
  hasSelection,
  highlightSelection,
  moveSelection,
  selectedRange,
  selectionForReference,
  selectionSummary,
  type SelectionBounds,
} from './selection';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const hasKjv = existsSync(join(MODULES, 'bible_kjv.db'));

const theme = createTheme('ansi256');

const JOHN = 43;
const PSALMS = 19;

/** John 3 — 36 verses. The chapter the tests are drawn on. */
const JOHN3: SelectionBounds = { bookNumber: JOHN, chapter: 3, verseCount: 36 };

function tabAt(verse: number, anchor?: number): TabState {
  return {
    ...DEFAULT_TAB,
    bookNumber: JOHN,
    chapter: 3,
    cursorVerse: VerseIdHelper.calculate(JOHN, 3, verse),
    selectionAnchor: anchor === undefined ? undefined : VerseIdHelper.calculate(JOHN, 3, anchor),
  };
}

let shared: Library | undefined;
function library(): Library {
  shared ??= Library.open({ modules: discoverModules() });
  return shared;
}

/** The real chapter, as the reader has it laid out. */
function chapterVerses(book: number, chapter: number): DisplayVerse[] {
  const bible = library().bible('KJV');
  if (bible === undefined) throw new Error('no KJV');
  const loaded = library().chapter(bible, book, chapter);
  if (loaded === undefined) throw new Error(`no ${book} ${chapter}`);
  return loaded.verses.map((verse) =>
    toDisplayVerse(verse, {
      theme,
      redLetter: true,
      showSupplied: true,
    }),
  );
}

describe('resolving an anchor and a cursor', () => {
  test('no anchor is the cursor verse alone — what y copies by default', () => {
    expect(selectedRange(tabAt(16))).toEqual({ start: 16, end: 16 });
    expect(hasSelection(tabAt(16))).toBe(false);
  });

  test('the range is ordered however the two are arranged', () => {
    expect(selectedRange(tabAt(17, 16))).toEqual({ start: 16, end: 17 });
    expect(selectedRange(tabAt(16, 17))).toEqual({ start: 16, end: 17 });
  });

  test('an anchor left behind in another chapter is discarded, not honoured', () => {
    // `<` and `>` move the tab with a selection live. Defending here rather
    // than trusting every navigation path to clear the anchor is what makes
    // this one place to get right instead of a dozen.
    const stale: TabState = {
      ...tabAt(5),
      selectionAnchor: VerseIdHelper.calculate(JOHN, 2, 20),
    };
    expect(selectedRange(stale)).toEqual({ start: 5, end: 5 });
    expect(hasSelection(stale)).toBe(false);
  });

  test('an anchor in another book is discarded too', () => {
    const stale: TabState = {
      ...tabAt(5),
      selectionAnchor: VerseIdHelper.calculate(PSALMS, 3, 5),
    };
    expect(selectedRange(stale)).toEqual({ start: 5, end: 5 });
  });
});

describe('extending and shrinking', () => {
  test('shift+↓ from a bare cursor selects two verses', () => {
    const next = moveSelection(tabAt(16), 1, JOHN3);
    expect(selectedRange(next)).toEqual({ start: 16, end: 17 });
  });

  test('shift+↑ back over the anchor shrinks the range rather than inverting it', () => {
    // The case a start/end pair gets wrong. Down twice, up once, and you must
    // be left with the two verses you started the second press on.
    let tab = moveSelection(tabAt(16), 1, JOHN3);
    tab = moveSelection(tab, 1, JOHN3);
    expect(selectedRange(tab)).toEqual({ start: 16, end: 18 });

    tab = moveSelection(tab, -1, JOHN3);
    expect(selectedRange(tab)).toEqual({ start: 16, end: 17 });
    expect(tab.selectionAnchor).toBe(VerseIdHelper.calculate(JOHN, 3, 16));
  });

  test('shrinking all the way back to the anchor keeps the anchor armed', () => {
    // So the very next shift+↑ grows the selection upwards instead of doing
    // nothing — the anchor is where you started, not where the range ended.
    let tab = moveSelection(tabAt(16), 1, JOHN3);
    tab = moveSelection(tab, -1, JOHN3);
    expect(selectedRange(tab)).toEqual({ start: 16, end: 16 });
    expect(tab.selectionAnchor).toBeDefined();

    tab = moveSelection(tab, -1, JOHN3);
    expect(selectedRange(tab)).toEqual({ start: 15, end: 16 });
  });

  test('the clamp is the chapter, and reports nothing rather than a changed tab', () => {
    // Identity is the "nothing happened" signal, so the reader can return
    // `none` and let the shell have the key.
    const last = tabAt(36);
    expect(moveSelection(last, 1, JOHN3)).toBe(last);
    const first = tabAt(1);
    expect(moveSelection(first, -1, JOHN3)).toBe(first);
  });

  test('it clamps rather than rolling into the neighbouring chapter', () => {
    let tab = tabAt(34);
    for (let i = 0; i < 10; i += 1) tab = moveSelection(tab, 1, JOHN3);
    expect(selectedRange(tab)).toEqual({ start: 34, end: 36 });
    expect(tab.chapter).toBe(3);
  });
});

describe('v, and esc', () => {
  test('v arms the selection without moving anything', () => {
    const armed = beginSelection(tabAt(16));
    expect(armed.cursorVerse).toBe(tabAt(16).cursorVerse);
    expect(armed.selectionAnchor).toBe(tabAt(16).cursorVerse);
  });

  test('an armed anchor turns the reader’s ordinary ↓ into an extend', () => {
    // The guaranteed fallback for terminals that swallow shift+arrow: the
    // reader rebuilds the tab by spreading it, so the anchor rides along.
    const armed = beginSelection(tabAt(16));
    const moved: TabState = { ...armed, cursorVerse: VerseIdHelper.calculate(JOHN, 3, 18) };
    expect(selectedRange(moved)).toEqual({ start: 16, end: 18 });
  });

  test('v again collapses it, so the key is its own undo', () => {
    expect(beginSelection(beginSelection(tabAt(16))).selectionAnchor).toBeUndefined();
  });

  test('esc drops the anchor and leaves the cursor where it is', () => {
    const cleared = clearSelection(tabAt(20, 16));
    expect(cleared.selectionAnchor).toBeUndefined();
    expect(cleared.cursorVerse).toBe(tabAt(20).cursorVerse);
  });
});

describe('a range typed on the input line', () => {
  test('16-17 arrives selected', () => {
    const intent = classifyInput('16-17', { book: JOHN, chapter: 3 });
    expect(intent.kind).toBe('reference');
    if (intent.kind !== 'reference') return;

    const { cursorVerse, selectionAnchor, clamped } = selectionForReference(intent.reference, 36);
    expect(VerseIdHelper.parse(cursorVerse).verse).toBe(17);
    expect(VerseIdHelper.parse(selectionAnchor!).verse).toBe(16);
    expect(clamped).toBe(false);
  });

  test('3:16-17 arrives selected too', () => {
    const intent = classifyInput('3:16-17', { book: JOHN, chapter: 1 });
    expect(intent.kind).toBe('reference');
    if (intent.kind !== 'reference') return;

    const resolved = selectionForReference(intent.reference, 36);
    expect(VerseIdHelper.parse(resolved.cursorVerse).verse).toBe(17);
    expect(VerseIdHelper.parse(resolved.selectionAnchor!).verse).toBe(16);
  });

  test('a plain reference brings no selection with it', () => {
    const intent = classifyInput('john 3:16', { book: 1, chapter: 1 });
    expect(intent.kind).toBe('reference');
    if (intent.kind !== 'reference') return;
    expect(selectionForReference(intent.reference, 36).selectionAnchor).toBeUndefined();
  });

  test('a cross-chapter range is cut at the chapter end and says so', () => {
    // The input line parses `3:16-4:2`; a selection cannot hold it, because the
    // reader lays out one chapter and the other half would be invisible.
    const intent = classifyInput('3:16-4:2', { book: JOHN, chapter: 3 });
    expect(intent.kind).toBe('reference');
    if (intent.kind !== 'reference') return;

    const resolved = selectionForReference(intent.reference, 36);
    expect(VerseIdHelper.parse(resolved.cursorVerse).verse).toBe(36);
    expect(VerseIdHelper.parse(resolved.selectionAnchor!).verse).toBe(16);
    expect(resolved.clamped).toBe(true);
  });
});

describe.skipIf(!hasKjv)('the summary above the input line', () => {
  test('reproduces the summary line exactly, counts and all', () => {
    const texts = chapterVerses(JOHN, 3)
      .filter((v) => v.verse === 16 || v.verse === 17)
      .map((v) => v.plainText);

    const rows = selectionSummary({
      reference: 'John 3:16-17',
      texts,
      theme,
      width: 84,
    });
    const first = stripAnsi(renderStyledLine(rows[0]!, theme.depth));
    // The summary says "2 verses, 47 words" — and the KJV really does have 47.
    expect(first).toBe('John 3:16-17 selected — 2 verses, 47 words.   y copies · esc clears');
  });

  test('one verse is not pluralised', () => {
    const rows = selectionSummary({ reference: 'John 3:16', texts: ['a b c'], theme, width: 84 });
    expect(stripAnsi(renderStyledLine(rows[0]!, theme.depth))).toContain('1 verse, 3 words');
  });

  test('the teaching line is dropped whole rather than truncated', () => {
    // A list of alternatives cut off mid-item teaches the wrong alternatives.
    expect(selectionSummary({ reference: 'John 3:16-17', texts: ['a'], theme, width: 84 })).toHaveLength(2);
    expect(selectionSummary({ reference: 'John 3:16-17', texts: ['a'], theme, width: 30 })).toHaveLength(1);
  });

  test('countWords counts as the span data does', () => {
    expect(countWords(['one two  three', ' four '])).toBe(4);
  });
});

describe.skipIf(!hasKjv)('highlighting the selection', () => {
  test('every row of every selected verse is lit, and no row of any other', () => {
    const verses = chapterVerses(JOHN, 3);
    const lines = layoutReading(verses, {
      width: 60,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
    });

    const lit = highlightSelection(lines, { start: 16, end: 17 }, theme);
    for (const [index, line] of lit.entries()) {
      const isLit = line.segments.some((s) => s.style?.bg === theme.cursorVerse.bg);
      const selected = line.verse === 16 || line.verse === 17;
      // Blank rows have no segments and so cannot be lit either way.
      if (line.segments.length === 0) continue;
      expect([index, isLit]).toEqual([index, selected]);
    }
  });

  test('the highlight sits under the word styles rather than erasing them', () => {
    const verses = chapterVerses(JOHN, 3);
    const lines = layoutReading(verses, { width: 60, mode: 'numbered', theme, cursorVerse: 0 });
    const lit = highlightSelection(lines, { start: 16, end: 16 }, theme);
    // A one-verse range is not a selection, so nothing changes.
    expect(lit).toEqual([...lines]);

    const two = highlightSelection(lines, { start: 16, end: 17 }, theme);
    const red = two
      .filter((line) => line.verse === 16)
      .flatMap((line) => line.segments)
      .filter((s) => s.style?.fg === theme.wordsOfChrist.fg);
    // John 3:16 is red-letter in the KJV; selecting it must not turn it grey.
    expect(red.length).toBeGreaterThan(0);
    expect(red.every((s) => s.style?.bg === theme.cursorVerse.bg)).toBe(true);
  });
});
