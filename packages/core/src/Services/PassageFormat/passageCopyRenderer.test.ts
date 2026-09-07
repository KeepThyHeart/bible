import { describe, it, expect } from 'vitest';
import { renderPassageCopy } from './passageCopyRenderer';
import {
  AdvancedCopyOptions,
  DEFAULT_ADVANCED_COPY_OPTIONS,
} from './copyOptions';
import { DEFAULT_COPY_FORMAT_SETTINGS } from './settings';
import type { PassageVerse, FormatOptions, VerseContext } from './types';
import standardFormat from './standardFormat';
import combinedFormat from './combinedFormat';
import { getAllFormats, getFormatById, DEFAULT_FORMAT_ID } from './formatRegistry';

const CONTEXT: VerseContext = { bookName: 'John', chapter: 3, translation: 'KJV' };

const FORMAT_OPTIONS: FormatOptions = {
  displayVersionNumber: true,
  wordsOfChristInRed: false,
};

function verse(
  chapter: number,
  num: number,
  text: string,
  isParagraphStart = false,
): PassageVerse {
  return {
    verse_id: 43000000 + chapter * 1000 + num,
    book_number: 43,
    chapter,
    verse: num,
    text,
    is_paragraph_start: isParagraphStart,
  };
}

/** John 3:16-17, the passage the required output shapes are specified against. */
const JOHN_3_16 =
  'For God so loved the world, that he gave his only begotten Son, that whosoever ' +
  'believeth in him should not perish, but have everlasting life.';
const JOHN_3_17 =
  'For God sent not his Son into the world to condemn the world; but that the ' +
  'world through him might be saved.';

const PASSAGE = [verse(3, 16, JOHN_3_16), verse(3, 17, JOHN_3_17)];

function standard(
  overrides: Partial<AdvancedCopyOptions>,
  verses = PASSAGE,
  formatOptions = FORMAT_OPTIONS,
): string {
  return renderPassageCopy(verses, CONTEXT, formatOptions, {
    ...DEFAULT_ADVANCED_COPY_OPTIONS,
    ...overrides,
  }, 'standard');
}

function combined(
  overrides: Partial<AdvancedCopyOptions>,
  verses = PASSAGE,
  formatOptions = FORMAT_OPTIONS,
): string {
  return renderPassageCopy(verses, CONTEXT, formatOptions, {
    ...DEFAULT_ADVANCED_COPY_OPTIONS,
    ...overrides,
  }, 'combined');
}

describe('the copy format registry', () => {
  it('offers exactly Standard, Combined and Custom Template, in that order', () => {
    expect(getAllFormats().map(f => f.id)).toEqual(['standard', 'combined', 'template']);
  });

  it('no longer knows the formats the redesign removed', () => {
    // A persisted "last used format" naming one of these must not resolve, or
    // `getLastUsedFormatId()` would hand the dialog a format it cannot render.
    for (const gone of ['inline', 'plain', 'advanced']) {
      expect(getFormatById(gone)).toBeUndefined();
    }
    expect(DEFAULT_FORMAT_ID).toBe('standard');
  });
});

