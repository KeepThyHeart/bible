/**
 * Tests for the shared verse-expansion core.
 *
 * The pure parts (`resolveReferenceRange`, `buildExpandedHtml`) are covered
 * table-driven; `expandReference` gets a real TipTap editor in jsdom with IPC
 * and the Bible store mocked, because the two things most likely to break in
 * production - what lands in the document, and whether one Ctrl+Z reverts it -
 * cannot be checked any other way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { ReferenceParser } from '@bible/core';
import { findVerseReferenceRanges } from '../components/notes/editor/verseReferenceRanges';

const parser = new ReferenceParser();

/** Mutable so individual tests can simulate "no Bible panel open". */
let activeTabs: Array<{ abbreviation: string }> = [{ abbreviation: 'KJV' }];

vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'bible_default',
  useBibleStore: {
    getState: () => ({
      panels: new Map([['bible_default', { openTabs: activeTabs, activeTabIndex: 0 }]]),
    }),
  },
}));

const getVerses = vi.fn();
vi.mock('./electronAPI', () => ({
  bibleAPI: {
    getVerses: (...args: unknown[]) => getVerses(...args),
  },
}));

import {
  resolveReferenceRange,
  buildExpandedHtml,
  getActiveTranslation,
  expandReference,
  MAX_EXPAND_VERSES,
} from './verseExpansionService';
import { __clearVerseFetchCache } from './verseFetchCache';

const JOHN_3_16 = {
  verse_id: 43003016,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
};

function verse(n: number, text: string) {
  return { ...JOHN_3_16, verse_id: 43003000 + n, verse: n, text, text_html: text };
}

describe('resolveReferenceRange', () => {
  const cases: Array<[string, number, number]> = [
    ['John 3:16', 43003016, 43003016],
    ['John 3:16-18', 43003016, 43003018],
    ['John 3:16-4:2', 43003016, 43004002],
    // A bare chapter is the whole chapter, not a single verse - this is the
    // one place we deliberately differ from InsertPassageDialog, which treats
    // "Ps 119" as Psalm 119:1.
    ['John 3', 43003001, 43003999],
    // "John 3-5" parses as { chapter: 3, endVerse: 5 } because the regex
    // cannot tell that trailing 5 is a chapter. With no start verse, it is.
    ['John 3-5', 43003001, 43005999],
    ['Psalms 119', 19119001, 19119999],
    ['Jude 5', 65001005, 65001005],
    // Well-formed but non-existent: resolves fine, comes back empty at fetch.
    ['Genesis 99:1', 1099001, 1099001],
  ];

  it.each(cases)('%s resolves to %d-%d', (text, startId, endId) => {
    expect(resolveReferenceRange(parser.parse(text))).toEqual({ startId, endId });
  });

  it('collapses a backwards range to the start verse rather than fetching nothing', () => {
    expect(resolveReferenceRange({ isValid: true, book: 43, chapter: 3, verse: 16, endVerse: 2, originalText: '' }))
      .toEqual({ startId: 43003016, endId: 43003016 });
  });

  it('reads an end chapter with no end verse as "through the end of that chapter"', () => {
    expect(resolveReferenceRange({ isValid: true, book: 43, chapter: 3, verse: 16, endChapter: 4, originalText: '' }))
      .toEqual({ startId: 43003016, endId: 43004999 });
  });

  it('returns null for references it cannot place', () => {
    expect(resolveReferenceRange({ isValid: false, originalText: '' })).toBeNull();
    expect(resolveReferenceRange({ isValid: true, book: 43, originalText: '' })).toBeNull();
    // Out-of-domain numbers would compute an id that silently means something
    // else entirely (43*1e6 + 3*1000 + 1000 is chapter 4 verse 0).
    expect(resolveReferenceRange({ isValid: true, book: 43, chapter: 3, verse: 1000, originalText: '' })).toBeNull();
    expect(resolveReferenceRange({ isValid: true, book: 99, chapter: 1, verse: 1, originalText: '' })).toBeNull();
  });
});

describe('buildExpandedHtml', () => {
  it('keeps a single-line format inline so it flows inside a sentence', () => {
    const html = buildExpandedHtml('"For God so loved the world" (John 3:16 KJV)');
    expect(html).not.toContain('<p>');
    expect(html).toBe('"For God so loved the world" (John 3:16 KJV)');
  });

  it('turns a multi-line format into paragraphs', () => {
    expect(buildExpandedHtml('John 3:16 (KJV)\n16 For God so loved the world'))
      .toBe('<p>John 3:16 (KJV)</p><p>16 For God so loved the world</p>');
  });

  it('renders a blank line as a break rather than an empty paragraph', () => {
    expect(buildExpandedHtml('a\n\nb')).toBe('<p>a</p><p><br></p><p>b</p>');
  });

  it('preserves red-letter spans, which round-trip as TextStyle/Color marks', () => {
    const html = buildExpandedHtml('Jesus said <span style="color: #B71C1C;">Follow me</span>');
    expect(html).toContain('color: #B71C1C');
  });

  it('strips dangerous markup from the raw-text path', () => {
    // With wordsOfChristInRed off, the format engine returns unescaped text
    // that is about to be parsed as HTML. The sanitiser is what makes that safe.
    expect(buildExpandedHtml('hi <script>alert(1)</script>')).not.toContain('<script');
  });
});

