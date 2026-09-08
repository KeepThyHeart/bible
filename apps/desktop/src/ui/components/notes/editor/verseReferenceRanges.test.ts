/**
 * Pure tests for verse-reference range extraction.
 *
 * No editor, no DOM, no events: documents are built straight from the TipTap
 * schema, so these run fast and cover the offset arithmetic that every
 * downstream feature (right-click expansion, caret preview, Tab) depends on.
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  findVerseReferenceRanges,
  findRangeContainingPos,
  findRangeEndingAt,
  findRangeAtCaret,
} from './verseReferenceRanges';

const schema = getSchema([StarterKit]);

/** A doc of one paragraph per string. */
function doc(...paragraphs: string[]): ProseMirrorNode {
  return schema.node(
    'doc',
    null,
    paragraphs.map(text =>
      schema.node('paragraph', null, text.length > 0 ? [schema.text(text)] : []),
    ),
  );
}

/** The text a range actually covers, read back out of the document. */
function slice(d: ProseMirrorNode, from: number, to: number): string {
  return d.textBetween(from, to);
}

describe('findVerseReferenceRanges', () => {
  it('finds a single reference and reports the exact document range', () => {
    const d = doc('See John 3:16 today');
    const ranges = findVerseReferenceRanges(d);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].text).toBe('John 3:16');
    expect(slice(d, ranges[0].from, ranges[0].to)).toBe('John 3:16');
    expect(ranges[0].ref).toMatchObject({ book: 43, chapter: 3, verse: 16 });
  });

  it('finds two references in one paragraph at distinct offsets', () => {
    const d = doc('Compare John 3:16 with Romans 8:28 here');
    const ranges = findVerseReferenceRanges(d);

    expect(ranges.map(r => r.text)).toEqual(['John 3:16', 'Romans 8:28']);
    expect(slice(d, ranges[0].from, ranges[0].to)).toBe('John 3:16');
    expect(slice(d, ranges[1].from, ranges[1].to)).toBe('Romans 8:28');
    expect(ranges[1].from).toBeGreaterThan(ranges[0].to);
  });

  it('accounts for block offsets across paragraphs', () => {
    // The second paragraph's text starts well past the first's - this is the
    // case that breaks if `pos + match.start` is ever replaced with a
    // document-wide character offset.
    const d = doc('First John 3:16 here', 'Then Romans 8:28 there');
    const ranges = findVerseReferenceRanges(d);

    expect(ranges).toHaveLength(2);
    expect(slice(d, ranges[0].from, ranges[0].to)).toBe('John 3:16');
    expect(slice(d, ranges[1].from, ranges[1].to)).toBe('Romans 8:28');
  });

  it('does not detect a reference broken by a mark boundary', () => {
    // `John **3**:16` is three text nodes, so scanText never sees the whole
    // reference. This is deliberate, not a bug to fix: because every range is
    // guaranteed to sit inside one text node, a replacement over [from, to)
    // can never straddle a node boundary.
    const d = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('See John '),
        schema.text('3', [schema.marks.bold.create()]),
        schema.text(':16 today'),
      ]),
    ]);

    expect(findVerseReferenceRanges(d)).toHaveLength(0);
  });

  it('trims the leading comma off a comma-continuation range', () => {
    // scanText emits "John 3:16" plus a second match covering ", 17".
    // Underlining (and later replacing) the comma would be wrong.
    const d = doc('Read John 3:16, 17 tonight');
    const ranges = findVerseReferenceRanges(d);

    expect(ranges).toHaveLength(2);
    expect(ranges[0].text).toBe('John 3:16');
    expect(ranges[1].text).toBe('17');
    expect(slice(d, ranges[1].from, ranges[1].to)).toBe('17');
    expect(ranges[1].ref).toMatchObject({ book: 43, chapter: 3, verse: 17 });
  });

  it('normalises single-chapter books (Jude 5 is Jude 1:5)', () => {
    const ranges = findVerseReferenceRanges(doc('Jude 5 says'));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].ref).toMatchObject({ book: 65, chapter: 1, verse: 5 });
  });

  it('detects a numbered book', () => {
    const d = doc('in 1 John 3:16 we read');
    const ranges = findVerseReferenceRanges(d);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].text).toBe('1 John 3:16');
    expect(ranges[0].ref.book).toBe(62);
  });

  it('detects a numbered book preceded by a capitalised word', () => {
    // Was a real defect: the scan regex matches `[A-Z][a-z]+\s+\d+`, so "See 1"
    // was consumed as a candidate and the scan resumed *after* it, losing the
    // "1" - "See 1 John 3:16" was detected as John 3:16 (the wrong book), and
    // "Read 2 Timothy 1:7" was not detected at all. Fixed in
    // ReferenceParser.scanText by resuming one character past where a rejected
    // attempt started; covered there too.
    const seen = findVerseReferenceRanges(doc('See 1 John 3:16'));
    expect(seen.map(r => r.text)).toEqual(['1 John 3:16']);
    expect(seen[0].ref.book).toBe(62);

    const timothy = findVerseReferenceRanges(doc('Read 2 Timothy 1:7'));
    expect(timothy.map(r => r.text)).toEqual(['2 Timothy 1:7']);
    expect(timothy[0].ref.book).toBe(55);
  });

  it('detects a verse range and a cross-chapter range', () => {
    expect(findVerseReferenceRanges(doc('Romans 8:28-30'))[0].ref).toMatchObject({
      chapter: 8, verse: 28, endVerse: 30,
    });
    expect(findVerseReferenceRanges(doc('John 3:16-4:2'))[0].ref).toMatchObject({
      chapter: 3, verse: 16, endChapter: 4, endVerse: 2,
    });
  });

  it('detects a whole-chapter reference with no verse', () => {
    const ranges = findVerseReferenceRanges(doc('Psalms 119 is long'));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].ref.chapter).toBe(119);
    expect(ranges[0].ref.verse).toBeUndefined();
  });

  it('ignores a lowercase book name', () => {
    // The scan regex requires a capitalised book token, so prose like
    // "the john 3:16 of business" is left alone.
    expect(findVerseReferenceRanges(doc('see john 3:16 now'))).toHaveLength(0);
  });

  it('ignores a misspelled book name rather than fuzzy-correcting it', () => {
    // parse() alone would fuzzy-match "Jonh" to John; scanText rejects fuzzy
    // matches so running text like "Task 1" is not decorated.
    expect(findVerseReferenceRanges(doc('see Jonh 3:16 now'))).toHaveLength(0);
  });

  it('decorates a well-formed but non-existent reference', () => {
    // validate() checks shape, not existence. Genesis 99 is detected here and
    // has to be handled at fetch time instead.
    expect(findVerseReferenceRanges(doc('Genesis 99:1'))).toHaveLength(1);
  });

  it('returns nothing for an empty document', () => {
    expect(findVerseReferenceRanges(doc(''))).toHaveLength(0);
  });
});

