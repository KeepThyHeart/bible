import { describe, it, expect } from 'vitest';
import { normalizeModuleLabel } from './moduleLabel';

describe('normalizeModuleLabel', () => {
  it('turns the right-to-left N’Ko high tone apostrophe (U+07F4) into a plain apostrophe', () => {
    // The Nave's data spells its name with U+07F4, a strong RTL character that
    // reorders the label to "s Topical Bible'Nave" in an Arabic UI.
    expect(normalizeModuleLabel('Naveߴs Topical Bible')).toBe('Nave’s Topical Bible');
  });
  it('also maps U+07F5 and leaves other text alone', () => {
    expect(normalizeModuleLabel('AߵB')).toBe('A’B');
    expect(normalizeModuleLabel('Torrey')).toBe('Torrey');
  });
});
