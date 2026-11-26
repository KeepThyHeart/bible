import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChapterActiveEditor, CHAPTER_AUTOSAVE_MS, type ActiveVerseTarget, type ChapterActiveEditorDeps } from './useChapterActiveEditor';
import { flushActiveNote } from '../../../services/activeNoteFlush';
import { announceLocalNoteSaved } from '../../../services/noteSavedLocal';
import { IpcResultError } from '../../../services/ipcResult';
import type { BnFile, VerseNoteRecord } from '../../../services/fileNotesAPI';

const mkNote = (content: string, updated: string): BnFile => ({ bn: 1, type: 'verse_note', title: 'T', tags: [], passages: [], created: 'c', updated, content, metadata: {} });
const rec = (verse: number, content: string, updated = 't1'): VerseNoteRecord => ({
  bookName: 'Romans', chapter: 8, verse, relativePath: `Verse Notes/Romans/8/${verse}.bn`, note: mkNote(content, updated),
});
const target = (verse: number, record: VerseNoteRecord | null): ActiveVerseTarget => ({
  verseId: 45008000 + verse, folderName: 'Romans', chapter: 8, verse, record,
});

let n = 0;
let saveWithBaseline: ReturnType<typeof vi.fn>;
let saveVerseNote: ReturnType<typeof vi.fn>;
let readVerseNote: ReturnType<typeof vi.fn>;
let saveConflictCopy: ReturnType<typeof vi.fn>;
let notifyLeaveFailure: ReturnType<typeof vi.fn>;
let remote: ((e: { absolutePath: string; updated: string; senderId: number }) => void) | null;
let onSaved: ReturnType<typeof vi.fn>;

function mount() {
  const deps: Partial<ChapterActiveEditorDeps> = {
    save: { saveWithBaseline: saveWithBaseline as never, saveVerseNote: saveVerseNote as never },
    readVerseNote: readVerseNote as never,
    saveConflictCopy: saveConflictCopy as never,
    notifyLeaveFailure: notifyLeaveFailure as never,
    getNotesDir: async () => '/notes',
    onNoteSaved: (cb) => { remote = cb; return () => { remote = null; }; },
  };
  return renderHook(() => useChapterActiveEditor({ origin: 'chapter:p1', deps, onSaved: onSaved as never }));
}
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const edit = async (h: ReturnType<typeof mount>, html: string) => { act(() => h.result.current.setHtml(html)); await tick(); };

