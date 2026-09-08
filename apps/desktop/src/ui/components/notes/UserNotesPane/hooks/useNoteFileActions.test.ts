/**
 * Unit tests for the save-conflict false positive fixed in this phase.
 *
 * Bug: `handleSaveNote` computed its own `updated: new Date().toISOString()`
 * BEFORE the IPC round-trip and stored that guess as the new baseline via
 * `setCurrentNote`. The main process, however, always regenerates `updated`
 * itself and writes ITS value to disk - a value the renderer never saw
 * (the IPC call returned `void`). So the very next save's `expectedUpdated`
 * (the client's guess) could never match what was actually on disk, and the
 * save was refused with a false "changed in another window" conflict -
 * reproducible with a single window, no second tab required.
 *
 * `saveNote` here is mocked to behave like the real server: it maintains its
 * own internal "disk" timestamp, generated independently of whatever
 * `updated` the caller passed in on the note object, and refuses (like
 * `BibleNotesFileService.assertNoConflict`) when `expectedUpdated` doesn't
 * match. This lets the test fail against the pre-fix hook (which fed back a
 * client guess) and pass against the fixed hook (which feeds back the
 * mock's real return value) without touching the filesystem at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNoteFileActions } from './useNoteFileActions';
import type { BnFile } from '../../../../services/fileNotesAPI';
import { IpcResultError } from '../../../../services/ipcResult';

vi.mock('../../../../services/fileNotesAPI', () => ({
  saveNote: vi.fn(),
  saveNoteAbsolute: vi.fn(),
  readNote: vi.fn(),
  readNoteAbsolute: vi.fn(),
  showSaveDialog: vi.fn(),
  printNote: vi.fn(),
  exportNotePdf: vi.fn(),
}));

vi.mock('../../../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: { getState: vi.fn().mockReturnValue({ markSaved: vi.fn() }) },
}));

vi.mock('../../../../stores/useFileNotesStore', () => ({
  useFileNotesStore: { getState: vi.fn().mockReturnValue({ addRecentFile: vi.fn() }) },
}));

import * as fileNotesAPI from '../../../../services/fileNotesAPI';

function makeNote(overrides: Partial<BnFile> = {}): BnFile {
  return {
    bn: 1,
    type: 'document',
    title: 'Sermon Outline',
    tags: [],
    passages: [],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    content: '',
    metadata: {},
    ...overrides,
  };
}

/**
 * Installs a `saveNote` mock that behaves like the real
 * `BibleNotesFileService`: it stamps its OWN `updated` timestamp (never the
 * caller's), rejects when `expectedUpdated` doesn't match the timestamp it
 * last handed out, and returns the real value on success.
 */
function installServerLikeSaveNote(): { diskUpdated: string } {
  let counter = 0;
  const state = { diskUpdated: '2026-01-01T00:00:00.000Z' }; // matches makeNote()'s initial `updated`
  (fileNotesAPI.saveNote as ReturnType<typeof vi.fn>).mockImplementation(
    async (_path: string, _note: BnFile, expectedUpdated?: string) => {
      if (expectedUpdated !== undefined && expectedUpdated !== state.diskUpdated) {
        throw new IpcResultError('conflict', 'Note was modified in another window since it was opened');
      }
      counter += 1;
      // A real server-generated timestamp - deliberately NOT derived from
      // anything the caller passed in, mirroring `new Date().toISOString()`
      // being computed fresh on the main-process side.
      state.diskUpdated = `2026-01-01T00:00:0${counter}.000Z`;
      return state.diskUpdated;
    }
  );
  return state;
}

function baseArgs(overrides: Partial<Parameters<typeof useNoteFileActions>[0]> = {}) {
  return {
    currentNote: makeNote(),
    currentNotePath: 'Documents/Sermon Outline.bn',
    editorContent: '<p>hello</p>',
    setCurrentNote: vi.fn(),
    setCurrentNotePath: vi.fn(),
    setView: vi.fn(),
    setIsSaving: vi.fn(),
    setFileError: vi.fn(),
    ...overrides,
  };
}

