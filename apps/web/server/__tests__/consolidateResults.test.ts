import { describe, it, expect } from 'vitest';
import type { RerankResult } from '@bible/core';
import { consolidateResults } from '../utils/consolidateResults.js';

type Scored = RerankResult & { fusedScore?: number };

// Helper to create a mock result
function makeResult(startVerseId: number, endVerseId: number, fusedScore: number, level = 'verse'): Scored {
  return {
    index: startVerseId,
    rerankerScore: fusedScore * 0.5,
    embeddingScore: fusedScore * 0.8,
    level,
    startVerseId,
    endVerseId,
    text: `text for ${startVerseId}`,
    fusedScore,
  };
}

describe('consolidateResults', () => {
  it('should keep a verse that scores higher than its containing passage', () => {
    const results = [
      makeResult(11020035, 11020035, 1.0, 'verse'),
      makeResult(11020037, 11020037, 0.42, 'verse'),
      makeResult(11020031, 11020043, 0.63, 'paragraph'),
      makeResult(32004003, 32004003, 0.85, 'verse'),
    ];

    const consolidated = consolidateResults(results, 10);

    const v35 = consolidated.find(r => r.startVerseId === 11020035 && r.endVerseId === 11020035);
    expect(v35).toBeDefined();
    expect((v35 as Scored).fusedScore).toBe(1.0);

    const passage = consolidated.find(r => r.startVerseId === 11020031);
    expect(passage).toBeDefined();

    const v35Idx = consolidated.indexOf(v35!);
    const passageIdx = consolidated.indexOf(passage!);
    expect(v35Idx).toBeLessThan(passageIdx);

    const v37 = consolidated.find(r => r.startVerseId === 11020037 && r.endVerseId === 11020037);
    expect(v37).toBeUndefined();
  });

  it('REALISTIC: multiple facets per verse and passage — v35 best facet should survive', () => {
    // This simulates real pipeline output: multiple facets per verse/passage
    // each with different scores after fusion
    const results = [
      // v35 has multiple facets — one scores very high
      makeResult(11020035, 11020035, 1.0, 'verse'),    // best facet
      makeResult(11020035, 11020035, 0.59, 'verse'),   // another facet
      makeResult(11020035, 11020035, 0.56, 'verse'),   // another facet
      // v37 has facets
      makeResult(11020037, 11020037, 0.42, 'verse'),
      makeResult(11020037, 11020037, 0.38, 'verse'),
      // Passage 20:31-43 has multiple facets
      makeResult(11020031, 11020043, 0.63, 'paragraph'),
      makeResult(11020031, 11020043, 0.55, 'paragraph'),
      makeResult(11020031, 11020043, 0.50, 'paragraph'),
      // v36 facets
      makeResult(11020036, 11020036, 0.59, 'verse'),
      makeResult(11020036, 11020036, 0.54, 'verse'),
      // Other results
      makeResult(32004003, 32004003, 0.85, 'verse'),
      makeResult(11013023, 11013034, 0.71, 'paragraph'),
    ];

    const consolidated = consolidateResults(results, 10);

    // v35 must appear (its best facet scored 1.0, above passage's 0.63)
    const v35 = consolidated.find(r => r.startVerseId === 11020035 && r.endVerseId === 11020035);
    expect(v35).toBeDefined();
    expect((v35 as Scored).fusedScore).toBe(1.0);

    // Passage should also appear
    const passage = consolidated.find(r => r.startVerseId === 11020031 && r.endVerseId === 11020043);
    expect(passage).toBeDefined();

    // v35 should rank above the passage
    const v35Idx = consolidated.indexOf(v35!);
    const passageIdx = consolidated.indexOf(passage!);
    expect(v35Idx).toBeLessThan(passageIdx);

    // v36 and v37 should be absorbed (they scored lower than the passage)
    const v36 = consolidated.find(r => r.startVerseId === 11020036 && r.endVerseId === 11020036);
    const v37 = consolidated.find(r => r.startVerseId === 11020037 && r.endVerseId === 11020037);
    expect(v36).toBeUndefined();
    expect(v37).toBeUndefined();

    console.log('Consolidated results:');
    for (const r of consolidated) {
      console.log(`  v${r.startVerseId}-${r.endVerseId} [${r.level}] fused=${(r as Scored).fusedScore?.toFixed(3)}`);
    }
  });

  it('should absorb all verses when passage scores highest', () => {
    const results = [
      makeResult(20006006, 20006006, 0.5, 'verse'),
      makeResult(20006007, 20006007, 0.4, 'verse'),
      makeResult(20006008, 20006008, 0.45, 'verse'),
      makeResult(20006006, 20006011, 0.9, 'paragraph'),
    ];

    const consolidated = consolidateResults(results, 10);

    const passage = consolidated.find(r => r.startVerseId === 20006006 && r.endVerseId === 20006011);
    expect(passage).toBeDefined();

    const singles = consolidated.filter(r => r.startVerseId === r.endVerseId && r.startVerseId >= 20006006 && r.startVerseId <= 20006008);
    expect(singles.length).toBe(0);
  });

  it('should merge consecutive single verses into a range', () => {
    const results = [
      makeResult(20006006, 20006006, 0.9, 'verse'),
      makeResult(20006007, 20006007, 0.85, 'verse'),
      makeResult(20006008, 20006008, 0.8, 'verse'),
    ];

    const consolidated = consolidateResults(results, 10);

    expect(consolidated.length).toBe(1);
    expect(consolidated[0].startVerseId).toBe(20006006);
    expect(consolidated[0].endVerseId).toBe(20006008);
    expect((consolidated[0] as Scored).fusedScore).toBe(0.9);
  });

  it('should not merge non-consecutive verses', () => {
    const results = [
      makeResult(20006006, 20006006, 0.9, 'verse'),
      makeResult(20006008, 20006008, 0.8, 'verse'),
    ];

    const consolidated = consolidateResults(results, 10);
    expect(consolidated.length).toBe(2);
  });

  it('should deduplicate multiple facets for the same verse', () => {
    const results = [
      makeResult(43003016, 43003016, 0.95, 'verse'),
      makeResult(43003016, 43003016, 0.90, 'verse'),
      makeResult(43003016, 43003016, 0.85, 'verse'),
    ];

    const consolidated = consolidateResults(results, 10);
    expect(consolidated.length).toBe(1);
    expect((consolidated[0] as Scored).fusedScore).toBe(0.95);
  });
});
