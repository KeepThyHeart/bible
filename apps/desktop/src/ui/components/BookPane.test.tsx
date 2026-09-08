import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BookPane from './BookPane';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

// Mock hooks
const mockUseBookPanel = vi.fn();
vi.mock('../stores/hooks/useBookPanel', () => ({
  useBookPanel: (...args: unknown[]) => mockUseBookPanel(...args),
}));

const mockUseDictionaryPanel = vi.fn();
vi.mock('../stores/hooks/useDictionaryPanel', () => ({
  useDictionaryPanel: (...args: unknown[]) => mockUseDictionaryPanel(...args),
}));

const bookPanelLifecycle = {
  initPanel: vi.fn(),
  detachPanel: vi.fn(),
  destroyPanel: vi.fn(),
};
vi.mock('../stores/useBookStore', () => ({
  useBookStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    { getState: () => bookPanelLifecycle },
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

vi.mock('../utils/verseFormatting', () => ({
  cleanModuleName: (name: string) => name.replace(/^book_/, ''),
}));

// Mock sub-components
vi.mock('./DictionaryPane', () => ({ default: () => <div data-testid="dictionary-pane-embedded" /> }));
// Renders whatever BookPane's custom `renderTab` produces, so the tab chrome
// (close button, badge) is covered rather than stubbed away.
vi.mock('./DraggableTabBar', () => ({ default: (props: any) => (
  <div data-testid="book-tab-bar" data-active-index={String(props.activeTabIndex)}>
    {/* The real bar renders this ahead of the tabs; the Overview tab lives here
        rather than in `tabs` because it owns no `role="tab"`. */}
    {props.prefixContent}
    {props.tabs?.map((t: any, i: number) => (
      <span
        key={i}
        data-testid={`book-tab-${t.id}`}
        data-index={String(i)}
        data-subtitle={t.subtitle ?? ''}
        data-has-content={String(!!t.hasContent)}
        onClick={() => props.onTabClick(i)}
      >
        {props.renderTab ? props.renderTab(t, i, i === props.activeTabIndex) : t.label}
      </span>
    ))}
    <button data-testid="book-add-btn" onClick={props.onAddClick}>+</button>
    {/* Stands in for @dnd-kit: a drag is just a (source, destination) pair. */}
    <button
      data-testid="book-drag"
      onClick={(e) => {
        const el = e.currentTarget;
        props.onReorder(Number(el.dataset.from), Number(el.dataset.to));
      }}
    />
    {props.paneMenuOptions?.map((option: any) => (
      <button key={option.id} data-testid={`book-pane-menu-${option.id}`} onClick={option.onClick}>
        {option.label}
      </button>
    ))}
  </div>
) }));
vi.mock('./BookPane/BookTabMenuItem', () => ({ BookTabMenuItem: () => <div /> }));
vi.mock('./BookPane/BookNavigationToolbar', () => ({ BookNavigationToolbar: (props: any) => (
  <div
    data-testid="book-nav-toolbar"
    data-next={props.nextSectionInfo ? props.nextSectionInfo.title : ''}
    data-prev={props.prevSectionInfo ? props.prevSectionInfo.title : ''}
  />
) }));
vi.mock('./BookPane/BookSectionContent', () => ({ BookSectionContent: () => <div data-testid="book-section-content">Content</div> }));
vi.mock('./BookPane/BookHome', () => ({ default: () => <div data-testid="book-home" /> }));
vi.mock('./BookPane/BookModuleSelectorModal', () => ({ BookModuleSelectorModal: (props: any) => <div data-testid="book-module-selector" data-selector-type={props.selectorType}><button onClick={props.onClose}>Close</button></div> }));
vi.mock('./BookPane/sectionTreeRenderers', () => ({ getFirstSectionId: () => 1 }));
const mockNavSectionInfo = vi.fn(() => ({ nextSectionInfo: null, prevSectionInfo: null } as {
  nextSectionInfo: { section_id: number; title: string } | null;
  prevSectionInfo: { section_id: number; title: string } | null;
}));
vi.mock('./BookPane/hooks/useNavSectionInfo', () => ({
  useNavSectionInfo: () => mockNavSectionInfo(),
}));
vi.mock('./BookPane/hooks/useDetachedInit', () => ({
  useDetachedInit: vi.fn(),
}));

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

const defaultBookPanel = {
  availableBooks: [{ abbreviation: 'book_test', name: 'Test Book' }],
  loadingBooks: false,
  openTabs: [],
  activeTabIndex: 0,
  tabOrder: [],
  setTabOrder: vi.fn(),
  currentSectionByTab: new Map(),
  sectionsByTab: new Map(),
  loadingByTab: new Map(),
  errorByTab: new Map(),
  sectionSummariesByTab: new Map(),
  loadingSummariesByTab: new Map(),
  summariesErrorByTab: new Map(),
  childSectionsByTab: new Map(),
  loadAvailableBooks: vi.fn(),
  openBook: vi.fn(),
  closeBook: vi.fn(),
  setActiveTab: vi.fn(),
  reorderTabs: vi.fn(),
  navigateToNextSection: vi.fn(),
  navigateToPreviousSection: vi.fn(),
  navigateToParentSection: vi.fn(),
  navigateToSection: vi.fn(),
  navigateToHome: vi.fn(),
  loadSectionSummaries: vi.fn(),
};

const defaultDictPanel = {
  availableDictionaries: [],
  loadingDictionaries: false,
  openTabs: [],
  activeTabIndex: 0,
  entriesByTab: new Map(),
  loadAvailableDictionaries: vi.fn(),
  openDictionary: vi.fn(),
  closeDictionary: vi.fn(),
  setActiveTab: vi.fn(),
  reorderTabs: vi.fn(),
};

describe('BookPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  it('renders the books pane container', () => {
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('books-pane')).toBeInTheDocument();
  });

  it('shows tab bar', () => {
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('book-tab-bar')).toBeInTheDocument();
  });

  // The shelf is how you find a module, so it is the landing view for a pane
  // with nothing open - the report was that navigating to Dictionary showed
  // anything but its Overview.
  it('lands on the shelf when nothing is open', () => {
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('library-home')).toBeInTheDocument();
  });

  it('coaches the user once the shelf is dismissed with nothing open', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookPane />);
    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('book-dict-empty-state')).toBeInTheDocument();
    // A Books pane offers books only; offering a dictionary here too is what
    // puts the two kinds in one pane.
    expect(screen.getByTestId('library-empty-book')).toBeInTheDocument();
    expect(screen.queryByTestId('library-empty-dictionary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-empty-dictionary-install')).not.toBeInTheDocument();
  });

  it('offers a dictionary, and no book, on a Dictionary pane', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookPane paneKind="dictionary" />);
    await user.click(screen.getByTestId('library-overview-tab'));
    // No dictionary is installed in the default fixture, so the empty state
    // routes the user to the Module Manager to get one (the on-ramp) rather
    // than dead-ending on a selector with nothing in it.
    expect(screen.getByTestId('library-empty-dictionary-install')).toBeInTheDocument();
    expect(screen.queryByTestId('library-empty-book')).not.toBeInTheDocument();
  });

  it('shows book content when book tab is open with section', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [{ abbreviation: 'book_test', name: 'Test Book' }],
      sectionsByTab: new Map([['book_test', { section_id: 1, title: 'Chapter 1', content: '<p>Content</p>', parent_section_id: null }]]),
    });
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();
  });

  // A local SQLite section read usually resolves in well under 80ms; showing a
  // loading UI for it produced a full-pane flash on every navigation.
  it('does not flash a loading state for a fast section load', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [{ abbreviation: 'book_test', name: 'Test Book' }],
      loadingByTab: new Map([['book_test', true]]),
    });
    renderWithProviders(<BookPane />);
    expect(screen.queryByTestId('book-loading-skeleton')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton once a section load runs long', async () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [{ abbreviation: 'book_test', name: 'Test Book' }],
      loadingByTab: new Map([['book_test', true]]),
    });
    renderWithProviders(<BookPane />);
    expect(await screen.findByTestId('book-loading-skeleton')).toBeInTheDocument();
  });

  it('shows error state for book content', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [{ abbreviation: 'book_test', name: 'Test Book' }],
      errorByTab: new Map([['book_test', 'Load failed']]),
    });
    renderWithProviders(<BookPane />);
    expect(screen.getByText('Load failed')).toBeInTheDocument();
  });

  it('opens module selector when add button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookPane />);
    await user.click(screen.getByTestId('book-add-btn'));
    expect(screen.getByTestId('book-module-selector')).toBeInTheDocument();
  });

  it('shows navigation toolbar when section is loaded', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [{ abbreviation: 'book_test', name: 'Test Book' }],
      sectionsByTab: new Map([['book_test', { section_id: 1, title: 'Chapter 1', content: '<p>Test</p>', parent_section_id: null }]]),
    });
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('book-nav-toolbar')).toBeInTheDocument();
  });

  it('shows the embedded DictionaryPane on a Dictionary pane with a tab open', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'dict_test', name: 'Test Dict' }],
    });
    renderWithProviders(<BookPane paneKind="dictionary" />);
    expect(screen.getByTestId('dictionary-pane-embedded')).toBeInTheDocument();
  });

  // The reader opened Books; a dictionary tab sharing the panel state must not
  // pull the dictionary UI into it.
  it('never shows the dictionary on a Books pane', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [{ abbreviation: 'dict_test', name: 'Test Dict' }],
    });
    renderWithProviders(<BookPane />);
    expect(screen.queryByTestId('dictionary-pane-embedded')).not.toBeInTheDocument();
  });

  it('passes panelId to useBookPanel', () => {
    renderWithProviders(<BookPane panelId="custom-book" />);
    expect(mockUseBookPanel).toHaveBeenCalledWith('custom-book');
  });
});

