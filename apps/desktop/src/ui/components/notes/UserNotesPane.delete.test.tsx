/**
 * Deleting a note (task 0216, item 8): from the folder browser's context menu
 * and from the open editor (sidebar / header), always behind the confirmation
 * dialog, and landing back in the note's folder when the open note is deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UserNotesPane from './UserNotesPane';
import type { FileEntry, BnFile } from '../../services/fileNotesAPI';

const h = vi.hoisted(() => ({
  crudArgs: null as null | Record<string, (...a: any[]) => void>,
  handleDelete: vi.fn(),
  markSaved: vi.fn(),
}));

vi.mock('../../stores/useNotesStore', () => ({
  useNotesStore: Object.assign(
    (selector: (s: any) => any) => selector({ initPanel: vi.fn(), destroyPanel: vi.fn() }),
    { getState: vi.fn().mockReturnValue({}) },
  ),
}));
vi.mock('../../stores/hooks/useNotesPanel', () => ({ useNotesPanel: () => ({ currentVerseId: null }) }));
vi.mock('../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: Object.assign(
    (selector: (s: any) => any) => selector({ content: '', setContent: vi.fn(), isDirty: false, lastSaved: null }),
    { getState: () => ({ markSaved: h.markSaved }) },
  ),
}));
vi.mock('../../stores/useFileNotesStore', () => ({
  useFileNotesStore: Object.assign(
    (selector: (s: any) => any) => selector({ recentFiles: [], removeRecentFile: vi.fn() }),
    { getState: vi.fn().mockReturnValue({}) },
  ),
}));
vi.mock('./UserNotesPane/hooks/useNotesAutoSave', () => ({ useNotesAutoSave: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useActiveNoteFlush', () => ({ useActiveNoteFlush: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useVerseNavigationListeners', () => ({ useVerseNavigationListeners: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNoteFileActions', () => ({
  useNoteFileActions: () => ({
    handleSaveNote: vi.fn(), handleSaveAs: vi.fn(), handlePrint: vi.fn(), handleExportPdf: vi.fn(),
    handleExportMarkdown: vi.fn(), handleExportDocx: vi.fn(), handleOpenFile: vi.fn(), handleOpenInExplorer: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useNoteCrud', () => ({
  useNoteCrud: (args: Record<string, (...a: any[]) => void>) => {
    h.crudArgs = args;
    return {
      handleCreateNote: vi.fn(), handleCreateFolder: vi.fn(), handleRename: vi.fn(),
      handleMoveCurrentNote: vi.fn(), handleMoveEntry: vi.fn(), handleDelete: h.handleDelete,
    };
  },
}));
vi.mock('./UserNotesPane/hooks/useEditorShortcuts', () => ({ useEditorShortcuts: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNotesInit', () => ({ useNotesInit: vi.fn(() => ({ restoreDone: true })) }));
vi.mock('./UserNotesPane/hooks/useVerseNoteOpener', () => ({ useVerseNoteOpener: vi.fn(() => ({ handleOpenVerseNote: vi.fn() })) }));
vi.mock('./UserNotesPane/hooks/usePopOutListener', () => ({ usePopOutListener: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNoteSavedListener', () => ({ useNoteSavedListener: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNotesNavigation', () => ({
  useNotesNavigation: () => ({
    loadDirectory: vi.fn(), handleOpenNote: vi.fn(), handleBreadcrumbNavigate: vi.fn(),
    buildBreadcrumbs: () => [], buildEditorBreadcrumbs: () => [], requestRenameCurrentNote: vi.fn(), handlePopOut: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useMoveDialogFolders', () => ({ useMoveDialogFolders: () => [] }));
vi.mock('./UserNotesPane/utils', () => ({
  VERSE_NOTES_FOLDER: 'Verse Notes',
  isInVerseNotesFolderPath: () => false,
  isAbsolutePath: () => false,
}));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, p?: unknown) => (p ? `${k}${JSON.stringify(p)}` : k), localizer: { formatVerseReference: () => 'John 3:16' } }),
}));
vi.mock('./verseNoteName', () => ({ entryDisplayName: (e: FileEntry) => `shown:${e.path}` }));
vi.mock('../shared/ConfirmDialog', () => ({
  default: (p: { open: boolean; message: string; onConfirm: () => void; onCancel: () => void }) =>
    p.open ? (
      <div data-testid="confirm-dialog">
        <span>{p.message}</span>
        <button onClick={p.onConfirm}>do-confirm</button>
        <button onClick={p.onCancel}>do-cancel</button>
      </div>
    ) : null,
}));
vi.mock('./NotesSetupDialog', () => ({ default: () => null }));
vi.mock('./NotesErrorBanner', () => ({ default: () => null }));
vi.mock('./UserNotesPane/UserNotesDialogs', () => ({ default: () => null }));
vi.mock('./NotesFolderBrowser', () => ({
  default: (p: { onDelete: (e: FileEntry) => void }) => (
    <button onClick={() => p.onDelete(VERSE_ENTRY)}>browser-delete</button>
  ),
}));
vi.mock('./UserNotesPane/UserNotesSidebar', () => ({
  default: (p: { onRequestDelete?: () => void }) => <button onClick={p.onRequestDelete}>sidebar-delete</button>,
}));
vi.mock('./UserNotesPane/UserNotesEditorView', () => ({
  default: (p: { onRequestDelete?: () => void }) =>
    p.onRequestDelete ? <button onClick={p.onRequestDelete}>header-delete</button> : null,
}));
vi.mock('../../services/fileNotesAPI', () => ({ ensureVerseNotesFolder: vi.fn().mockResolvedValue(undefined) }));

const VERSE_ENTRY: FileEntry = {
  name: '16', path: 'Verse Notes/John/3/16.bn', isDirectory: false, modified: '2026-01-01T00:00:00.000Z',
};

function openEditorOn(type: BnFile['type']): void {
  act(() => {
    h.crudArgs!.setCurrentNote({ type, title: 'John 3:16', updated: '2026-01-01T00:00:00.000Z', content: '' });
    h.crudArgs!.setCurrentNotePath('Verse Notes/John/3/16.bn');
    h.crudArgs!.setView('editor');
  });
}

describe('UserNotesPane - deleting notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.crudArgs = null;
  });

  it('deletes from the browser menu only after confirmation', () => {
    render(<UserNotesPane />);
    fireEvent.click(screen.getByText('browser-delete'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(h.handleDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('do-confirm'));
    expect(h.handleDelete).toHaveBeenCalledWith(VERSE_ENTRY);
  });

  it('cancelling the confirmation deletes nothing', () => {
    render(<UserNotesPane />);
    fireEvent.click(screen.getByText('browser-delete'));
    fireEvent.click(screen.getByText('do-cancel'));
    expect(h.handleDelete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('offers Delete in the header for an open verse note and confirms before deleting it', () => {
    render(<UserNotesPane />);
    openEditorOn('verse_note');
    fireEvent.click(screen.getByText('header-delete'));
    expect(screen.getByTestId('confirm-dialog')).toHaveTextContent('shown:Verse Notes/John/3/16.bn');
    expect(h.handleDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('do-confirm'));
    // The open note's unsaved edits are dropped, and the pane returns to its folder.
    expect(h.markSaved).toHaveBeenCalled();
    expect(h.handleDelete).toHaveBeenCalledTimes(1);
    const [entry, reloadPath] = h.handleDelete.mock.calls[0];
    expect(entry.path).toBe('Verse Notes/John/3/16.bn');
    expect(reloadPath).toBe('Verse Notes/John/3');
  });

  it('does not put the header Delete on a regular note (the sidebar offers it there)', () => {
    render(<UserNotesPane />);
    openEditorOn('document');
    expect(screen.queryByText('header-delete')).not.toBeInTheDocument();
  });
});
