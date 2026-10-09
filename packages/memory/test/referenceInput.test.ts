/**
 * `extractReferenceCandidates` and `dropContainedRanges` are pure, DOM-free
 * logic - see `src/ui/referenceInput.ts` - so they get their own suite here
 * rather than only being exercised indirectly through `panelRender.test.ts`'s
 * paste tests.
 */
import { describe, expect, it } from 'vitest';
import { dropContainedRanges, extractReferenceCandidates } from '../src/ui/referenceInput';

describe('extractReferenceCandidates', () => {
  it('treats a clean one-per-line list as one candidate per line, unchanged', () => {
    expect(extractReferenceCandidates('John 3:16\nRomans 8:28\nPsalm 23:1-6')).toEqual([
      'John 3:16',
      'Romans 8:28',
      'Psalm 23:1-6',
    ]);
  });

  it('finds several references sprinkled through one line of prose', () => {
    // The follow-up review round's own example: "lots of text with random
    // verse references sprinkled in", not a clean list.
    const text = 'Check out John 3:16, and also Romans 8:28 - so good! Maybe Psalm 23:1-6 too.';
    expect(extractReferenceCandidates(text)).toEqual(['John 3:16', 'Romans 8:28', 'Psalm 23:1-6']);
  });

  it('finds a numbered book, a bare chapter, and the two-word "Song of Solomon"', () => {
    const text = '1 Corinthians 13:4-7\nJohn 3\nSong of Solomon 2:1';
    expect(extractReferenceCandidates(text)).toEqual(['1 Corinthians 13:4-7', 'John 3', 'Song of Solomon 2:1']);
  });

  it('passes an unrecognised line through whole, letting the worker have the final say', () => {
    // "Jn 3.16" does not match the reference shape (a period, not a colon),
    // but this module is not the parser - see the file header - so it still
    // reaches the worker as its own candidate rather than being dropped.
    expect(extractReferenceCandidates('Jn 3.16')).toEqual(['Jn 3.16']);
  });

  it('drops an exact repeat, case-insensitively, keeping the first spelling', () => {
    expect(extractReferenceCandidates('John 3:16\njohn 3:16\nJOHN 3:16')).toEqual(['John 3:16']);
  });

  it('ignores blank lines', () => {
    expect(extractReferenceCandidates('John 3:16\n\n\nRomans 8:28\n')).toEqual(['John 3:16', 'Romans 8:28']);
  });

  it('does not mistake an ordinary capitalised word for a book unless a chapter number follows', () => {
    // "Also Romans 8:28": "Also" alone is not followed by a number, so it is
    // never treated as part of the book name - the engine moves on to
    // "Romans 8:28", which is.
    expect(extractReferenceCandidates('Also Romans 8:28 is good')).toEqual(['Romans 8:28']);
  });
});

describe('dropContainedRanges', () => {
  function range(startVerseId: number, endVerseId: number, extra: Record<string, unknown> = {}) {
    return { startVerseId, endVerseId, ...extra };
  }

  it('drops a single verse wholly inside a wider range from the same batch', () => {
    // "if John 3:16-17 is in there, John 3:16 separately should be ignored"
    const wide = range(43003016, 43003017, { reference: 'John 3:16-17' });
    const narrow = range(43003016, 43003016, { reference: 'John 3:16' });

    const { kept, dropped } = dropContainedRanges([wide, narrow]);
    expect(kept).toEqual([wide]);
    expect(dropped).toEqual([narrow]);
  });

  it('keeps non-overlapping ranges as they are, in their original order', () => {
    const a = range(1, 2);
    const b = range(100, 101);
    const { kept, dropped } = dropContainedRanges([a, b]);
    expect(kept).toEqual([a, b]);
    expect(dropped).toEqual([]);
  });

  it('is order-independent about which one is the wider range', () => {
    const narrow = range(10, 10);
    const wide = range(9, 12);
    const { kept, dropped } = dropContainedRanges([narrow, wide]);
    expect(kept).toEqual([wide]);
    expect(dropped).toEqual([narrow]);
  });

  it('keeps only the first of two identical ranges', () => {
    const first = range(5, 6, { tag: 'first' });
    const second = range(5, 6, { tag: 'second' });
    const { kept, dropped } = dropContainedRanges([first, second]);
    expect(kept).toEqual([first]);
    expect(dropped).toEqual([second]);
  });

  it('never touches an item that is not in the batch at all', () => {
    // Containment is only ever checked within the array passed in - a passage
    // already in the plan before this paste is never a candidate, because it
    // never appears here.
    const onlyItem = range(1, 100);
    const { kept, dropped } = dropContainedRanges([onlyItem]);
    expect(kept).toEqual([onlyItem]);
    expect(dropped).toEqual([]);
  });
});