const OPEN_BOOK_TAB = { abbreviation: 'book_test', name: 'Test Book' };
const A_SECTION = { section_id: 1, title: 'Chapter 1', content: '<p>Content</p>', parent_section_id: null };

describe('BookPane: table of contents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  /*
    A book with no section showing is on its Home page, which *is* the contents,
    plus a search box over its full text - not its first section with the
    contents behind a "Contents" button that opens a modal over the pane.
  */
  it('shows the book Home page when no section is open', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-home')).toBeInTheDocument();
  });

  // The auto-load guard reads "has this tab been attempted", not "is the array
  // empty" - an empty-but-present result is a completed attempt, so a failing
  // query is not re-fired on every render.
  it('does not re-request summaries for a tab whose load already resolved empty', () => {
    const loadSectionSummaries = vi.fn();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
      childSectionsByTab: new Map([['book_test', [{ section_id: 2, title: 'Child' }]]]),
      sectionSummariesByTab: new Map([['book_test', []]]),
      loadSectionSummaries,
    });
    const { rerender } = renderWithProviders(<BookPane />);
    rerender(<ContextProvider services={createMockServices()}><BookPane /></ContextProvider>);

    expect(loadSectionSummaries).not.toHaveBeenCalled();
  });

  it('requests summaries once for a tab that has never been attempted', () => {
    const loadSectionSummaries = vi.fn();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
      childSectionsByTab: new Map([['book_test', [{ section_id: 2, title: 'Child' }]]]),
      loadSectionSummaries,
    });
    const { rerender } = renderWithProviders(<BookPane />);
    rerender(<ContextProvider services={createMockServices()}><BookPane /></ContextProvider>);

    expect(loadSectionSummaries).toHaveBeenCalledTimes(1);
  });
});

