import { describe, it, expect } from 'vitest';
import { hashWriteMode } from './bibleStore';

describe('hashWriteMode', () => {
  it('pushes a user chapter change from a reader hash', () => {
    expect(hashWriteMode('#/ASV/3/1', '#/ASV/3/2', true)).toBe('push');
    expect(hashWriteMode('#/ASV/3/1', '#/KJV/3/1', true)).toBe('push');
  });
  it('replaces for same chapter, non-user navigation or no reader hash', () => {
    expect(hashWriteMode('#/ASV/3/1', '#/ASV/3/1/5', true)).toBe('replace');
    expect(hashWriteMode('#/ASV/3/1', '#/ASV/3/2', false)).toBe('replace');
    expect(hashWriteMode('', '#/ASV/3/2', true)).toBe('replace');
    expect(hashWriteMode('#/@present', '#/ASV/3/2', true)).toBe('replace');
  });
});
