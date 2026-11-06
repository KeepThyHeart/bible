import { describe, it, expect } from 'vitest';
import { dedupeSemanticResults } from './dedupeSemanticResults';
import type { SemanticResult } from '../stores/useSearchStore';

const row = (id: string, level: SemanticResult['level'], start: number, end: number, similarity: number): SemanticResult => ({
  id, level, startVerseId: start, endVerseId: end, reference: id, text: id, textPreview: id, similarity,
});

describe('dedupeSemanticResults', () => {
  it('merges a one-verse paragraph with its verse row (first position, best score, verse level)', () => {
    const out = dedupeSemanticResults([
      row('p', 'paragraph', 20019017, 20019017, 0.61),
      row('a', 'verse', 1001001, 1001001, 0.6),
      row('v', 'verse', 20019017, 20019017, 0.64),
    ]);
    expect(out.map((r) => r.id)).toEqual(['p', 'a']);
    expect(out[0]).toMatchObject({ level: 'verse', similarity: 0.64 });
  });

  it('drops a lone verse already inside a listed multi-verse paragraph, keeping order', () => {
    const out = dedupeSemanticResults([
      row('v1', 'verse', 5, 5, 0.9),
      row('para', 'paragraph', 4, 7, 0.8),
      row('v2', 'verse', 9, 9, 0.7),
    ]);
    expect(out.map((r) => r.id)).toEqual(['para', 'v2']);
  });

  it('leaves distinct results alone, and a chapter does not swallow verses', () => {
    const input = [row('c', 'chapter', 1, 30, 0.9), row('v', 'verse', 5, 5, 0.8)];
    expect(dedupeSemanticResults(input).map((r) => r.id)).toEqual(['c', 'v']);
    expect(dedupeSemanticResults([])).toEqual([]);
  });
});