describe('BookPane: book/dictionary split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  /*
    Books and dictionaries are two panes, and each lists only its own kind -
    even when both stores hold tabs under the same panel id. Sharing one pane,
    one tab strip and a "which half is showing" toggle would let a reader who
    opened Dictionary end up looking at books, and vice versa.
  */
  it('lists only book tabs on a Books pane', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    renderWithProviders(<BookPane />);

    expect(stripLabels()).toEqual(['book-tab-book-book_test']);
  });

  it('lists only dictionary tabs on a Dictionary pane', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    expect(stripLabels()).toEqual(['book-tab-dict-dict_test']);
  });

  it('shows the dictionary on a dictionary panel even with a book tab in the panel state', () => {
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    expect(screen.getByTestId('dictionary-pane-embedded')).toBeInTheDocument();
    expect(screen.queryByTestId('book-section-content')).not.toBeInTheDocument();
  });

  it('opens the selector on Dictionaries for a dictionary panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookPane paneKind="dictionary" />);

    await user.click(screen.getByTestId('book-add-btn'));

    expect(screen.getByTestId('book-module-selector')).toHaveAttribute('data-selector-type', 'dictionary');
  });

  it('opens the selector on Books for a book panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('book-add-btn'));

    expect(screen.getByTestId('book-module-selector')).toHaveAttribute('data-selector-type', 'book');
  });

  it('links the content region to its tab as a tabpanel', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    const panel = screen.getByRole('tabpanel');
    // Scoped by panelId (defaults to DEFAULT_PANEL_ID, '_default', when no
    // panelId prop is passed) so two Books panes in one document don't
    // collide on element ids.
    expect(panel).toHaveAttribute('id', 'book-dict-_default-panel-0');
    expect(panel).toHaveAttribute('aria-labelledby', 'book-dict-_default-tab-0');
  });
});

