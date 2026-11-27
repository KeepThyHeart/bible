import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVerseNoteOpener } from './useVerseNoteOpener';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';

vi.mock('../../../../services/fileNotesAPI', () => ({
  readVerseNote: vi.fn(),
}));
vi.mock('../../../../stores/useFileNotesStore', () => ({
  useFileNotesStore: { getState: () => ({ addRecentFile: vi.fn() }) },
}));
vi.mock('../../../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: { getState: () => ({ resetContent: vi.fn() }) },
}));
vi.mock('../../../../services/activeNoteFlush', () => ({ flushActiveNote: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../utils/verseReference', () => ({
  parseVerseId: () => ({ bookNumber: 45, chapter: 8, verse: 28 }),
  getBookNameFromCache: () => 'Romans',
}));
vi.mock('../verseNoteRequest', () => ({
  consumeVerseNoteRequest: vi.fn(),
  claimRecentVerseNoteRequest: () => undefined,
}));

function args(overrides = {}) {
  return {
    currentVerseId: 45008028,
    setCurrentNote: vi.fn(),
    setCurrentNotePath: vi.fn(),
    setCurrentPath: vi.fn(),
    setView: vi.fn(),
    setFileError: vi.fn(),
    ...overrides,
  };
}

describe('useVerseNoteOpener - routeToChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileNotesAPI.readVerseNote).mockResolvedValue(null);
  });

  it('skips the single-note opener when routeToChapter returns true', async () => {
    const routeToChapter = vi.fn().mockReturnValue(true);
    const a = args({ routeToChapter });
    const { result } = renderHook(() => useVerseNoteOpener(a));

    await act(async () => { await result.current.handleOpenVerseNote(45008028); });

    expect(routeToChapter).toHaveBeenCalledWith(45008028);
    expect(fileNotesAPI.readVerseNote).not.toHaveBeenCalled();
    expect(a.setView).not.toHaveBeenCalled();
  });

  it('opens the single note when routeToChapter returns false, or is absent', async () => {
    const a = args({ routeToChapter: vi.fn().mockReturnValue(false) });
    const { result } = renderHook(() => useVerseNoteOpener(a));
    await act(async () => { await result.current.handleOpenVerseNote(45008028); });
    expect(a.setView).toHaveBeenCalledWith('editor');

    const b = args();
    const r2 = renderHook(() => useVerseNoteOpener(b));
    await act(async () => { await r2.result.current.handleOpenVerseNote(45008028); });
    expect(b.setView).toHaveBeenCalledWith('editor');
  });
});
