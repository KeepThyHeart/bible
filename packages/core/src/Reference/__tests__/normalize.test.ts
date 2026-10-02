import { describe, it, expect } from 'vitest';
import { digitValue, foldName, foldText, normalizeString, normalizeText, type FoldMode } from '../normalize';

const ROOT: FoldMode = { caseLocale: '', foldMarks: true };
const KEEP_MARKS: FoldMode = { caseLocale: '', foldMarks: false };
const TR: FoldMode = { caseLocale: 'tr', foldMarks: true };
const TR_KEEP: FoldMode = { caseLocale: 'tr', foldMarks: false };

describe('normalizeText', () => {
  it('leaves plain ASCII alone, with identity offsets', () => {
    const n = normalizeText('John 3:16');
    expect(n.text).toBe('John 3:16');
    expect(n.start).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(n.end).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('full-width letters, digits and colon (NFKC)', () => {
    const n = normalizeText('Ｊｏｈｎ ３：１６');
    expect(n.text).toBe('John 3:16');
    expect(n.start).toHaveLength(n.text.length);
  });

  it('strips bidi controls, ZWSP, BOM and tatweel but keeps offsets of what is left', () => {
    const input = 'a‏b‎‪⁦c؜﻿d​eـf';
    const n = normalizeText(input);
    expect(n.text).toBe('abcdef');
    expect(n.start.map((i) => input[i])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(n.end.map((i, k) => i - n.start[k])).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('collapses whitespace runs (including NBSP and ideographic space) to one space', () => {
    const n = normalizeText('a \t 　 b');
    expect(n.text).toBe('a b');
    expect(n.start).toEqual([0, 1, 6]);
  });

  it('maps every dash form to "-"', () => {
    expect(normalizeText('3–16—4−2－1‐').text).toBe('3-16-4-2-1-');
  });

  it('expanding characters repeat their original span for each output unit', () => {
    const input = 'xﬁy…z';
    const n = normalizeText(input);
    expect(n.text).toBe('xfiy...z');
    expect(n.start).toEqual([0, 1, 1, 2, 3, 3, 3, 4]);
    expect(n.end).toEqual([1, 2, 2, 3, 4, 4, 4, 5]);
  });

  it('astral code points span two UTF-16 units of the original', () => {
    const input = 'a\u{1D7D1}b'; // mathematical bold digit three
    const n = normalizeText(input);
    expect(n.text).toBe('a3b');
    expect(n.start).toEqual([0, 1, 3]);
    expect(n.end).toEqual([1, 3, 4]);
  });

  it('every Unicode decimal digit becomes ASCII', () => {
    expect(normalizeText('٣:١٦').text).toBe('3:16'); // Arabic-Indic
    expect(normalizeText('۳:۱۶').text).toBe('3:16'); // Extended Arabic-Indic (Persian)
    expect(normalizeText('३:१६').text).toBe('3:16'); // Devanagari
    expect(normalizeText('৩:১৬').text).toBe('3:16'); // Bengali
    expect(normalizeText('\u{1D7D1}:\u{1D7CF}\u{1D7D4}').text).toBe('3:16'); // Math bold
  });

  it('empty input', () => {
    expect(normalizeText('')).toEqual({ text: '', start: [], end: [] });
  });
});

describe('normalizeString', () => {
  it('is the trimmed normalised text', () => {
    expect(normalizeString('  ‏John  3：16  ')).toBe('John 3:16');
  });
});

describe('digitValue', () => {
  it.each([
    ['ASCII', 0x30, 0],
    ['ASCII 9', 0x39, 9],
    ['Arabic-Indic 3', 0x663, 3],
    ['Arabic-Indic 0', 0x660, 0],
    ['Arabic-Indic 9', 0x669, 9],
    ['Extended Arabic-Indic 3', 0x6f3, 3],
    ['Extended Arabic-Indic 9', 0x6f9, 9],
    ['Devanagari 3', 0x969, 3],
    ['Bengali 3', 0x9e9, 3],
    ['Bengali 9', 0x9ef, 9],
    ['Thai 7', 0xe57, 7],
    ['Full-width 3', 0xff13, 3],
    ['Full-width 0', 0xff10, 0],
    ['Math bold 3', 0x1d7d1, 3],
    ['Math double-struck 3', 0x1d7db, 3],
    ['Math sans-serif bold 9', 0x1d7ec + 9, 9],
    ['Math monospace 0', 0x1d7f6, 0],
  ])('%s', (_name, cp, expected) => {
    expect(digitValue(cp)).toBe(expected);
  });

  it('every decimal digit in the BMP and SMP maps to 0..9, ten code points per value', () => {
    const counts = new Array<number>(10).fill(0);
    for (let cp = 0; cp < 0x20000; cp++) {
      if (!/^\p{Nd}$/u.test(String.fromCodePoint(cp))) continue;
      const v = digitValue(cp);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(9);
      counts[v]++;
    }
    // If runs were mis-split (adjacent blocks), the counts would differ.
    expect(new Set(counts).size).toBe(1);
  });
});

describe('foldName', () => {
  it('lower-cases and strips accents', () => {
    expect(foldName('Génesis', ROOT)).toBe('genesis');
    expect(foldName('FILEMÓN', ROOT)).toBe('filemon');
    expect(foldName('Nehemías', ROOT)).toBe('nehemias');
  });

  it('accent folding is symmetrical (typed with or without)', () => {
    expect(foldName('Isaías', ROOT)).toBe(foldName('isaias', ROOT));
    expect(foldName('Isaí́as', ROOT)).toBe(foldName('isaias', ROOT));
  });

  it('keeps marks when foldMarks is off', () => {
    expect(foldName('Génesis', KEEP_MARKS)).toBe('génesis');
    expect(foldName('Genesis', KEEP_MARKS)).toBe('genesis');
  });

  it('drops a trailing period and collapses spaces', () => {
    expect(foldName('Gen.', ROOT)).toBe('gen');
    expect(foldName('  1   Cor. ', ROOT)).toBe('1 cor');
  });

  it('Arabic: alef variants lose their hamza, alef maksura and Persian yeh -> yeh', () => {
    expect(foldName('أيوب', ROOT)).toBe('ايوب');
    expect(foldName('إشعياء', ROOT)).toBe('اشعياء');
    expect(foldName('آ', ROOT)).toBe('ا');
    expect(foldName('موسى', ROOT)).toBe('موسي'); // alef maksura -> yeh
    expect(foldName('یوحنا', ROOT)).toBe(foldName('يوحنا', ROOT)); // Persian yeh = Arabic yeh
  });

  it('Arabic: teh marbuta -> heh, keheh -> kaf', () => {
    expect(foldName('مدينة', ROOT)).toBe('مدينه');
    expect(foldName('ک', ROOT)).toBe('ك');
  });

  // The letter map runs before NFD, which would otherwise split U+06C0 into U+06D5 + hamza.
  it('Arabic: heh with yeh above folds to heh', () => {
    expect(foldName('\u06C0', ROOT)).toBe('\u0647');
  });

  it('Arabic: harakat and tatweel do not matter, ZWNJ is dropped', () => {
    expect(foldName('يُوحَنَّا', ROOT)).toBe('يوحنا');
    expect(foldName('يـوحنا', ROOT)).toBe('يوحنا');
    expect(foldName('می‌خواهم', ROOT)).toBe('ميخواهم');
  });

  it('Hebrew: niqqud is dropped, letters are kept', () => {
    expect(foldName('בְּרֵאשִׁית', ROOT)).toBe('בראשית');
    expect(foldName('בראשית', ROOT)).toBe('בראשית');
  });

  it('Turkish: dotted and dotless I follow the locale', () => {
    expect(foldName('İstanbul', TR)).toBe('istanbul');
    expect(foldName('ISPARTA', TR)).toBe('ısparta');
    expect(foldName('ISPARTA', ROOT)).toBe('isparta');
    // Without folding marks the difference is visible in the root rules:
    expect(foldName('İ', KEEP_MARKS)).toBe('i̇');
    expect(foldName('İ', TR_KEEP)).toBe('i');
  });

  it('CJK passes through unchanged', () => {
    expect(foldName('约翰福音', ROOT)).toBe('约翰福音');
  });

  it('full-width and other compatibility forms are normalised first', () => {
    expect(foldName('Ｊｏｈｎ', ROOT)).toBe('john');
  });
});

describe('foldText offset maps', () => {
  it('maps folded units back to the normalised text and forward again', () => {
    const f = foldText('Génesis 1', ROOT); // "é" decomposes to e + mark, mark removed
    expect(f.text).toBe('genesis 1');
    expect(f.toNorm).toHaveLength(f.text.length);
    expect(f.toNorm[1]).toBe(1);
    expect(f.fromNorm).toHaveLength('Génesis 1'.length + 1);
    expect(f.fromNorm[0]).toBe(0);
    expect(f.fromNorm['Génesis 1'.length]).toBe(f.text.length);
  });

  it('a removed mark shares the folded position of the next unit', () => {
    const f = foldText('éx', ROOT);
    expect(f.text).toBe('ex');
    expect(f.fromNorm[1]).toBe(1); // the mark folds to nothing: next folded unit is "x"
    expect(f.toNorm).toEqual([0, 2]);
  });
});
