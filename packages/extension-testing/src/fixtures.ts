/**
 * Test fixtures for extension developers.
 *
 * Provides sample data matching the DTO shapes from `@bible/core/Extensions`
 * so tests can exercise their extension logic against realistic inputs without
 * needing a live database or module files.
 */

import type { Extensions } from '@bible/core';

// ─── Verse fixtures ───────────────────────────────────────────────────────────

/** Genesis 1:1 — verse ID 1001001 */
export const VERSE_GEN_1_1: Extensions.BibleVerseDto = {
  verseId: 1001001,
  text: 'In the beginning God created the heaven and the earth.',
  textPlain: 'In the beginning God created the heaven and the earth.',
  wordCount: 10,
  formattingData: {
    paragraphStart: true,
  },
};

/** John 3:16 — verse ID 43003016 */
export const VERSE_JOHN_3_16: Extensions.BibleVerseDto = {
  verseId: 43003016,
  text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  textPlain: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  wordCount: 25,
  formattingData: {
    wordsOfChrist: [{ start: 0, end: 141 }],
  },
};

/** Psalm 23:1 — verse ID 19023001 */
export const VERSE_PSALM_23_1: Extensions.BibleVerseDto = {
  verseId: 19023001,
  text: 'The LORD is my shepherd; I shall not want.',
  textPlain: 'The LORD is my shepherd; I shall not want.',
  wordCount: 8,
  formattingData: {
    poetry: { isPoetry: true, indentLevel: 0 },
  },
};

/** Romans 8:28 — verse ID 45008028 */
export const VERSE_ROM_8_28: Extensions.BibleVerseDto = {
  verseId: 45008028,
  text: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.',
  textPlain: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.',
  wordCount: 23,
};

/** Revelation 22:21 — verse ID 66022021 (last verse) */
export const VERSE_REV_22_21: Extensions.BibleVerseDto = {
  verseId: 66022021,
  text: 'The grace of our Lord Jesus Christ be with you all. Amen.',
  textPlain: 'The grace of our Lord Jesus Christ be with you all. Amen.',
  wordCount: 11,
};

/** A small range of verses for testing getRange(). */
export const VERSES_GEN_1_1_3: Extensions.BibleVerseDto[] = [
  VERSE_GEN_1_1,
  {
    verseId: 1001002,
    text: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.',
    textPlain: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.',
    wordCount: 29,
  },
  {
    verseId: 1001003,
    text: 'And God said, Let there be light: and there was light.',
    textPlain: 'And God said, Let there be light: and there was light.',
    wordCount: 11,
    formattingData: { paragraphStart: true },
  },
];

// ─── Module fixtures ──────────────────────────────────────────────────────────

export const MODULE_KJV: Extensions.BibleModuleInfoDto = {
  id: 'bible_kjv',
  abbreviation: 'KJV',
  name: 'King James Version',
  language: 'en',
  version: '1769',
  textDirection: 'ltr',
};

export const MODULE_ESV: Extensions.BibleModuleInfoDto = {
  id: 'bible_esv',
  abbreviation: 'ESV',
  name: 'English Standard Version',
  language: 'en',
  version: '2016',
  textDirection: 'ltr',
};

export const MODULE_HEBREW: Extensions.BibleModuleInfoDto = {
  id: 'bible_wlc',
  abbreviation: 'WLC',
  name: 'Westminster Leningrad Codex',
  language: 'he',
  isOriginalLanguage: true,
  textDirection: 'rtl',
};

// ─── Book fixtures ────────────────────────────────────────────────────────────

export const BOOKS_SAMPLE: Extensions.BibleBookDto[] = [
  { bookNumber: 1, shortName: 'Gen', name: 'Genesis', testament: 'old', chapterCount: 50 },
  { bookNumber: 2, shortName: 'Exo', name: 'Exodus', testament: 'old', chapterCount: 40 },
  { bookNumber: 19, shortName: 'Psa', name: 'Psalms', testament: 'old', chapterCount: 150 },
  { bookNumber: 43, shortName: 'Jhn', name: 'John', testament: 'new', chapterCount: 21 },
  { bookNumber: 45, shortName: 'Rom', name: 'Romans', testament: 'new', chapterCount: 16 },
  { bookNumber: 66, shortName: 'Rev', name: 'Revelation', testament: 'new', chapterCount: 22 },
];