beforeEach(() => {
  vi.useFakeTimers();
  n = 0;
  saveWithBaseline = vi.fn(async () => `u${++n}`);
  saveVerseNote = vi.fn(async (_id: number, html: string) => ({ note: mkNote(html, 'created'), relativePath: 'Verse Notes/Romans/8/5.bn' }));
  readVerseNote = vi.fn(async () => null);
  saveConflictCopy = vi.fn(async () => {});
  notifyLeaveFailure = vi.fn();
  onSaved = vi.fn();
  remote = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('useChapterActiveEditor', () => {
  it('activate A, type, activate B: exactly one save of A, and B is loaded', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    await edit(h, '<p>a2</p>');
    await act(async () => { await h.result.current.activate(target(2, rec(2, '<p>b</p>'))); });
    expect(saveWithBaseline).toHaveBeenCalledTimes(1);
    expect(saveWithBaseline.mock.calls[0][0]).toBe('Verse Notes/Romans/8/1.bn');
    expect(saveWithBaseline.mock.calls[0][1].content).toBe('<p>a2</p>');
    expect(h.result.current.active).toMatchObject({ verseId: 45008002, html: '<p>b</p>', dirty: false });
    expect(onSaved).toHaveBeenCalledWith(1, expect.objectContaining({ verse: 1 }));
  });

  it('drops a stale load when a newer activation superseded it', async () => {
    const h = mount();
    let release!: (v: unknown) => void;
    readVerseNote.mockImplementationOnce(() => new Promise(r => { release = r; }));
    let first!: Promise<void>;
    act(() => { first = h.result.current.activate(target(1, null)); });
    await tick();
    await act(async () => { await h.result.current.activate(target(2, rec(2, '<p>b</p>'))); });
    await act(async () => { release({ note: mkNote('<p>late</p>', 'x'), relativePath: 'p' }); await first; });
    expect(h.result.current.active).toMatchObject({ verseId: 45008002, html: '<p>b</p>', loading: false });
  });

  it('reads the file when the row has no record; no file means a draft', async () => {
    const h = mount();
    readVerseNote.mockResolvedValueOnce({ note: mkNote('', 'e1'), relativePath: 'Verse Notes/Romans/8/3.bn' });
    await act(async () => { await h.result.current.activate(target(3, null)); });
    await edit(h, '<p>x</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(saveWithBaseline.mock.calls[0][1].updated).toBe('e1'); // empty file's updated is the baseline
    expect(saveVerseNote).not.toHaveBeenCalled();
  });

  it('a draft saves only with content, through saveVerseNote', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(5, null)); });
    await edit(h, '<p></p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(saveVerseNote).not.toHaveBeenCalled();
    await edit(h, '<p>real</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(saveVerseNote).toHaveBeenCalledTimes(1);
    expect(h.result.current.active?.dirty).toBe(false);
    expect(onSaved).toHaveBeenCalledWith(5, expect.objectContaining({ relativePath: 'Verse Notes/Romans/8/5.bn' }));
  });

  it('normalize does not dirty; it is ignored once the user has edited', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    act(() => h.result.current.normalize('<p>a</p><p></p>'));
    expect(h.result.current.active).toMatchObject({ html: '<p>a</p><p></p>', dirty: false });
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(saveWithBaseline).not.toHaveBeenCalled();
    await edit(h, '<p>typed</p>');
    act(() => h.result.current.normalize('<p>other</p>'));
    expect(h.result.current.active?.html).toBe('<p>typed</p>');
    expect(h.result.current.active?.dirty).toBe(true);
  });

  it('autosaves 2 s after the last edit, not before', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    await edit(h, '<p>b</p>');
    await tick(CHAPTER_AUTOSAVE_MS - 1);
    expect(saveWithBaseline).not.toHaveBeenCalled();
    await edit(h, '<p>c</p>'); // restarts the timer
    await tick(CHAPTER_AUTOSAVE_MS - 1);
    expect(saveWithBaseline).not.toHaveBeenCalled();
    await tick(1);
    expect(saveWithBaseline).toHaveBeenCalledTimes(1);
    expect(saveWithBaseline.mock.calls[0][1].content).toBe('<p>c</p>');
  });

  describe('external saves of the active note', () => {
    const open = async (h: ReturnType<typeof mount>) => {
      await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>', 't1'))); });
    };
    const fire = async (updated = 't2') => {
      act(() => announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/1.bn', updated, origin: 'chapter:other' }));
      await tick(); await tick();
    };

    it('dirty with different content: conflict, autosave paused', async () => {
      const h = mount(); await open(h);
      await edit(h, '<p>mine</p>');
      readVerseNote.mockResolvedValue({ note: mkNote('<p>theirs</p>', 't2'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await fire();
      expect(h.result.current.active?.conflict).toBe('conflict');
      await tick(CHAPTER_AUTOSAVE_MS * 2);
      expect(saveWithBaseline).not.toHaveBeenCalled();
    });

    it('clean: reloads their copy and keeps the caret (flag set)', async () => {
      const h = mount(); await open(h);
      readVerseNote.mockResolvedValue({ note: mkNote('<p>theirs</p>', 't2'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await fire();
      expect(h.result.current.active).toMatchObject({ html: '<p>theirs</p>', dirty: false, conflict: null });
      expect(h.result.current.preserveSelectionFlag.get()).toBe(true);
      h.result.current.preserveSelectionFlag.clear();
      expect(h.result.current.preserveSelectionFlag.get()).toBe(false);
    });

    it('dirty but their content equals our baseline: adopts updated silently', async () => {
      const h = mount(); await open(h);
      await edit(h, '<p>mine</p>');
      readVerseNote.mockResolvedValue({ note: mkNote('<p>a</p>', 't2'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await fire();
      expect(h.result.current.active?.conflict).toBeNull();
      await tick(CHAPTER_AUTOSAVE_MS);
      expect(saveWithBaseline.mock.calls[0][1]).toMatchObject({ updated: 't2', content: '<p>mine</p>' });
    });

    it('same updated, or our own origin, is ignored', async () => {
      const h = mount(); await open(h);
      await fire('t1');
      act(() => announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/1.bn', updated: 't9', origin: 'chapter:p1' }));
      await tick(); await tick();
      expect(readVerseNote).not.toHaveBeenCalled();
    });

    it('a remote save is matched by absolute path', async () => {
      const h = mount(); await open(h);
      readVerseNote.mockResolvedValue({ note: mkNote('<p>remote</p>', 't3'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await act(async () => { remote!({ absolutePath: '/notes/Verse Notes/Romans/8/1.bn', updated: 't3', senderId: 2 }); await vi.advanceTimersByTimeAsync(0); });
      await tick();
      expect(h.result.current.active?.html).toBe('<p>remote</p>');
    });

    it('another verse is ignored', async () => {
      const h = mount(); await open(h);
      act(() => announceLocalNoteSaved({ path: 'Verse Notes/Romans/8/2.bn', updated: 't2', origin: 'x' }));
      await tick(); await tick();
      expect(readVerseNote).not.toHaveBeenCalled();
    });

    it('note gone: back to a draft whose text is kept and recreated by the next save', async () => {
      const h = mount(); await open(h);
      await edit(h, '<p>mine</p>');
      readVerseNote.mockResolvedValue(null);
      await fire();
      expect(h.result.current.active).toMatchObject({ html: '<p>mine</p>', dirty: true, conflict: null });
      await act(async () => { await h.result.current.flush(); });
      expect(saveWithBaseline).not.toHaveBeenCalled();
      expect(saveVerseNote).toHaveBeenCalledWith(45008001, '<p>mine</p>', undefined, 'Romans', 'chapter:p1');
    });

    it('overwrite re-reads updated and saves over it; reload takes theirs', async () => {
      const h = mount(); await open(h);
      await edit(h, '<p>mine</p>');
      readVerseNote.mockResolvedValue({ note: mkNote('<p>theirs</p>', 't2'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await fire();
      readVerseNote.mockResolvedValue({ note: mkNote('<p>theirs</p>', 't3'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await act(async () => { await h.result.current.resolveConflict('overwrite'); });
      expect(saveWithBaseline.mock.calls[0][1]).toMatchObject({ updated: 't3', content: '<p>mine</p>' });
      expect(h.result.current.active).toMatchObject({ conflict: null, dirty: false });

      await edit(h, '<p>mine2</p>');
      readVerseNote.mockResolvedValue({ note: mkNote('<p>theirs2</p>', 't5'), relativePath: 'Verse Notes/Romans/8/1.bn' });
      await fire('t5');
      await act(async () => { await h.result.current.resolveConflict('reload'); });
      expect(h.result.current.active).toMatchObject({ html: '<p>theirs2</p>', dirty: false, conflict: null });
      expect(saveWithBaseline).toHaveBeenCalledTimes(1);
    });

    it('a save refused with a conflict sets the conflict; leaving keeps a conflict copy', async () => {
      const h = mount(); await open(h);
      saveWithBaseline.mockRejectedValueOnce(new IpcResultError('conflict', 'changed'));
      await edit(h, '<p>mine</p>');
      await tick(CHAPTER_AUTOSAVE_MS);
      expect(h.result.current.active?.conflict).toBe('conflict');
      await act(async () => { await h.result.current.activate(target(2, rec(2, '<p>b</p>'))); });
      expect(saveConflictCopy).toHaveBeenCalledWith('Verse Notes/Romans/8/1.bn', expect.objectContaining({ content: '<p>mine</p>' }));
      expect(notifyLeaveFailure).toHaveBeenCalledWith('conflict-copy', 'T');
      expect(h.result.current.active?.verseId).toBe(45008002);
    });
  });

  it('flushes a dirty row on unmount', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    await edit(h, '<p>unsaved</p>');
    h.unmount();
    await tick();
    expect(saveWithBaseline).toHaveBeenCalledTimes(1);
    expect(saveWithBaseline.mock.calls[0][1].content).toBe('<p>unsaved</p>');
  });

  it('registers a shutdown flush while mounted and clears it on unmount', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    await edit(h, '<p>quit</p>');
    await act(async () => { await flushActiveNote(); });
    expect(saveWithBaseline).toHaveBeenCalledTimes(1);
    await edit(h, '<p>quit2</p>');
    h.unmount();
    await tick();
    expect(saveWithBaseline).toHaveBeenCalledTimes(2);
    saveWithBaseline.mockClear();
    await act(async () => { await flushActiveNote(); });
    expect(saveWithBaseline).not.toHaveBeenCalled();
  });

  it('shutdown flush while in conflict keeps the text as a conflict copy, with no toast', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(1, rec(1, '<p>a</p>'))); });
    saveWithBaseline.mockRejectedValueOnce(new IpcResultError('conflict', 'changed'));
    await edit(h, '<p>mine</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(h.result.current.active?.conflict).toBe('conflict');
    await act(async () => { await flushActiveNote(); });
    expect(saveConflictCopy).toHaveBeenCalledWith('Verse Notes/Romans/8/1.bn', expect.objectContaining({ content: '<p>mine</p>' }));
    expect(notifyLeaveFailure).not.toHaveBeenCalled();
  });

  it('a draft whose create is refused keeps its text as a conflict copy on leave and on quit', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(7, null)); });
    saveVerseNote.mockRejectedValueOnce(new IpcResultError('conflict', 'exists'));
    await edit(h, '<p>draft text</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(h.result.current.active?.conflict).toBe('conflict');
    await act(async () => { await flushActiveNote(); });
    expect(saveConflictCopy).toHaveBeenCalledWith('Verse Notes/Romans/8/7.bn',
      expect.objectContaining({ type: 'verse_note', content: '<p>draft text</p>' }));
    expect(notifyLeaveFailure).not.toHaveBeenCalled();
    saveConflictCopy.mockClear();
    await act(async () => { await h.result.current.activate(target(2, rec(2, '<p>b</p>'))); });
    expect(saveConflictCopy).toHaveBeenCalledWith('Verse Notes/Romans/8/7.bn', expect.objectContaining({ content: '<p>draft text</p>' }));
    expect(notifyLeaveFailure).toHaveBeenCalledWith('conflict-copy', 'Romans 8:7');
  });

  it('a save whose file vanished is retried once as a new note; only a failure toasts', async () => {
    const h = mount();
    await act(async () => { await h.result.current.activate(target(5, rec(5, '<p>a</p>'))); });
    saveWithBaseline.mockRejectedValueOnce(new IpcResultError('not_found', 'gone'));
    await edit(h, '<p>typed</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(saveVerseNote).toHaveBeenCalledTimes(1);
    expect(saveVerseNote.mock.calls[0][1]).toBe('<p>typed</p>');
    expect(notifyLeaveFailure).not.toHaveBeenCalled();
    expect(h.result.current.active?.dirty).toBe(false);

    saveWithBaseline.mockRejectedValueOnce(new IpcResultError('not_found', 'gone'));
    saveVerseNote.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await edit(h, '<p>typed2</p>');
    await tick(CHAPTER_AUTOSAVE_MS);
    expect(notifyLeaveFailure).toHaveBeenCalledWith('missing', expect.any(String));
  });
});
