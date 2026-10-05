import { describe, it, expect, beforeEach } from 'vitest';
import { studyOwnsHash, setStudyOwnsHash, noteStudyHash, takeStudyHash } from '../hashGate';

describe('hashGate', () => {
  beforeEach(() => {
    setStudyOwnsHash(true);
    takeStudyHash();
  });

  it('defaults to Study owning the hash', () => {
    expect(studyOwnsHash()).toBe(true);
  });

  it('toggles ownership', () => {
    setStudyOwnsHash(false);
    expect(studyOwnsHash()).toBe(false);
    setStudyOwnsHash(true);
    expect(studyOwnsHash()).toBe(true);
  });

  it('remembers the latest noted hash and clears it on take', () => {
    noteStudyHash('#/KJV/1/1');
    noteStudyHash('#/KJV/1/2');
    expect(takeStudyHash()).toBe('#/KJV/1/2');
    expect(takeStudyHash()).toBeNull();
  });
});
