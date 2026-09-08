import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import DictionaryPane from './DictionaryPane';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useSessionStore } from '../stores/useSessionStore';
import { enString, enT } from '../testing/enCatalog';

// Mock hooks
const mockUseDictionaryPanel = vi.fn();
vi.mock('../stores/hooks/useDictionaryPanel', () => ({
  useDictionaryPanel: (...args: unknown[]) => mockUseDictionaryPanel(...args),
}));

// Mutable so individual tests can seed the shared (cross-panel) slice, which
// is where `recentLookups` lives.
const mockStoreState: { recentLookups: unknown[] } = { recentLookups: [] };

const dictPanelLifecycle = {
  initPanel: vi.fn(),
  detachPanel: vi.fn(),
  destroyPanel: vi.fn(),
  getPanelState: vi.fn().mockReturnValue({
    entriesByTab: new Map(),
    searchResultsByTab: new Map(),
  }),
};
vi.mock('../stores/useDictionaryStore', () => ({
  useDictionaryStore: Object.assign(
    (selector: (s: any) => any) => selector(mockStoreState),
    { getState: () => dictPanelLifecycle },
  ),
}));

vi.mock('../stores/useTextSettingsStore', () => ({
  useTextSettingsStore: vi.fn().mockReturnValue({ fontFamily: 'serif', fontSize: 16, lineHeight: 1.6 }),
  getFontFamilyCSS: vi.fn().mockReturnValue('serif'),
}));

vi.mock('../utils/verseReference', () => ({
  formatVerseReference: (id: number) => `Verse ${id}`,
}));

