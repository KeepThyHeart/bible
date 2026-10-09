import { describe, it, expect } from 'vitest';
import { matchAnswer, allowedEdits } from './match.js';

describe('allowedEdits', () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 1],
    [6, 1],
    [7, 1],
    [8, 2],
    [9, 2],
    [20, 2],
  ])('allows %i-character answers %i edits', (length, expected) => {
    expect(allowedEdits(length)).toBe(expected);
  });
});

describe('the length thresholds at their boundaries', () => {
  it.each([
    ['four letters, exact', 'cain', 'cain', true],
    ['four letters, one substitution', 'rain', 'cain', false],
    ['four letters, one insertion', 'cains', 'cain', false],
    ['four letters, one deletion', 'cai', 'cain', false],
    ['three letters, one substitution', 'jog', 'job', false],
    ['five letters, exact', 'faith', 'faith', true],
    ['five letters, one substitution', 'faitn', 'faith', true],
    ['five letters, one insertion', 'faithh', 'faith', true],
    ['five letters, two substitutions', 'faitn', 'faixh', false],
    ['seven letters, one substitution', 'prophit', 'prophet', true],
    ['seven letters, two substitutions', 'prophix', 'prophet', false],
    ['eight letters, one substitution', 'passovar', 'passover', true],
    ['eight letters, two substitutions', 'pessovar', 'passover', true],
    ['eight letters, three substitutions', 'pessovix', 'passover', false],
    ['eight letters, one deletion', 'pasover', 'passover', true],
    ['eight letters, two deletions', 'pasovr', 'passover', true],
    ['eight letters, three deletions', 'pasov', 'passover', false],
    ['fourteen letters, one substitution', 'nebuchadnezzer', 'nebuchadnezzar', true],
    ['fourteen letters, two substitutions', 'nebuchodnezzer', 'nebuchadnezzar', true],
    ['fourteen letters, three substitutions', 'nabuchodnezzer', 'nebuchadnezzar', false],
  ])('%s', (_name, typed, answer, expected) => {
    expect(matchAnswer(typed, answer).matched).toBe(expected);
  });

  it('takes the budget from the answer, not from what the player typed', () => {
    // Both are one edit apart, but the four-letter answer is the fixed side and
    // four-letter answers are exact-only.
    expect(matchAnswer('lords', 'lord').matched).toBe(false);
    expect(matchAnswer('lord', 'lords').matched).toBe(true);
  });
});

describe('exact against near', () => {
  it('reports a clean answer as exact', () => {
    expect(matchAnswer('faith', 'faith')).toEqual({
      matched: true,
      matchedAnswer: 'faith',
      distance: 0,
      exact: true,
      near: false,
    });
  });

  it('reports a typo as near, with the edit count', () => {
    expect(matchAnswer('faitn', 'faith')).toEqual({
      matched: true,
      matchedAnswer: 'faith',
      distance: 1,
      exact: false,
      near: true,
    });
  });

  it('reports a miss with no answer attached', () => {
    const result = matchAnswer('naomi', 'ruth');
    expect(result.matched).toBe(false);
    expect(result.matchedAnswer).toBeNull();
    expect(result.exact).toBe(false);
    expect(result.near).toBe(false);
  });

  it('treats an archaic equivalent as right, not as nearly right', () => {
    const result = matchAnswer('you have', 'thou hast');
    expect(result.matched).toBe(true);
    expect(result.exact).toBe(true);
    expect(result.near).toBe(false);
    expect(result.distance).toBe(0);
  });
});

describe('what a phone actually sends', () => {
  it.each([
    ['mixed case', 'BeThLeHeM', 'bethlehem'],
    ['shouting', 'JERUSALEM', 'Jerusalem'],
    ['a trailing full stop from autocorrect', 'Jerusalem.', 'Jerusalem'],
    ['trailing punctuation', 'Jerusalem!!', 'Jerusalem'],
    ['leading and trailing space', '   Jerusalem   ', 'Jerusalem'],
    ['extra space between words', 'the   good    shepherd', 'the good shepherd'],
    ['a tab between words', 'the\tgood\tshepherd', 'the good shepherd'],
    ['a curly apostrophe', 'Isaiah’s', "Isaiah's"],
    ['a straight apostrophe against a curly answer', "Isaiah's", 'Isaiah’s'],
    ['an accent kept from a copy and paste', 'Bethsaída', 'Bethsaida'],
    ['an accent the answer carries', 'Bethsaida', 'Bethsaída'],
    ['a hyphen typed as a space', 'well beloved', 'well-beloved'],
    ['an en dash where a hyphen belongs', 'well–beloved', 'well-beloved'],
    ['an ampersand for the word', 'Paul & Silas', 'Paul and Silas'],
  ])('credits %s', (_name, typed, answer) => {
    const result = matchAnswer(typed, answer);
    expect(result.matched).toBe(true);
    expect(result.exact).toBe(true);
  });
});

