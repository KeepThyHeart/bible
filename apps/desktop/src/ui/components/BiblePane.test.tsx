import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BiblePane from './BiblePane';

// Mock all the hooks used by BiblePane
const mockUseBiblePanel = vi.fn();
vi.mock('../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
      }),
      setState: vi.fn(),
    },
  ),
  DEFAULT_DISPLAY_MODE: 'standard',
}));

// Mock all BiblePane-specific hooks
vi.mock('./bible/hooks/useBookPickerOverlay', () => ({
  useBookPickerOverlay: () => ({ showBookPicker: false, setShowBookPicker: vi.fn(), open: vi.fn(), close: vi.fn() }),
}));
vi.mock('./bible/hooks/useModulePickerOverlay', () => ({
  useModulePickerOverlay: () => ({ showSelector: false, setShowSelector: vi.fn(), versionSelectorTabId: null, setVersionSelectorTabId: vi.fn() }),
}));
vi.mock('./bible/hooks/useParallelPickerOverlay', () => ({
  useParallelPickerOverlay: () => ({ showParallelPicker: false, setShowParallelPicker: vi.fn(), parallelSelections: [], setParallelSelections: vi.fn() }),
}));
vi.mock('./bible/hooks/useHistoryDropdown', () => ({
  useHistoryDropdown: () => ({ showHistory: false, setShowHistory: vi.fn() }),
}));
vi.mock('./bible/hooks/useVerseContextMenu', () => ({
  useVerseContextMenu: () => ({ contextMenu: null, setContextMenu: vi.fn() }),
}));
vi.mock('./bible/hooks/useCopyDialog', () => ({
  useCopyDialog: () => ({ copyOptionsDialog: null, setCopyOptionsDialog: vi.fn() }),
}));
vi.mock('./bible/hooks/useNoteTooltip', () => ({
  useNoteTooltip: () => ({ noteTooltip: null, setNoteTooltip: vi.fn(), handleNoteTooltipClose: vi.fn(), handleNoteTooltipEnter: vi.fn(), hide: vi.fn() }),
}));
vi.mock('./bible/hooks/useVersesWithNotes', () => ({
  useVersesWithNotes: () => [],
}));
vi.mock('./bible/hooks/useContentKeyInit', () => ({
  useContentKeyInit: vi.fn(),
}));
vi.mock('./bible/hooks/useDockviewTitleSync', () => ({
  useDockviewTitleSync: vi.fn(),
}));
vi.mock('./bible/hooks/useInitialDataLoader', () => ({
  useInitialDataLoader: vi.fn(),
}));
vi.mock('./bible/hooks/useBibleNavigation', () => ({
  useBibleNavigation: () => ({ handlePreviousChapter: vi.fn(), handleNextChapter: vi.fn() }),
}));
vi.mock('./bible/hooks/useBibleTabActions', () => ({
  useBibleTabActions: () => ({ handleDetachPane: vi.fn() }),
}));
vi.mock('./bible/hooks/useSessionPanelRestore', () => ({
  useSessionPanelRestore: () => false,
}));
vi.mock('./bible/hooks/useVerseInteractionHandlers', () => ({
  useVerseInteractionHandlers: () => ({
    handleVerseClick: vi.fn(), handleStrongsClick: vi.fn(), handleVerseContextMenu: vi.fn(),
    handleNoteIndicatorClick: vi.fn(), syncAllNotesPanelsWithVerse: vi.fn(), setStudyPaneActiveTab: vi.fn(),
  }),
}));
vi.mock('./bible/hooks/useBiblePaneContextValue', () => ({
  useBiblePaneContextValue: (args: any) => args,
}));

// Mock cross-cutting hooks
vi.mock('../hooks/useBibleScrolling', () => ({
  useBibleScrolling: () => ({ goBackWithScroll: vi.fn(), goForwardWithScroll: vi.fn(), navigateToHistoryEntryWithScroll: vi.fn() }),
}));
vi.mock('../hooks/useBibleHighlights', () => ({
  useBibleHighlights: () => ({
    showFloatingToolbar: vi.fn(), dismissFloatingToolbar: vi.fn(), buildSelectionFromDOM: vi.fn(),
    handleRemoveHighlight: vi.fn(), highlightMenu: null, setHighlightMenu: vi.fn(),
    handleSelectHighlight: vi.fn(), handleCancelHighlightMenu: vi.fn(),
    floatingToolbar: null, handleFloatingHighlight: vi.fn(), handleFloatingUnderline: vi.fn(),
    handleFloatingRemoveFormatting: vi.fn(), highlightRepository: null,
  }),
}));
vi.mock('../hooks/useBibleSelection', () => ({
  useBibleSelection: () => ({ handleMouseUpWithToolbar: vi.fn() }),
}));
vi.mock('../hooks/useBibleKeyboard', () => ({
  useBibleKeyboard: vi.fn(),
  useBibleFind: vi.fn(),
}));

