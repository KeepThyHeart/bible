import { describe, it, expect } from 'vitest';
import { entryLabel } from './entryLabel';

describe('entryLabel (B-165)', () => {
  it('shows a raw Strong\'s key as G26 / H430', () => {
    expect(entryLabel('StrongsGreek', '00026', '00026')).toBe('G26');
    expect(entryLabel('StrongsHebrew', undefined, '00430')).toBe('H430');
    expect(entryLabel('StrongsGreek', undefined, '00031A')).toBe('G31A');
  });
  it('adds the original word when the server sends one', () => {
    expect(entryLabel('StrongsGreek', 'ἀγάπη', '00026')).toBe('G26 ἀγάπη');
  });
  it('leaves ordinary dictionaries alone', () => {
    expect(entryLabel('Easton', 'Aaron', 'aaron')).toBe('Aaron');
  });
});
