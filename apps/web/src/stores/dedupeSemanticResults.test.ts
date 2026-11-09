import { describe, it, expect } from 'vitest';
import { dedupeSemanticResults } from './dedupeSemanticResults';

describe('dedupeSemanticResults (web)', () => {
  it('shows an identical range once, first position, best score', () => {
    const out = dedupeSemanticResults([
      { verseId: 20019017, endVerseId: 20019017, module: 'KJV', score: 0.7 },
      { verseId: 43003016, module: 'KJV', score: 0.6 },
      { verseId: 20019017, module: 'KJV', score: 0.8 },
    ]);
    expect(out.map((r) => r.verseId)).toEqual([20019017, 43003016]);
    expect(out[0].score).toBe(0.8);
  });

  it('keeps different ranges and different modules apart', () => {
    const out = dedupeSemanticResults([
      { verseId: 1, endVerseId: 2, module: 'KJV' },
      { verseId: 1, module: 'KJV' },
      { verseId: 1, module: 'ESV' },
    ]);
    expect(out).toHaveLength(3);
  });
});