describe('BookPane: tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  it('gives the tab close button an accessible name', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByRole('button', { name: 'Close test' })).toBeInTheDocument();
  });

  it('closes the tab from its close button', async () => {
    const user = userEvent.setup();
    const closeBook = vi.fn();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB], closeBook });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByRole('button', { name: 'Close test' }));

    expect(closeBook).toHaveBeenCalledWith('book_test');
  });

  // Shading is how the user tells a tab that has content from one that has
  // never been opened; the mechanism already existed in DraggableTabBar.
  it('marks a book tab as having content once its section is loaded', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-tab-book-book_test')).toHaveAttribute('data-has-content', 'true');
  });

  it('leaves a book tab unshaded until its section loads', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-tab-book-book_test')).toHaveAttribute('data-has-content', 'false');
  });

  it('exposes the tab context menu as a menu', async () => {
    const user = userEvent.setup();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('test') });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

const DICT_TAB = { abbreviation: 'dict_test', name: 'Test Dict' };
const OTHER_BOOK_TAB = { abbreviation: 'book_other', name: 'Other Book' };

/** Reads the strip as the labels the user sees, left to right. */
function stripLabels(): string[] {
  return Array.from(screen.getByTestId('book-tab-bar').querySelectorAll('[data-index]'))
    .map(el => el.getAttribute('data-testid') ?? '');
}

function drag(from: number, to: number) {
  const button = screen.getByTestId('book-drag');
  button.setAttribute('data-from', String(from));
  button.setAttribute('data-to', String(to));
  return button;
}

