/**
 * Unit tests for the Books pane's unified tab strip order and for opening a
 * book straight at a known section.
 *
 * The strip interleaves books and dictionaries, so its order cannot be derived
 * from either content store - it is held here, per panel, and persisted with
 * the session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBookStore } from './useBookStore';
import { getSessionSerializers } from './helpers/sessionRegistry';

const getTopLevelSections = vi.fn();
const getSection = vi.fn();
const getAllSectionSummaries = vi.fn();

vi.mock('../services/electronAPI', () => ({
  bookAPI: {
    getAvailableBooks: vi.fn().mockResolvedValue([]),
    getTopLevelSections: (...args: unknown[]) => getTopLevelSections(...args),
    getSection: (...args: unknown[]) => getSection(...args),
    getSectionsByParent: vi.fn().mockResolvedValue([]),
    getNextSection: vi.fn().mockResolvedValue(null),
    getPreviousSection: vi.fn().mockResolvedValue(null),
    getParentSection: vi.fn().mockResolvedValue(null),
    getAllSectionSummaries: (...args: unknown[]) => getAllSectionSummaries(...args),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

const PANEL = 'book_panel_1';
const getPs = () => useBookStore.getState().getPanelState(PANEL);

describe('useBookStore tab strip order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookStore.setState({ availableBooks: [], loadingBooks: false, panels: new Map() });
    useBookStore.getState().initPanel(PANEL);
    getTopLevelSections.mockResolvedValue([]);
    getSection.mockResolvedValue(null);
    getAllSectionSummaries.mockResolvedValue([]);
  });

  it('starts empty, so a fresh pane falls back to books-then-dictionaries', () => {
    expect(getPs().tabOrder).toEqual([]);
  });

  it('stores the strip order the pane hands it, per panel', () => {
    useBookStore.getState().initPanel('book_panel_2');

    useBookStore.getState().setTabOrder(PANEL, [
      { type: 'book', abbreviation: 'mhc' },
      { type: 'dictionary', abbreviation: 'StrongsGreek' },
    ]);

    expect(getPs().tabOrder).toEqual([
      { type: 'book', abbreviation: 'mhc' },
      { type: 'dictionary', abbreviation: 'StrongsGreek' },
    ]);
    // Panels are independent: two Books panes each keep their own strip.
    expect(useBookStore.getState().getPanelState('book_panel_2').tabOrder).toEqual([]);
  });

  it('persists the strip order with the session and restores it', async () => {
    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry');
    useBookStore.getState().setTabOrder(PANEL, [
      { type: 'dictionary', abbreviation: 'StrongsGreek' },
      { type: 'book', abbreviation: 'mhc' },
    ]);

    const serialize = getSessionSerializers().get('book');
    const saved = serialize?.() as { tabOrder?: unknown; openTabs?: unknown };
    expect(saved.tabOrder).toEqual([
      { type: 'dictionary', abbreviation: 'StrongsGreek' },
      { type: 'book', abbreviation: 'mhc' },
    ]);

    useBookStore.setState({ panels: new Map() });
    await useBookStore.getState().restoreFromSession(PANEL, {
      openTabs: [{ abbreviation: 'mhc', name: 'Matthew Henry' }],
      activeTabIndex: 0,
      currentSectionByTab: {},
      tabOrder: saved.tabOrder as Array<{ type: 'book' | 'dictionary'; abbreviation: string }>,
    });

    expect(getPs().tabOrder).toEqual([
      { type: 'dictionary', abbreviation: 'StrongsGreek' },
      { type: 'book', abbreviation: 'mhc' },
    ]);
  });

  it('restores a pre-strip session with no order at all', async () => {
    await useBookStore.getState().restoreFromSession(PANEL, {
      openTabs: [{ abbreviation: 'mhc', name: 'Matthew Henry' }],
      activeTabIndex: 0,
      currentSectionByTab: {},
    });

    expect(getPs().tabOrder).toEqual([]);
    expect(getPs().openTabs).toHaveLength(1);
  });
});

describe('useBookStore.openBook with a starting section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookStore.setState({ availableBooks: [], loadingBooks: false, panels: new Map() });
    useBookStore.getState().initPanel(PANEL);
    getTopLevelSections.mockResolvedValue([{ section_id: 1, title: 'Preface', content: '' }]);
    getSection.mockResolvedValue({ section_id: 42, title: 'Chapter 9', content: '' });
    getAllSectionSummaries.mockResolvedValue([]);
  });

  // Firing both fetches let whichever query returned last decide what the
  // reader saw, so moving a book back from its own panel landed on chapter one
  // about half the time.
  it('loads only the requested section, not the start of the book', async () => {
    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry', 42);
    await vi.waitFor(() => expect(getPs().sectionsByTab.get('mhc')).toBeTruthy());

    expect(getSection).toHaveBeenCalledWith('mhc', 42);
    expect(getTopLevelSections).not.toHaveBeenCalled();
    expect(getPs().currentSectionByTab.get('mhc')).toBe(42);
  });

  /*
    A book with no section named opens on its Home page - the table of contents
    and a search box over its text. Loading the first top-level section instead
    would, for most books, land on a title page: the least useful place to
    land, and one that hides the fact the book has a structure at all.
  */
  it('opens on the Home page when no section is named', async () => {
    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry');
    await vi.waitFor(() => expect(getAllSectionSummaries).toHaveBeenCalledWith('mhc'));

    expect(getPs().currentSectionByTab.get('mhc')).toBeUndefined();
    expect(getSection).not.toHaveBeenCalled();
    expect(getTopLevelSections).not.toHaveBeenCalled();
  });

  it('navigates an already-open tab to the requested section instead of duplicating it', async () => {
    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry');
    await vi.waitFor(() => expect(getPs().openTabs).toHaveLength(1));

    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry', 42);
    await vi.waitFor(() => expect(getPs().currentSectionByTab.get('mhc')).toBe(42));

    expect(getPs().openTabs).toHaveLength(1);
  });

  // The breadcrumb Home. A plain state clear: Home has nothing to fetch that
  // the summaries load has not already fetched.
  it('returns a book to its Home page, clearing the reading position', async () => {
    useBookStore.getState().openBook(PANEL, 'mhc', 'Matthew Henry', 42);
    await vi.waitFor(() => expect(getPs().currentSectionByTab.get('mhc')).toBe(42));

    useBookStore.getState().navigateToHome(PANEL, 'mhc');

    expect(getPs().currentSectionByTab.get('mhc')).toBeNull();
    expect(getPs().sectionsByTab.get('mhc')).toBeNull();
  });
});