describe('useNoteFileActions - handleSaveNote conflict false positive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not surface a false conflict on a second save when fed the note setCurrentNote actually received', async () => {
    installServerLikeSaveNote();

    // Track what the hook passes to setCurrentNote, the same way the real
    // parent (UserNotesPane) feeds it back into `currentNote` on re-render.
    let latestNote: BnFile = makeNote();
    const setCurrentNote = vi.fn((note: BnFile) => {
      latestNote = note;
    });

    let args = baseArgs({ currentNote: latestNote, setCurrentNote });
    const { result, rerender } = renderHook((a: Parameters<typeof useNoteFileActions>[0]) => useNoteFileActions(a), {
      initialProps: args,
    });

    // First save: succeeds, and (per the fix) the baseline stored via
    // setCurrentNote must be the server's real returned timestamp.
    await result.current.handleSaveNote();
    expect(args.setFileError).toHaveBeenCalledWith(null);
    expect(setCurrentNote).toHaveBeenCalledTimes(1);

    // Simulate the parent's re-render with the new `currentNote` state.
    args = baseArgs({ currentNote: latestNote, setCurrentNote });
    rerender(args);

    // Second save (the exact "press Ctrl+S again" scenario from the bug
    // report) - must NOT report a conflict.
    await result.current.handleSaveNote();

    expect(args.setFileError).not.toHaveBeenCalledWith(
      expect.stringContaining('changed in another window')
    );
    expect(args.setFileError).toHaveBeenLastCalledWith(null);
    expect(setCurrentNote).toHaveBeenCalledTimes(2);
  });

  it('a genuine conflict (server rejects because the baseline is stale) still surfaces the warning', async () => {
    installServerLikeSaveNote();
    (fileNotesAPI.readNote as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeNote({ updated: '2026-01-01T00:00:09.000Z' })
    );

    // Deliberately pass a baseline that does not match the mock's initial
    // "disk" state, simulating another window having already saved.
    const staleNote = makeNote({ updated: '1999-01-01T00:00:00.000Z' });
    const args = baseArgs({ currentNote: staleNote, setCurrentNote: vi.fn() });
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleSaveNote();

    expect(args.setFileError).toHaveBeenCalledWith(
      expect.stringContaining('changed in another window')
    );
  });
});

/**
 * PDF export cannot be exercised for real from a unit test - it ends in a
 * hidden BrowserWindow and `webContents.printToPDF` in the main process. What
 * is testable here, and what actually broke twice in the print path, is the
 * wiring: that the renderer hands over a complete standalone document (not the
 * bare editor HTML), that the body is sanitized on the way, and that a failure
 * reported by the channel reaches the error banner instead of vanishing.
 */
describe('useNoteFileActions - PDF export wiring', () => {
  const exportNotePdf = fileNotesAPI.exportNotePdf as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exportNotePdf.mockResolvedValue({ success: true });
  });

  it('sends the same standalone document printing gets, with a file-safe name', async () => {
    const args = baseArgs({
      currentNote: makeNote({ title: 'Romans 8: Hope' }),
      editorContent: '<p>No condemnation</p>',
    });
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleExportPdf();

    expect(exportNotePdf).toHaveBeenCalledTimes(1);
    const [html, defaultName] = exportNotePdf.mock.calls[0] as [string, string];
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('No condemnation');
    expect(html).toContain('<h1>Romans 8: Hope</h1>');
    // ':' is not legal in a Windows filename, and this string is the save
    // dialog's default path.
    expect(defaultName).toBe('Romans 8_ Hope');
  });

  it('strips scripts out of the note body before it leaves the renderer', async () => {
    const args = baseArgs({ editorContent: '<p>ok</p><script>alert(1)</script>' });
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleExportPdf();

    const [html] = exportNotePdf.mock.calls[0] as [string];
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('ok');
  });

  it('shows the error the channel reports rather than failing silently', async () => {
    exportNotePdf.mockResolvedValue({ success: false, error: 'disk full' });
    const args = baseArgs();
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleExportPdf();

    expect(args.setFileError).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });

  // A cancelled save dialog answers `{ success: true }`: the user asked for
  // nothing to happen, and nothing happened. No banner.
  it('says nothing when the save dialog is cancelled', async () => {
    const args = baseArgs();
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleExportPdf();

    expect(args.setFileError).not.toHaveBeenCalled();
  });

  it('does nothing at all with no note open', async () => {
    const args = baseArgs({ currentNote: null });
    const { result } = renderHook(() => useNoteFileActions(args));

    await result.current.handleExportPdf();

    expect(exportNotePdf).not.toHaveBeenCalled();
  });
});
