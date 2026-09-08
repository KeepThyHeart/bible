import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateWhen, _resetWhenParserCache } from './WhenExpressionParser';
import type { WhenContextValue } from './IWhenContextService';

function lookup(bag: Record<string, WhenContextValue>) {
  return (k: string) => (Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : undefined);
}

describe('WhenExpressionParser', () => {
  beforeEach(() => _resetWhenParserCache());

  describe('identifiers + boolean coercion', () => {
    it('returns true for a true boolean key', () => {
      expect(evaluateWhen('verseSelected', lookup({ verseSelected: true }))).toBe(true);
    });
    it('returns false for a false boolean key', () => {
      expect(evaluateWhen('verseSelected', lookup({ verseSelected: false }))).toBe(false);
    });
    it('coerces non-empty string to true', () => {
      expect(evaluateWhen('theme', lookup({ theme: 'dark' }))).toBe(true);
    });
    it('coerces empty string to false', () => {
      expect(evaluateWhen('theme', lookup({ theme: '' }))).toBe(false);
    });
    it('coerces 0 to false', () => {
      expect(evaluateWhen('panelCount', lookup({ panelCount: 0 }))).toBe(false);
    });
    it('coerces non-zero number to true', () => {
      expect(evaluateWhen('panelCount', lookup({ panelCount: 3 }))).toBe(true);
    });
    it('returns false for missing key', () => {
      expect(evaluateWhen('missing', lookup({}))).toBe(false);
    });
    it('null coerces to false', () => {
      expect(evaluateWhen('x', lookup({ x: null }))).toBe(false);
    });
  });

  describe('negation', () => {
    it('!key flips a boolean', () => {
      expect(evaluateWhen('!verseSelected', lookup({ verseSelected: false }))).toBe(true);
    });
    it('!!key double-negates', () => {
      expect(evaluateWhen('!!verseSelected', lookup({ verseSelected: true }))).toBe(true);
    });
    it('!missingKey is true (missing is false)', () => {
      expect(evaluateWhen('!nope', lookup({}))).toBe(true);
    });
  });

  describe('comparisons', () => {
    it('string == literal', () => {
      expect(evaluateWhen("theme == 'dark'", lookup({ theme: 'dark' }))).toBe(true);
      expect(evaluateWhen("theme == 'dark'", lookup({ theme: 'light' }))).toBe(false);
    });
    it('number ==, !=', () => {
      expect(evaluateWhen('panelCount == 3', lookup({ panelCount: 3 }))).toBe(true);
      expect(evaluateWhen('panelCount != 3', lookup({ panelCount: 2 }))).toBe(true);
    });
    it('numeric > >= < <=', () => {
      const ctx = lookup({ n: 5 });
      expect(evaluateWhen('n > 3', ctx)).toBe(true);
      expect(evaluateWhen('n >= 5', ctx)).toBe(true);
      expect(evaluateWhen('n < 10', ctx)).toBe(true);
      expect(evaluateWhen('n <= 5', ctx)).toBe(true);
      expect(evaluateWhen('n > 5', ctx)).toBe(false);
    });
    it('comparison against missing key returns false', () => {
      expect(evaluateWhen("missing == 'x'", lookup({}))).toBe(false);
      expect(evaluateWhen('missing != 5', lookup({}))).toBe(false);
    });
  });

  describe('and / or / precedence', () => {
    it('a && b', () => {
      expect(evaluateWhen('a && b', lookup({ a: true, b: true }))).toBe(true);
      expect(evaluateWhen('a && b', lookup({ a: true, b: false }))).toBe(false);
    });
    it('a || b', () => {
      expect(evaluateWhen('a || b', lookup({ a: false, b: true }))).toBe(true);
      expect(evaluateWhen('a || b', lookup({ a: false, b: false }))).toBe(false);
    });
    it('precedence: && binds tighter than ||', () => {
      // a || b && c  ==  a || (b && c)
      expect(evaluateWhen('a || b && c', lookup({ a: false, b: true, c: false }))).toBe(false);
      expect(evaluateWhen('a || b && c', lookup({ a: true, b: false, c: false }))).toBe(true);
    });
    it('parentheses override precedence', () => {
      expect(evaluateWhen('(a || b) && c', lookup({ a: true, b: false, c: false }))).toBe(false);
      expect(evaluateWhen('(a || b) && c', lookup({ a: true, b: false, c: true }))).toBe(true);
    });
  });

  describe('compound real-world expressions', () => {
    it("verseSelected && theme == 'dark'", () => {
      expect(
        evaluateWhen("verseSelected && theme == 'dark'", lookup({ verseSelected: true, theme: 'dark' })),
      ).toBe(true);
      expect(
        evaluateWhen("verseSelected && theme == 'dark'", lookup({ verseSelected: true, theme: 'light' })),
      ).toBe(false);
    });
    it('!editor.dirty || activePane', () => {
      expect(
        evaluateWhen('!editor.dirty || activePane', lookup({ 'editor.dirty': false, activePane: false })),
      ).toBe(true);
    });
  });

  describe('error tolerance', () => {
    it('malformed expression returns false rather than throwing', () => {
      expect(evaluateWhen('a &&', lookup({ a: true }))).toBe(false);
      expect(evaluateWhen('(((', lookup({}))).toBe(false);
      expect(evaluateWhen("foo == 'unterminated", lookup({}))).toBe(false);
    });
    it('empty expression is true (always allowed)', () => {
      expect(evaluateWhen('', lookup({}))).toBe(true);
      expect(evaluateWhen('   ', lookup({}))).toBe(true);
    });
  });
});