describe('renderPassageCopy - Standard', () => {
  it('produces the specified Markdown block quote', () => {
    // The shape the redesign is specified against: reference on its own line,
    // a blank line, then one `> ` line per numbered verse.
    expect(
      standard({
        markdown: true,
        referencePosition: 'beginning',
        includeVerseNumbers: true,
        newLinePerVerse: true,
        textFormat: 'blockquote',
      }),
    ).toBe(
      `John 3:16-17 (KJV)\n\n> (16) ${JOHN_3_16}\n> (17) ${JOHN_3_17}`,
    );
  });

  it('is the same shape without Markdown, indented instead of marked with >', () => {
    expect(
      standard({
        markdown: false,
        referencePosition: 'beginning',
        includeVerseNumbers: true,
        newLinePerVerse: true,
        textFormat: 'blockquote',
      }),
    ).toBe(
      `John 3:16-17 (KJV)\n\n    (16) ${JOHN_3_16}\n    (17) ${JOHN_3_17}`,
    );
  });

  it('drops the quote decoration entirely for the Inline text format', () => {
    const out = standard({ textFormat: 'inline' });
    expect(out).toBe(`John 3:16-17 (KJV)\n\n(16) ${JOHN_3_16}\n(17) ${JOHN_3_17}`);
    expect(out).not.toContain('> ');
  });

  it('runs the verses together on one quoted line when new-line-per-verse is off', () => {
    expect(standard({ newLinePerVerse: false, markdown: true })).toBe(
      `John 3:16-17 (KJV)\n\n> (16) ${JOHN_3_16} (17) ${JOHN_3_17}`,
    );
  });

  it('omits verse numbers on request', () => {
    expect(standard({ includeVerseNumbers: false, textFormat: 'inline' })).toBe(
      `John 3:16-17 (KJV)\n\n${JOHN_3_16}\n${JOHN_3_17}`,
    );
  });

  it('places the reference after the passage, or nowhere', () => {
    expect(standard({ referencePosition: 'end', textFormat: 'inline' })).toBe(
      `(16) ${JOHN_3_16}\n(17) ${JOHN_3_17}\n\nJohn 3:16-17 (KJV)`,
    );

    const none = standard({ referencePosition: 'none', textFormat: 'inline' });
    expect(none).toBe(`(16) ${JOHN_3_16}\n(17) ${JOHN_3_17}`);
    expect(none).not.toContain('John 3:16-17');
  });

  it('leaves the translation off when the shared option says so', () => {
    expect(
      standard({ textFormat: 'inline' }, PASSAGE, {
        displayVersionNumber: false,
        wordsOfChristInRed: false,
      }),
    ).toContain('John 3:16-17\n');
  });

  it('ignores the options that belong to Combined', () => {
    const withParagraphs = standard(
      { paragraphBreaks: true, textFormat: 'inline' },
      [verse(3, 16, JOHN_3_16), verse(3, 17, JOHN_3_17, true)],
    );
    // "Preserve paragraphs" is Combined's; Standard's line policy is
    // new-line-per-verse and nothing else, so no blank line appears.
    expect(withParagraphs).toBe(`John 3:16-17 (KJV)\n\n(16) ${JOHN_3_16}\n(17) ${JOHN_3_17}`);
  });
});

describe('renderPassageCopy - Combined', () => {
  it('produces the specified one-line shape with the reference inlined', () => {
    expect(
      combined({ referencePosition: 'beginning', includeVerseNumbers: false }),
    ).toBe(`(John 3:16-17, KJV) ${JOHN_3_16}  ${JOHN_3_17}`);
  });

  it('appends the reference instead when placement is After', () => {
    expect(combined({ referencePosition: 'end', includeVerseNumbers: false })).toBe(
      `${JOHN_3_16}  ${JOHN_3_17} (John 3:16-17, KJV)`,
    );
  });

  it('omits the reference entirely when placement is None', () => {
    const out = combined({ referencePosition: 'none', includeVerseNumbers: false });
    expect(out).toBe(`${JOHN_3_16}  ${JOHN_3_17}`);
    expect(out).not.toContain('KJV');
  });

  it('carries verse numbers when the shared option is on', () => {
    expect(combined({ includeVerseNumbers: true })).toBe(
      `(John 3:16-17, KJV) (16) ${JOHN_3_16}  (17) ${JOHN_3_17}`,
    );
  });

  it('breaks at a paragraph marker only when asked to', () => {
    const passage = [verse(3, 16, JOHN_3_16), verse(3, 17, JOHN_3_17, true)];

    expect(combined({ paragraphBreaks: true, includeVerseNumbers: false }, passage)).toBe(
      `(John 3:16-17, KJV) ${JOHN_3_16}\n\n${JOHN_3_17}`,
    );
    expect(combined({ paragraphBreaks: false, includeVerseNumbers: false }, passage)).toBe(
      `(John 3:16-17, KJV) ${JOHN_3_16}  ${JOHN_3_17}`,
    );
  });

  it('ignores the options that belong to Standard', () => {
    // Combined is one running line by definition: neither the per-verse line
    // break nor the block-quote decoration may reach it.
    const out = combined({
      newLinePerVerse: true,
      textFormat: 'blockquote',
      markdown: true,
      includeVerseNumbers: false,
    });
    expect(out).toBe(`(John 3:16-17, KJV) ${JOHN_3_16}  ${JOHN_3_17}`);
  });
});

