import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import CommentaryPane from './CommentaryPane';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { commentaryAPI } from '../services/electronAPI';
import { useSessionStore } from '../stores/useSessionStore';
import { enT } from '../testing/enCatalog';

// Mock useCommentaryPanel
const mockUseCommentaryPanel = vi.fn();
vi.mock('../stores/hooks/useCommentaryPanel', () => ({
  useCommentaryPanel: (...args: unknown[]) => mockUseCommentaryPanel(...args),
}));

// Mock stores
vi.mock('../stores/useCommentaryStore', () => ({
  useCommentaryStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
        reorderTabs: vi.fn(),
        unpin: vi.fn(),
        syncWithBibleVerse: vi.fn(),
      }),
      setState: vi.fn(),
    },
  ),
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    vi.fn().mockReturnValue(null),
    {
      getState: vi.fn().mockReturnValue({
        panels: new Map(),
        navigateToVerseInPrimary: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../stores/useTextSettingsStore', () => ({
  useTextSettingsStore: vi.fn().mockReturnValue({ fontFamily: 'serif', fontSize: 16, lineHeight: 1.6 }),
  getFontFamilyCSS: vi.fn().mockReturnValue('serif'),
}));

vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        addPanel: vi.fn(),
        dockviewApi: null,
      }),
    },
  ),
}));

vi.mock('../hooks/useOverlayDismissal', () => ({
  useOverlayDismissal: vi.fn(),
}));

// Mock API
vi.mock('../services/electronAPI', () => ({
  bibleAPI: { getBookNames: vi.fn().mockResolvedValue([]) },
  commentaryAPI: { hasContentForVerse: vi.fn().mockResolvedValue(false) },
}));

vi.mock('../utils/verseReference', () => ({
  loadBookNamesCache: vi.fn(),
  formatVerseReference: vi.fn().mockReturnValue('John 3:16'),
}));

vi.mock('../utils/verseFormatting', () => ({
  cleanModuleName: (name: string) => name.replace(/^commentary_/, ''),
}));

// Mock sub-components
vi.mock('./CommentaryTreeView', () => ({ default: () => <div data-testid="commentary-tree-view" /> }));
vi.mock('./CommentaryHome', () => ({ default: (props: any) => <div data-testid="commentary-home">Home {props.currentVerseId}</div> }));
vi.mock('./commentary/CommentaryPassageHeader', () => ({ default: () => <div data-testid="commentary-passage-header" /> }));
vi.mock('./commentary/CommentaryVersePreview', () => ({ default: () => <div data-testid="commentary-verse-preview" /> }));
vi.mock('./commentary/CommentaryPinnedBanner', () => ({ default: () => <div data-testid="commentary-pinned-banner" /> }));
vi.mock('./commentary/CommentaryContentArea', () => ({ default: () => <div data-testid="commentary-content-area" /> }));
vi.mock('./ModuleSelector', () => ({ default: (props: any) => (
  <div data-testid="module-selector">
    {props.modules?.map((m: any) => (
      <div key={m.id} data-testid={`module-${m.abbreviation}`}>
        <span>{m.abbreviation}</span>
        {m.availabilityLoading && <span data-testid={`loading-${m.abbreviation}`}>loading</span>}
        {m.availabilityLabel && <span data-testid={`avail-${m.abbreviation}`}>{m.availabilityLabel}</span>}
        {props.onRemove && m.openCount > 0 && (
          <button data-testid="module-selector-remove" onClick={() => props.onRemove(m)}>x</button>
        )}
      </div>
    ))}
    <button onClick={() => props.onSelect({ abbreviation: 'MHC', name: 'Matthew Henry' })}>Select</button>
    <button onClick={props.onClose}>Close</button>
  </div>
) }));
// Most tests want the lightweight stub (stable testids, no dnd-kit). The
// aria-wiring tests below need the *real* tab bar: the whole point there is
// that the ids CommentaryPane emits line up with the ones DraggableTabBar
// derives from `idPrefix`, and a stub re-implementing that scheme could agree
// with the pane while both disagreed with the real component.
const tabBarMode = vi.hoisted(() => ({ real: false }));
vi.mock('./DraggableTabBar', async () => {
  const actual = await vi.importActual<typeof import('./DraggableTabBar')>('./DraggableTabBar');
  const RealTabBar = actual.default;
  return {
    default: (props: any) => tabBarMode.real ? <RealTabBar {...props} /> : (
      <div data-testid="draggable-tab-bar">
        {props.prefixContent}
        {props.tabs?.map((t: any, i: number) => (
          <span key={i} onClick={() => props.onTabClick(i)}>
            {props.renderTab ? props.renderTab(t, i, i === props.activeTabIndex) : t.label}
          </span>
        ))}
        <button data-testid="add-btn" onClick={props.onAddClick}>+</button>
      </div>
    ),
  };
});

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: (key: string, params?: Record<string, unknown>) => enT(key, params), currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultPanelState = {
  availableCommentaries: [{ abbreviation: 'MHC', name: 'Matthew Henry', language_code: 'en', version: '1.0' }],
  loadingCommentaries: false,
  openTabs: [],
  activeTabIndex: 0,
  currentVerseId: 43003016,
  isRestoringSession: false,
  pinned: false,
  pinnedVerseId: null,
  liveBibleVerseId: null,
  entriesByTab: new Map(),
  loadingByTab: new Map(),
  errorByTab: new Map(),
  entrySummariesByTab: new Map(),
  loadingSummariesByTab: new Map(),
  loadAvailableCommentaries: vi.fn(),
  openCommentary: vi.fn(),
  closeCommentary: vi.fn(),
  setActiveTab: vi.fn(),
  syncWithBibleVerse: vi.fn(),
  togglePin: vi.fn(),
  loadHomeData: vi.fn(),
  navigateToNextVerse: vi.fn(),
  navigateToPreviousVerse: vi.fn(),
  navigateToVerse: vi.fn(),
  loadEntrySummaries: vi.fn(),
  initializeFromState: vi.fn(),
};

