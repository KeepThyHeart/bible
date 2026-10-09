/**
 * Reading a payload that might be from a different day.
 *
 * The cases here are the ones that reach a screen in front of people: an older
 * bundle that does not know a field, a round the server built nothing for, a
 * reveal that has not arrived yet. None of them may throw, and none of them may
 * silently draw a question with no options as though it were a real one.
 */

import { describe, expect, it } from 'vitest';
import { BOOK_COUNT, BOOK_NAMES } from '../../../shared/verseId.js';
import { CHAPTER_COUNTS, chapterCount, chaptersOf } from './chapters.js';
import { indexForLetter, letterFor, readDetail, readQuestion } from './payload.js';

const QUESTION = {
  answerShape: 'choice',
  closeness: 'chapter',
  translation: 'KJV',
  text: 'For God so loved the world.',
  options: [
    { index: 0, label: 'John 3:16' },
    { index: 1, label: 'Romans 8:28' },
  ],
};

const DETAIL = {
  answerShape: 'choice',
  reference: 'John 3:16',
  text: 'For God so loved the world.',
  translation: 'KJV',
  options: [
    { label: 'John 3:16', distance: null, correct: true },
    { label: 'John 3:15', distance: 'chapter', correct: false },
  ],
  credit: { exact: 100, bookAndChapter: 70, book: 40 },
};

describe('reading a question', () => {
  it('reads one the server sent', () => {
    const question = readQuestion(QUESTION);

    expect(question?.answerShape).toBe('choice');
    expect(question?.closeness).toBe('chapter');
    expect(question?.options).toHaveLength(2);
    expect(question?.options[1]?.label).toBe('Romans 8:28');
  });

  it('refuses anything it cannot draw', () => {
    expect(readQuestion(null)).toBeNull();
    expect(readQuestion('a question')).toBeNull();
    expect(readQuestion({ text: 'no shape given' })).toBeNull();
    expect(readQuestion({ answerShape: 'choice' })).toBeNull();
    expect(readQuestion({ answerShape: 'order', text: 'a shape it does not have' })).toBeNull();
  });

  it('drops an option it cannot label rather than the whole question', () => {
    const question = readQuestion({ ...QUESTION, options: [{ index: 0 }, { label: 'Jude 4' }, 7] });

    expect(question).not.toBeNull();
    expect(question?.options).toEqual([]);
  });

  it('treats an unfamiliar closeness as the room default', () => {
    expect(readQuestion({ ...QUESTION, closeness: 'fiendish' })?.closeness).toBe('section');
  });

  it('reads a typed round as having no options', () => {
    const question = readQuestion({ ...QUESTION, answerShape: 'reference', options: [] });

    expect(question?.answerShape).toBe('reference');
    expect(question?.options).toEqual([]);
  });
});

describe('reading a reveal', () => {
  it('reads one the server sent', () => {
    const detail = readDetail(DETAIL);

    expect(detail?.reference).toBe('John 3:16');
    expect(detail?.options[1]?.distance).toBe('chapter');
    expect(detail?.credit.bookAndChapter).toBe(70);
  });

  it('refuses one with no reference in it', () => {
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ ...DETAIL, reference: '' })).toBeNull();
    expect(readDetail({ ...DETAIL, answerShape: undefined })).toBeNull();
  });

  it('fills in what an older server did not send', () => {
    const detail = readDetail({ answerShape: 'reference', reference: 'Jude 4' });

    expect(detail?.options).toEqual([]);
    expect(detail?.text).toBe('');
    expect(detail?.credit).toEqual({ exact: 0, bookAndChapter: 0, book: 0 });
  });

  it('letters the options so a host can say them aloud', () => {
    expect(letterFor(0)).toBe('A');
    expect(letterFor(3)).toBe('D');
    expect(letterFor(9)).toBe('10');
  });

  it('reads a letter back to the index it names, either case', () => {
    expect(indexForLetter('a')).toBe(0);
    expect(indexForLetter('D')).toBe(3);
    expect(indexForLetter('b')).toBe(1);
  });

  it('reads nothing from a key that names no option', () => {
    expect(indexForLetter('g')).toBeNull();
    expect(indexForLetter('1')).toBeNull();
    expect(indexForLetter('Enter')).toBeNull();
    expect(indexForLetter('')).toBeNull();
  });
});

describe('what the picker may offer', () => {
  it('has a count for every book', () => {
    expect(CHAPTER_COUNTS).toHaveLength(BOOK_COUNT);
    expect(CHAPTER_COUNTS).toHaveLength(BOOK_NAMES.length);
    expect(CHAPTER_COUNTS.reduce((total, count) => total + count, 0)).toBe(1189);
  });

  it('knows the books that are one chapter long', () => {
    for (const book of [31, 57, 63, 64, 65]) {
      expect(chapterCount(book), BOOK_NAMES[book - 1]).toBe(1);
    }
    expect(chaptersOf(65)).toEqual([1]);
  });

  it('knows the long ones', () => {
    expect(chapterCount(19)).toBe(150);
    expect(chapterCount(1)).toBe(50);
    expect(chapterCount(66)).toBe(22);
    expect(chaptersOf(1)).toHaveLength(50);
  });

  it('offers a single chapter for a book number that is not in the canon', () => {
    expect(chapterCount(0)).toBe(1);
    expect(chapterCount(67)).toBe(1);
    expect(chapterCount(1.5)).toBe(1);
  });
});
