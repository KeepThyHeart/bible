import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../services/notesAPI', () => ({ getVersesWithNotes: vi.fn().mockResolvedValue(new Set([43003001])) }));
const remoteSaved = vi.hoisted(() => ({ cb: null as null | ((e: { absolutePath: string }) => void) }));
vi.mock('../../../services/fileNotesAPI', () => ({
  onNoteSaved: (cb: (e: { absolutePath: string }) => void) => { remoteSaved.cb = cb; return () => { remoteSaved.cb = null; }; },
  listVerseNotesInChapter: vi.fn().mockResolvedValue([
    { name: '12.bn', path: 'x', isDirectory: false, modified: '' },
    { name: 'sub', path: 'y', isDirectory: true, modified: '' },
  ]),
}));
vi.mock('../../../utils/verseReference', () => ({ getBookNameFromCache: () => 'Matthew' }));

import { useVersesWithNotes } from './useVersesWithNotes';
import { listVerseNotesInChapter } from '../../../services/fileNotesAPI';
import { noteVerseNoteSaved, noteVerseNoteRemoved } from '../../../services/verseNoteMarkerEvents';
import { act } from '@testing-library/react';

describe('useVersesWithNotes (B-012)', () => {
  it('includes verses that only have a .bn verse-note file', async () => {
    const verses = [{ verse_id: 40006001 }, { verse_id: 40006012 }];
    const { result } = renderHook(() => useVersesWithNotes(verses, 40, 6));
    await waitFor(() => expect(result.current.has(40006012)).toBe(true));
    expect(result.current.has(43003001)).toBe(true);
    expect(result.current.has(40006001)).toBe(false);
  });

  it('drops the marker after the verse note is deleted (refresh event)', async () => {
    const verses = [{ verse_id: 40006001 }, { verse_id: 40006012 }];
    const { result } = renderHook(() => useVersesWithNotes(verses, 40, 6));
    await waitFor(() => expect(result.current.has(40006012)).toBe(true));
    vi.mocked(listVerseNotesInChapter).mockResolvedValueOnce([]);
    act(() => noteVerseNoteRemoved('Verse Notes/Matthew/6/12.bn'));
    await waitFor(() => expect(result.current.has(40006012)).toBe(false));
  });

  it('drops the marker when the note is saved cleared to empty, not when it keeps content', async () => {
    const verses = [{ verse_id: 40006012 }];
    const { result } = renderHook(() => useVersesWithNotes(verses, 40, 6));
    await waitFor(() => expect(result.current.has(40006012)).toBe(true));
    vi.mocked(listVerseNotesInChapter).mockClear();
    noteVerseNoteSaved('Verse Notes/Matthew/6/12.bn', '<p>kept</p>'); // first content save: refresh
    noteVerseNoteSaved('Verse Notes/Matthew/6/12.bn', '<p>kept more</p>'); // unchanged state: no refresh
    await waitFor(() => expect(listVerseNotesInChapter).toHaveBeenCalledTimes(1));
    vi.mocked(listVerseNotesInChapter).mockResolvedValueOnce([]);
    act(() => noteVerseNoteSaved('Verse Notes/Matthew/6/12.bn', '<p></p><p><br></p>'));
    await waitFor(() => expect(result.current.has(40006012)).toBe(false));
  });

  it('refreshes when another window saves a verse note', async () => {
    const verses = [{ verse_id: 40006012 }];
    const { result } = renderHook(() => useVersesWithNotes(verses, 40, 6));
    await waitFor(() => expect(result.current.has(40006012)).toBe(true));
    vi.mocked(listVerseNotesInChapter).mockResolvedValueOnce([]);
    act(() => remoteSaved.cb?.({ absolutePath: '/n/Verse Notes/Matthew/6/12.bn' }));
    await waitFor(() => expect(result.current.has(40006012)).toBe(false));
  });
});