vi.mock('../utils/verseFormatting', () => ({
  cleanModuleName: (name: string) => name.replace(/^dictionary_/, ''),
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

// Mock ModuleSelector
vi.mock('./ModuleSelector', () => ({ default: (props: any) => <div data-testid="module-selector"><button onClick={props.onClose}>Close</button></div> }));

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

const defaultDictPanel = {
  availableDictionaries: [{ abbreviation: 'strongs', name: "Strong's", language_code: 'en', version: '1.0' }],
  loadingDictionaries: false,
  openTabs: [],
  activeTabIndex: 0,
  entriesByTab: new Map(),
  loadingByTab: new Map(),
  errorByTab: new Map(),
  allEntriesByTab: new Map(),
  loadingAllEntriesByTab: new Map(),
  allEntriesCompleteByTab: new Map(),
  searchResultsByTab: new Map(),
  searchingByTab: new Map(),
  loadAvailableDictionaries: vi.fn(),
  openDictionary: vi.fn(),
  closeDictionary: vi.fn(),
  setActiveTab: vi.fn(),
  lookupEntry: vi.fn(),
  searchDictionary: vi.fn(),
  loadAllEntries: vi.fn(),
  clearError: vi.fn(),
  navHistory: [],
  navIndex: -1,
  goBack: vi.fn(),
  goForward: vi.fn(),
};

describe('DictionaryPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.recentLookups = [];
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    // These tests exercise the pane's steady-state behavior (app already
    // running), not the startup-restore window - mark the session loaded so
    // an empty `openTabs` renders the real empty state instead of the
    // restore-in-progress skeleton (see PaneLoadingSkeleton).
    useSessionStore.setState({ isSessionLoaded: true });
  });

  it('renders the dictionary pane container', () => {
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-pane')).toBeInTheDocument();
  });

  it('coaches the user when no dictionary has been chosen yet', () => {
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-empty-state')).toBeInTheDocument();
  });

  it('offers the one action that fills an empty dictionary pane', () => {
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-empty-choose')).toBeInTheDocument();
  });

  it('shows lookup prompt when tab is open but no entry loaded', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
    });
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-no-entry-state')).toBeInTheDocument();
  });

  it('shows lookup input when tabs are open', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
    });
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-lookup-input')).toBeInTheDocument();
  });

  it('shows dictionary entry when loaded', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      entriesByTab: new Map([['strongs', {
        entry_key: 'G25',
        word: 'agapao',
        definition: 'To love, value, esteem',
        transliteration: 'agapao',
        pronunciation: 'ag-ap-ah-o',
        part_of_speech: 'verb',
        etymology: null,
        usage_notes: null,
        semantic_range: null,
        related_words: [],
        example_verses: [],
      }]]),
    });
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByTestId('dictionary-entry')).toBeInTheDocument();
    expect(screen.getByTestId('dictionary-entry-key')).toHaveTextContent('G25');
  });

  it('shows loading state (after the 80ms defer threshold, so brief lookups do not flicker)', async () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      loadingByTab: new Map([['strongs', true]]),
    });
    renderWithProviders(<DictionaryPane />);
    expect(await screen.findByText(enString('dictionaryPane.loadingEntry'))).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      errorByTab: new Map([['strongs', 'Entry not found']]),
    });
    renderWithProviders(<DictionaryPane />);
    expect(screen.getByText('Entry not found')).toBeInTheDocument();
  });

  it('hides tab bar when hideTabs is true', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
    });
    renderWithProviders(<DictionaryPane hideTabs />);
    // Tab bar should not be rendered
    screen.queryByText("Strong's");
    // When hideTabs, the tab container with border-b is not rendered
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  it('opens module selector on button click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DictionaryPane />);
    await user.click(screen.getByTestId('dictionary-empty-choose'));
    expect(screen.getByTestId('module-selector')).toBeInTheDocument();
  });

  it('shows related words for an entry', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      entriesByTab: new Map([['strongs', {
        entry_key: 'G25',
        word: 'agapao',
        definition: 'To love',
        related_words: ['G26', 'G5368'],
        example_verses: [],
      }]]),
    });
    renderWithProviders(<DictionaryPane />);
    const relatedBtns = screen.getAllByTestId('related-word-btn');
    expect(relatedBtns).toHaveLength(2);
    expect(relatedBtns[0]).toHaveTextContent('G26');
  });

  it('calls lookupEntry when related word is clicked', async () => {
    const user = userEvent.setup();
    const mockLookup = vi.fn();
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      entriesByTab: new Map([['strongs', {
        entry_key: 'G25',
        word: 'agapao',
        definition: 'To love',
        related_words: ['G26'],
        example_verses: [],
      }]]),
      lookupEntry: mockLookup,
    });
    renderWithProviders(<DictionaryPane />);
    await user.click(screen.getByTestId('related-word-btn'));
    expect(mockLookup).toHaveBeenCalledWith('strongs', 'G26');
  });

  // ---------------------------------------------------------------------
  // 5.2 - startup empty-state flash: an empty `openTabs` during session
  // restore must show a neutral skeleton, not the alarming "Get a
  // dictionary"/"Choose a dictionary" empty state.
  // ---------------------------------------------------------------------
  describe('startup restore gating (5.2)', () => {
    it('shows a neutral loading skeleton, not the empty state, while session restore is in progress', () => {
      useSessionStore.setState({ isSessionLoaded: false });
      renderWithProviders(<DictionaryPane />);

      expect(screen.getByTestId('dictionary-loading-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('dictionary-empty-state')).not.toBeInTheDocument();
    });

    it('shows the real empty state once restore has resolved with genuinely zero tabs', () => {
      useSessionStore.setState({ isSessionLoaded: true });
      renderWithProviders(<DictionaryPane />);

      expect(screen.queryByTestId('dictionary-loading-skeleton')).not.toBeInTheDocument();
      expect(screen.getByTestId('dictionary-empty-state')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // F13 - the Recent menu must dismiss like every other overlay.
  // ---------------------------------------------------------------------
  describe('Recent dropdown dismissal (F13)', () => {
    beforeEach(() => {
      mockStoreState.recentLookups = [
        { abbreviation: 'strongs', entry_key: '00025', word: 'agapao', timestamp: 1 },
      ];
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      });
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      expect(screen.getByTestId('dictionary-recent-menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('dictionary-recent-menu')).not.toBeInTheDocument();
    });

    it('closes on a click outside itself', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      expect(screen.getByTestId('dictionary-recent-menu')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('dictionary-recent-menu')).not.toBeInTheDocument();
    });

    it('stays open when the menu itself is moused down', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      fireEvent.mouseDown(screen.getByTestId('dictionary-recent-menu'));

      expect(screen.getByTestId('dictionary-recent-menu')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // F2 - Recent is a cross-module trail: rows name their dictionary, render
  // the human-readable key, and open in the module they came from.
  // ---------------------------------------------------------------------
  describe('Recent as a cross-module trail (F2)', () => {
    const recentGreek = {
      abbreviation: 'StrongsGreek',
      entry_key: '00025',
      word: 'agapao',
      timestamp: 1,
    };

    it("renders the Strong's display key and the dictionary it came from", async () => {
      const user = userEvent.setup();
      mockStoreState.recentLookups = [recentGreek];
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'easton', name: "Easton's" }],
      });
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      const row = screen.getByTestId('dictionary-recent-item');
      expect(row).toHaveTextContent('G25');
      expect(row).not.toHaveTextContent('00025');
      expect(row).toHaveTextContent('StrongsGreek');
    });

    it('activates the entry’s own dictionary before looking it up', async () => {
      const user = userEvent.setup();
      const openDictionary = vi.fn();
      const lookupEntry = vi.fn();
      mockStoreState.recentLookups = [recentGreek];
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        availableDictionaries: [
          { abbreviation: 'StrongsGreek', name: "Strong's Greek", language_code: 'en', version: '1.0' },
        ],
        openTabs: [{ abbreviation: 'easton', name: "Easton's" }],
        openDictionary,
        lookupEntry,
      });
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      await user.click(screen.getByTestId('dictionary-recent-item'));

      expect(openDictionary).toHaveBeenCalledWith('StrongsGreek', "Strong's Greek");
      expect(lookupEntry).toHaveBeenCalledWith('StrongsGreek', '00025');
      expect(screen.queryByTestId('dictionary-recent-menu')).not.toBeInTheDocument();
    });

    it('keeps a non-Strong’s key exactly as stored', async () => {
      const user = userEvent.setup();
      mockStoreState.recentLookups = [
        { abbreviation: 'easton', entry_key: 'Abednego', word: undefined, timestamp: 1 },
      ];
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'easton', name: "Easton's" }],
      });
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-recent-toggle'));
      expect(screen.getByTestId('dictionary-recent-item')).toHaveTextContent('Abednego');
    });
  });

  // ---------------------------------------------------------------------
  // Tab-loss regression: this component is rendered conditionally inside
  // BookPane, so it unmounts on an ordinary tab switch. Clearing the panel
  // state there deleted the user's open dictionaries - and the session
  // serializer then wrote the empty state over the good one.
  // ---------------------------------------------------------------------
  describe('panel lifecycle', () => {
    it('only detaches when its component goes away — a tab switch is not a close', () => {
      const { unmount } = renderWithProviders(<DictionaryPane panelId="book_abc" />);
      expect(dictPanelLifecycle.initPanel).toHaveBeenCalledWith('book_abc');

      unmount();

      expect(dictPanelLifecycle.detachPanel).toHaveBeenCalledWith('book_abc');
      // Deleting the state is dockview's onDidRemovePanel's job alone.
      expect(dictPanelLifecycle.destroyPanel).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Live search - the box shows matches as the word is typed, so a
  // half-remembered spelling is enough. See DictionaryLiveSearch.
  // ---------------------------------------------------------------------
  describe('as-you-type search', () => {
    const openTabs = [{ abbreviation: 'strongs', name: "Strong's" }];
    const matches = [
      { entry_key: '00025', word: 'agapao', definition: '<b>To love</b>, value, esteem' },
      { entry_key: '00026', word: 'agape', definition: 'Love, affection' },
    ];

    it('searches on a debounce once the query is long enough', async () => {
      const searchDictionary = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs, searchDictionary });
      renderWithProviders(<DictionaryPane />);

      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'a' } });
      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'agap' } });

      await waitFor(() => expect(searchDictionary).toHaveBeenCalledWith('strongs', 'agap', 25));
      // One query for the pause at the end, not one per keystroke.
      expect(searchDictionary).toHaveBeenCalledTimes(1);
    });

    it("searches a Strong's number by its stored zero-padded key", async () => {
      const searchDictionary = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs, searchDictionary });
      renderWithProviders(<DictionaryPane />);

      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'G25' } });

      await waitFor(() => expect(searchDictionary).toHaveBeenCalledWith('strongs', '00025', 25));
    });

    it('lists the matches under the box and opens the one that is clicked', async () => {
      const lookupEntry = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs,
        searchResultsByTab: new Map([['strongs', matches]]),
        lookupEntry,
      });
      renderWithProviders(<DictionaryPane />);

      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'agap' } });

      const rows = await screen.findAllByTestId('dictionary-live-result');
      expect(rows).toHaveLength(2);
      // The definition is stored as HTML; the row previews it as plain text.
      expect(rows[0]).toHaveTextContent('To love, value, esteem');

      fireEvent.mouseDown(rows[1]);
      expect(lookupEntry).toHaveBeenCalledWith('strongs', '00026');
    });

    it('opens the highlighted match on Enter rather than falling back to the browse dialog', async () => {
      const lookupEntry = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs,
        searchResultsByTab: new Map([['strongs', matches]]),
        lookupEntry,
      });
      renderWithProviders(<DictionaryPane />);

      const input = screen.getByTestId('dictionary-lookup-input');
      fireEvent.change(input, { target: { value: 'agap' } });
      await screen.findAllByTestId('dictionary-live-result');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.submit(input.closest('form') as HTMLFormElement);

      expect(lookupEntry).toHaveBeenCalledWith('strongs', '00026');
      expect(screen.queryByTestId('dictionary-live-results')).not.toBeInTheDocument();
    });

    it('says so when nothing matches, instead of leaving the box looking broken', async () => {
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs });
      renderWithProviders(<DictionaryPane />);

      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'zzzz' } });

      expect(await screen.findByTestId('dictionary-live-no-matches')).toHaveTextContent('zzzz');
    });

    it('stays quiet for a query too short to be worth a query', () => {
      const searchDictionary = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs, searchDictionary });
      renderWithProviders(<DictionaryPane />);

      fireEvent.change(screen.getByTestId('dictionary-lookup-input'), { target: { value: 'a' } });

      expect(screen.queryByTestId('dictionary-live-results')).not.toBeInTheDocument();
      expect(searchDictionary).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // F14 - the browse list must say how much of the dictionary it is showing
  // and offer the rest.
  // ---------------------------------------------------------------------
  describe('Browse list disclosure and paging (F14)', () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      entry_key: String(i).padStart(5, '0'),
      word: `word${i}`,
      definition: `definition ${i}`,
    }));

    /*
      The dialog no longer has a "Browse" button of its own - a 5,700-entry
      lexicon listed in storage order is not something anyone browses, and the
      button sat next to the search box competing with it. Its surviving job is
      disambiguation: a term that matches several entries opens the dialog on
      those matches, which is the one case the list is genuinely good at.
    */
    async function openViaAmbiguousLookup(
      user: ReturnType<typeof userEvent.setup>,
      matches: Array<{ entry_key: string }>,
    ): Promise<void> {
      dictPanelLifecycle.getPanelState.mockReturnValue({
        entriesByTab: new Map(),
        searchResultsByTab: new Map([['strongs', matches]]),
      });
      await user.type(screen.getByTestId('dictionary-lookup-input'), 'love');
      await user.click(screen.getByTestId('dictionary-lookup-btn'));
      // The dialog opens showing those matches; clearing its own search box is
      // what asks it for the full list, which is what paging is about.
      await user.clear(await screen.findByTestId('dictionary-browse-search-input'));
      await user.click(screen.getByTestId('dictionary-browse-search-btn'));
    }

    it('discloses a truncated list and offers more', async () => {
      const user = userEvent.setup();
      const loadAllEntries = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
        allEntriesByTab: new Map([['strongs', page]]),
        allEntriesCompleteByTab: new Map([['strongs', false]]),
        loadAllEntries,
      });
      renderWithProviders(<DictionaryPane />);

      await openViaAmbiguousLookup(user, page.slice(0, 2));
      expect(await screen.findByTestId('dictionary-browse-count'))
        .toHaveTextContent('Showing the first 100 entries');

      await user.click(screen.getByTestId('dictionary-browse-load-more'));
      // Next page, appended, starting where the loaded list ends.
      expect(loadAllEntries).toHaveBeenCalledWith('strongs', 100, 100, true);
    });

    it('says so, and stops offering more, once the whole list is loaded', async () => {
      const user = userEvent.setup();
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
        allEntriesByTab: new Map([['strongs', page.slice(0, 3)]]),
        allEntriesCompleteByTab: new Map([['strongs', true]]),
      });
      renderWithProviders(<DictionaryPane />);

      await openViaAmbiguousLookup(user, page.slice(0, 2));
      expect(await screen.findByTestId('dictionary-browse-count'))
        .toHaveTextContent('Showing all 3 entries');
      expect(screen.queryByTestId('dictionary-browse-load-more')).not.toBeInTheDocument();
    });
  });

  /*
    The toolbar wears the Bible pane's furniture.

    Every pane had grown its own: the Bible pane a band of flush icon cells,
    Dictionary a row of rounded pills with a text "Recent v" button and a
    hand-rolled "Aa" box. Same gestures, different faces, so moving between
    panes meant re-learning where the controls were.
  */
  describe('toolbar', () => {
    const OPEN = [{ abbreviation: 'strongs', name: "Strong's" }];

    it('is a toolbar, with the shared settings gear rather than an Aa box', () => {
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: OPEN });
      renderWithProviders(<DictionaryPane />);

      expect(screen.getByTestId('dictionary-toolbar')).toHaveAttribute('role', 'toolbar');
      expect(screen.getByTestId('passage-settings')).toBeInTheDocument();
    });

    // "Recent" was a text button with a caret; the Bible pane calls the same
    // list a clock icon.
    it('offers the trail behind the history icon, disabled while there is no trail', () => {
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: OPEN });
      renderWithProviders(<DictionaryPane />);

      const toggle = screen.getByTestId('dictionary-recent-toggle');
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveTextContent('');
    });

    it('steps back and forward through the pane trail', async () => {
      const user = userEvent.setup();
      const goBack = vi.fn();
      const goForward = vi.fn();
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: OPEN,
        navHistory: [
          { abbreviation: 'strongs', entryKey: '00025' },
          { abbreviation: 'strongs', entryKey: '00026' },
        ],
        navIndex: 1,
        goBack,
        goForward,
      });
      renderWithProviders(<DictionaryPane />);

      await user.click(screen.getByTestId('dictionary-back'));
      expect(goBack).toHaveBeenCalled();
      // At the end of the trail there is nowhere forward to go.
      expect(screen.getByTestId('dictionary-forward')).toBeDisabled();
    });

    it('disables Back at the start of the trail', () => {
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: OPEN,
        navHistory: [{ abbreviation: 'strongs', entryKey: '00025' }],
        navIndex: 0,
      });
      renderWithProviders(<DictionaryPane />);

      expect(screen.getByTestId('dictionary-back')).toBeDisabled();
    });

    // 5,700 entries in storage order is not something anyone browses, and the
    // button sat beside the search box competing with it.
    it('offers no Browse button — the search box is the way in', () => {
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: OPEN });
      renderWithProviders(<DictionaryPane />);

      expect(screen.queryByText('Browse')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dictionary-empty-browse')).not.toBeInTheDocument();
    });

    // "Nothing looked up yet" over a "Browse all entries" button was an
    // accusation followed by the least useful thing on offer.
    it('invites a lookup rather than reporting that none has happened', () => {
      mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: OPEN });
      renderWithProviders(<DictionaryPane />);

      const empty = screen.getByTestId('dictionary-no-entry-state');
      expect(empty).toHaveTextContent('Look up a word in strongs');
      expect(empty).not.toHaveTextContent('Nothing looked up yet');
    });
  });

  // ---------------------------------------------------------------------
  // F17 - ids are per-panel, so two panels on screen don't collide.
  // ---------------------------------------------------------------------
  describe('per-panel tab ids (F17)', () => {
    it('scopes the tabpanel and tab ids to the panel, and wires them together', () => {
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [{ abbreviation: 'strongs', name: "Strong's" }],
      });
      const { container } = renderWithProviders(<DictionaryPane panelId="panel-b" />);

      const tab = screen.getByRole('tab');
      expect(tab).toHaveAttribute('id', 'dictionary-tab-panel-b-strongs');
      expect(tab).toHaveAttribute('aria-controls', 'dictionary-tabpanel-panel-b');
      expect(container.querySelector('#dictionary-tabpanel-panel-b')).not.toBeNull();
      expect(container.querySelector('#dictionary-tabpanel')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // F21 - which open dictionaries actually had an entry, at a glance.
  // ---------------------------------------------------------------------
  describe('tab content shading (F21)', () => {
    it('marks only the tabs that hold an entry', () => {
      mockUseDictionaryPanel.mockReturnValue({
        ...defaultDictPanel,
        openTabs: [
          { abbreviation: 'strongs', name: "Strong's" },
          { abbreviation: 'easton', name: "Easton's" },
        ],
        entriesByTab: new Map([['strongs', { entry_key: 'G25', definition: 'To love' }]]),
      });
      const { container } = renderWithProviders(<DictionaryPane />);

      const shaded = container.querySelectorAll('[data-has-content="true"]');
      expect(shaded).toHaveLength(1);
      expect(shaded[0]).toHaveTextContent("strongs");
    });
  });
});