describe('renderPassageCopy - options common to both shapes', () => {
  const CROSS_CHAPTER = [
    verse(3, 36, 'He that believeth on the Son hath everlasting life'),
    verse(4, 1, 'When therefore the Lord knew'),
  ];

  it('heads each chapter of a multi-chapter passage', () => {
    const out = standard({ includeChapterHeadings: true, textFormat: 'inline' }, CROSS_CHAPTER);
    expect(out).toContain('Chapter 3');
    expect(out).toContain('Chapter 4');
    // The reference spans the chapters it covers.
    expect(out.startsWith('John 3:36-4:1 (KJV)')).toBe(true);
  });

  it('renders chapter headings as Markdown headings', () => {
    const out = standard(
      { includeChapterHeadings: true, markdown: true, textFormat: 'inline' },
      CROSS_CHAPTER,
    );
    expect(out).toContain('### Chapter 3');
    expect(out).toContain('### Chapter 4');
  });

  it('carries the chapter in the verse label when headings are off', () => {
    // Nothing else in the output would say which chapter the verse came from.
    const out = standard({ includeChapterHeadings: false, textFormat: 'inline' }, CROSS_CHAPTER);
    expect(out).toContain('(3:36)');
    expect(out).toContain('(4:1)');
    expect(out).not.toContain('Chapter 3');
  });

  it('still breaks at a chapter boundary with headings switched off', () => {
    const out = combined({ includeChapterHeadings: false, includeVerseNumbers: false }, CROSS_CHAPTER);
    expect(out).toContain('everlasting life\n\nWhen therefore');
  });

  it('keeps the chapter heading outside the block quote', () => {
    const out = standard(
      { includeChapterHeadings: true, markdown: true, textFormat: 'blockquote' },
      CROSS_CHAPTER,
    );
    expect(out).toContain('### Chapter 3\n\n> ');
    expect(out).not.toContain('> ### ');
  });

  it('suppresses red letters in Markdown mode', () => {
    const christ: PassageVerse = {
      verse_id: 43003016,
      book_number: 43,
      chapter: 3,
      verse: 16,
      text: 'plain',
      text_html: '<span class="christ-words">For God so loved</span>',
    };
    const red: FormatOptions = { displayVersionNumber: true, wordsOfChristInRed: true };

    // Markdown reaches the clipboard as source text; HTML alongside it would let
    // a rich editor pick the HTML and discard the Markdown.
    expect(standard({ markdown: true }, [christ], red)).not.toContain('<span');
    expect(standard({ markdown: false }, [christ], red)).toContain('color: #B71C1C');
  });

  it('returns nothing for an empty passage', () => {
    expect(standard({}, [])).toBe('');
    expect(combined({}, [])).toBe('');
  });
});


describe('the registry formats render through the settings they are handed', () => {
  // Standard and Combined take their shape from a stored `AdvancedCopyOptions`
  // record. Core has no storage, so the app hands it over; what is pinned here
  // is that the format *uses* it rather than rendering its own defaults, and
  // that omitting it falls back to the defaults rather than throwing.
  it('renders Standard through the supplied options', () => {
    expect(
      standardFormat.format(PASSAGE, CONTEXT, FORMAT_OPTIONS, {
        ...DEFAULT_COPY_FORMAT_SETTINGS,
        advanced: {
          ...DEFAULT_ADVANCED_COPY_OPTIONS,
          markdown: true,
          textFormat: 'blockquote',
        },
      }),
    ).toBe(`John 3:16-17 (KJV)\n\n> (16) ${JOHN_3_16}\n> (17) ${JOHN_3_17}`);
  });

  it('renders Combined through the supplied options', () => {
    expect(
      combinedFormat.format(PASSAGE, CONTEXT, FORMAT_OPTIONS, {
        ...DEFAULT_COPY_FORMAT_SETTINGS,
        advanced: { ...DEFAULT_ADVANCED_COPY_OPTIONS, includeVerseNumbers: false },
      }),
    ).toBe(`(John 3:16-17, KJV) ${JOHN_3_16}  ${JOHN_3_17}`);
  });

  it('falls back to the defaults when no settings are supplied', () => {
    expect(standardFormat.format(PASSAGE, CONTEXT, FORMAT_OPTIONS)).toBe(
      standard({}),
    );
    expect(combinedFormat.format(PASSAGE, CONTEXT, FORMAT_OPTIONS)).toBe(
      combined({}),
    );
  });

  it('truncates the preview at 150 characters', () => {
    const preview = standardFormat.preview(PASSAGE, CONTEXT, FORMAT_OPTIONS);
    expect(preview.endsWith('...')).toBe(true);
    expect(preview).toHaveLength(153);
  });
});
