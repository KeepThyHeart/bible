import { numberToWords, numberTokens, ordinalToWords } from '../../recite/numbers';

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [13, 'thirteen'],
    [20, 'twenty'],
    [21, 'twenty one'],
    [100, 'one hundred'],
    [101, 'one hundred one'],
    [342, 'three hundred forty two'],
    [1000, 'one thousand'],
    [144000, 'one hundred forty four thousand'],
    [1234, 'one thousand two hundred thirty four'],
    [2000000, 'two million'],
    [999999999, 'nine hundred ninety nine million nine hundred ninety nine thousand nine hundred ninety nine'],
  ])('%d', (n, words) => {
    expect(numberToWords(n).join(' ')).toBe(words);
  });

  it('reads out-of-range numbers digit by digit', () => {
    expect(numberToWords(1000000000).join(' ')).toBe('one zero zero zero zero zero zero zero zero zero');
  });
});

describe('ordinals and numberTokens', () => {
  it.each([
    ['1st', 'first'],
    ['2nd', 'second'],
    ['3rd', 'third'],
    ['4th', 'fourth'],
    ['5th', 'fifth'],
    ['12th', 'twelfth'],
    ['20th', 'twentieth'],
    ['21st', 'twenty first'],
    ['100th', 'one hundredth'],
    ['1,000', 'one thousand'],
    ['1,234,567', 'one million two hundred thirty four thousand five hundred sixty seven'],
    ['42', 'forty two'],
  ])('%s', (text, words) => {
    expect((numberTokens(text) as string[]).join(' ')).toBe(words);
  });

  it('returns null for non-numbers', () => {
    expect(numberTokens('lord')).toBeNull();
    expect(numberTokens('3:16')).toBeNull();
    expect(numberTokens('1,00')).toBeNull();
  });

  it('ordinalToWords handles 9 and 80', () => {
    expect(ordinalToWords(9)).toEqual(['ninth']);
    expect(ordinalToWords(80)).toEqual(['eightieth']);
  });
});
