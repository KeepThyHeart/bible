/** Soak DS-03/DS-06: renaming or moving the open note must follow it, save its edits first, and update Recent. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNoteCrud } from './useNoteCrud';
import type { BnFile, FileEntry } from '../../../../services/fileNotesAPI';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { useFileNotesStore } from '../../../../stores/useFileNotesStore';

vi.mock('../../../../services/fileNotesAPI', () => ({
  saveNote: vi.fn().mockResolvedValue('U1'),
  saveNoteAbsolute: vi.fn(),
  renameEntry: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(undefined),
}));
import * as api from '../../../../services/fileNotesAPI';

const note: BnFile = { bn: 1, type: 'document', title: 'Old', tags: [], passages: [], created: 'c', updated: 'U0', content: '<p>a</p>', metadata: {} };
const entry: FileEntry = { name: 'Old', path: 'S/Old.bn', isDirectory: false, modified: '' };

function setup() {
  const args = {
    currentPath: 'S', currentNotePath: 'S/Old.bn', currentNote: note, loadDirectory: vi.fn(),
    setCurrentNote: vi.fn(), setCurrentNotePath: vi.fn(), setCurrentPath: vi.fn(), setView: vi.fn(),
    setShowNewNoteDialog: vi.fn(), setShowNewFolderDialog: vi.fn(), setShowMoveDialog: vi.fn(),
    setRenameEntry: vi.fn(), setFileError: vi.fn(),
  };
  return { args, hook: renderHook(() => useNoteCrud(args)).result };
}

describe('useNoteCrud follows the open note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNoteEditorStore.getState().resetContent('<p>a</p>');
    useFileNotesStore.setState({ recentFiles: [{ path: 'S/Old.bn', title: 'Old', openedAt: 'x' }] });
  });

  it('saves unsaved edits at the old path, renames, then points the pane and Recent at the new name', async () => {
    useNoteEditorStore.getState().setContent('<p>a edited</p>');
    const { args, hook } = setup();
    await hook.current.handleRename(entry, 'New');
    const order = [vi.mocked(api.saveNote).mock.invocationCallOrder[0], vi.mocked(api.renameEntry).mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
    expect(api.saveNote).toHaveBeenCalledWith('S/Old.bn', expect.objectContaining({ content: '<p>a edited</p>' }), 'U0');
    expect(api.renameEntry).toHaveBeenCalledWith('S/Old.bn', 'S/New.bn');
    expect(args.setCurrentNotePath).toHaveBeenCalledWith('S/New.bn');
    // the baseline must be the one the pre-rename save produced, not the old one
    expect(args.setCurrentNote).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'New', updated: 'U1', content: '<p>a edited</p>' }));
    expect(useFileNotesStore.getState().recentFiles[0]).toMatchObject({ path: 'S/New.bn', title: 'New' });
  });

  it('reads the open note at call time, not from a stale render (autosave moved the baseline)', async () => {
    const { args, hook } = setup();
    // a later render hands the hook a newer baseline for the same path
    const newer = { ...note, updated: 'U5' };
    const r2 = renderHook(() => useNoteCrud({ ...args, currentNote: newer }));
    useNoteEditorStore.getState().setContent('<p>typed</p>');
    await r2.result.current.handleMoveCurrentNote('Other');
    expect(api.saveNote).toHaveBeenCalledWith('S/Old.bn', expect.anything(), 'U5');
    void hook;
  });

  it('a clean note is not saved before the rename', async () => {
    const { hook } = setup();
    await hook.current.handleRename(entry, 'New');
    expect(api.saveNote).not.toHaveBeenCalled();
  });

  it('renaming the folder re-points the open note inside it', async () => {
    const { args, hook } = setup();
    await hook.current.handleRename({ name: 'S', path: 'S', isDirectory: true, modified: '' }, 'T');
    expect(args.setCurrentNotePath).toHaveBeenCalledWith('T/Old.bn');
    expect(useFileNotesStore.getState().recentFiles[0].path).toBe('T/Old.bn');
  });

  it('deleting a note drops it from Recent', async () => {
    const { hook } = setup();
    await hook.current.handleDelete(entry);
    expect(useFileNotesStore.getState().recentFiles).toEqual([]);
  });
});
