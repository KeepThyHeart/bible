import { describe, expect, it } from 'vitest';
import { englishTranslate, formatMessage } from '../src/core/messages';

describe('formatMessage', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(formatMessage('Hello {name}, {missing}', { name: 'Ann' })).toBe('Hello Ann, {missing}');
  });
  it('picks plural cases, with # and exact matches', () => {
    const m = '{count, plural, =0 {none} one {# verse} other {# verses}}';
    expect(formatMessage(m, { count: 0 })).toBe('none');
    expect(formatMessage(m, { count: 1 })).toBe('1 verse');
    expect(formatMessage(m, { count: 5 })).toBe('5 verses');
  });
  it('uses the locale\'s plural categories and nests placeholders', () => {
    const m = '{n, plural, one {{who} has # card} few {{who} has # cards (few)} other {{who} has # cards}}';
    expect(formatMessage(m, { n: 3, who: 'Ann' }, 'ru')).toBe('Ann has 3 cards (few)');
    expect(formatMessage(m, { n: 1, who: 'Ann' }, 'en')).toBe('Ann has 1 card');
  });
  it('englishTranslate returns the fallback, formatted only when given params', () => {
    expect(englishTranslate('k', 'Plain {braces}')).toBe('Plain {braces}');
    expect(englishTranslate('k', 'Due in {n} days', { n: 3 })).toBe('Due in 3 days');
  });
});