describe('getActiveTranslation', () => {
  afterEach(() => {
    activeTabs = [{ abbreviation: 'KJV' }];
  });

  it('reads the primary Bible panel\'s active tab', () => {
    expect(getActiveTranslation()).toBe('KJV');
  });

  it('returns null rather than silently defaulting when no Bible tab is open', () => {
    activeTabs = [];
    expect(getActiveTranslation()).toBeNull();
  });
});

describe('expandReference', () => {
  let editor: Editor;

  beforeEach(() => {
    __clearVerseFetchCache();
    getVerses.mockReset();
    activeTabs = [{ abbreviation: 'KJV' }];
    editor = new Editor({
      extensions: [StarterKit, TextStyle, Color],
      content: '<p>See John 3:16 today</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  function rangeInDoc() {
    const ranges = findVerseReferenceRanges(editor.state.doc);
    expect(ranges).toHaveLength(1);
    return ranges[0];
  }

  it('replaces the reference with the formatted verse text', async () => {
    getVerses.mockResolvedValue([JOHN_3_16]);

    const result = await expandReference(editor, rangeInDoc(), 'combined', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    expect(result).toEqual({ ok: true, verseCount: 1 });
    expect(getVerses).toHaveBeenCalledWith('KJV', 43003016, 43003016);
    const html = editor.getHTML();
    expect(html).toContain('For God so loved the world');
    expect(html).not.toContain('See John 3:16 today');
    // The surrounding sentence survives.
    expect(editor.getText()).toContain('See ');
    expect(editor.getText()).toContain(' today');
  });

  it('is a single undo step that restores the original document exactly', async () => {
    const before = editor.getHTML();
    getVerses.mockResolvedValue([JOHN_3_16]);

    await expandReference(editor, rangeInDoc(), 'combined', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });
    expect(editor.getHTML()).not.toBe(before);

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
  });

  it('serves a second expansion of the same range from cache without another fetch', async () => {
    getVerses.mockResolvedValue([JOHN_3_16]);
    const opts = { displayVersionNumber: true, wordsOfChristInRed: false };

    await expandReference(editor, rangeInDoc(), 'combined', opts);
    editor.commands.undo();
    await expandReference(editor, rangeInDoc(), 'combined', opts);

    expect(getVerses).toHaveBeenCalledTimes(1);
  });

  it('refuses an over-cap expansion and leaves the document untouched', async () => {
    const many = Array.from({ length: MAX_EXPAND_VERSES + 1 }, (_, i) => verse(i + 1, `verse ${i + 1}`));
    getVerses.mockResolvedValue(many);
    const before = editor.getHTML();

    const result = await expandReference(editor, rangeInDoc(), 'standard', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    expect(result).toEqual({ ok: false, reason: 'too-large', verseCount: MAX_EXPAND_VERSES + 1 });
    expect(editor.getHTML()).toBe(before);
  });

  it('proceeds over the cap when the caller explicitly allows it', async () => {
    const many = Array.from({ length: MAX_EXPAND_VERSES + 1 }, (_, i) => verse(i + 1, `verse ${i + 1}`));
    getVerses.mockResolvedValue(many);

    const result = await expandReference(
      editor,
      rangeInDoc(),
      'standard',
      { displayVersionNumber: true, wordsOfChristInRed: false },
      { allowOverCap: true },
    );

    expect(result).toEqual({ ok: true, verseCount: MAX_EXPAND_VERSES + 1 });
    expect(editor.getText()).toContain('verse 51');
  });

  it('leaves the document untouched when the reference resolves to nothing', async () => {
    getVerses.mockResolvedValue([]);
    const before = editor.getHTML();

    const result = await expandReference(editor, rangeInDoc(), 'combined', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(editor.getHTML()).toBe(before);
  });

  it('reports a fetch failure without touching the document', async () => {
    getVerses.mockRejectedValue(new Error('ipc exploded'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = editor.getHTML();

    const result = await expandReference(editor, rangeInDoc(), 'combined', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    expect(result).toEqual({ ok: false, reason: 'fetch-failed' });
    expect(editor.getHTML()).toBe(before);
  });

  it('refuses when no Bible translation is open rather than guessing KJV', async () => {
    activeTabs = [];
    const result = await expandReference(editor, rangeInDoc(), 'combined', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    expect(result).toEqual({ ok: false, reason: 'no-translation' });
    expect(getVerses).not.toHaveBeenCalled();
  });

  it('inserts a multi-line format as separate paragraphs', async () => {
    getVerses.mockResolvedValue([JOHN_3_16, verse(17, 'For God sent not his Son')]);

    await expandReference(editor, rangeInDoc(), 'standard', {
      displayVersionNumber: true,
      wordsOfChristInRed: false,
    });

    const html = editor.getHTML();
    expect(html).toContain('For God so loved the world');
    expect(html).toContain('For God sent not his Son');
    expect((html.match(/<p>/g) ?? []).length).toBeGreaterThan(1);
  });
});
