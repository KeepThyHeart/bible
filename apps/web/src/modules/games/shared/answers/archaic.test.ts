import { describe, it, expect } from 'vitest';
import { FORM_GROUPS, wordVariants, moderniseWord, modernise, sameWord, samePhrase } from './archaic.js';
import { normalise } from './normalise.js';

/** Every pairing the table promises, flattened so each is one test case. */
const TABLE_PAIRS: [string, string][] = FORM_GROUPS.flatMap((group) =>
  group.archaic.flatMap((archaic) =>
    group.modern.map((modern): [string, string] => [archaic, modern]),
  ),
);

describe('the form table', () => {
  it('has entries', () => {
    expect(TABLE_PAIRS.length).toBeGreaterThan(50);
  });

  it('stores every form in the spelling lookups arrive in', () => {
    for (const group of FORM_GROUPS) {
      for (const form of [...group.modern, ...group.archaic]) {
        expect(normalise(form)).toBe(form);
      }
    }
  });

  it('claims each spelling once, so no two groups silently merge', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const group of FORM_GROUPS) {
      for (const form of [...group.modern, ...group.archaic]) {
        if (seen.has(form)) duplicates.push(form);
        seen.add(form);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('gives every group at least one modern spelling to resolve to', () => {
    for (const group of FORM_GROUPS) {
      expect(group.modern.length).toBeGreaterThan(0);
      expect(group.archaic.length).toBeGreaterThan(0);
    }
  });
});

describe('sameWord over the form table', () => {
  it.each(TABLE_PAIRS)('treats %s and %s as the same word', (archaic, modern) => {
    expect(sameWord(archaic, modern)).toBe(true);
  });

  it.each(TABLE_PAIRS)('reads %s when the player types %s', (archaic, modern) => {
    expect(sameWord(modern, archaic)).toBe(true);
  });
});

describe('sameWord over verb endings', () => {
  it.each([
    ['sheweth', 'shows'],
    ['sheweth', 'show'],
    ['showeth', 'shows'],
    ['cometh', 'comes'],
    ['cometh', 'come'],
    ['walketh', 'walks'],
    ['walketh', 'walk'],
    ['loveth', 'loves'],
    ['loveth', 'love'],
    ['believeth', 'believes'],
    ['believeth', 'believe'],
    ['dwelleth', 'dwells'],
    ['sitteth', 'sits'],
    ['sitteth', 'sit'],
    ['runneth', 'runs'],
    ['putteth', 'puts'],
    ['crieth', 'cries'],
    ['crieth', 'cry'],
    ['goeth', 'goes'],
    ['goeth', 'go'],
    ['doeth', 'does'],
    ['knowest', 'know'],
    ['knowest', 'knows'],
    ['givest', 'give'],
    ['hearest', 'hear'],
    ['believest', 'believe'],
    ['doest', 'do'],
    ['sayest', 'says'],
  ])('treats %s and %s as the same word', (archaic, modern) => {
    expect(sameWord(archaic, modern)).toBe(true);
    expect(sameWord(modern, archaic)).toBe(true);
  });
});

describe('sameWord leaves ordinary words alone', () => {
  it.each([
    ['best', 'be'],
    ['rest', 'r'],
    ['west', 'we'],
    ['cain', 'rain'],
    ['lord', 'lords'],
    ['ruth', 'moab'],
    ['shepherd', 'sheep'],
  ])('does not confuse %s with %s', (a, b) => {
    expect(sameWord(a, b)).toBe(false);
  });

  it('is reflexive for a word it has never heard of', () => {
    expect(sameWord('zerubbabel', 'zerubbabel')).toBe(true);
    expect(wordVariants('zerubbabel')).toEqual(['zerubbabel']);
  });
});

describe('wordVariants', () => {
  it('never returns an empty list', () => {
    for (const word of ['thou', 'sheweth', 'zerubbabel', 'x', '']) {
      expect(wordVariants(word).length).toBeGreaterThan(0);
    }
  });

  it('offers both the inflected and the bare modern form of an archaic verb', () => {
    expect(wordVariants('cometh')).toContain('comes');
    expect(wordVariants('cometh')).toContain('come');
  });

  it('modernises an archaic stem under an archaic ending', () => {
    expect(wordVariants('sheweth')).toContain('shows');
    expect(wordVariants('sheweth')).toContain('show');
  });
});

describe('moderniseWord', () => {
  it.each([
    ['thou', 'you'],
    ['thee', 'you'],
    ['ye', 'you'],
    ['thy', 'your'],
    ['thine', 'your'],
    ['hast', 'have'],
    ['doth', 'does'],
    ['saith', 'says'],
    ['unto', 'to'],
    ['brethren', 'brothers'],
    ['zerubbabel', 'zerubbabel'],
  ])('renders %s as %s', (word, expected) => {
    expect(moderniseWord(word)).toBe(expected);
  });
});

describe('modernise', () => {
  it('runs over a whole phrase and normalises on the way', () => {
    expect(modernise('  Thou HAST  ')).toBe('you have');
  });

  it('leaves a phrase it has nothing to say about intact', () => {
    expect(modernise('the good shepherd')).toBe('the good shepherd');
  });
});

describe('samePhrase', () => {
  it.each([
    ['thou shalt not kill', 'you shall not kill'],
    ['thou hast', 'you have'],
    ['thy word', 'your word'],
    ['he sheweth', 'he shows'],
    ['verily verily', 'truly truly'],
    ['the LORD’s raiment', 'the lords clothes'],
  ])('matches %s with %s', (a, b) => {
    expect(samePhrase(a, b)).toBe(true);
    expect(samePhrase(b, a)).toBe(true);
  });

  it.each([
    ['the good shepherd', 'good shepherd'],
    ['thou shalt', 'you shall not'],
    ['ruth', 'naomi'],
    ['', ''],
    ['   ', 'you'],
  ])('does not match %s with %s', (a, b) => {
    expect(samePhrase(a, b)).toBe(false);
  });
});
