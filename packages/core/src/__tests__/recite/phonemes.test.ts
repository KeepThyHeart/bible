import { createPronouncer, letterToSound } from '../../recite/phonemes';
import { phonemeDistance, phoneticSimilarity } from '../../recite/phonemeDistance';
import { PHONEME_TABLE } from '../../recite/lang/enTables';
import { englishKit } from '../../recite/lang/en';

describe('letterToSound', () => {
  it.each([
    ['cat', 'K AE T'],
    ['dog', 'D AA G'],
    ['shake', 'SH EY K'],
    ['phone', 'F OW N'],
    ['knight', 'N AY T'],
    ['write', 'R AY T'],
    ['wrong', 'R AA NG'],
    ['gentle', 'JH EH N T AH L'],
    ['nation', 'N AE SH AH N'],
    ['mission', 'M IH SH AH N'],
    ['city', 'S IH T IY'],
    ['gem', 'JH EH M'],
    ['quick', 'K W IH K'],
    ['thumb', 'TH AH M'],
    ['hands', 'HH AE N D Z'],
    ['helped', 'HH EH L P T'],
    ['stone', 'S T OW N'],
    ['nine', 'N AY N'],
    ['running', 'R AH N IH NG'],
    ['happy', 'HH AE P IY'],
    ['my', 'M AY'],
    ['fly', 'F L AY'],
    ['mercy', 'M ER S IY'],
    ['named', 'N AE M D'],
    ['church', 'CH ER CH'],
    ['lamb', 'L AE M'],
    ['hearing', 'HH IY R IH NG'],
    ['praises', 'P R EY S IH Z'],
    ['believeth', 'B EH L IY V EH TH'],
    ['he', 'HH IY'],
  ])('%s -> %s', (word, ph) => {
    expect(letterToSound(word).join(' ')).toBe(ph);
  });

  it('ignores case and punctuation, empty gives empty', () => {
    expect(letterToSound("Don't")).toEqual(letterToSound('dont'));
    expect(letterToSound('')).toEqual([]);
  });
});

describe('createPronouncer', () => {
  const p = createPronouncer(PHONEME_TABLE);
  it('prefers the lexicon over letter rules', () => {
    expect(p.phonemes('the').join(' ')).toBe('DH AH');
    expect(p.phonemes('Jesus').join(' ')).toBe('JH IY Z AH S');
    expect(p.phonemes('thou').join(' ')).not.toBe(letterToSound('thou').join(' '));
  });
  it('falls back to letter rules', () => {
    expect(p.phonemes('cat')).toEqual(letterToSound('cat'));
    expect(p.phonemes('constructor')).toEqual(letterToSound('constructor'));
  });
  it('has a lexicon of roughly three hundred words or more', () => {
    expect(Object.keys(PHONEME_TABLE).length).toBeGreaterThanOrEqual(300);
  });
  it('is shared by the english kit', () => {
    expect(englishKit.pronouncer.phonemes('hath').join(' ')).toBe('HH AE TH');
  });
});

describe('phonemeDistance', () => {
  const d = phonemeDistance;
  it('is zero for equal sequences and symmetric', () => {
    expect(d(['K', 'AE', 'T'], ['K', 'AE', 'T'])).toBe(0);
    expect(d(['K', 'AE', 'T'], ['K', 'AA', 'T'])).toBe(d(['K', 'AA', 'T'], ['K', 'AE', 'T']));
  });
  it('close vowels are cheaper than other vowels, which beat unrelated consonants', () => {
    const close = d(['B', 'IH', 'T'], ['B', 'IY', 'T']);
    const vowel = d(['B', 'IH', 'T'], ['B', 'AW', 'T']);
    const cons = d(['B', 'IH', 'T'], ['B', 'IH', 'K']);
    expect(close).toBeCloseTo(0.15);
    expect(close).toBeLessThan(vowel);
    expect(vowel).toBeLessThan(cons);
  });
  it('voicing pairs cost 0.3, nasals 0.4, other 1', () => {
    expect(d(['P'], ['B'])).toBeCloseTo(0.3);
    expect(d(['M'], ['NG'])).toBeCloseTo(0.4);
    expect(d(['P'], ['L'])).toBe(1);
    expect(d(['AH'], ['P'])).toBe(1);
  });
  it('cheap indels for AH, ER and final S/Z', () => {
    expect(d(['K', 'AE', 'T'], ['K', 'AE', 'T', 'S'])).toBeCloseTo(0.5);
    expect(d(['K', 'AE', 'T'], ['K', 'AE', 'T', 'AH'])).toBeCloseTo(0.5);
    expect(d(['K', 'AE', 'T'], ['K', 'AE', 'T', 'P'])).toBe(1);
    expect(d(['S', 'AE', 'T'], ['AE', 'T'])).toBe(1);
  });
  it('handles empties', () => {
    expect(d([], [])).toBe(0);
    expect(d([], ['T', 'K'])).toBe(2);
  });
});

describe('phoneticSimilarity', () => {
  it('is 1 for identical, 1 for both empty, 0 for disjoint', () => {
    expect(phoneticSimilarity(['K', 'AE', 'T'], ['K', 'AE', 'T'])).toBe(1);
    expect(phoneticSimilarity([], [])).toBe(1);
    expect(phoneticSimilarity(['K', 'L', 'T'], ['P', 'R', 'M'])).toBe(0);
  });
  it('ranks believeth near believes, far from mountain', () => {
    const pr = englishKit.pronouncer;
    const near = phoneticSimilarity(pr.phonemes('believeth'), pr.phonemes('believes'));
    const far = phoneticSimilarity(pr.phonemes('believeth'), pr.phonemes('mountain'));
    expect(near).toBeGreaterThan(0.75);
    expect(far).toBeLessThan(near);
  });
});
