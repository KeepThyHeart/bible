import { describe, it, expect } from 'vitest';
import {
  toUSFM,
  toUSFMBook,
  renderVerseTextAsUsfm,
  UsfmExportError,
  UsfmVerseInput,
  SPAN_TYPE_TO_USFM_MARKER
} from './toUSFM';
import { parseUSFM, parseInlineUsfm, UsfmParseError } from './parseUSFM';
import { getUsfmBookByCode, getUsfmBookByNumber, usfmFileName, USFM_BOOKS } from './UsfmBookCodes';
import { splitVerseWords, VerseBlockWithHeadingKind, VerseFormatting, VerseSpan } from './VerseFormatting';
import type { PoetryLevel } from '../Data/Text/VerseFormatting';

const PSALM_TITLE_BLOCK: VerseBlockWithHeadingKind = {
  paragraph_start: true,
  // "The LORD is my shepherd;" / "I shall not want." - two lines, two indents,
  // inside one verse. A single `poetry_level` could not say this.
  lines: [
    { start: 0, end: 4, level: 1 },
    { start: 5, end: 8, level: 2 }
  ],
  heading: 'A Psalm of David',
  heading_kind: 'psalm_title'
};

/**
 * Psalm 23:1 as the module format documents it: clean text plus two
 * structured spans, no markup in `text`.
 */
const PSALM_23_1: UsfmVerseInput = {
  verseId: 19023001,
  text: 'The LORD is my shepherd; I shall not want.',
  formatting: {
    v: 1,
    block: PSALM_TITLE_BLOCK,
    spans: [
      { type: 'divine_name', start: 1, end: 1 },
      { type: 'supplied', start: 2, end: 2 }
    ]
  }
};

const JOHN_3_16: UsfmVerseInput = {
  verseId: 43003016,
  text: 'For God so loved the world, that he gave his only begotten Son.',
  formatting: {
    v: 1,
    block: { paragraph_start: true },
    spans: [{ type: 'words_of_christ', start: 0, end: 11 }]
  }
};

const MATT_1_23: UsfmVerseInput = {
  verseId: 40001023,
  text: 'Behold, a virgin shall be with child, and shall bring forth a son.',
  formatting: {
    v: 1,
    block: { paragraph_start: true },
    spans: [{ type: 'quotation', start: 0, end: 12, ref_start: 23007014, ref_end: 23007014 }]
  }
};

describe('UsfmBookCodes', () => {
  it('covers exactly the 66-book canon', () => {
    expect(USFM_BOOKS).toHaveLength(66);
    expect(USFM_BOOKS[0]!.code).toBe('GEN');
    expect(USFM_BOOKS[65]!.code).toBe('REV');
  });

  it('maps book numbers to USFM identifiers', () => {
    expect(getUsfmBookByNumber(1)!.code).toBe('GEN');
    expect(getUsfmBookByNumber(19)!.code).toBe('PSA');
    expect(getUsfmBookByNumber(43)!.code).toBe('JHN');
    expect(getUsfmBookByNumber(66)!.code).toBe('REV');
    expect(getUsfmBookByNumber(67)).toBeUndefined();
    expect(getUsfmBookByNumber(0)).toBeUndefined();
  });

  it('resolves identifiers case-insensitively', () => {
    expect(getUsfmBookByCode('jhn')!.bookNumber).toBe(43);
    expect(getUsfmBookByCode('TOB')).toBeUndefined();
  });

  it('skips Paratext file number 40, which is reserved for deuterocanon', () => {
    expect(usfmFileName(getUsfmBookByNumber(39)!)).toBe('39-MAL.usfm');
    expect(usfmFileName(getUsfmBookByNumber(40)!)).toBe('41-MAT.usfm');
    expect(usfmFileName(getUsfmBookByNumber(66)!)).toBe('67-REV.usfm');
  });
});

describe('word tokenization', () => {
  it('uses the canonical splitVerseWords definition', () => {
    expect(splitVerseWords('  The  LORD is\tmy shepherd ')).toEqual(['The', 'LORD', 'is', 'my', 'shepherd']);
    expect(splitVerseWords('   ')).toEqual([]);
  });
});