// -------------------------------------------------------------------
// F7 - one strip per kind, in open order, every tab draggable anywhere.
// -------------------------------------------------------------------
describe('BookPane: tab strip order (F7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  it('shows tabs in the recorded order, not the order the store happens to hold them', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB],
      tabOrder: [
        { type: 'book', abbreviation: 'book_other' },
        { type: 'book', abbreviation: 'book_test' },
      ],
    });
    renderWithProviders(<BookPane />);

    expect(stripLabels()).toEqual([
      'book-tab-book-book_other',
      'book-tab-book-book_test',
    ]);
  });

  it('records the reconciled order so the next tab opened lands after this one', () => {
    const setTabOrder = vi.fn();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB], setTabOrder });
    renderWithProviders(<BookPane />);

    expect(setTabOrder).toHaveBeenCalledWith([
      { type: 'book', abbreviation: 'book_test' },
      { type: 'book', abbreviation: 'book_other' },
    ]);
  });

  it('leaves a strip that already matches alone, rather than rewriting it every render', () => {
    const setTabOrder = vi.fn();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      tabOrder: [{ type: 'book', abbreviation: 'book_test' }],
      setTabOrder,
    });
    renderWithProviders(<BookPane />);

    expect(setTabOrder).not.toHaveBeenCalled();
  });

  it('drops a closed tab from the strip without disturbing its neighbours', () => {
    // Order still names a book that is no longer open.
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB],
      tabOrder: [
        { type: 'book', abbreviation: 'book_test' },
        { type: 'book', abbreviation: 'book_gone' },
        { type: 'book', abbreviation: 'book_other' },
      ],
    });
    renderWithProviders(<BookPane />);

    expect(stripLabels()).toEqual(['book-tab-book-book_test', 'book-tab-book-book_other']);
  });

  // The other kind's refs survive in `tabOrder` (both panes share one panel
  // state), and must not become phantom tabs on this strip.
  it('ignores refs for the other kind of module', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      tabOrder: [
        { type: 'dictionary', abbreviation: 'dict_test' },
        { type: 'book', abbreviation: 'book_test' },
      ],
    });
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    renderWithProviders(<BookPane />);

    expect(stripLabels()).toEqual(['book-tab-book-book_test']);
  });

  it('translates a strip drag into a move within the content store', () => {
    const reorderBookTabs = vi.fn();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB],
      tabOrder: [
        { type: 'book', abbreviation: 'book_test' },
        { type: 'book', abbreviation: 'book_other' },
      ],
      reorderTabs: reorderBookTabs,
    });
    renderWithProviders(<BookPane />);

    drag(1, 0).click();

    expect(reorderBookTabs).toHaveBeenCalledWith(1, 0);
  });

  it('reorders dictionary tabs through the dictionary store', () => {
    const reorderDictTabs = vi.fn();
    const setTabOrder = vi.fn();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, setTabOrder });
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [DICT_TAB, { abbreviation: 'dict_other', name: 'Other Dict' }],
      reorderTabs: reorderDictTabs,
    });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    drag(1, 0).click();

    expect(reorderDictTabs).toHaveBeenCalledWith(1, 0);
  });

  it('activates the dictionary a click landed on', () => {
    const setDictActiveTab = vi.fn();
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [DICT_TAB],
      setActiveTab: setDictActiveTab,
    });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    screen.getByTestId('book-tab-dict-dict_test').click();

    expect(setDictActiveTab).toHaveBeenCalledWith(0);
  });

  it('marks the active tab by identity, not by strip arithmetic', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB],
      activeTabIndex: 1,
      sectionsByTab: new Map([['book_other', A_SECTION]]),
      tabOrder: [
        { type: 'book', abbreviation: 'book_other' },
        { type: 'book', abbreviation: 'book_test' },
      ],
    });
    renderWithProviders(<BookPane />);

    // Store index 1, strip position 0.
    expect(screen.getByTestId('book-tab-bar')).toHaveAttribute('data-active-index', '0');
  });
});

// -------------------------------------------------------------------
// F21 remainder + F24 - tab markers.
// -------------------------------------------------------------------
describe('BookPane: tab markers (F21, F24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  it('shades a dictionary tab once its entry is loaded', () => {
    mockUseDictionaryPanel.mockReturnValue({
      ...defaultDictPanel,
      openTabs: [DICT_TAB],
      entriesByTab: new Map([['dict_test', { entry_key: '00025', definition: 'love' }]]),
    });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    expect(screen.getByTestId('book-tab-dict-dict_test')).toHaveAttribute('data-has-content', 'true');
  });

  it('leaves a dictionary tab unshaded until an entry is looked up', () => {
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    expect(screen.getByTestId('book-tab-dict-dict_test')).toHaveAttribute('data-has-content', 'false');
  });

  // Both kinds carry a glyph: a 9px "Dict" badge on dictionaries alone would
  // identify a book tab by the *absence* of a badge. The kinds live in separate
  // panes, but the glyph is still what a popped-out window is identified by.
  it('marks a book tab with its type glyph', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-tab-icon-book')).toBeInTheDocument();
    expect(screen.queryByText('Dict')).not.toBeInTheDocument();
  });

  it('hides the glyph from assistive tech and names the type in the tab instead', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-tab-icon-book')).toHaveAttribute('aria-hidden', 'true');
    // DraggableTabBar composes the accessible name as "{label} {subtitle}".
    expect(screen.getByTestId('book-tab-book-book_test')).toHaveAttribute('data-subtitle', 'Book');
  });

  it('names a dictionary tab as a dictionary', () => {
    mockUseDictionaryPanel.mockReturnValue({ ...defaultDictPanel, openTabs: [DICT_TAB] });
    renderWithProviders(<BookPane paneKind="dictionary" />);

    expect(screen.getByTestId('book-tab-icon-dictionary')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('book-tab-dict-dict_test')).toHaveAttribute('data-subtitle', 'Dictionary');
  });
});

