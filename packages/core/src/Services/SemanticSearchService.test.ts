import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from './SemanticSearchService';

/**
 * Cosine similarity is the scoring function behind every semantic search hit.
 *
 * This file used to declare its own copy of it - the header said "it's a
 * private module function" - so the tests passed no matter what the service
 * computed. The function is exported now and tested for real.
 */

describe('SemanticSearchService - Cosine Similarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3, 4, 5]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return 0 for zero vectors', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should return 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should be scale-invariant', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]); // 2x scale of a
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should compute correct similarity for known vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 1]);
    // cos(45°) = 1/sqrt2 ~= 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('should handle high-dimensional vectors (embedding size)', () => {
    const dim = 768;
    const a = new Float32Array(dim);
    const b = new Float32Array(dim);

    // Create two vectors with known similarity
    for (let i = 0; i < dim; i++) {
      a[i] = Math.sin(i * 0.1);
      b[i] = Math.sin(i * 0.1 + 0.5); // shifted version
    }

    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});
