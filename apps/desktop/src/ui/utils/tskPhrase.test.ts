/**
 * TSK stores a group's keyword and any editorial remark about it in one column,
 * run together with no delimiter. Study mode prints the keyword inline in bold,
 * so an unsplit phrase would land in the reading flow looking like corrupted
 * data. These cases are taken from `xref_tsk.db` itself.
 */
import { describe, it, expect } from 'vitest';
import { splitTskPhrase, tskPhraseAside, tskPhraseKeyword } from './tskPhrase';

describe('splitTskPhrase', () => {
  it('leaves a bare keyword alone', () => {
    expect(splitTskPhrase('Yea.')).toEqual({ keyword: 'Yea.', aside: null });
    expect(splitTskPhrase('hath God said')).toEqual({ keyword: 'hath God said', aside: null });
  });

  it('splits a period immediately followed by a capital', () => {
    const { keyword, aside } = splitTskPhrase(
      'locusts.The word {arbeh,} Locust, is derived from {ravah,} to multiply.'
    );
    expect(keyword).toBe('locusts');
    expect(aside).toBe('The word {arbeh,} Locust, is derived from {ravah,} to multiply.');
  });

  it('splits a period followed by two or more spaces', () => {
    const { keyword, aside } = splitTskPhrase('thou mayest freely eat.  Heb. eating thou shalt eat.');
    expect(keyword).toBe('thou mayest freely eat');
    expect(aside).toBe('Heb. eating thou shalt eat.');
  });

  it('does not split a short phrase, however it is punctuated', () => {
    // Under the length floor: a period here is the keyword's own terminator,
    // not the start of a remark.
    expect(splitTskPhrase('A.D. 33.')).toEqual({ keyword: 'A.D. 33.', aside: null });
  });

  it('does not split when the candidate aside is a scrap of punctuation', () => {
    // Long enough to consider, but nothing substantial follows the period.
    const phrase = 'a phrase long enough to consider splitting.Ok';
    expect(splitTskPhrase(phrase)).toEqual({ keyword: phrase, aside: null });
  });

  it('never splits inside the first few characters', () => {
    // "Dr." would otherwise be shaved off the front of its own keyword.
    const { keyword } = splitTskPhrase('Dr. Lightfoot observes that this is the true reading here.');
    expect(keyword.startsWith('Dr.')).toBe(true);
  });
});

describe('display helpers', () => {
  it('trims the trailing period TSK puts on nearly every phrase', () => {
    // The renderer supplies its own punctuation; keeping TSK's gives "Yea..".
    expect(tskPhraseKeyword('Yea.')).toBe('Yea');
    expect(tskPhraseKeyword('locusts.The word {arbeh,} Locust, is derived from {ravah,}.')).toBe('locusts');
  });

  it('returns the aside separately, or null when there is none', () => {
    expect(tskPhraseAside('Yea.')).toBeNull();
    expect(tskPhraseAside('thou mayest freely eat.  Heb. eating thou shalt eat.')).toBe(
      'Heb. eating thou shalt eat'
    );
  });
});