describe('range lookup helpers', () => {
  const d = doc('See John 3:16 today');
  const ranges = findVerseReferenceRanges(d);
  const { from, to } = ranges[0];

  it('findRangeContainingPos matches inside and at the start, but not at the end', () => {
    expect(findRangeContainingPos(ranges, from)).toBe(ranges[0]);
    expect(findRangeContainingPos(ranges, from + 3)).toBe(ranges[0]);
    // `to` is the position *after* the last character - the caret there is
    // past the reference, which is exactly the Tab case, not the "inside" case.
    expect(findRangeContainingPos(ranges, to)).toBeNull();
    expect(findRangeContainingPos(ranges, from - 1)).toBeNull();
  });

  it('findRangeEndingAt matches only the exact end position', () => {
    expect(findRangeEndingAt(ranges, to)).toBe(ranges[0]);
    expect(findRangeEndingAt(ranges, to - 1)).toBeNull();
    expect(findRangeEndingAt(ranges, to + 1)).toBeNull();
  });

  it('findRangeAtCaret covers both inside and immediately-after', () => {
    expect(findRangeAtCaret(ranges, from + 2)).toBe(ranges[0]);
    expect(findRangeAtCaret(ranges, to)).toBe(ranges[0]);
    expect(findRangeAtCaret(ranges, to + 1)).toBeNull();
  });

  it('picks the right reference when several are present', () => {
    const multi = doc('Compare John 3:16 with Romans 8:28 here');
    const rs = findVerseReferenceRanges(multi);
    expect(findRangeAtCaret(rs, rs[1].to)).toBe(rs[1]);
    expect(findRangeContainingPos(rs, rs[0].from + 1)).toBe(rs[0]);
  });

  it('returns null against an empty range list', () => {
    expect(findRangeAtCaret([], 5)).toBeNull();
    expect(findRangeContainingPos([], 5)).toBeNull();
    expect(findRangeEndingAt([], 5)).toBeNull();
  });
});
