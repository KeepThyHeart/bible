import { describe, it, expect } from 'vitest';
import { normalise, normaliseWords, isBlank } from './normalise.js';

describe('normalise', () => {
  it.each([
    ['already plain', 'jerusalem', 'jerusalem'],
    ['mixed case', 'JeRuSaLeM', 'jerusalem'],
    ['shouting', 'THE LORD', 'the lord'],
    ['leading and trailing space', '   bethlehem   ', 'bethlehem'],
    ['a tab and a newline', '\tthe\nlord\t', 'the lord'],
    ['runs of internal space', 'the    good     shepherd', 'the good shepherd'],
    ['a non-breaking space', 'the lord', 'the lord'],
    ['a trailing full stop from autocorrect', 'Bethlehem.', 'bethlehem'],
    ['trailing punctuation of every kind', 'Bethlehem?!,;:', 'bethlehem'],
    ['a straight apostrophe', "the lord's", 'the lords'],
    ['a curly apostrophe', 'the lord’s', 'the lords'],
    ['a backtick standing in for one', 'the lord`s', 'the lords'],
    ['a prime standing in for one', 'the lord′s', 'the lords'],
    ['an opening curly quote', '‘hosanna’', 'hosanna'],
    ['double quotes', '"hosanna"', 'hosanna'],
    ['an acute accent', 'Bethsaída', 'bethsaida'],
    ['a grave accent', 'Noè', 'noe'],
    ['a cedilla', 'François', 'francois'],
    ['a precomposed accent', 'café', 'cafe'],
    ['a decomposed accent', 'café', 'cafe'],
    ['a hyphen', 'well-beloved', 'well beloved'],
    ['a non-breaking hyphen', 'well‐beloved', 'well beloved'],
    ['an en dash', 'well–beloved', 'well beloved'],
    ['an em dash', 'Ephraim—Manasseh', 'ephraim manasseh'],
    ['a minus sign', 'well−beloved', 'well beloved'],
    ['a slash', 'either/or', 'either or'],
    ['an underscore', 'son_of_man', 'son of man'],
    ['an ampersand typed for the word', 'Paul & Silas', 'paul and silas'],
    ['an eszett', 'straße', 'strasse'],
    ['an ash', 'Cæsar', 'caesar'],
    ['a slashed o', 'Søren', 'soren'],
    ['a thorn', 'þorn', 'thorn'],
    ['digits', 'Psalm 23', 'psalm 23'],
    ['nothing but punctuation', '!!!', ''],
    ['nothing but space', '   ', ''],
    ['the empty string', '', ''],
  ])('%s', (_name, input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('is idempotent, so a caller may normalise twice without penalty', () => {
    const inputs = ['  The LORD’s  house. ', 'Bethsaída', 'well-beloved', '!!!'];
    for (const input of inputs) {
      expect(normalise(normalise(input))).toBe(normalise(input));
    }
  });

  it('destroys the same things on both sides of a comparison', () => {
    expect(normalise('The LORD’s!')).toBe(normalise('the lords'));
  });
});

describe('normaliseWords', () => {
  it.each([
    ['a phrase', 'The Good  Shepherd', ['the', 'good', 'shepherd']],
    ['a hyphenated word', 'well-beloved', ['well', 'beloved']],
    ['one word', 'jesus', ['jesus']],
    ['whitespace only', '   ', []],
    ['punctuation only', '...', []],
    ['the empty string', '', []],
  ])('%s', (_name, input, expected) => {
    expect(normaliseWords(input)).toEqual(expected);
  });
});

describe('isBlank', () => {
  it.each([
    ['the empty string', '', true],
    ['spaces', '   ', true],
    ['a tab', '\t', true],
    ['punctuation only', '.,!?', true],
    ['a curly apostrophe alone', '’', true],
    ['a word', 'ruth', false],
    ['a digit', '7', false],
  ])('%s', (_name, input, expected) => {
    expect(isBlank(input)).toBe(expected);
  });
});