describe('blank submissions', () => {
  it.each([
    ['the empty string', '', 'ruth'],
    ['spaces', '   ', 'ruth'],
    ['a tab', '\t', 'ruth'],
    ['punctuation only', '...', 'ruth'],
    ['a lone curly apostrophe', '’', 'ruth'],
    ['nothing against an answer that is also nothing', '', ''],
    ['spaces against an answer that is also nothing', '   ', '   '],
  ])('never matches: %s', (_name, typed, answer) => {
    const result = matchAnswer(typed, answer);
    expect(result.matched).toBe(false);
    expect(result.matchedAnswer).toBeNull();
  });

  it('does not let an answer that normalises away match anything', () => {
    expect(matchAnswer('ruth', '...').matched).toBe(false);
  });
});

describe('alternates', () => {
  it('says which alternate carried the answer', () => {
    const result = matchAnswer('cephas', 'Simon Peter', ['Peter', 'Cephas']);
    expect(result.matched).toBe(true);
    expect(result.matchedAnswer).toBe('Cephas');
  });

  it('matches an alternate that only agrees once normalised', () => {
    const result = matchAnswer('the lords anointed', 'David', ['the LORD’s anointed']);
    expect(result.matched).toBe(true);
    expect(result.matchedAnswer).toBe('the LORD’s anointed');
    expect(result.exact).toBe(true);
  });

  it('matches an alternate that only agrees once its accents are stripped', () => {
    const result = matchAnswer('bethsaida', 'Capernaum', ['Bethsaída']);
    expect(result.matched).toBe(true);
    expect(result.matchedAnswer).toBe('Bethsaída');
  });

  it('prefers the canonical answer when both are exact', () => {
    expect(matchAnswer('peter', 'Peter', ['Peter']).matchedAnswer).toBe('Peter');
  });

  it('prefers an exact alternate over a near canonical', () => {
    const result = matchAnswer('joseph', 'joseoh', ['joseph']);
    expect(result.matchedAnswer).toBe('joseph');
    expect(result.exact).toBe(true);
  });

  it('misses when no alternate is close enough', () => {
    expect(matchAnswer('andrew', 'Simon Peter', ['Peter', 'Cephas']).matched).toBe(false);
  });
});

describe('a player typing the King James in modern English', () => {
  it.each([
    ['thou', 'you'],
    ['thee', 'you'],
    ['ye', 'you'],
    ['thy', 'your'],
    ['thine', 'yours'],
    ['hast', 'have'],
    ['hath', 'has'],
    ['doth', 'does'],
    ['saith', 'says'],
    ['shalt', 'shall'],
    ['wilt', 'will'],
    ['canst', 'can'],
    ['art', 'are'],
    ['wast', 'were'],
    ['unto', 'to'],
    ['shew', 'show'],
    ['sheweth', 'shows'],
    ['shewed', 'showed'],
    ['cometh', 'comes'],
    ['spake', 'spoke'],
    ['brethren', 'brothers'],
    ['raiment', 'clothes'],
    ['verily', 'truly'],
    ['straightway', 'immediately'],
    ['peradventure', 'perhaps'],
    ['whosoever', 'whoever'],
    ['saviour', 'savior'],
    ['honour', 'honor'],
    ['neighbour', 'neighbor'],
    ['knowest', 'know'],
    ['believeth', 'believes'],
    ['hearken', 'listen'],
  ])('credits %s answered as %s', (answer, typed) => {
    expect(matchAnswer(typed, answer).matched).toBe(true);
    expect(matchAnswer(answer, typed).matched).toBe(true);
  });

  it.each([
    ['thou shalt not kill', 'you shall not kill'],
    ['thou hast', 'you have'],
    ['thy word', 'your word'],
    ['he sheweth', 'he shows'],
    ['the LORD’s raiment', 'the lords clothes'],
    ['whosoever believeth', 'whoever believes'],
  ])('credits the phrase %s answered as %s', (answer, typed) => {
    const result = matchAnswer(typed, answer);
    expect(result.matched).toBe(true);
    expect(result.exact).toBe(true);
  });

  it('still refuses a different word that merely looks archaic', () => {
    expect(matchAnswer('you', 'thus').matched).toBe(false);
    expect(matchAnswer('best', 'be').matched).toBe(false);
  });
});

describe('a blanked word against a short free-text answer', () => {
  it('judges a single blanked word', () => {
    expect(matchAnswer('shepherd', 'shepherd').matched).toBe(true);
    expect(matchAnswer('sheperd', 'shepherd').near).toBe(true);
    expect(matchAnswer('sheep', 'shepherd').matched).toBe(false);
  });

  it('does not let an extra word into a one-word blank', () => {
    expect(matchAnswer('the light', 'light').matched).toBe(false);
  });

  it('credits a hyphenated blank typed as one word', () => {
    expect(matchAnswer('wellbeloved', 'well-beloved').matched).toBe(true);
  });

  it('judges a short free-text answer', () => {
    expect(matchAnswer('the good shepherd', 'the good shepherd').exact).toBe(true);
    expect(matchAnswer('the good sheperd', 'the good shepherd').near).toBe(true);
    expect(matchAnswer('a bad shepherd', 'the good shepherd').matched).toBe(false);
  });

  it('credits a free-text answer with the words in a different case and spacing', () => {
    expect(matchAnswer('  The  Good   Shepherd ', 'the good shepherd').exact).toBe(true);
  });
});