// Mock sub-components
vi.mock('./BibleToolbar', () => ({ default: () => <div data-testid="bible-toolbar">Toolbar</div> }));
vi.mock('./BibleVerseList', () => ({ default: () => <div data-testid="bible-verse-list">VerseList</div> }));
vi.mock('./BiblePaneOverlays', () => ({ default: () => <div data-testid="bible-overlays" /> }));
// Stubbed like the other children: this suite is about what the pane composes,
// and the back bar has its own tests. Renders only when there is a preview to
// return from, so it stands in as `null` here.
vi.mock('./bible/PreviewBackBar', () => ({ default: () => null }));
vi.mock('./BiblePaneContext', () => ({
  BiblePaneProvider: ({ children }: any) => <div>{children}</div>,
}));

const defaultPanel = {
  availableBibles: [{ abbreviation: 'KJV', name: 'King James Version' }],
  openTabs: [{ tabId: 'tab1', abbreviation: 'KJV', displayMode: 'reading' }],
  activeTabIndex: 0,
  isParallelViewMode: false,
  currentBook: 43,
  currentChapter: 3,
  currentBookName: 'John',
  selectedVerseId: 43003016,
  versesByTab: new Map([['tab1', [{ verse_id: 43003016, text: 'For God so loved...' }]]]),
  loadingByTab: new Map(),
  errorByTab: new Map(),
  closeBible: vi.fn(),
  setDisplayMode: vi.fn(),
  loadChapter: vi.fn(),
  setSelectedVerse: vi.fn(),
  scrollTrigger: 0,
  scrollMode: 'nearest',
  saveScrollPosition: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  navigateToHistoryEntry: vi.fn(),
  canGoBack: false,
  canGoForward: false,
  initialLoadComplete: true,
  loadInitialData: vi.fn(),
  toggleParallelView: vi.fn(),
  openBible: vi.fn(),
  openPassageInNewPanel: vi.fn().mockResolvedValue('bible_new'),
  changeTabVersion: vi.fn(),
  loadingBibles: false,
  navigationHistory: [],
};

describe('BiblePane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBiblePanel.mockReturnValue(defaultPanel);
  });

  it('renders the bible pane container', () => {
    render(<BiblePane />);
    expect(screen.getByTestId('bible-pane')).toBeInTheDocument();
  });

  it('renders toolbar and verse list sub-components', () => {
    render(<BiblePane />);
    expect(screen.getByTestId('bible-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('bible-verse-list')).toBeInTheDocument();
  });

  // The passage is the dockview tab now, so the pane must not render a tab
  // strip of its own - that band is what the restructure removed.
  // See docs/Design/BiblePaneTabRestructure.md.
  it('renders no in-pane tab strip', () => {
    render(<BiblePane />);
    expect(screen.queryByTestId('bible-tab-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders no in-pane tab strip in parallel view mode', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultPanel,
      isParallelViewMode: true,
    });
    render(<BiblePane />);
    expect(screen.queryByTestId('bible-tab-bar')).not.toBeInTheDocument();
  });

  it('renders no in-pane tab strip when seeded from a contentKey', () => {
    render(<BiblePane contentKey="KJV|43|3|43003016|reading" />);
    expect(screen.queryByTestId('bible-tab-bar')).not.toBeInTheDocument();
  });

  it('renders only the toolbar band above the verse list', () => {
    const { container } = render(<BiblePane />);
    const pane = container.querySelector('[data-testid="bible-pane"]')!;
    // Toolbar + verse list + overlays. Any extra element here is a new band of
    // persistent chrome and needs to be justified against the 3-band target.
    expect(pane.children).toHaveLength(3);
    expect(pane.children[0]).toHaveAttribute('data-testid', 'bible-toolbar');
    expect(pane.children[1]).toHaveAttribute('data-testid', 'bible-verse-list');
  });

  it('renders overlays component', () => {
    render(<BiblePane />);
    expect(screen.getByTestId('bible-overlays')).toBeInTheDocument();
  });

  it('uses provided panelId prop', () => {
    render(<BiblePane panelId="custom-panel" />);
    expect(mockUseBiblePanel).toHaveBeenCalledWith('custom-panel');
  });

  it('uses default panel ID when no panelId provided', () => {
    render(<BiblePane />);
    expect(mockUseBiblePanel).toHaveBeenCalledWith('_default');
  });

  it('renders with no open tabs gracefully', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultPanel,
      openTabs: [],
      activeTabIndex: 0,
    });
    render(<BiblePane />);
    expect(screen.getByTestId('bible-pane')).toBeInTheDocument();
  });

  it('renders with loading state', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultPanel,
      loadingByTab: new Map([['tab1', true]]),
    });
    render(<BiblePane />);
    expect(screen.getByTestId('bible-pane')).toBeInTheDocument();
  });

  it('renders with error state', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultPanel,
      errorByTab: new Map([['tab1', 'Failed to load']]),
    });
    render(<BiblePane />);
    expect(screen.getByTestId('bible-pane')).toBeInTheDocument();
  });
});
