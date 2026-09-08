import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserNotesPane from './UserNotesPane';

// Mock stores
vi.mock('../../stores/useNotesStore', () => ({
  useNotesStore: Object.assign(
    (selector: (s: any) => any) => selector({
      initPanel: vi.fn(),
      destroyPanel: vi.fn(),
    }),
    {
      getState: vi.fn().mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
      }),
    },
  ),
}));

const mockUseNotesPanel = vi.fn();
vi.mock('../../stores/hooks/useNotesPanel', () => ({
  useNotesPanel: (...args: unknown[]) => mockUseNotesPanel(...args),
}));

vi.mock('../../stores/useNoteEditorStore', () => ({
  useNoteEditorStore: (selector: (s: any) => any) => selector({
    content: '',
    setContent: vi.fn(),
    isDirty: false,
    lastSaved: null,
  }),
}));

vi.mock('../../stores/useFileNotesStore', () => ({
  useFileNotesStore: Object.assign(
    (selector: (s: any) => any) => selector({
      recentFiles: [],
      removeRecentFile: vi.fn(),
    }),
    {
      getState: vi.fn().mockReturnValue({
        setNotesDirectory: vi.fn(),
        notesDirectory: '/test/notes',
      }),
    },
  ),
}));

// Mock all hooks
vi.mock('./UserNotesPane/hooks/useNotesAutoSave', () => ({ useNotesAutoSave: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useVerseNavigationListeners', () => ({ useVerseNavigationListeners: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNoteFileActions', () => ({
  useNoteFileActions: () => ({
    handleSaveNote: vi.fn(),
    handleSaveAs: vi.fn(),
    handlePrint: vi.fn(),
    handleExportMarkdown: vi.fn(),
    handleExportDocx: vi.fn(),
    handleOpenFile: vi.fn(),
    handleOpenInExplorer: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useNoteCrud', () => ({
  useNoteCrud: () => ({
    handleCreateNote: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleRename: vi.fn(),
    handleMoveCurrentNote: vi.fn(),
    handleMoveEntry: vi.fn(),
    handleDelete: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useEditorShortcuts', () => ({ useEditorShortcuts: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNotesInit', () => ({ useNotesInit: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useVerseNoteOpener', () => ({ useVerseNoteOpener: vi.fn() }));
vi.mock('./UserNotesPane/hooks/usePopOutListener', () => ({ usePopOutListener: vi.fn() }));
vi.mock('./UserNotesPane/hooks/useNotesNavigation', () => ({
  useNotesNavigation: () => ({
    loadDirectory: vi.fn(),
    handleOpenNote: vi.fn(),
    handleBreadcrumbNavigate: vi.fn(),
    buildBreadcrumbs: () => [{ label: 'Notes', path: '' }],
    buildEditorBreadcrumbs: () => [],
    requestRenameCurrentNote: vi.fn(),
    handlePopOut: vi.fn(),
  }),
}));
vi.mock('./UserNotesPane/hooks/useMoveDialogFolders', () => ({
  useMoveDialogFolders: () => [],
}));

vi.mock('./UserNotesPane/utils', () => ({
  VERSE_NOTES_FOLDER: 'Verse Notes',
  isInVerseNotesFolderPath: () => false,
}));

// Mock sub-components
vi.mock('./NotesFolderBrowser', () => ({ default: () => <div data-testid="notes-folder-browser">Browser</div> }));
vi.mock('./NotesSetupDialog', () => ({ default: (props: any) => <div data-testid="notes-setup-dialog"><button onClick={() => props.onComplete('/notes')}>Complete</button></div> }));
vi.mock('./NotesErrorBanner', () => ({ default: (props: any) => <div data-testid="notes-error-banner">{props.message}</div> }));
vi.mock('./UserNotesPane/UserNotesSidebar', () => ({ default: () => <div data-testid="notes-sidebar">Sidebar</div> }));
vi.mock('./UserNotesPane/UserNotesEditorView', () => ({ default: () => <div data-testid="notes-editor-view">Editor</div> }));
vi.mock('./UserNotesPane/UserNotesDialogs', () => ({ default: () => <div data-testid="notes-dialogs" /> }));
vi.mock('../../services/fileNotesAPI', () => ({
  ensureVerseNotesFolder: vi.fn().mockResolvedValue(undefined),
}));

describe('UserNotesPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNotesPanel.mockReturnValue({ currentVerseId: null });
  });

  it('renders the notes pane container', () => {
    const { container } = render(<UserNotesPane />);
    expect(container.querySelector('.h-full')).toBeInTheDocument();
  });

  it('shows the folder browser in browser view (default)', () => {
    render(<UserNotesPane />);
    expect(screen.getByTestId('notes-folder-browser')).toBeInTheDocument();
  });

  it('shows sidebar in browser view', () => {
    render(<UserNotesPane />);
    expect(screen.getByTestId('notes-sidebar')).toBeInTheDocument();
  });

  it('renders dialogs component', () => {
    render(<UserNotesPane />);
    expect(screen.getByTestId('notes-dialogs')).toBeInTheDocument();
  });

  it('does not show editor view in browser mode', () => {
    render(<UserNotesPane />);
    expect(screen.queryByTestId('notes-editor-view')).not.toBeInTheDocument();
  });

  it('does not show error banner when there is no error', () => {
    render(<UserNotesPane />);
    expect(screen.queryByTestId('notes-error-banner')).not.toBeInTheDocument();
  });

  it('passes panelId to useNotesPanel', () => {
    render(<UserNotesPane panelId="custom-notes" />);
    expect(mockUseNotesPanel).toHaveBeenCalledWith('custom-notes');
  });

  it('uses default panel ID when none provided', () => {
    render(<UserNotesPane />);
    expect(mockUseNotesPanel).toHaveBeenCalledWith('_default');
  });
});