describe('CommentaryPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCommentaryPanel.mockReturnValue(defaultPanelState);
    // Most tests below exercise pane behavior with the overview active by
    // default, where isSessionLoaded is irrelevant. Default it to "loaded"
    // so the dedicated restore-gating tests are the only ones that need to
    // think about it.
    useSessionStore.setState({ isSessionLoaded: true });
  });

  it('renders the commentary pane container', () => {
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-pane')).toBeInTheDocument();
  });

  it('renders overview tab in tab bar', () => {
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-overview-tab')).toBeInTheDocument();
  });

  it('shows CommentaryHome when overview is active (default)', () => {
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-home')).toBeInTheDocument();
  });

  it('shows verse preview when verse is set', () => {
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-verse-preview')).toBeInTheDocument();
  });

  it('shows "no commentary open" when overview is off and no tabs', async () => {
    const user = userEvent.setup();
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      entriesByTab: new Map([['MHC', []]]),
    });
    renderWithProviders(<CommentaryPane />);
    // Click on MHC tab to deactivate overview
    await user.click(screen.getByText('MHC'));
    // Should show content area (not home)
    expect(screen.getByTestId('commentary-content-area')).toBeInTheDocument();
  });

  // "I don't see a clear way to remove a commentary tab." There are two now:
  // a x on the tab itself (as in the web app) and a x beside each open module
  // in the Add Commentary list. Both are hidden on the last remaining tab -
  // closing it would leave the strip with nothing but Overview.
  it('shows a close button on each commentary tab when more than one is open', async () => {
    const user = userEvent.setup();
    const closeCommentary = vi.fn();
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      closeCommentary,
      openTabs: [
        { abbreviation: 'MHC', name: 'Matthew Henry' },
        { abbreviation: 'BARNES', name: 'Barnes' },
      ],
      entriesByTab: new Map([['MHC', []], ['BARNES', []]]),
    });
    renderWithProviders(<CommentaryPane />);

    await user.click(screen.getByTestId('commentary-tab-close-BARNES'));
    expect(closeCommentary).toHaveBeenCalledWith('BARNES');
  });

  it('hides the tab close button when only one commentary is open', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      entriesByTab: new Map([['MHC', []]]),
    });
    renderWithProviders(<CommentaryPane />);

    expect(screen.queryByTestId('commentary-tab-close-MHC')).not.toBeInTheDocument();
  });

  it('offers a remove button beside an already-open commentary in the selector', async () => {
    const user = userEvent.setup();
    const closeCommentary = vi.fn();
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      closeCommentary,
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      entriesByTab: new Map([['MHC', []]]),
    });
    renderWithProviders(<CommentaryPane />);

    await user.click(screen.getByTestId('add-btn'));
    await user.click(screen.getByTestId('module-selector-remove'));
    expect(closeCommentary).toHaveBeenCalledWith('MHC');
  });

  it('opens module selector when add button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommentaryPane />);
    await user.click(screen.getByTestId('add-btn'));
    expect(screen.getByTestId('module-selector')).toBeInTheDocument();
  });

  it('does not show pinned banner when not pinned', () => {
    renderWithProviders(<CommentaryPane />);
    expect(screen.queryByTestId('commentary-pinned-banner')).not.toBeInTheDocument();
  });

  it('shows pinned banner when pinned and the Bible pane has moved on', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      pinned: true,
      pinnedVerseId: 43003015,
      // currentVerseId stays frozen at the pinned verse (real store behavior);
      // it's liveBibleVerseId that reflects where the Bible pane actually is.
      currentVerseId: 43003015,
      liveBibleVerseId: 43003016,
    });
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-pinned-banner')).toBeInTheDocument();
  });

  it('does not show pinned banner when pinned but the Bible pane has not moved from the pinned verse', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      pinned: true,
      pinnedVerseId: 43003015,
      currentVerseId: 43003015,
      liveBibleVerseId: 43003015,
    });
    renderWithProviders(<CommentaryPane />);
    expect(screen.queryByTestId('commentary-pinned-banner')).not.toBeInTheDocument();
  });

  it('shows passage header when a commentary tab is active', async () => {
    const user = userEvent.setup();
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      entriesByTab: new Map([['MHC', [{ entry_id: 1, content: 'Test' }]]]),
    });
    renderWithProviders(<CommentaryPane />);
    await user.click(screen.getByText('MHC'));
    expect(screen.getByTestId('commentary-passage-header')).toBeInTheDocument();
  });

  it('passes panelId to useCommentaryPanel', () => {
    renderWithProviders(<CommentaryPane panelId="custom-panel" />);
    expect(mockUseCommentaryPanel).toHaveBeenCalledWith('custom-panel');
  });

  it('labels the SYNTHESIS tab "Combined Summary" instead of the raw abbreviation', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      openTabs: [{ abbreviation: 'SYNTHESIS', name: 'Synthesis' }],
      entriesByTab: new Map([['SYNTHESIS', [{ entry_id: 1, content: 'Test' }]]]),
    });
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByText('Combined Summary')).toBeInTheDocument();
    expect(screen.queryByText('SYNTHESIS')).not.toBeInTheDocument();
  });

  it('renders with loading commentaries state', () => {
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      loadingCommentaries: true,
    });
    renderWithProviders(<CommentaryPane />);
    expect(screen.getByTestId('commentary-pane')).toBeInTheDocument();
  });
});