// ─── Chapter-extent fixtures ──────────────────────────────────────────────────

/**
 * KJV verse counts for John, chapter 1 through 21.
 *
 * John is the one book this package models completely, because it is the book
 * every other fixture here already anchors to: `VERSE_JOHN_3_16`,
 * `PARSED_REF_JOHN_3_16`, `COMMENTARY_ENTRY_JOHN_3_16` and the default verse
 * corpus all point into it. An extension that resolves a passage against the
 * mock therefore gets a real answer for the reference it is most likely to be
 * handed, and one that is arithmetically consistent with the verse ids the
 * rest of the file hands out.
 */
const JOHN_VERSE_COUNTS: readonly number[] = [
  51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25,
];

/**
 * Build the chapter extents for a book from its per-chapter verse counts.
 *
 * Verse ids are `book * 1_000_000 + chapter * 1_000 + verse`, the encoding the
 * host uses and the one every verse fixture above is written in. `lastVerseId`
 * is INCLUSIVE — it is the id of verse `verseCount`, not a bound past the end —
 * because that is what `collections.addPassage(firstVerseId, lastVerseId)`
 * expects, which is the reason `listChapters` exists at all.
 */
function chapterExtents(
  bookNumber: number,
  verseCounts: readonly number[],
): Extensions.BibleChapterDto[] {
  return verseCounts.map((verseCount, i) => {
    const chapter = i + 1;
    const base = bookNumber * 1_000_000 + chapter * 1_000;
    return {
      bookNumber,
      chapter,
      verseCount,
      firstVerseId: base + 1,
      lastVerseId: base + verseCount,
    };
  });
}

/**
 * Every chapter of John with its verse count and inclusive verse-id bounds.
 * `CHAPTERS_JOHN[2]` is John 3: 36 verses, 43003001 through 43003036.
 */
export const CHAPTERS_JOHN: Extensions.BibleChapterDto[] = chapterExtents(
  43,
  JOHN_VERSE_COUNTS,
);

// ─── Commentary fixtures ──────────────────────────────────────────────────────

export const COMMENTARY_MODULE_SAMPLE: Extensions.CommentaryModuleInfoDto = {
  id: 'commentary_mhc',
  abbreviation: 'MHC',
  name: 'Matthew Henry Complete',
  language: 'en',
};

export const COMMENTARY_ENTRY_JOHN_3_16: Extensions.CommentaryEntryDto = {
  id: 'mhc-43003016',
  moduleId: 'commentary_mhc',
  startVerseId: 43003016,
  endVerseId: 43003016,
  title: 'John 3:16',
  content: '<p>Here is the gospel in miniature. God so loved the world that He gave His only Son...</p>',
  isHtml: true,
};

// ─── Dictionary fixtures ──────────────────────────────────────────────────────

export const DICTIONARY_MODULE_SAMPLE: Extensions.DictionaryModuleInfoDto = {
  id: 'dictionary_strongs',
  abbreviation: 'Strong',
  name: "Strong's Concordance",
  language: 'en',
};

export const DICTIONARY_ENTRY_AGAPE: Extensions.DictionaryEntryDto = {
  key: 'G26',
  moduleId: 'dictionary_strongs',
  headword: 'agape',
  pronunciation: 'ag-ah-pay',
  language: 'el',
  content: 'Love, affection, good will, benevolence. From agapao (G25).',
  strongsNumber: 'G26',
};

export const DICTIONARY_ENTRY_LOGOS: Extensions.DictionaryEntryDto = {
  key: 'G3056',
  moduleId: 'dictionary_strongs',
  headword: 'logos',
  pronunciation: 'log-os',
  language: 'el',
  content: 'A word, speech, matter, thing. From lego (G3004).',
  strongsNumber: 'G3056',
};

