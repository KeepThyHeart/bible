import { describe, expect, it } from 'vitest';
import { kitFor } from '@bible/core/recite';
import type { VerseText } from '../src/core/types';
import { expectedFor, gradeRecitation, stripPunctuation } from '../src/core/recite/grade';
import { spokenReference } from '../src/core/recite/spokenReference';

const N = 25;
const kit = kitFor('en')!;

function verse(id: number, label: string, text: string): VerseText {
  return {
    verseId: id,
    label,
    words: text.split(' '),
    lines: null,
    psalmTitle: null,
    paragraphStart: false,
  };
}

const VERSES = [
  verse(19023001, '23:1', 'The LORD is my shepherd; I shall not want.'),
  verse(19023002, '23:2', 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.'),
];

const say = (t: string) => t.split(' ').map((w) => ({ text: w }));
const FULL =
  'the lord is my shepherd i shall not want he maketh me to lie down in green pastures he leadeth me beside the still waters';

describe('expectedFor', () => {
  it('flattens verses and records verse starts', () => {
    const e = expectedFor(VERSES);
    expect(e.words).toHaveLength(9 + 16);
    expect(e.verseStarts).toEqual([0, 9]);
  });
});

describe('gradeRecitation', () => {
  it('a perfect recitation scores 1 with all-correct detail', () => {
    const g = gradeRecitation(VERSES, say(FULL), new Set(), 'normal', kit);
    expect(g.result.score).toBe(1);
    expect(g.attempt).toEqual({ score: 1, correctFirst: N, totalSteps: N });
    expect(g.detail.verdicts).toBe('c'.repeat(N));
    expect(g.detail.credits).toEqual(new Array(N).fill(1));
    expect(g.detail.verseScores).toEqual([1, 1]);
    expect(g.detail.extras).toBe(0);
    expect(g.detail.strictness).toBe('normal');
    expect(g.missedQuote).toEqual([]);
  });

  it('a missed word lowers the score and is quoted without punctuation', () => {
    const g = gradeRecitation(VERSES, say(FULL.replace('shepherd ', '')), new Set(), 'normal', kit);
    expect(g.result.score).toBeLessThan(1);
    expect(g.detail.verdicts[4]).toBe('m');
    expect(g.missedQuote).toEqual(['shepherd']);
    expect(g.attempt.correctFirst).toBe(N - 1);
  });

  it('a slip in a later verse only lowers that verse', () => {
    const g = gradeRecitation(VERSES, say(FULL.replace('green pastures', 'green fields')), new Set(), 'normal', kit);
    expect(g.detail.verseScores[0]).toBe(1);
    expect(g.detail.verseScores[1]).toBeLessThan(1);
    expect(g.detail.verdicts.includes('w')).toBe(true);
    expect(g.missedQuote).toEqual(['pastures']);
  });

  it('a hinted opening gets no credit and is encoded h', () => {
    const g = gradeRecitation(VERSES, say(FULL), new Set([0, 1, 2]), 'normal', kit);
    expect(g.detail.verdicts.slice(0, 3)).toBe('hhh');
    expect(g.detail.credits.slice(0, 3)).toEqual([0, 0, 0]);
    expect(g.result.score).toBeLessThan(1);
    expect(g.attempt.correctFirst).toBe(N - 3);
  });

  it('missedQuote is capped at five words', () => {
    const g = gradeRecitation(VERSES, say('the lord'), new Set(), 'normal', kit);
    expect(g.missedQuote).toHaveLength(5);
    expect(g.missedQuote[0]).toBe('is');
    expect(g.detail.verdicts.startsWith('cc')).toBe(true);
    expect(g.detail.verdicts.slice(2)).toBe('m'.repeat(N - 2));
  });

  it('extras are counted, never stored as text', () => {
    const g = gradeRecitation(VERSES, say(FULL.replace('my shepherd', 'my zebrafish shepherd')), new Set(), 'normal', kit);
    expect(g.detail.extras).toBe(1);
    expect(JSON.stringify(g.detail)).not.toContain('zebrafish');
    expect(g.result.extras[0].heard).toBe('zebrafish');
  });

  it('detail encoding: one char per word, credits at 2 dp, valid letters', () => {
    const g = gradeRecitation(VERSES, say(FULL.replace('lie down', 'lay down')), new Set(), 'normal', kit);
    expect(g.detail.verdicts).toHaveLength(N);
    expect(g.detail.verdicts).toMatch(/^[cvnswmh]+$/);
    expect(g.detail.credits).toHaveLength(N);
    for (const c of g.detail.credits) expect(Math.round(c * 100) / 100).toBe(c);
  });

  it('strictness changes credit for near words', () => {
    const heard = say(FULL.replace('pastures', 'pasture'));
    const strict = gradeRecitation(VERSES, heard, new Set(), 'strict', kit);
    const lenient = gradeRecitation(VERSES, heard, new Set(), 'lenient', kit);
    expect(lenient.result.score).toBeGreaterThanOrEqual(strict.result.score);
  });

  it('nothing heard scores 0', () => {
    const g = gradeRecitation(VERSES, [], new Set(), 'normal', kit);
    expect(g.result.score).toBe(0);
    expect(g.detail.verdicts).toBe('m'.repeat(N));
  });
});

describe('stripPunctuation', () => {
  it('trims edges only', () => {
    expect(stripPunctuation('pastures:')).toBe('pastures');
    expect(stripPunctuation('"LORD,')).toBe('LORD');
    expect(stripPunctuation("o'er")).toBe("o'er");
    expect(stripPunctuation(';')).toBe('');
  });
});

describe('spokenReference', () => {
  const r = (reference: string, names: string[] = []) => spokenReference({ reference }, names);
  it('single verse', () => expect(r('John 3:16')).toBe('John chapter 3, verse 16'));
  it('verse range', () => expect(r('John 3:16-18')).toBe('John chapter 3, verses 16 to 18'));
  it('cross-chapter range', () =>
    expect(r('John 3:16-4:2')).toBe('John chapter 3 verse 16 to chapter 4 verse 2'));
  it('whole chapter', () => expect(r('John 3')).toBe('John chapter 3'));
  it('numbered book is read as an ordinal', () => {
    expect(r('1 John 3:16')).toBe('First John chapter 3, verse 16');
    expect(r('2 Timothy 3:16-17')).toBe('Second Timothy chapter 3, verses 16 to 17');
  });
  it('multi-word book names, known or not', () => {
    expect(r('Song of Solomon 2:1')).toBe('Song of Solomon chapter 2, verse 1');
    expect(r('Song of Solomon 2:1', ['Song of Solomon'])).toBe('Song of Solomon chapter 2, verse 1');
  });
  it('no book (names not loaded)', () => expect(r('3:16')).toBe('chapter 3, verse 16'));
  it('dash variants and same-verse range', () => {
    expect(r('Psalm 23:1–6')).toBe('Psalm chapter 23, verses 1 to 6');
    expect(r('Psalm 23:1-1')).toBe('Psalm chapter 23, verse 1');
  });
  it('unparseable text is returned as is', () => expect(r('Whatever')).toBe('Whatever'));
});