describe('renderVerseTextAsUsfm', () => {
  it('renders the worked Psalm 23:1 example from the spec', () => {
    expect(renderVerseTextAsUsfm(PSALM_23_1.text, PSALM_23_1.formatting!.spans)).toBe(
      'The \\nd LORD\\nd* \\add is\\add* my shepherd; I shall not want.'
    );
  });

  it('emits nested spans outermost-first', () => {
    const rendered = renderVerseTextAsUsfm('one two three four', [
      { type: 'words_of_christ', start: 0, end: 3 },
      { type: 'emphasis', start: 1, end: 2 }
    ]);
    expect(rendered).toBe('\\wj one \\em two three\\em* four\\wj*');
  });

  it('nests supplied inside words_of_christ, the common real-world case', () => {
    const rendered = renderVerseTextAsUsfm('I am the way', [
      { type: 'words_of_christ', start: 0, end: 3 },
      { type: 'supplied', start: 2, end: 2 }
    ]);
    expect(rendered).toBe('\\wj I am \\add the\\add* way\\wj*');
  });

  it('splits markers rather than mis-nesting when spans partially overlap', () => {
    // \wj covers words 0-2 and \em covers 1-3: no nesting can express this, so
    // the renderer closes and re-opens to keep the output well formed.
    const rendered = renderVerseTextAsUsfm('a b c d', [
      { type: 'words_of_christ', start: 0, end: 2 },
      { type: 'emphasis', start: 1, end: 3 }
    ]);
    expect(rendered).toBe('\\wj a \\em b c\\em*\\wj* \\em d\\em*');
    // and it survives a parse without unbalanced markers
    expect(parseInlineUsfm(rendered).text).toBe('a b c d');
  });

  it('carries a single-verse quotation source as a bare x-ref attribute', () => {
    const rendered = renderVerseTextAsUsfm('a b c', [
      { type: 'quotation', start: 0, end: 2, ref_start: 23007014, ref_end: 23007014 }
    ]);
    expect(rendered).toBe('\\qt a b c|x-ref="23007014"\\qt*');
  });

  it('carries a multi-verse quotation source as an x-ref range', () => {
    // Heb 8:8-12 quotes Jer 31:31-34; a single verse id cannot express that.
    const rendered = renderVerseTextAsUsfm('a b c', [
      { type: 'quotation', start: 0, end: 2, ref_start: 24031031, ref_end: 24031034 }
    ]);
    expect(rendered).toBe('\\qt a b c|x-ref="24031031-24031034"\\qt*');
  });

  it('drops out-of-range spans and reports them', () => {
    const warnings: string[] = [];
    const rendered = renderVerseTextAsUsfm('a b', [{ type: 'emphasis', start: 0, end: 9 }], 1001001, (m) =>
      warnings.push(m)
    );
    expect(rendered).toBe('a b');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('falls outside');
  });

  it('drops span types it does not recognize but keeps the text', () => {
    // A future MINOR revision may add span types; a 2.0 consumer must tolerate them.
    const futureSpan = { type: 'future_thing', start: 0, end: 1 } as unknown as VerseSpan;
    const warnings: string[] = [];
    const rendered = renderVerseTextAsUsfm('a b', [futureSpan], 1001001, (m) => warnings.push(m));
    expect(rendered).toBe('a b');
    expect(warnings[0]).toContain('no USFM equivalent');
  });

  it('has a marker for every span type in the published vocabulary', () => {
    expect(Object.keys(SPAN_TYPE_TO_USFM_MARKER).sort()).toEqual([
      'divine_name',
      'emphasis',
      'musical_direction',
      'quotation',
      'supplied',
      'transliteration',
      'words_of_christ'
    ]);
  });

  it('derives its markers from the canonical SPAN_TYPE_USFM table', async () => {
    const { SPAN_TYPE_USFM } = await import('../Data/Text/VerseFormatting');
    for (const [type, marker] of Object.entries(SPAN_TYPE_USFM)) {
      expect(`\\${SPAN_TYPE_TO_USFM_MARKER[type]}`).toBe(marker);
    }
  });
});

