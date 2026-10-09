/**
 * Reading a payload that might be from a different day.
 *
 * The cases here are the ones that reach a screen in front of people: an older
 * bundle that does not know a field, a round the server had nothing to ask, a
 * reveal that has not arrived yet. None of them may throw, and none of them may
 * draw a question with no names to tap as though it were a real one.
 */

import { describe, expect, it } from 'vitest';
import { citation, letterFor, readDetail, readQuestion } from './payload.js';

const QUESTION = {
  quote: 'Am I my brother’s keeper?',
  options: [
    { index: 0, label: 'Abel' },
    { index: 1, label: 'Cain' },
    { index: 2, label: 'Seth' },
    { index: 3, label: 'Noah' },
  ],
};

const DETAIL = {
  speaker: 'Cain',
  quote: 'Am I my brother’s keeper?',
  reference: 'Genesis 4:9',
  listener: 'God',
  text: 'And the LORD said unto Cain, Where is Abel thy brother?',
  translation: 'KJV',
  options: [
    { label: 'Abel', correct: false },
    { label: 'Cain', correct: true },
  ],
};

describe('reading a question', () => {
  it('reads one the server sent', () => {
    const question = readQuestion(QUESTION);

    expect(question?.quote).toBe('Am I my brother’s keeper?');
    expect(question?.options).toHaveLength(4);
    expect(question?.options[1]?.label).toBe('Cain');
  });

  it('refuses anything it cannot draw', () => {
    expect(readQuestion(null)).toBeNull();
    expect(readQuestion('a question')).toBeNull();
    expect(readQuestion({ options: QUESTION.options })).toBeNull();
    expect(readQuestion({ ...QUESTION, quote: '   ' })).toBeNull();
  });

  it('drops a name it cannot read rather than the whole question', () => {
    const question = readQuestion({ ...QUESTION, options: [{ index: 0 }, { index: 1, label: 'Cain' }, 7] });

    expect(question?.options).toEqual([{ index: 1, label: 'Cain' }]);
  });

  it('refuses a question with no names left to tap', () => {
    expect(readQuestion({ ...QUESTION, options: [] })).toBeNull();
    expect(readQuestion({ ...QUESTION, options: [{ label: 'no index' }] })).toBeNull();
  });
});

describe('reading a reveal', () => {
  it('reads one the server sent', () => {
    const detail = readDetail(DETAIL);

    expect(detail?.speaker).toBe('Cain');
    expect(detail?.listener).toBe('God');
    expect(detail?.options[1]?.correct).toBe(true);
  });

  it('refuses one with nobody named as the speaker', () => {
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ ...DETAIL, speaker: '' })).toBeNull();
    expect(readDetail({ ...DETAIL, speaker: undefined })).toBeNull();
  });

  it('fills in what an older server did not send', () => {
    const detail = readDetail({ speaker: 'Cain' });

    expect(detail).toEqual({
      speaker: 'Cain',
      quote: '',
      reference: '',
      listener: null,
      text: '',
      translation: '',
      options: [],
    });
  });

  it('treats an empty listener as none', () => {
    expect(readDetail({ ...DETAIL, listener: '' })?.listener).toBeNull();
  });
});

describe('the small things both screens share', () => {
  it('letters the names so a host can say them aloud', () => {
    expect(letterFor(0)).toBe('A');
    expect(letterFor(3)).toBe('D');
    expect(letterFor(9)).toBe('10');
  });

  it('cites the verse with whatever half of the citation it has', () => {
    const detail = readDetail(DETAIL);
    if (detail === null) throw new Error('the fixture should read');

    expect(citation(detail)).toBe('Genesis 4:9 · KJV');
    expect(citation({ ...detail, translation: '' })).toBe('Genesis 4:9');
    expect(citation({ ...detail, reference: '', translation: '' })).toBe('');
  });
});