// ─── Note fixtures ────────────────────────────────────────────────────────────

export const NOTE_SAMPLE: Extensions.UserNoteDto = {
  id: 'note-001',
  type: 'general',
  title: 'Thoughts on John 3:16',
  content: 'This is the most quoted verse in the Bible. The word "so" emphasizes the extent of God\'s love.',
  linkedVerses: [43003016],
  tags: ['gospel', 'love'],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

export const NOTE_SERMON: Extensions.UserNoteDto = {
  id: 'note-002',
  type: 'sermon',
  title: 'Sunday Message: The Good Shepherd',
  content: '# Psalm 23 — The Good Shepherd\n\n## Introduction\nDavid wrote this psalm from the perspective of a sheep...',
  linkedVerses: [19023001, 19023002, 19023003, 19023004, 19023005, 19023006],
  tags: ['sermon', 'psalms'],
  createdAt: 1700100000000,
  updatedAt: 1700200000000,
};

// ─── Highlight fixtures ───────────────────────────────────────────────────────

export const HIGHLIGHT_SAMPLE: Extensions.UserHighlightDto = {
  id: 'hl-001',
  range: { verseId: 43003016 },
  styleId: 'yellow',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

// ─── Bookmark / collection fixtures ───────────────────────────────────────────

export const BOOKMARK_SAMPLE: Extensions.BookmarkDto = {
  id: 'bm-001',
  verseId: 43003016,
  collectionId: 'col-001',
  label: 'John 3:16',
  createdAt: 1700000000000,
};

export const COLLECTION_SAMPLE: Extensions.CollectionDto = {
  id: 'col-001',
  name: 'Favorites',
  count: 5,
  createdAt: 1700000000000,
};

// ─── Token fixtures (interlinear data) ────────────────────────────────────────

export const TOKENS_JOHN_1_1: Extensions.VerseTokenDto[] = [
  { index: 0, text: 'In', startOffset: 0, endOffset: 2 },
  { index: 1, text: 'the', startOffset: 3, endOffset: 6 },
  { index: 2, text: 'beginning', strongsNumber: 'G746', lemma: 'arche', startOffset: 7, endOffset: 16 },
  { index: 3, text: 'was', startOffset: 17, endOffset: 20 },
  { index: 4, text: 'the', startOffset: 21, endOffset: 24 },
  { index: 5, text: 'Word', strongsNumber: 'G3056', lemma: 'logos', startOffset: 25, endOffset: 29 },
];

// ─── Parsed reference fixtures ────────────────────────────────────────────────

export const PARSED_REF_JOHN_3_16: Extensions.ParsedReferenceDto = {
  bookNumber: 43,
  chapter: 3,
  startVerse: 16,
  input: 'John 3:16',
  startVerseId: 43003016,
};

export const PARSED_REF_GEN_1: Extensions.ParsedReferenceDto = {
  bookNumber: 1,
  chapter: 1,
  input: 'Genesis 1',
  startVerseId: 1001001,
  endVerseId: 1001031,
};

export const PARSED_REF_ROM_8_28_30: Extensions.ParsedReferenceDto = {
  bookNumber: 45,
  chapter: 8,
  startVerse: 28,
  endVerse: 30,
  input: 'Romans 8:28-30',
  startVerseId: 45008028,
  endVerseId: 45008030,
};

// ─── Panel fixtures ───────────────────────────────────────────────────────────

export const PANEL_BIBLE: Extensions.PanelInfoDto = {
  panelId: 'panel-bible-1',
  contentType: 'bible',
  title: 'KJV - John 3',
  state: { module: 'bible_kjv', chapter: 43003 },
};

export const PANEL_COMMENTARY: Extensions.PanelInfoDto = {
  panelId: 'panel-commentary-1',
  contentType: 'commentary',
  title: 'Matthew Henry - John 3:16',
  state: { module: 'commentary_mhc', verseId: 43003016 },
};