describe('toUSFMBook', () => {
  it('emits a complete document with header, chapter and verse structure', () => {
    const doc = toUSFMBook([PSALM_23_1], {
      module: { abbreviation: 'KJV', fullName: 'King James Version' }
    });

    expect(doc.bookNumber).toBe(19);
    expect(doc.bookCode).toBe('PSA');
    expect(doc.fileName).toBe('19-PSA.usfm');
    expect(doc.usfm).toBe(
      [
        '\\id PSA KJV - King James Version',
        '\\ide UTF-8',
        '\\h Psalms',
        '\\mt1 Psalms',
        '\\c 23',
        '\\d A Psalm of David',
        '\\q1',
        '\\v 1 The \\nd LORD\\nd* \\add is\\add* my shepherd;',
        '\\q2 I shall not want.',
        ''
      ].join('\n')
    );
  });

  it('uses \\s for section headings and \\d for psalm titles', () => {
    const withSection = toUSFMBook([
      {
        verseId: 1001001,
        text: 'In the beginning God created the heaven and the earth.',
        formatting: { v: 1, block: { paragraph_start: true, heading: 'The Creation' } }
      }
    ]);
    expect(withSection.usfm).toContain('\\s The Creation');
    expect(withSection.usfm).not.toContain('\\d ');
  });

  it('supplies a paragraph marker when a chapter opens without one', () => {
    const doc = toUSFMBook([{ verseId: 1001001, text: 'In the beginning.' }]);
    expect(doc.usfm).toContain('\\c 1\n\\p\n\\v 1 In the beginning.');
  });

  it('separates poetic stanzas with \\b', () => {
    const doc = toUSFMBook([
      {
        verseId: 19001001,
        text: 'first line',
        formatting: { v: 1, block: { lines: [{ start: 0, end: 1, level: 1 }] } }
      },
      {
        verseId: 19001002,
        text: 'new stanza',
        formatting: {
          v: 1,
          block: { lines: [{ start: 0, end: 1, level: 1 }], paragraph_start: true }
        }
      }
    ]);
    expect(doc.usfm).toContain('\\v 1 first line\n\\b\n\\q1\n\\v 2 new stanza');
  });

  it('wraps the words a musical_direction span names', () => {
    const doc = toUSFMBook([
      {
        verseId: 19003002,
        text: 'many there be which say of my soul. Selah',
        formatting: { v: 1, spans: [{ type: 'musical_direction', start: 8, end: 8 }] }
      }
    ]);
    expect(doc.usfm).toContain('my soul. \\qs Selah\\qs*');
  });

  it('wraps a mid-verse musical direction, which a trailing-token flag could not', () => {
    // Ps 9:16 carries "Higgaion. Selah" inside the verse, not at its end.
    const doc = toUSFMBook([
      {
        verseId: 19009016,
        text: 'Higgaion. Selah the wicked is snared',
        formatting: { v: 1, spans: [{ type: 'musical_direction', start: 0, end: 1 }] }
      }
    ]);
    expect(doc.usfm).toContain('\\qs Higgaion. Selah\\qs* the wicked is snared');
  });

  it('clamps poetry levels above 3', () => {
    // Cast because `PoetryLevel` is `1 | 2 | 3` - a 9 cannot arrive through
    // typed code, but it can arrive from a module's stored JSON, which is
    // exactly the input this clamp exists for.
    const doc = toUSFMBook([{
      verseId: 19001001,
      text: 'deep',
      formatting: {
        v: 1,
        block: { lines: [{ start: 0, end: 0, level: 9 as unknown as PoetryLevel }] }
      },
    }]);
    expect(doc.usfm).toContain('\\q3');
  });

  it('breaks a verse across \\q markers, one per poetic line', () => {
    const doc = toUSFMBook([PSALM_23_1]);
    // The opening line's marker precedes \v; every later line carries its own.
    expect(doc.usfm).toContain(
      '\\q1\n\\v 1 The \\nd LORD\\nd* \\add is\\add* my shepherd;\n\\q2 I shall not want.'
    );
  });

  it('splits a span that straddles a line break, because USFM markers cannot cross one', () => {
    const doc = toUSFMBook([{
      verseId: 19023001,
      text: 'one two three four',
      formatting: {
        v: 1,
        block: { lines: [{ start: 0, end: 1, level: 1 }, { start: 2, end: 3, level: 2 }] },
        spans: [{ type: 'words_of_christ', start: 0, end: 3 }]
      }
    }]);
    expect(doc.usfm).toContain('\\v 1 \\wj one two\\wj*\n\\q2 \\wj three four\\wj*');
  });

  it('falls back to one line, and warns, when block.lines do not cover the verse', () => {
    const warnings: string[] = [];
    const doc = toUSFMBook([{
      verseId: 19023001,
      text: 'one two three',
      formatting: { v: 1, block: { lines: [{ start: 0, end: 0, level: 1 }, { start: 1, end: 1, level: 2 }] } }
    }], { onWarning: m => warnings.push(m) });
    expect(doc.usfm).toContain('\\v 1 one two three');
    expect(warnings[0]).toContain('do not cover');
  });

  it('sorts verses by verse id regardless of input order', () => {
    const doc = toUSFMBook([
      { verseId: 43003017, text: 'second' },
      { verseId: 43003016, text: 'first' }
    ]);
    const firstIndex = doc.usfm.indexOf('\\v 16');
    const secondIndex = doc.usfm.indexOf('\\v 17');
    expect(firstIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it('emits one \\c per chapter', () => {
    const doc = toUSFMBook([
      { verseId: 43003016, text: 'a' },
      { verseId: 43003017, text: 'b' },
      { verseId: 43004001, text: 'c' }
    ]);
    expect(doc.usfm.match(/\\c \d+/gu)).toEqual(['\\c 3', '\\c 4']);
  });

  it('honours the module copyright remark and title options', () => {
    const doc = toUSFMBook([{ verseId: 1001001, text: 'x' }], {
      module: { abbreviation: 'KJV', copyright: 'Public\n Domain' },
      includeCopyrightRemark: true,
      includeMainTitle: false,
      includeEncodingLine: false
    });
    expect(doc.usfm).toContain('\\rem Public Domain');
    expect(doc.usfm).not.toContain('\\mt1');
    expect(doc.usfm).not.toContain('\\ide');
  });

  it('accepts custom book names', () => {
    const doc = toUSFMBook([{ verseId: 43003016, text: 'x' }], { bookNames: new Map([[43, 'Juan']]) });
    expect(doc.usfm).toContain('\\h Juan');
    expect(doc.bookName).toBe('Juan');
  });

  it('strips backslashes, which USFM cannot represent', () => {
    const warnings: string[] = [];
    const doc = toUSFMBook([{ verseId: 1001001, text: 'a \\par b' }], { onWarning: (m) => warnings.push(m) });
    expect(doc.usfm).toContain('\\v 1 a par b');
    expect(warnings[0]).toContain('backslash');
  });

  it('rejects an empty verse list', () => {
    expect(() => toUSFMBook([])).toThrow(UsfmExportError);
  });

  it('rejects verses from more than one book', () => {
    expect(() => toUSFMBook([{ verseId: 1001001, text: 'a' }, { verseId: 43003016, text: 'b' }])).toThrow(
      /single book/u
    );
  });

  it('rejects book numbers outside the canon', () => {
    expect(() => toUSFMBook([{ verseId: 67001001, text: 'a' }])).toThrow(/outside the 66-book canon/u);
  });
});

describe('toUSFM', () => {
  it('produces one document per book, in canonical order', () => {
    const docs = toUSFM([JOHN_3_16, PSALM_23_1, MATT_1_23]);
    expect(docs.map((d) => d.bookCode)).toEqual(['PSA', 'MAT', 'JHN']);
    expect(docs.map((d) => d.fileName)).toEqual(['19-PSA.usfm', '41-MAT.usfm', '44-JHN.usfm']);
  });

  it('returns nothing for no input', () => {
    expect(toUSFM([])).toEqual([]);
  });

  it('honours a custom line ending', () => {
    const [doc] = toUSFM([{ verseId: 1001001, text: 'x' }], { lineEnding: '\r\n' });
    expect(doc!.usfm).toContain('\r\n');
  });
});

describe('parseInlineUsfm', () => {
  it('recovers word spans from character markers', () => {
    expect(parseInlineUsfm('The \\nd LORD\\nd* \\add is\\add* my shepherd; I shall not want.')).toEqual({
      text: 'The LORD is my shepherd; I shall not want.',
      spans: [
        { type: 'divine_name', start: 1, end: 1 },
        { type: 'supplied', start: 2, end: 2 }
      ]
    });
  });

  it('reads \\qs back as a musical_direction span naming the exact words', () => {
    const parsed = parseInlineUsfm('He restoreth my soul. \\qs Selah\\qs*');
    expect(parsed.text).toBe('He restoreth my soul. Selah');
    expect(parsed.spans).toEqual([{ type: 'musical_direction', start: 4, end: 4 }]);
  });

  it('recovers nested spans', () => {
    expect(parseInlineUsfm('\\wj one \\em two three\\em* four\\wj*').spans).toEqual([
      { type: 'words_of_christ', start: 0, end: 3 },
      { type: 'emphasis', start: 1, end: 2 }
    ]);
  });

  it('recovers a bare quotation reference as a single-verse range', () => {
    expect(parseInlineUsfm('\\qt a b c|x-ref="23007014"\\qt*').spans).toEqual([
      { type: 'quotation', start: 0, end: 2, ref_start: 23007014, ref_end: 23007014 }
    ]);
  });

  it('recovers a ranged quotation reference', () => {
    expect(parseInlineUsfm('\\qt a b c|x-ref="24031031-24031034"\\qt*').spans).toEqual([
      { type: 'quotation', start: 0, end: 2, ref_start: 24031031, ref_end: 24031034 }
    ]);
  });

  it('ignores markers with no span equivalent', () => {
    const parsed = parseInlineUsfm('a \\bd bold\\bd* b');
    expect(parsed.text).toBe('a bold b');
    expect(parsed.spans).toEqual([]);
  });
});

describe('parseUSFM', () => {
  it('rejects a document with no \\id line', () => {
    expect(() => parseUSFM('\\c 1\n\\p\n\\v 1 text\n')).toThrow(UsfmParseError);
  });

  it('rejects an unknown book identifier', () => {
    expect(() => parseUSFM('\\id TOB\n\\c 1\n\\p\n\\v 1 text\n')).toThrow(/unrecognized USFM book identifier/u);
  });

  it('reads the book name from \\h', () => {
    expect(parseUSFM('\\id JHN\n\\h John\n\\c 3\n\\p\n\\v 16 text\n').bookName).toBe('John');
  });

  it('joins verse text that continues on the next line', () => {
    const doc = parseUSFM('\\id JHN\n\\c 3\n\\p\n\\v 16 For God\nso loved the world.\n');
    expect(doc.verses[0]!.text).toBe('For God so loved the world.');
  });
});

/**
 * The round trip the format's interoperability claim rests on.
 *
 * NOTE (Pass 1 gap): the plan asks for `import USFM -> regenerate module ->
 * export -> diff`. Module regeneration is deferred to
 * the in-memory half of that loop: rows + spans -> toUSFM() -> parseUSFM() ->
 * rows + spans. The regenerate leg is untested until
 */
describe('round trip: rows -> USFM -> rows', () => {
  const corpus: UsfmVerseInput[] = [
    PSALM_23_1,
    {
      verseId: 19023002,
      text: 'He maketh me to lie down in green pastures.',
      formatting: { v: 1, block: { lines: [{ start: 0, end: 8, level: 2 }] } }
    },
    {
      verseId: 19023003,
      text: 'He restoreth my soul. Selah',
      formatting: {
        v: 1,
        block: { lines: [{ start: 0, end: 4, level: 1 }], paragraph_start: true },
        spans: [{ type: 'musical_direction', start: 4, end: 4 }]
      }
    },
    {
      verseId: 19024001,
      text: 'The earth is the LORD’s, and the fulness thereof.',
      formatting: {
        v: 1,
        block: { paragraph_start: true, heading: 'The King of Glory' },
        spans: [
          { type: 'divine_name', start: 3, end: 3 },
          { type: 'transliteration', start: 7, end: 7 }
        ]
      }
    }
  ];

  it('preserves text, spans and block structure for a whole book', () => {
    const [doc] = toUSFM(corpus, { module: { abbreviation: 'KJV', fullName: 'King James Version' } });
    const parsed = parseUSFM(doc!.usfm);

    expect(parsed.bookNumber).toBe(19);
    expect(parsed.verses).toHaveLength(corpus.length);
    for (let i = 0; i < corpus.length; i++) {
      const original = corpus[i]!;
      const returned = parsed.verses[i]!;
      expect(returned.verseId).toBe(original.verseId);
      expect(returned.text).toBe(original.text);
      expect(returned.formatting).toEqual(normalize(original.formatting));
    }
  });

  it('preserves a prose chapter with words of Christ and a quotation reference', () => {
    const prose: UsfmVerseInput[] = [
      JOHN_3_16,
      {
        verseId: 43003017,
        text: 'For God sent not his Son into the world to condemn the world.',
        formatting: { v: 1, spans: [{ type: 'words_of_christ', start: 0, end: 11 }] }
      }
    ];
    const [doc] = toUSFM(prose);
    const parsed = parseUSFM(doc!.usfm);
    expect(parsed.verses.map((v) => v.text)).toEqual(prose.map((v) => v.text));
    expect(parsed.verses[0]!.formatting).toEqual(normalize(JOHN_3_16.formatting));
    expect(parsed.verses[1]!.formatting?.spans).toEqual([{ type: 'words_of_christ', start: 0, end: 11 }]);
  });

  it('preserves a quotation reference across the round trip', () => {
    const [doc] = toUSFM([MATT_1_23]);
    const parsed = parseUSFM(doc!.usfm);
    expect(parsed.verses[0]!.formatting?.spans).toEqual([
      { type: 'quotation', start: 0, end: 12, ref_start: 23007014, ref_end: 23007014 }
    ]);
  });

  it('is stable across a second export', () => {
    const [first] = toUSFM(corpus);
    const reparsed = parseUSFM(first!.usfm);
    const [second] = toUSFM(reparsed.verses, { bookNames: new Map([[19, first!.bookName]]) });
    expect(second!.usfm).toBe(first!.usfm);
  });

  it('documents the one asymmetry: a chapter-opening verse always gains paragraph_start', () => {
    // The exporter must emit a paragraph marker after \c for the document to be
    // valid USFM, so a chapter's first verse comes back with paragraph_start
    // even when the source row omitted it. Producers should set it explicitly.
    const [doc] = toUSFM([{ verseId: 45008028, text: 'And we know that all things work together for good.' }]);
    const parsed = parseUSFM(doc!.usfm);
    expect(parsed.verses[0]!.formatting).toEqual({ v: 1, block: { paragraph_start: true } });
  });
});

/**
 * The exporter normalizes a couple of optional block fields (a heading always
 * comes back with an explicit `heading_type`). Apply the same normalization to
 * the expected value so the comparison tests behaviour, not defaulting.
 */
function normalize(formatting: VerseFormatting | null | undefined): VerseFormatting | undefined {
  if (!formatting) {
    return undefined;
  }
  const block: VerseBlockWithHeadingKind | undefined = formatting.block === undefined
    ? undefined
    : {
        ...formatting.block,
        ...(formatting.block.heading !== undefined
          ? { heading_kind: (formatting.block as VerseBlockWithHeadingKind).heading_kind ?? 'section' }
          : {})
      };
  const spans = formatting.spans === undefined || formatting.spans.length === 0
    ? undefined
    : [...formatting.spans].sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));

  if (block !== undefined && spans !== undefined) {
    return { v: formatting.v, block, spans };
  }
  if (block !== undefined) {
    return { v: formatting.v, block };
  }
  if (spans !== undefined) {
    return { v: formatting.v, spans };
  }
  return { v: formatting.v };
}
