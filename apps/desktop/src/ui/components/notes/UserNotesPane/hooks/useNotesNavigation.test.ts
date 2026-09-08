/**
 * Unit tests for useNotesNavigation, focused on the two bugs fixed here:
 *
 *  - Pop-out was calling `detachPane('notes', ...)` with a payload shape
 *    (`{ notePath, noteTitle }`) that matched neither a valid `PaneType`
 *    (electron/config/paneConfig.ts only knows 'verse-notes') nor what
 *    UserNotesPane/useNotesInit reads back (`initialView` /
 *    `initialCurrentPath` / `initialCurrentNotePath`). The main process
 *    handler rejected with "Unknown pane type: notes" and the renderer never
 *    looked at the result, so the button did nothing with no visible error.
 *  - Verse notes' titles are derived from the verse reference and must not
 *    be renameable, even if a caller reaches the handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotesNavigation } from './useNotesNavigation';
import type { BnFile } from '../../../../services/fileNotesAPI';

vi.mock('../../../../services/fileNotesAPI', () => ({
  listDirectory: vi.fn(),
  readNote: vi.fn(),
}));

vi.mock('../../../../stores/useFileNotesStore', () => ({
  useFileNotesStore: { getState: vi.fn().mockReturnValue({ addRecentFile: vi.fn() }) },
}));

vi.mock('../../../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: { getState: vi.fn().mockReturnValue({ resetContent: vi.fn() }) },
}));

const PANEL = 'panel-notes-1';

function makeNote(overrides: Partial<BnFile> = {}): BnFile {
  return {
    bn: 1,
    type: 'document',
    title: 'My Note',
    tags: [],
    passages: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    content: '',
    metadata: {},
    ...overrides,
  };
}

function baseArgs(overrides: Partial<Parameters<typeof useNotesNavigation>[0]> = {}) {
  return {
    panelId: PANEL,
    view: 'editor' as const,
    currentPath: 'Documents',
    currentNote: makeNote(),
    currentNotePath: 'Documents/My Note.bn',
    editorIsDirty: false,
    setEntries: vi.fn(),
    setCurrentPath: vi.fn(),
    setView: vi.fn(),
    setCurrentNote: vi.fn(),
    setCurrentNotePath: vi.fn(),
    setFileError: vi.fn(),
    setRenameEntry: vi.fn(),
    handleSaveNote: vi.fn(),
    ...overrides,
  };
}

describe('useNotesNavigation - handlePopOut', () => {
  beforeEach(() => {
    // vitest.setup.ts already stubs `window.electron` as a writable object;
    // redefine just the method under test rather than the whole property
    // (Object.defineProperty with `writable: true` still forbids stubGlobal's
    // full property redefinition).
    window.electron.window.detachPane = vi.fn().mockResolvedValue({ success: true, windowId: 'detached-1' });
  });

  it('detaches with the registered "verse-notes" pane type, not "notes"', async () => {
    const args = baseArgs();
    const { result } = renderHook(() => useNotesNavigation(args));

    await result.current.handlePopOut();

    expect(window.electron.window.detachPane).toHaveBeenCalledWith(
      'verse-notes',
      expect.objectContaining({
        initialView: 'editor',
        initialCurrentPath: 'Documents',
        initialCurrentNotePath: 'Documents/My Note.bn',
      }),
    );
  });

  it('dispatches notes-pane-popped-out for this panel on success', async () => {
    const args = baseArgs();
    const { result } = renderHook(() => useNotesNavigation(args));
    const handler = vi.fn();
    window.addEventListener('notes-pane-popped-out', handler);

    await result.current.handlePopOut();

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ panelId: PANEL });
    window.removeEventListener('notes-pane-popped-out', handler);
  });

  it('surfaces a file error and does not dispatch the pop-out event when the main process rejects', async () => {
    (window.electron.window.detachPane as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Unknown pane type: notes',
    });
    const args = baseArgs();
    const { result } = renderHook(() => useNotesNavigation(args));
    const handler = vi.fn();
    window.addEventListener('notes-pane-popped-out', handler);

    await result.current.handlePopOut();

    expect(args.setFileError).toHaveBeenCalledWith(expect.stringContaining('Unknown pane type: notes'));
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('notes-pane-popped-out', handler);
  });

  it('surfaces a file error if detachPane itself throws', async () => {
    (window.electron.window.detachPane as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IPC down'));
    const args = baseArgs();
    const { result } = renderHook(() => useNotesNavigation(args));

    await result.current.handlePopOut();

    expect(args.setFileError).toHaveBeenCalledWith(expect.stringContaining('IPC down'));
  });

  it('does nothing when there is no current note', async () => {
    const args = baseArgs({ currentNote: null });
    const { result } = renderHook(() => useNotesNavigation(args));

    await result.current.handlePopOut();

    expect(window.electron.window.detachPane).not.toHaveBeenCalled();
  });
});

describe('useNotesNavigation - requestRenameCurrentNote', () => {
  it('opens the rename dialog for a regular document note', () => {
    const args = baseArgs({ currentNote: makeNote({ type: 'document', title: 'Sermon Prep' }) });
    const { result } = renderHook(() => useNotesNavigation(args));

    result.current.requestRenameCurrentNote();

    expect(args.setRenameEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Sermon Prep', path: args.currentNotePath }),
    );
  });

  it('refuses to open the rename dialog for a verse note, even if invoked directly', () => {
    const args = baseArgs({ currentNote: makeNote({ type: 'verse_note', title: 'John 3:16' }) });
    const { result } = renderHook(() => useNotesNavigation(args));

    result.current.requestRenameCurrentNote();

    expect(args.setRenameEntry).not.toHaveBeenCalled();
  });
});
