/**
 * Input classification, one test per input form.
 *
 * The rows that matter most are the ones that
 * must NOT parse as a reference: the whole design rests on "if it does not
 * parse, it is a search", and a parser that is too eager silently swallows
 * searches.
 */
import { describe, expect, test } from 'bun:test';

import { type InputContext, type Intent, classifyInput } from './input';

/** Reading John 3. */
const IN_JOHN_3: InputContext = { book: 43, chapter: 3 };

const classify = (text: string, context: InputContext = IN_JOHN_3): Intent =>
  classifyInput(text, context);

const reference = (text: string, context: InputContext = IN_JOHN_3) => {
  const intent = classify(text, context);
  if (intent.kind !== 'reference') {
    throw new Error(`expected a reference for ${JSON.stringify(text)}, got ${intent.kind}`);
  }
  return intent.reference;
};

describe('context-relative references', () => {
  test('`16` is verse 16 of the current chapter', () => {
    expect(reference('16')).toEqual({
      book: 43,
      chapter: 3,
      verse: 16,
      endChapter: undefined,
      endVerse: undefined,
    });
  });

  test('`16-17` is that range, in the current chapter', () => {
    const ref = reference('16-17');
    expect(ref).toMatchObject({ book: 43, chapter: 3, verse: 16, endVerse: 17 });
  });

  test('`3:16` is chapter 3 verse 16 of the current book', () => {
    expect(reference('3:16', { book: 43, chapter: 1 })).toMatchObject({
      book: 43,
      chapter: 3,
      verse: 16,
    });
  });

  test('`3:16-17` is that range, in the current book', () => {
    expect(reference('3:16-17')).toMatchObject({ chapter: 3, verse: 16, endVerse: 17 });
  });

  test('a cross-chapter range is understood', () => {
    expect(reference('3:16-4:2')).toMatchObject({
      chapter: 3,
      verse: 16,
      endChapter: 4,
      endVerse: 2,
    });
  });

  test('a bare number is a verse, not a chapter', () => {
    // Deliberate: otherwise `23` in Psalms is ambiguous
    // with no way for the user to say which was meant.
    const ref = reference('23', { book: 19, chapter: 119 });
    expect(ref.chapter).toBe(119);
    expect(ref.verse).toBe(23);
  });

  test('surrounding whitespace does not matter', () => {
    expect(reference('  3:16  ')).toMatchObject({ chapter: 3, verse: 16 });
  });
});

describe('references naming a book', () => {
  test('the long, short and space-separated spellings all resolve', () => {
    for (const text of ['john 3:16', 'joh 3:16', 'John 3:16']) {
      expect(reference(text)).toMatchObject({ book: 43, chapter: 3, verse: 16 });
    }
  });

  test('numbered books work, with or without the space', () => {
    expect(reference('1co 13')).toMatchObject({ book: 46, chapter: 13 });
    expect(reference('2 sam 7')).toMatchObject({ book: 10, chapter: 7 });
  });

  test('a reference in another book overrides the current one', () => {
    expect(reference('gen 1:1').book).toBe(1);
  });
});

describe('anything that is not a reference is a search', () => {
  test('a phrase of ordinary words', () => {
    const intent = classify('everlasting life');
    expect(intent).toEqual({ kind: 'search', query: 'everlasting life', forced: false });
  });

  test('a quoted phrase is passed through for the search parser to handle', () => {
    expect(classify('"still small voice"')).toMatchObject({
      kind: 'search',
      query: '"still small voice"',
    });
  });

  test('a boolean query', () => {
    expect(classify('faith AND works')).toMatchObject({
      kind: 'search',
      query: 'faith AND works',
    });
  });

  test('a single word that is not a book name', () => {
    expect(classify('mercy').kind).toBe('search');
  });
});

describe('the slash forces a search', () => {
  test('text that would otherwise be a reference is searched instead', () => {
    // Its only purpose.
    expect(classify('john 3').kind).toBe('reference');
    expect(classify('/john 3')).toEqual({ kind: 'search', query: 'john 3', forced: true });
  });

  test('the slash is stripped and the remainder trimmed', () => {
    expect(classify('/  mercy  ')).toMatchObject({ query: 'mercy', forced: true });
  });
});

describe('movement', () => {
  test('`<` and `>` step by the unit being read', () => {
    expect(classify('<')).toEqual({ kind: 'step-unit', delta: -1 });
    expect(classify('>')).toEqual({ kind: 'step-unit', delta: 1 });
  });

  test('`+5` and `-5` move by verses', () => {
    expect(classify('+5')).toEqual({ kind: 'step-verse', delta: 5 });
    expect(classify('-5')).toEqual({ kind: 'step-verse', delta: -5 });
  });

  test('a step is not confused with a range', () => {
    expect(classify('-5').kind).toBe('step-verse');
    expect(classify('5-7').kind).toBe('reference');
  });
});

describe('edge cases', () => {
  test('empty input is not a search for nothing', () => {
    expect(classify('')).toEqual({ kind: 'empty' });
    expect(classify('    ')).toEqual({ kind: 'empty' });
  });

  test('a whole-chapter reference has no verse', () => {
    const ref = reference('john 3');
    expect(ref.chapter).toBe(3);
    expect(ref.verse).toBeUndefined();
  });

  test('a bare book name is a search, not a whole-book reference', () => {
    // `allowWholeBook` is deliberately not passed: someone typing "John" in a
    // box that also searches is looking for the word.
    expect(classify('john').kind).toBe('search');
  });

});

describe('two-letter abbreviations', () => {
  test('`jo 3:16` reaches John, not Joshua', () => {
    // Without an exact alias this fuzzy-matches to Joshua (book 6) and moves
    // the user to Joshua 3:16 without a word. Silent wrong navigation is the
    // one failure a single input line cannot afford.
    expect(reference('jo 3:16')).toMatchObject({ book: 43, chapter: 3, verse: 16 });
  });

  test('the abbreviations core already carries still work', () => {
    // Core's table has 65 two-character keys; they resolve exactly, so almost
    // nothing needs adding on this side.
    expect(reference('jn 3:16').book).toBe(43);
    expect(reference('mt 5:3').book).toBe(40);
    expect(reference('mk 1:1').book).toBe(41);
    expect(reference('lk 2:7').book).toBe(42);
    expect(reference('ps 23').book).toBe(19);
    expect(reference('rm 8:28').book).toBe(45);
  });

  test('a two-letter form that is only a fuzzy guess becomes a search', () => {
    // Two characters carry too little signal to correct a typo with, so a
    // guess is refused rather than acted on. Being wrong in the search results
    // costs the user a glance; being moved to the wrong book costs more.
    expect(classify('zz 3:16').kind).toBe('search');
  });

  test('longer names may still be fuzzy-matched', () => {
    // The guard is about two characters, not about fuzzy matching in general.
    expect(reference('jhn 3:16').book).toBe(43);
  });
});
