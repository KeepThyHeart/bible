import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveIntoBooksPane } from './moveIntoBooksPane';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { useBookStore } from '../../stores/useBookStore';
import { useDictionaryStore } from '../../stores/useDictionaryStore';

vi.mock('../../stores/useLayoutStore', () => ({
  useLayoutStore: { getState: vi.fn() },
}));
vi.mock('../../stores/useBookStore', () => ({
  useBookStore: { getState: vi.fn() },
}));
vi.mock('../../stores/useDictionaryStore', () => ({
  useDictionaryStore: { getState: vi.fn() },
}));

interface LayoutPanelStub {
  panelId: string;
  contentType: string;
  contentKey?: string;
  displayName: string;
}

function stubLayout(panels: LayoutPanelStub[]) {
  const setActive = vi.fn();
  const layout = {
    panels: new Map(panels.map(p => [p.panelId, p])),
    dockviewApi: { getPanel: vi.fn().mockReturnValue({ api: { setActive } }) },
    addPanel: vi.fn().mockReturnValue('book_new'),
    removePanel: vi.fn(),
  };
  vi.mocked(useLayoutStore.getState).mockReturnValue(layout as never);
  return { layout, setActive };
}

function stubStores() {
  const books = { openBook: vi.fn(), navigateToSection: vi.fn() };
  const dictionaries = { openDictionary: vi.fn(), lookupEntry: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(useBookStore.getState).mockReturnValue(books as never);
  vi.mocked(useDictionaryStore.getState).mockReturnValue(dictionaries as never);
  return { books, dictionaries };
}

const MULTI_TAB_PANE: LayoutPanelStub = { panelId: 'book_123', contentType: 'book', displayName: 'Books' };
const SINGLE_BOOK_PANEL: LayoutPanelStub = { panelId: 'book_mhc_9', contentType: 'book', contentKey: 'mhc', displayName: 'MHC' };

describe('moveIntoBooksPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reopens the book as a tab in the existing Books pane, on the same section', () => {
    const { layout, setActive } = stubLayout([SINGLE_BOOK_PANEL, MULTI_TAB_PANE]);
    const { books } = stubStores();

    const moved = moveIntoBooksPane({
      type: 'book',
      abbreviation: 'mhc',
      name: 'Matthew Henry',
      sectionId: 42,
      sourcePanelId: 'book_mhc_9',
    });

    expect(moved).toBe(true);
    // The reading position travels with the module: openBook is told where to
    // start rather than being left to load the first section.
    expect(books.openBook).toHaveBeenCalledWith('book_123', 'mhc', 'Matthew Henry', 42);
    expect(setActive).toHaveBeenCalled();
    expect(layout.removePanel).toHaveBeenCalledWith('book_mhc_9');
  });

  it('never targets another single-module panel, which has no tab strip', () => {
    const { layout } = stubLayout([SINGLE_BOOK_PANEL]);
    const { books } = stubStores();

    moveIntoBooksPane({ type: 'book', abbreviation: 'mhc', name: 'Matthew Henry', sourcePanelId: 'book_mhc_9' });

    expect(layout.addPanel).toHaveBeenCalledWith('book', undefined, 'Books');
    expect(books.openBook).toHaveBeenCalledWith('book_new', 'mhc', 'Matthew Henry', undefined);
  });

  it('accepts a Dictionary-typed pane as the destination — both render BookPane', () => {
    const { layout } = stubLayout([{ panelId: 'dictionary_7', contentType: 'dictionary', displayName: 'Dictionary' }]);
    const { dictionaries } = stubStores();

    moveIntoBooksPane({ type: 'dictionary', abbreviation: 'StrongsGreek', name: "Strong's Greek", entryKey: '00025' });

    expect(layout.addPanel).not.toHaveBeenCalled();
    expect(dictionaries.openDictionary).toHaveBeenCalledWith('dictionary_7', 'StrongsGreek', "Strong's Greek");
    expect(dictionaries.lookupEntry).toHaveBeenCalledWith('dictionary_7', 'StrongsGreek', '00025');
  });

  it('opens the dictionary without a lookup when nothing was on screen', () => {
    stubLayout([MULTI_TAB_PANE]);
    const { dictionaries } = stubStores();

    moveIntoBooksPane({ type: 'dictionary', abbreviation: 'StrongsGreek', name: "Strong's Greek", entryKey: null });

    expect(dictionaries.lookupEntry).not.toHaveBeenCalled();
  });

  // Losing the panel without gaining a tab would lose the module entirely.
  it('keeps the source panel open when no destination could be created', () => {
    const { layout } = stubLayout([SINGLE_BOOK_PANEL]);
    layout.addPanel.mockReturnValue(null);
    const { books } = stubStores();

    const moved = moveIntoBooksPane({ type: 'book', abbreviation: 'mhc', name: 'MHC', sourcePanelId: 'book_mhc_9' });

    expect(moved).toBe(false);
    expect(books.openBook).not.toHaveBeenCalled();
    expect(layout.removePanel).not.toHaveBeenCalled();
  });
});
