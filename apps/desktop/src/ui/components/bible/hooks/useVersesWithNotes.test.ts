import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../services/notesAPI', () => ({ getVersesWithNotes: vi.fn().mockResolvedValue(new Set([43003001])) }));
vi.mock('../../../services/fileNotesAPI', () => ({
  listVerseNotesInChapter: vi.fn().mockResolvedValue([
    { name: '12.bn', path: 'x', isDirectory: false, modified: '' },
    { name: 'sub', path: 'y', isDirectory: true, modified: '' },
  ]),
}));
vi.mock('../../../utils/verseReference', () => ({ getBookNameFromCache: () => 'Matthew' }));

import { useVersesWithNotes } from './useVersesWithNotes';

describe('useVersesWithNotes (B-012)', () => {
  it('includes verses that only have a .bn verse-note file', async () => {
    const verses = [{ verse_id: 40006001 }, { verse_id: 40006012 }];
    const { result } = renderHook(() => useVersesWithNotes(verses, 40, 6));
    await waitFor(() => expect(result.current.has(40006012)).toBe(true));
    expect(result.current.has(43003001)).toBe(true);
    expect(result.current.has(40006001)).toBe(false);
  });
});