// Task 3: the commentary module picker now surfaces per-passage availability
// (mirroring web's commentaryStore.fetchAvailability) via ModuleSelector's
// opt-in `availabilityLabel`/`availabilityLoading` fields.
describe('CommentaryPane: commentary availability badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCommentaryPanel.mockReturnValue(defaultPanelState);
    useSessionStore.setState({ isSessionLoaded: true });
  });

  it('checks availability for every installed commentary when the selector opens', async () => {
    const user = userEvent.setup();
    vi.mocked(commentaryAPI.hasContentForVerse).mockResolvedValue(true);
    renderWithProviders(<CommentaryPane />);

    await user.click(screen.getByTestId('add-btn'));

    expect(commentaryAPI.hasContentForVerse).toHaveBeenCalledWith('MHC', 43003016);
    expect(await screen.findByTestId('avail-MHC')).toHaveTextContent('Has content for John 3:16');
  });

  it('degrades gracefully (no badge) when the availability check fails', async () => {
    const user = userEvent.setup();
    vi.mocked(commentaryAPI.hasContentForVerse).mockRejectedValue(new Error('db locked'));
    renderWithProviders(<CommentaryPane />);

    await user.click(screen.getByTestId('add-btn'));

    // Wait for the (rejected) check to settle without throwing out of the pane.
    await screen.findByTestId('module-MHC');
    expect(screen.queryByTestId('avail-MHC')).not.toBeInTheDocument();
    expect(screen.getByTestId('commentary-pane')).toBeInTheDocument();
  });

  it('caps concurrent availability checks so a large module set cannot stall the UI with an IPC burst', async () => {
    const user = userEvent.setup();
    const manyCommentaries = Array.from({ length: 20 }, (_, i) => ({
      abbreviation: `C${i}`,
      name: `Commentary ${i}`,
      language_code: 'en',
      version: '1.0',
    }));
    vi.mocked(commentaryAPI.hasContentForVerse).mockResolvedValue(false);
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      availableCommentaries: manyCommentaries,
    });
    renderWithProviders(<CommentaryPane />);

    await user.click(screen.getByTestId('add-btn'));
    await screen.findByTestId('module-C19'); // last module rendered by the mock

    expect(commentaryAPI.hasContentForVerse).toHaveBeenCalledTimes(12);
  });

  it('does not query availability at all until the selector is opened', () => {
    renderWithProviders(<CommentaryPane />);
    expect(commentaryAPI.hasContentForVerse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// The tab bar advertises `aria-controls` on every tab from `idPrefix`. These
// tests run against the real DraggableTabBar and follow that reference to the
// element it names - asserting only that the attribute is present would pass
// even when (as it did) it pointed at an element that does not exist.
// ---------------------------------------------------------------------
describe('CommentaryPane: tab/tabpanel wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabBarMode.real = true;
    useSessionStore.setState({ isSessionLoaded: true });
    mockUseCommentaryPanel.mockReturnValue({
      ...defaultPanelState,
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      entriesByTab: new Map([['MHC', [{ entry_id: 1, content: 'Test' }]]]),
    });
  });

  afterEach(() => {
    tabBarMode.real = false;
  });

  it("resolves the active tab's aria-controls to a real tabpanel", () => {
    // isDetached + overviewActive={false} is the only way to start the pane on
    // a commentary tab rather than the Overview tab.
    renderWithProviders(<CommentaryPane isDetached overviewActive={false} />);

    const tab = screen.getByRole('tab', { name: 'MHC' });
    const controls = tab.getAttribute('aria-controls');
    expect(controls).toBeTruthy();

    const panel = document.getElementById(controls as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    // ...and the relationship points back, so the panel is announced with the
    // tab's name.
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(panel).toContainElement(screen.getByTestId('commentary-content-area'));
  });

  it('keeps tabpanel ids unique when two commentary panes are open at once', () => {
    renderWithProviders(
      <>
        <CommentaryPane panelId="commentary_a" isDetached overviewActive={false} />
        <CommentaryPane panelId="commentary_b" isDetached overviewActive={false} />
      </>,
    );

    const panelIds = screen.getAllByRole('tabpanel').map(p => p.id);
    expect(panelIds).toHaveLength(2);
    expect(new Set(panelIds).size).toBe(2);
    // Each pane's tab must resolve to *its own* panel, not the other pane's.
    for (const tab of screen.getAllByRole('tab')) {
      expect(panelIds).toContain(tab.getAttribute('aria-controls'));
    }
  });

  it('does not claim a tabpanel when the Overview tab is showing', () => {
    renderWithProviders(<CommentaryPane />);

    expect(screen.getByTestId('commentary-home')).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
// 5.2 - startup empty-state flash: an empty `openTabs` with the overview
// off during session restore must show a neutral skeleton, not the
// alarming "Get a commentary"/"Choose a commentary" empty state.
// ---------------------------------------------------------------------
describe('CommentaryPane: startup restore gating (5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // isDetached + overviewActive=false is the only way to get the pane out
    // of the (always-true-on-mount, for non-detached panes) overview tab so
    // the "no commentary open" branch is even reachable in a test.
    mockUseCommentaryPanel.mockReturnValue({ ...defaultPanelState, openTabs: [] });
  });

  it('shows a neutral loading skeleton, not the empty state, while session restore is in progress', () => {
    useSessionStore.setState({ isSessionLoaded: false });
    renderWithProviders(<CommentaryPane isDetached overviewActive={false} />);

    expect(screen.getByTestId('commentary-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('commentary-empty-state')).not.toBeInTheDocument();
  });

  it('shows the real empty state once restore has resolved with genuinely zero tabs', () => {
    useSessionStore.setState({ isSessionLoaded: true });
    renderWithProviders(<CommentaryPane isDetached overviewActive={false} />);

    expect(screen.queryByTestId('commentary-loading-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('commentary-empty-state')).toBeInTheDocument();
  });
});
