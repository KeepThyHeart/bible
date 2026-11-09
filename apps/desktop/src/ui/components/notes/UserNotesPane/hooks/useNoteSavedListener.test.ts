import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let emit: (e: { absolutePath: string; updated: string; senderId: number }) => void;
const readNote = vi.fn();
vi.mock('../../../../services/fileNotesAPI', () => ({
  getNotesDir: async () => '/notes',
  readNote: (...a: unknown[]) => readNote(...a),
  readNoteAbsolute: (...a: unknown[]) => readNote(...a),
  onNoteSaved: (cb: typeof emit) => { emit = cb; return () => {}; },
}));

import { useNoteSavedListener, normalizeNotePath } from './useNoteSavedListener';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { CONFLICT_MESSAGE, hasNoteConflict, clearNoteConflict, beginSave, endSave } from './noteSave';

const note = (updated: string, content = 'old') => ({ updated, content, title: 't' }) as never;
const PATH = 'a/b.bn';
let setCurrentNote: Mock;
let setFileError: Mock;

function mount(current = note('t1'), path = PATH) {
  return renderHook(() => useNoteSavedListener({ view: 'editor', currentNote: current, currentNotePath: path, setCurrentNote, setFileError }));
}
const ev = (updated: string, absolutePath = '/notes/a/b.bn') => ({ absolutePath, updated, senderId: 9 });
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => {
  readNote.mockReset();
  setCurrentNote = vi.fn();
  setFileError = vi.fn();
  clearNoteConflict(PATH);
  useNoteEditorStore.setState({ content: 'old', baseline: 'old', isDirty: false, preserveSelection: false });
});

describe('useNoteSavedListener', () => {
  it('clean pane reloads the newer copy and keeps selection via reloadExternal', async () => {
    readNote.mockResolvedValue(note('t2', 'new'));
    mount();
    emit(ev('t2')); await flush();
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 't2' }));
    const s = useNoteEditorStore.getState();
    expect(s.content).toBe('new');
    expect(s.isDirty).toBe(false);
    expect(s.preserveSelection).toBe(true);
    expect(setFileError).toHaveBeenCalledWith(null);
  });

  it('dirty pane with a REAL content difference shows the conflict banner and does not reload', async () => {
    useNoteEditorStore.setState({ content: 'mine', isDirty: true });
    readNote.mockResolvedValue(note('t2', 'theirs'));
    mount();
    emit(ev('t2')); await flush();
    expect(setFileError).toHaveBeenCalledWith(CONFLICT_MESSAGE);
    expect(hasNoteConflict(PATH)).toBe(true);
    expect(setCurrentNote).not.toHaveBeenCalled();
    expect(useNoteEditorStore.getState().content).toBe('mine');
  });

  it('dirty pane whose other-window copy equals its baseline adopts the new updated silently', async () => {
    useNoteEditorStore.setState({ content: 'mine', baseline: 'old', isDirty: true });
    readNote.mockResolvedValue(note('t2', 'old'));
    mount();
    emit(ev('t2')); await flush();
    expect(setFileError).not.toHaveBeenCalled();
    expect(hasNoteConflict(PATH)).toBe(false);
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 't2' }));
    expect(useNoteEditorStore.getState().content).toBe('mine');
    expect(useNoteEditorStore.getState().isDirty).toBe(true);
  });

  it('a save of ours in flight counts as a conflict', async () => {
    mount();
    beginSave(PATH);
    emit(ev('t2')); await flush();
    endSave(PATH);
    expect(setFileError).toHaveBeenCalledWith(CONFLICT_MESSAGE);
  });

  it('equal updated (echo) is ignored', async () => {
    mount();
    emit(ev('t1')); await flush();
    expect(readNote).not.toHaveBeenCalled();
    expect(setCurrentNote).not.toHaveBeenCalled();
  });

  it('another path is ignored', async () => {
    mount();
    emit(ev('t2', '/notes/other.bn')); await flush();
    expect(readNote).not.toHaveBeenCalled();
  });

  it('becoming dirty during the read takes the conflict branch', async () => {
    readNote.mockImplementation(async () => {
      useNoteEditorStore.setState({ content: 'typed', isDirty: true });
      return note('t2', 'new');
    });
    mount();
    emit(ev('t2')); await flush();
    expect(setCurrentNote).not.toHaveBeenCalled();
    expect(setFileError).toHaveBeenCalledWith(CONFLICT_MESSAGE);
    expect(useNoteEditorStore.getState().content).toBe('typed');
  });

  it('out-of-order reads keep the newest', async () => {
    let resolveFirst!: (n: unknown) => void;
    readNote.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
    readNote.mockResolvedValueOnce(note('t3', 'newest'));
    mount();
    emit(ev('t2')); await flush();
    emit(ev('t3')); await flush();
    resolveFirst(note('t2', 'middle')); await flush();
    expect(setCurrentNote).toHaveBeenCalledTimes(1);
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 't3' }));
    expect(useNoteEditorStore.getState().content).toBe('newest');
  });

  it('normalizes separators and Windows case', () => {
    expect(normalizeNotePath('C:\\Notes\\A.bn')).toBe('c:/notes/a.bn');
  });
});
