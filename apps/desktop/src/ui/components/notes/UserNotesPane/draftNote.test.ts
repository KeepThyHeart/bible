/**
 * Task 0216 item 12: a verse note with no file is an in-memory draft; its file
 * is written only by a save with real content.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../../services/fileNotesAPI', () => ({
  saveNote: vi.fn(),
  saveNoteAbsolute: vi.fn(),
  saveVerseNote: vi.fn(),
  readVerseNote: vi.fn(),
  readNote: vi.fn(),
  readNoteAbsolute: vi.fn(),
  createVerseNote: vi.fn(),
}));
vi.mock('../../../utils/verseReference', () => ({
  parseVerseId: (id: number) => ({ bookNumber: Math.floor(id / 1000000), chapter: Math.floor((id % 1000000) / 1000), verse: id % 1000 }),
  getBookNameFromCache: (n: number) => (n === 43 ? 'John' : 'Unknown'),
  getBookNumberFromName: (name: string) => (name === 'John' ? 43 : 0),
}));
import * as fileNotesAPI from '../../../services/fileNotesAPI';
import type { BnFile } from '../../../services/fileNotesAPI';
import { draftForVerse, draftForPath, isDraftNote } from './draftNote';
import { saveWithBaseline } from './hooks/noteSave';
import { useNotesAutoSave } from './hooks/useNotesAutoSave';
import { useActiveNoteFlush } from './hooks/useActiveNoteFlush';
import { useVerseNoteOpener } from './hooks/useVerseNoteOpener';
import { useNotesNavigation } from './hooks/useNotesNavigation';
import { flushActiveNote } from '../../../services/activeNoteFlush';
import { useNoteEditorStore } from '../../../stores/useNoteEditorStore';
import { noteVerseNoteSaved, onVerseNotesChanged } from '../../../services/verseNoteMarkerEvents';

vi.mock('../../../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));

const JOHN = 43003016;
const PATH = 'Verse Notes/John/3/16.bn';
const api = vi.mocked(fileNotesAPI);
const savedNote = (html: string): BnFile => ({ ...draftForVerse(JOHN).note, updated: 'U1', content: html });

beforeEach(() => {
  vi.clearAllMocks();
  api.saveVerseNote.mockImplementation(async (_id, html) => ({ note: savedNote(html), relativePath: PATH }));
  useNoteEditorStore.getState().resetContent('');
});

describe('draft verse note', () => {
  it('is built in memory from a verse id, or from a Verse Notes path', () => {
    const d = draftForVerse(JOHN);
    expect(d.relativePath).toBe(PATH);
    expect(d.note).toMatchObject({ type: 'verse_note', title: 'John 3:16', content: '', passages: [{ start: JOHN, end: JOHN, association: 'primary' }] });
    expect(isDraftNote(d.note)).toBe(true);
    expect(isDraftNote({ ...d.note, updated: 'U1' })).toBe(false);
    expect(draftForPath(PATH)!.note.passages[0].start).toBe(JOHN);
    expect(draftForPath('Documents/x.bn')).toBeNull();
  });

  it('saveWithBaseline writes nothing for an empty draft and creates the file on content', async () => {
    const { note } = draftForVerse(JOHN);
    expect(await saveWithBaseline(PATH, { ...note, content: '<p></p><p><br></p>' })).toBe('');
    expect(api.saveVerseNote).not.toHaveBeenCalled();
    expect(api.saveNote).not.toHaveBeenCalled();

    expect(await saveWithBaseline(PATH, { ...note, content: '<p>hello</p>' })).toBe('U1');
    expect(api.saveVerseNote).toHaveBeenCalledWith(JOHN, '<p>hello</p>', undefined, 'John');
    expect(api.saveNote).not.toHaveBeenCalled();
  });

  it('a note that has a file (clearing it) is an ordinary save with its baseline', async () => {
    api.saveNote.mockResolvedValue('U2');
    expect(await saveWithBaseline(PATH, { ...savedNote(''), content: '' })).toBe('U2');
    expect(api.saveNote).toHaveBeenCalledWith(PATH, expect.objectContaining({ content: '' }), 'U1');
    expect(api.saveVerseNote).not.toHaveBeenCalled();
  });

  it('the first saved content refreshes markers; clearing refreshes them again', () => {
    const cb = vi.fn();
    const off = onVerseNotesChanged(cb);
    noteVerseNoteSaved(PATH, '<p>hi</p>');
    expect(cb).toHaveBeenCalledTimes(1);
    noteVerseNoteSaved(PATH, '<p></p>');
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('autosave / flush of a draft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('autosave of an empty (whitespace) draft writes no file; typing real content creates it', async () => {
    const { note } = draftForVerse(JOHN);
    const setCurrentNote = vi.fn();
    renderHook(() => useNotesAutoSave({ view: 'editor', currentNote: note, currentNotePath: PATH, setCurrentNote, setIsSaving: vi.fn() }));
    useNoteEditorStore.getState().setContent('<p> </p>');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.saveVerseNote).not.toHaveBeenCalled();
    expect(api.saveNote).not.toHaveBeenCalled();
    expect(setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: '' }));

    useNoteEditorStore.getState().setContent('<p>real</p>');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.saveVerseNote).toHaveBeenCalledTimes(1);
    expect(setCurrentNote).toHaveBeenLastCalledWith(expect.objectContaining({ updated: 'U1', content: '<p>real</p>' }));
  });

  it('the shutdown flush writes nothing for an empty draft, and creates the file for a typed one', async () => {
    const { note } = draftForVerse(JOHN);
    const setCurrentNote = vi.fn();
    renderHook(() => useActiveNoteFlush({ view: 'editor', currentNote: note, currentNotePath: PATH, setCurrentNote }));
    useNoteEditorStore.getState().setContent('<p></p>');
    await flushActiveNote();
    expect(api.saveVerseNote).not.toHaveBeenCalled();

    useNoteEditorStore.getState().setContent('<p>typed</p>');
    await flushActiveNote();
    expect(api.saveVerseNote).toHaveBeenCalledWith(JOHN, '<p>typed</p>', undefined, 'John');
    expect(useNoteEditorStore.getState().isDirty).toBe(false);
  });
});

describe('useVerseNoteOpener', () => {
  const args = () => ({
    currentVerseId: JOHN,
    setCurrentNote: vi.fn(), setCurrentNotePath: vi.fn(), setCurrentPath: vi.fn(), setView: vi.fn(), setFileError: vi.fn(),
  });

  it('opens a draft without any create or save call when there is no file', async () => {
    api.readVerseNote.mockResolvedValue(null);
    const a = args();
    const { result } = renderHook(() => useVerseNoteOpener(a));
    await act(async () => { await result.current.handleOpenVerseNote(JOHN); });
    expect(api.createVerseNote).not.toHaveBeenCalled();
    expect(api.saveVerseNote).not.toHaveBeenCalled();
    expect(api.saveNote).not.toHaveBeenCalled();
    expect(a.setCurrentNotePath).toHaveBeenCalledWith(PATH);
    expect(a.setView).toHaveBeenCalledWith('editor');
    expect(a.setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ type: 'verse_note', updated: '', title: 'John 3:16' }));
  });

  it('opens the saved note when the file exists', async () => {
    api.readVerseNote.mockResolvedValue({ note: savedNote('<p>old</p>'), relativePath: PATH });
    const a = args();
    const { result } = renderHook(() => useVerseNoteOpener(a));
    await act(async () => { await result.current.handleOpenVerseNote(JOHN); });
    expect(a.setCurrentNote).toHaveBeenCalledWith(expect.objectContaining({ updated: 'U1' }));
    expect(api.createVerseNote).not.toHaveBeenCalled();
  });
});

describe('pop-out of a draft', () => {
  const detachPane = vi.fn().mockResolvedValue({ success: true });
  beforeEach(() => {
    detachPane.mockClear();
    (window as unknown as { electron: unknown }).electron = { window: { detachPane } };
  });
  const navArgs = (over: Record<string, unknown>) => ({
    panelId: 'p', view: 'editor' as const, currentPath: 'Verse Notes/John/3', currentNote: draftForVerse(JOHN).note,
    currentNotePath: PATH, editorIsDirty: false, setEntries: vi.fn(), setCurrentPath: vi.fn(), setView: vi.fn(),
    setCurrentNote: vi.fn(), setCurrentNotePath: vi.fn(), setFileError: vi.fn(), setRenameEntry: vi.fn(), handleSaveNote: vi.fn(),
    ...over,
  });

  it('an empty draft is handed over by path with nothing saved', async () => {
    const a = navArgs({});
    const { result } = renderHook(() => useNotesNavigation(a));
    await act(async () => { await result.current.handlePopOut(); });
    expect(a.handleSaveNote).not.toHaveBeenCalled();
    expect(detachPane).toHaveBeenCalledWith('verse-notes', expect.objectContaining({ initialCurrentNotePath: PATH }));
  });

  it('a typed draft is saved (file created) before the window opens', async () => {
    const order: string[] = [];
    const a = navArgs({ editorIsDirty: true, handleSaveNote: vi.fn(async () => { order.push('save'); }) });
    detachPane.mockImplementationOnce(async () => { order.push('detach'); return { success: true }; });
    const { result } = renderHook(() => useNotesNavigation(a));
    await act(async () => { await result.current.handlePopOut(); });
    expect(order).toEqual(['save', 'detach']);
  });
});
