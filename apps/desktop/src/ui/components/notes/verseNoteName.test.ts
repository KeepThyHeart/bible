import { describe, it, expect } from 'vitest';
import { entryDisplayName } from './verseNoteName';
import { enLocalizer } from '../../testing/enCatalog';

const entry = (path: string, isDirectory = false) => ({
  name: path.split('/').pop()!,
  path,
  isDirectory,
  modified: '2026-01-01T00:00:00.000Z',
});

describe('entryDisplayName', () => {
  it('turns a verse-note path into its full reference', () => {
    expect(entryDisplayName(entry('Verse Notes/Genesis/24/3.bn'), 'Verse Notes', enLocalizer)).toBe('Genesis 24:3');
  });

  it('leaves ordinary notes, folders and non-verse paths alone', () => {
    expect(entryDisplayName(entry('Documents/Romans 8.bn'), 'Verse Notes', enLocalizer)).toBe('Romans 8.bn');
    expect(entryDisplayName(entry('Verse Notes/Genesis', true), 'Verse Notes', enLocalizer)).toBe('Genesis');
    expect(entryDisplayName(entry('Verse Notes/Genesis/24/x.bn'), 'Verse Notes', enLocalizer)).toBe('x.bn');
  });
});
