/**
 * Chapter mode wired into the Notes pane (task 0216 B3): entering from a verse note, leaving through
 * "Single note", routing open-verse-note, the folder Compile item, and pop-out from the chapter view.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ChapterNotesViewProps } from './chapter/ChapterNotesView';

const api = vi.hoisted(() => ({
  readVerseNote: vi.fn(),
  readNote: vi.fn(),
  listDirectory: vi.fn(),
  listVerseNoteChapters: vi.fn(),
  readVerseNotes: vi.fn(),
  ensureVerseNotesFolder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/fileNotesAPI', () => api);
vi.mock('../../services/activeNoteFlush', () => ({ flushActiveNote: vi.fn().mockResolvedValue(undefined) }));

const saveNote = vi.hoisted(() => vi.fn());
vi.mock('./UserNotesPane/hooks/useNoteFileActions', () => ({
  useNoteFileActions: () => ({
    handleSaveNote: saveNote,
    handleSaveAs: vi.fn(),
    handlePrint: vi.fn(),
    handleExportPdf: vi.fn(),
    handleExportMarkdown: vi.fn(),
    handleExportDocx: vi.fn(),
    handleOpenFile: vi.fn(),
    handleOpenInExplorer: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useNoteCrud', () => ({
  useNoteCrud: () => ({
    handleCreateNote: vi.fn(), handleCreateFolder: vi.fn(), handleRename: vi.fn(),
    handleMoveCurrentNote: vi.fn(), handleMoveEntry: vi.fn(), handleDelete: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useNotesAutoSave', () => ({ useNotesAutoSave: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useActiveNoteFlush', () => ({ useActiveNoteFlush: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNoteSavedListener', () => ({ useNoteSavedListener: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useEditorShortcuts', () => ({ useEditorShortcuts: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useVerseNavigationListeners', () => ({ useVerseNavigationListeners: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNotesInit', () => ({ useNotesInit: vi.fn(() => ({ restoreDone: true })) }));
vi.mock('./UserNotesPane/hooks/useMoveDialogFolders', () => ({ useMoveDialogFolders: () => [] }));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, localizer: { formatVerseReference: () => 'ref' } }),
}));
vi.mock('../shared/ConfirmDialog', () => ({ default: () => null }));
vi.mock('./NotesSetupDialog', () => ({ default: () => null }));
vi.mock('./UserNotesPane/UserNotesSidebar', () => ({ default: () => <div data-testid="notes-sidebar" /> }));
vi.mock('./UserNotesPane/UserNotesDialogs', () => ({ default: () => null }));
vi.mock('../../stores/hooks/useNotesPanel', () => ({ useNotesPanel: () => ({ currentVerseId: undefined }) }));

const flagOn = vi.hoisted(() => ({ value: true }));
vi.mock('../../settings/featureFlags', () => ({ isEnabled: (n: string) => (n === 'chapterNotes' ? flagOn.value : false) }));

const chapterProps = vi.hoisted(() => ({ current: null as null | ChapterNotesViewProps }));
const openVerse = vi.hoisted(() => vi.fn());
const flush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./chapter/ChapterNotesView', () => ({
  default: (props: ChapterNotesViewProps) => {
    chapterProps.current = props;
    if (props.handleRef) props.handleRef.current = { openVerse, flush, deactivate: vi.fn() };
    return (
      <div data-testid="chapter-view">
        <span data-testid="chapter-state">{JSON.stringify(props.state)}</span>
        <button data-testid="single-verse" onClick={() => props.onExitToSingle(43003016)} />
        <button data-testid="single-none" onClick={() => props.onExitToSingle(null)} />
      </div>
    );
  },
}));
vi.mock('./UserNotesPane/UserNotesEditorView', () => ({
  default: (props: { onOpenChapter?: () => void }) => (
    <div data-testid="notes-editor-view">
      {props.onOpenChapter && <button data-testid="to-chapter" onClick={props.onOpenChapter} />}
    </div>
  ),
}));
vi.mock('./NotesFolderBrowser', () => ({
  default: (props: { onOpenChapter?: () => void; onCompileFolder?: (e: unknown) => void; currentPath: string }) => (
    <div data-testid="notes-folder-browser" data-path={props.currentPath}>
      {props.onOpenChapter && <button data-testid="browser-chapter" onClick={props.onOpenChapter} />}
      <button
        data-testid="compile-book"
        onClick={() => props.onCompileFolder?.({ name: 'John', path: 'Verse Notes/John', isDirectory: true, modified: '' })}
      />
    </div>
  ),
}));

import UserNotesPane from './UserNotesPane';
import { useNoteEditorStore } from '../../stores/useNoteEditorStore';
import { requestOpenNote } from './UserNotesPane/noteOpenRequest';
import { DEFAULT_PANEL_ID } from '../../stores/helpers/panelStateHelpers';
import { loadBookNamesCache } from '../../utils/verseReference';
import { COMPILE_PASSAGE_NOTES_EVENT } from '../../services/compile/compileRequest';

const VERSE_ID = 43003016; // John 3:16

function verseNote() {
  return {
    relativePath: 'Verse Notes/John/3/16.bn',
    note: {
      bn: 1, type: 'verse_note', title: 'John 3:16', tags: [], passages: [], metadata: {},
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-02T00:00:00.000Z', content: '<p>hi</p>',
    },
  };
}

async function openJohn316() {
  act(() => { window.dispatchEvent(new CustomEvent('open-verse-note', { detail: { verseId: VERSE_ID } })); });
  await screen.findByTestId('notes-editor-view');
}

describe('UserNotesPane chapter mode', () => {
  beforeAll(async () => {
    await loadBookNamesCache({ getAllBooks: async () => [{ book_number: 43, book_name: 'John' }] });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    chapterProps.current = null;
    flagOn.value = true;
    api.readVerseNote.mockResolvedValue(verseNote());
    api.listDirectory.mockResolvedValue([]);
    useNoteEditorStore.getState().resetContent('');
  });

  it('offers no way into Chapter mode while the chapterNotes flag is off', async () => {
    flagOn.value = false;
    render(<UserNotesPane />);
    await openJohn316();
    expect(screen.queryByTestId('to-chapter')).toBeNull();
    expect(screen.queryByTestId('chapter-view')).toBeNull();
  });

  it('verse note -> Chapter -> Single note round trip, saving a dirty single note first', async () => {
    render(<UserNotesPane />);
    await openJohn316();
    act(() => { useNoteEditorStore.getState().setContent('<p>edited</p>'); });
    expect(useNoteEditorStore.getState().isDirty).toBe(true);

    fireEvent.click(screen.getByTestId('to-chapter'));
    await screen.findByTestId('chapter-view');
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(JSON.parse(screen.getByTestId('chapter-state').textContent!)).toMatchObject({ book: 43, chapter: 3, activeVerse: 16, follow: true });
    expect(screen.queryByTestId('notes-editor-view')).toBeNull();

    api.readVerseNote.mockClear();
    fireEvent.click(screen.getByTestId('single-verse'));
    await screen.findByTestId('notes-editor-view');
    expect(api.readVerseNote).toHaveBeenCalledWith('John', 3, 16);
    expect(screen.queryByTestId('chapter-view')).toBeNull();
  });

  it('Single note without an active verse shows the chapter folder in the browser', async () => {
    api.listDirectory.mockResolvedValue([{ name: '16.bn', path: 'x', isDirectory: false, modified: '' }]);
    render(<UserNotesPane />);
    await openJohn316();
    fireEvent.click(screen.getByTestId('to-chapter'));
    await screen.findByTestId('chapter-view');
    fireEvent.click(screen.getByTestId('single-none'));
    const browser = await screen.findByTestId('notes-folder-browser');
    expect(browser.getAttribute('data-path')).toBe('Verse Notes/John/3');
  });

  it('Single note falls back to the notes root when the chapter folder is gone', async () => {
    api.listDirectory.mockImplementation(async (p: string) => {
      if (p === 'Verse Notes/John/3') throw new Error('ENOENT');
      return [];
    });
    render(<UserNotesPane />);
    await openJohn316();
    fireEvent.click(screen.getByTestId('to-chapter'));
    await screen.findByTestId('chapter-view');
    fireEvent.click(screen.getByTestId('single-none'));
    await waitFor(() => expect(screen.getByTestId('notes-folder-browser').getAttribute('data-path')).toBe(''));
  });

  it('open-verse-note in chapter view stays in chapter view and focuses the verse', async () => {
    render(<UserNotesPane />);
    await openJohn316();
    fireEvent.click(screen.getByTestId('to-chapter'));
    await screen.findByTestId('chapter-view');
    api.readVerseNote.mockClear();

    act(() => { window.dispatchEvent(new CustomEvent('open-verse-note', { detail: { verseId: 43003018 } })); });
    expect(openVerse).toHaveBeenCalledWith(43003018, { focus: true });
    expect(api.readVerseNote).not.toHaveBeenCalled();
    expect(screen.getByTestId('chapter-view')).toBeInTheDocument();
  });

  it('the browser offers Chapter inside Verse Notes only (prop wiring) and enters the folder chapter', async () => {
    api.listDirectory.mockResolvedValue([]);
    render(<UserNotesPane />);
    // Not inside Verse Notes at the start: no button.
    expect(screen.queryByTestId('browser-chapter')).toBeNull();
    await openJohn316();
    // Leave the editor to the verse's folder via a pop-out style reload of the folder.
    act(() => { window.dispatchEvent(new CustomEvent('notes-pane-popped-out', { detail: { panelId: DEFAULT_PANEL_ID } })); });
    await waitFor(() => expect(screen.getByTestId('notes-folder-browser').getAttribute('data-path')).toBe('Verse Notes/John/3'));
    fireEvent.click(screen.getByTestId('browser-chapter'));
    await screen.findByTestId('chapter-view');
    expect(JSON.parse(screen.getByTestId('chapter-state').textContent!)).toMatchObject({ book: 43, chapter: 3 });
  });

  it('pop-out from the chapter view leaves the source pane in Chapter mode', async () => {
    render(<UserNotesPane />);
    await openJohn316();
    fireEvent.click(screen.getByTestId('to-chapter'));
    await screen.findByTestId('chapter-view');
    api.listDirectory.mockClear();

    act(() => { window.dispatchEvent(new CustomEvent('notes-pane-popped-out', { detail: { panelId: DEFAULT_PANEL_ID } })); });
    expect(screen.getByTestId('chapter-view')).toBeTruthy();
    expect(screen.queryByTestId('notes-folder-browser')).toBeNull();
    expect(api.listDirectory).not.toHaveBeenCalled();
  });

  it('Compile on a folder dispatches the compile request for the book', async () => {
    api.listVerseNoteChapters.mockResolvedValue([
      { name: '10', path: 'Verse Notes/John/10', isDirectory: true, modified: '' },
      { name: '3', path: 'Verse Notes/John/3', isDirectory: true, modified: '' },
    ]);
    api.readVerseNotes.mockResolvedValue([{ bookName: 'John', chapter: 3, verse: 16, relativePath: '', note: {} }]);
    const heard = vi.fn();
    window.addEventListener(COMPILE_PASSAGE_NOTES_EVENT, heard);
    render(<UserNotesPane />);
    fireEvent.click(screen.getByTestId('compile-book'));
    await waitFor(() => expect(heard).toHaveBeenCalled());
    window.removeEventListener(COMPILE_PASSAGE_NOTES_EVENT, heard);
    const detail = (heard.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.reference).toMatch(/^.+ 3$/);
    expect(detail.initialOptions).toEqual({ versesWithoutNotes: 'skip' });
  });

  it('opens a note when an open-note request arrives', async () => {
    api.readNote.mockResolvedValue(verseNote().note);
    render(<UserNotesPane />);
    act(() => { requestOpenNote('Documents/Compiled.bn'); });
    await waitFor(() => expect(api.readNote).toHaveBeenCalledWith('Documents/Compiled.bn'));
    await screen.findByTestId('notes-editor-view');
  });
});