// -------------------------------------------------------------------
// Pop out to a real window, from the pane menu.
// -------------------------------------------------------------------
// One step to a real window, and the payload carries the module. Routing via
// "open in own panel" - another dockview panel inside the same window - is a
// two-step journey that loses the module on the way.
describe('BookPane: pop out to window (F19)', () => {
  const detachPane = vi.fn().mockResolvedValue({ success: true });
  let originalElectron: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    detachPane.mockResolvedValue({ success: true });
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
    const w = window as unknown as { electron?: unknown };
    originalElectron = w.electron;
    w.electron = { window: { detachPane } };
  });

  afterEach(() => {
    (window as unknown as { electron?: unknown }).electron = originalElectron;
  });

  it('offers it in the pane menu, naming the tab it would act on', () => {
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB] });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-pane-menu-pop-out-to-window'))
      .toHaveTextContent('Pop test out to its own window');
  });

  it('sends the module to a new window and drops it from this pane', async () => {
    const user = userEvent.setup();
    const closeBook = vi.fn();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB], closeBook });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('book-pane-menu-pop-out-to-window'));

    await waitFor(() => expect(closeBook).toHaveBeenCalledWith('book_test'));
    const [paneType, initialState] = detachPane.mock.calls[0];
    expect(paneType).toBe('book');
    // The identity has to travel, or the new window opens on nothing.
    expect((initialState as { openTabs: Array<{ abbreviation: string }> }).openTabs)
      .toEqual([expect.objectContaining({ abbreviation: 'book_test' })]);
  });

  // Closing the tab before the window exists would leave the reader with
  // neither.
  it('keeps the tab when the window could not be opened', async () => {
    const user = userEvent.setup();
    const closeBook = vi.fn();
    detachPane.mockResolvedValue({ success: false, error: 'nope' });
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openTabs: [OPEN_BOOK_TAB], closeBook });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('book-pane-menu-pop-out-to-window'));

    await waitFor(() => expect(detachPane).toHaveBeenCalled());
    expect(closeBook).not.toHaveBeenCalled();
  });

  it('offers nothing to act on when the pane is empty', () => {
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    renderWithProviders(<BookPane />);

    expect(screen.queryByTestId('book-pane-menu-pop-out-to-window')).not.toBeInTheDocument();
  });
});

describe('BookPane: navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
  });

  // The toolbar computes nothing itself; it can only disable its arrows if the
  // pane hands it the already-loaded next/previous section info.
  it('passes the resolved next/previous sections to the toolbar', () => {
    mockNavSectionInfo.mockReturnValue({
      nextSectionInfo: { section_id: 3, title: 'Vanity Fair' },
      prevSectionInfo: { section_id: 1, title: 'Preface' },
    });
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    const toolbar = screen.getByTestId('book-nav-toolbar');
    expect(toolbar).toHaveAttribute('data-next', 'Vanity Fair');
    expect(toolbar).toHaveAttribute('data-prev', 'Preface');
  });

  it('tells the toolbar when there is no next section', () => {
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: { section_id: 1, title: 'Preface' } });
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-nav-toolbar')).toHaveAttribute('data-next', '');
  });
});

