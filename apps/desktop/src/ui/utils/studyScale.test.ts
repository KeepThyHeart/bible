import { describe, it, expect } from 'vitest';
import { studyScaled } from './studyScale';

describe('studyScaled (B-074)', () => {
  it('is a fraction of --study-fs, so the Study / pane text setting scales it', () => {
    expect(studyScaled(16)).toBe('calc(1 * var(--study-fs, 1rem))');
    expect(studyScaled(12)).toBe('calc(0.75 * var(--study-fs, 1rem))');
  });
  it('falls back to the rem root outside a Study pane', () => {
    expect(studyScaled(13)).toContain('var(--study-fs, 1rem)');
  });
});
