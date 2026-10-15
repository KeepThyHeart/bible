/**
 * Soak regressions (task 0161): autosave passes the note's baseline, so it can
 * neither overwrite another window's save (SP-01) nor re-create a note that was
 * renamed or trashed (DS-03, SP-02); it pauses and raises the banner instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotesAutoSave } from './useNotesAutoSave';
import type { BnFile } from '../../../../services/fileNotesAPI';
import { IpcResultError } from '../../../../services/ipcResult';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';

vi.mock('../../../../services/fileNotesAPI', () => ({
  saveNote: vi.fn(),
  saveNoteAbsolute: vi.fn(),
  readNote: vi.fn(),
  readNoteAbsolute: vi.fn(),
}));
import * as fileNotesAPI from '../../../../services/fileNotesAPI';

const note: BnFile = {
  bn: 1, type: 'document', title: 'T', tags: [], passages: [],
  created: 'c', updated: 'U0', content: '<p>a</p>', metadata: {},
};

function mount() {
  const setCurrentNote = vi.fn();
  const setFileError = vi.fn();
  const setIsSaving = vi.fn();
  renderHook(() =>
    useNotesAutoSave({ view: 'editor', currentNote: note, currentNotePath: 'F/T.bn', setCurrentNote, setIsSaving, setFileError })
  );
  return { setCurrentNote, setFileError };
}

describe('useNotesAutoSave stale-save refusals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fileNotesAPI.saveNote).mockReset();
    useNoteEditorStore.getState().resetContent('<p>a</p>');
    useNoteEditorStore.getState().setContent('<p>a b</p>');
  });
  afterEach(() => vi.useRealTimers());

  it('saves with the note baseline as expectedUpdated', async () => {
    vi.mocked(fileNotesAPI.saveNote).mockResolvedValue('U1');
    const { setCurrentNote } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fileNotesAPI.saveNote).toHaveBeenCalledWith('F/T.bn', expect.objectContaining({ content: '<p>a b</p>' }), 'U0');
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 'U1' }));
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
  });

  it('after a conflict the baseline is re-synced to disk so one "Save again" is enough', async () => {
    vi.mocked(fileNotesAPI.saveNote).mockRejectedValue(new IpcResultError('conflict', 'x'));
    vi.mocked(fileNotesAPI.readNote).mockResolvedValue({ ...note, updated: 'U9' });
    const { setCurrentNote } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 'U9' }));
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
  });

  it.each([
    ['conflict', /changed in another window/],
    ['not_found', /renamed, moved or deleted/],
  ] as const)('on %s it keeps the edit, shows the banner once and stops retrying', async (code, text) => {
    vi.mocked(fileNotesAPI.saveNote).mockRejectedValue(new IpcResultError(code, 'x'));
    const { setFileError, setCurrentNote } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(setFileError).toHaveBeenCalledTimes(1);
    expect(setFileError.mock.calls[0][0]).toMatch(text);
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
    if (code === 'not_found') expect(setCurrentNote).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(fileNotesAPI.saveNote).toHaveBeenCalledTimes(1);
    expect(setFileError).toHaveBeenCalledTimes(1);
  });
});