/*
  F23 - the Overview shelf.

  Commentary has had an Overview tab for a while; Books and Dictionaries had
  none, so once a single module was open the only route to any other was an
  unlabelled "+" in the tab strip.
*/
describe('BookPane: overview shelf (F23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBookPanel.mockReturnValue(defaultBookPanel);
    mockUseDictionaryPanel.mockReturnValue(defaultDictPanel);
    mockNavSectionInfo.mockReturnValue({ nextSectionInfo: null, prevSectionInfo: null });
  });

  it('offers an overview tab, and opens on it, when nothing is open', () => {
    renderWithProviders(<BookPane />);
    expect(screen.getByTestId('library-overview-tab')).toBeInTheDocument();
    expect(screen.getByTestId('library-home')).toBeInTheDocument();
  });

  // The other half of that rule: the shelf is for *finding* a module, so a pane
  // that already has one open shows the module rather than the shelf.
  it('opens on the module, not the shelf, when a tab is already open', () => {
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);
    expect(screen.queryByTestId('library-home')).not.toBeInTheDocument();
    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();
  });

  it('replaces the book content with the shelf, and restores it on the way back', async () => {
    const user = userEvent.setup();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();

    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('library-home')).toBeInTheDocument();
    // The book must actually be replaced, not merely covered: two scrolling
    // regions stacked in one pane is what this tab exists to avoid.
    expect(screen.queryByTestId('book-section-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('book-nav-toolbar')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();
    expect(screen.queryByTestId('library-home')).not.toBeInTheDocument();
  });

  it('deselects every tab while the shelf is showing', async () => {
    const user = userEvent.setup();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    expect(screen.getByTestId('book-tab-bar')).toHaveAttribute('data-active-index', '0');
    await user.click(screen.getByTestId('library-overview-tab'));
    // -1, not 0: leaving a tab highlighted while its content is gone would
    // point `aria-controls` at a tabpanel that is no longer rendered.
    expect(screen.getByTestId('book-tab-bar')).toHaveAttribute('data-active-index', '-1');
  });

  it('hides the shelf again when a tab is chosen', async () => {
    const user = userEvent.setup();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('library-home')).toBeInTheDocument();

    await user.click(screen.getByTestId('book-tab-book-book_test'));
    expect(screen.queryByTestId('library-home')).not.toBeInTheDocument();
    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();
  });

  /*
    The regression the detached Dictionary window found: a session restore and a
    detached window both seed the store from an effect, so the tabs arrive after
    the first render. Deciding the shelf once at mount left the pane sitting on
    it with the module it had just been handed unreachable.
  */
  it('steps aside when tabs arrive after the first render', () => {
    const { rerender } = renderWithProviders(<BookPane />);
    expect(screen.getByTestId('library-home')).toBeInTheDocument();

    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    rerender(<ContextProvider services={createMockServices()}><BookPane /></ContextProvider>);

    expect(screen.queryByTestId('library-home')).not.toBeInTheDocument();
    expect(screen.getByTestId('book-section-content')).toBeInTheDocument();
  });

  it('stays put when the reader opened it themselves', async () => {
    const user = userEvent.setup();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    const { rerender } = renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('library-home')).toBeInTheDocument();

    // Another tab opening must not yank the shelf away mid-browse.
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB, OTHER_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
    });
    rerender(<ContextProvider services={createMockServices()}><BookPane /></ContextProvider>);

    expect(screen.getByTestId('library-home')).toBeInTheDocument();
  });

  it('opens a book picked from the shelf', async () => {
    const user = userEvent.setup();
    const openBook = vi.fn();
    mockUseBookPanel.mockReturnValue({ ...defaultBookPanel, openBook });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('library-item-book_test'));

    expect(openBook).toHaveBeenCalledWith('book_test', 'Test Book');
    // And the shelf steps aside so the newly opened book is visible.
    expect(screen.queryByTestId('library-home')).not.toBeInTheDocument();
  });

  it('switches to an already-open book instead of opening it twice', async () => {
    const user = userEvent.setup();
    const openBook = vi.fn();
    const setActiveTab = vi.fn();
    mockUseBookPanel.mockReturnValue({
      ...defaultBookPanel,
      openTabs: [OPEN_BOOK_TAB],
      sectionsByTab: new Map([['book_test', A_SECTION]]),
      openBook,
      setActiveTab,
    });
    renderWithProviders(<BookPane />);

    await user.click(screen.getByTestId('library-overview-tab'));
    expect(screen.getByTestId('library-item-book_test')).toHaveAttribute('data-open', 'true');

    await user.click(screen.getByTestId('library-item-book_test'));
    expect(setActiveTab).toHaveBeenCalledWith(0);
    expect(openBook).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Tab-loss regression - see DictionaryPane.test.tsx and
  // stores/panelLifecycle.test.ts. A pane component unmounting is not the
  // pane closing: presets rebuild the grid and StrictMode double-invokes.
  // ---------------------------------------------------------------------
  describe('panel lifecycle', () => {
    it('detaches rather than destroys when its component unmounts', () => {
      const { unmount } = renderWithProviders(<BookPane panelId="book_abc" />);
      expect(bookPanelLifecycle.initPanel).toHaveBeenCalledWith('book_abc');

      unmount();

      expect(bookPanelLifecycle.detachPanel).toHaveBeenCalledWith('book_abc');
      expect(bookPanelLifecycle.destroyPanel).not.toHaveBeenCalled();
    });
  });
});
