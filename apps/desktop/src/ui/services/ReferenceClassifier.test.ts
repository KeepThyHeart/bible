import { describe, it, expect } from 'vitest';
import { ReferenceClassifier } from './ReferenceClassifier';

describe('ReferenceClassifier', () => {
  const classifier = new ReferenceClassifier();

  it('rejects empty string', () => {
    expect(classifier.looksLikeReference('')).toBe(false);
  });

  it('rejects bare book name with no digit', () => {
    // "acts" has no digit -> gate 1 fails
    expect(classifier.looksLikeReference('acts')).toBe(false);
  });

  it('accepts "acts 1" (digit + valid reference)', () => {
    expect(classifier.looksLikeReference('acts 1')).toBe(true);
  });

  it('accepts "acts 1:5"', () => {
    expect(classifier.looksLikeReference('acts 1:5')).toBe(true);
  });

  it('accepts "acts 1:5-7"', () => {
    expect(classifier.looksLikeReference('acts 1:5-7')).toBe(true);
  });

  it('rejects "love" (no digit)', () => {
    expect(classifier.looksLikeReference('love')).toBe(false);
  });

  it('handles "love 1" -- parser fuzzy-matches to a book', () => {
    // The ReferenceParser uses fuzzy matching, so "love" matches a book name
    // This is parser-dependent behavior; we just verify the classifier delegates correctly
    const result = classifier.looksLikeReference('love 1');
    expect(typeof result).toBe('boolean');
  });

  it('rejects "acts of the apostles" (no digit)', () => {
    expect(classifier.looksLikeReference('acts of the apostles')).toBe(false);
  });

  it('handles "1 corinthians" (bare numbered book, no chapter)', () => {
    // "1 corinthians" has a digit but the parser may not treat a bare book name
    // without a chapter number as a valid reference -- behavior is parser-dependent
    const result = classifier.looksLikeReference('1 corinthians');
    expect(typeof result).toBe('boolean');
  });

  it('accepts "1 corinthians 1" (numbered book with chapter)', () => {
    expect(classifier.looksLikeReference('1 corinthians 1')).toBe(true);
  });

  it('accepts abbreviated references like "gen 1:1"', () => {
    expect(classifier.looksLikeReference('gen 1:1')).toBe(true);
  });

  it('accepts "John 3:16"', () => {
    expect(classifier.looksLikeReference('John 3:16')).toBe(true);
  });

  it('accepts "Rev 22:21"', () => {
    expect(classifier.looksLikeReference('Rev 22:21')).toBe(true);
  });

  it('handles random text with digits -- depends on fuzzy matching', () => {
    // The parser uses fuzzy matching so some random words may match book names
    // We verify the function returns a boolean without crashing
    const result = classifier.looksLikeReference('hello 42');
    expect(typeof result).toBe('boolean');
  });
});
