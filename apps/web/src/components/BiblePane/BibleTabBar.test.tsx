/**
 * Component tests for BibleTabBar.
 *
 * Pattern: Store-connected component with dnd-kit drag-and-drop.
 * bibleStore and moduleStore are fully mocked. dnd-kit is mocked to
 * render a simple passthrough so the real DndContext/SortableContext
 * don't need a DOM pointer-events environment.
 * BookChapterPicker is mocked to avoid deep sub-tree setup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { BibleTab } from '../../stores/bibleStore';
import { focusAfterTabClose } from '../common/SortableTab';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { title?: string }) => (key === 'bibleTabBar.closeTabNamed' ? `Close ${opts?.title}` : key),
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- dnd-kit mocks -------------------------------------------------------
// Stub out the heavy drag-and-drop infrastructure so tests run without a
// real pointer-events environment.
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: unknown }) => children,
  closestCenter: vi.fn(),
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  horizontalListSortingStrategy: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));

// ---- SortableTab mock ----------------------------------------------------
vi.mock('../common/SortableTab', () => ({
  tabKeyDown: (activate: () => void, close?: (list: Element | null) => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') activate(); else if (e.key === 'Delete' && close) close(null); },
  focusAfterTabClose: vi.fn(),
  tablistKeyDown: () => {},
  SortableTab: ({ children, class: className, onClick }: { children: unknown; class?: string; onClick?: () => void }) => (
    <div class={className} onClick={onClick}>{children as any}</div>
  ),
}));

// ---- BookChapterPicker mock ----------------------------------------------
vi.mock('./BookChapterPicker', () => ({
  BookChapterPicker: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="book-chapter-picker"><button onClick={onClose}>close-picker</button></div> : null,
}));

// ---- Store state ---------------------------------------------------------
function makeTab(overrides: Partial<BibleTab> = {}): BibleTab {
  return {
    id: 'tab-1',
    moduleAbbr: 'KJV',
    moduleName: 'King James Version',
    book: 43,
    chapter: 3,
    studyVerse: null,
    previewVerse: null,
    previewVerseEnd: null,
    selectionEndVerse: null,
    verses: [],
    loading: false,
    scrollPosition: 0,
    pendingScrollVerse: null,
    pendingScrollTop: null,
    hasInterlinearData: false,
    displayMode: 'standard',
    history: [],
    historyIndex: -1,
    showBackBar: false,
    ...overrides,
  };
}

let mockTabs: BibleTab[] = [makeTab()];
let mockActiveTabId = 'tab-1';
let mockShowHome = false;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockSetActiveTab = vi.fn();
const mockSetShowHome = vi.fn();
const mockRemoveTab = vi.fn();
const mockReorderTabs = vi.fn();
const mockAddTabWithPassage = vi.fn();
const mockGetActiveTab = vi.fn(() => mockTabs[0]);

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    get tabs() { return mockTabs; },
    get activeTabId() { return mockActiveTabId; },
    get showHome() { return mockShowHome; },
    getActiveTab: () => mockGetActiveTab(),
    getActiveModule: () => mockGetActiveTab()?.moduleAbbr ?? 'KJV',
    setActiveTab: (id: string) => mockSetActiveTab(id),
    setShowHome: (v: boolean) => mockSetShowHome(v),
    removeTab: (id: string) => mockRemoveTab(id),
    reorderTabs: (a: string, b: string) => mockReorderTabs(a, b),
    addTabWithPassage: (abbr: string, book: number, ch: number, v?: number) =>
      mockAddTabWithPassage(abbr, book, ch, v),
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookName: (n: number) => (n === 43 ? 'John' : `Book${n}`),
  },
}));

import { BibleTabBar } from './BibleTabBar';

describe('BibleTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabs = [makeTab()];
    mockActiveTabId = 'tab-1';
    mockShowHome = false;
    mockGetActiveTab.mockImplementation(() => mockTabs[0]);
  });

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  it('renders the tab bar container', () => {
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar')).toBeTruthy();
  });

  it('renders a tab with the passage title', () => {
    render(<BibleTabBar />);
    // John 3 should appear as the tab title
    expect(screen.getByText('John 3')).toBeTruthy();
  });

  it('renders the module abbreviation as the subtitle', () => {
    render(<BibleTabBar />);
    expect(screen.getByText('KJV')).toBeTruthy();
  });

  it('renders "New Tab" title for a tab with no book/chapter', () => {
    mockTabs = [makeTab({ book: null, chapter: null })];
    render(<BibleTabBar />);
    expect(screen.getByText('New Tab')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Home button
  // ------------------------------------------------------------------
  it('renders the home button by default', () => {
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__home')).toBeTruthy();
  });

  it('hides the home button when hideHome is true', () => {
    const { container } = render(<BibleTabBar hideHome />);
    expect(container.querySelector('.bible-tab-bar__home')).toBeNull();
  });

  it('home button has active class when showHome is true', () => {
    mockShowHome = true;
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__home--active')).toBeTruthy();
  });

  it('home button does NOT have active class when showHome is false', () => {
    mockShowHome = false;
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__home--active')).toBeNull();
  });

  it('calls setShowHome(true) when home button is clicked', () => {
    const { container } = render(<BibleTabBar />);
    fireEvent.click(container.querySelector('.bible-tab-bar__home')!);
    expect(mockSetShowHome).toHaveBeenCalledWith(true);
  });

  // ------------------------------------------------------------------
  // Tab active state
  // ------------------------------------------------------------------
  it('applies active class to the active tab', () => {
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__tab--active')).toBeTruthy();
  });

  it('does not apply active class when showHome is true', () => {
    mockShowHome = true;
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__tab--active')).toBeNull();
  });

  it('does not apply active class to a non-active tab', () => {
    const tab2 = makeTab({ id: 'tab-2', book: 1, chapter: 1, moduleAbbr: 'NIV' });
    mockTabs = [makeTab(), tab2];
    mockActiveTabId = 'tab-1';
    const { container } = render(<BibleTabBar />);
    const activeTabs = container.querySelectorAll('.bible-tab-bar__tab--active');
    expect(activeTabs.length).toBe(1);
  });

  // ------------------------------------------------------------------
  // Tab click
  // ------------------------------------------------------------------
  it('calls setActiveTab when a tab is clicked', () => {
    const { container } = render(<BibleTabBar />);
    fireEvent.click(container.querySelector('.bible-tab-bar__tab')!);
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-1');
  });

  it('calls setShowHome(false) when a tab is clicked', () => {
    const { container } = render(<BibleTabBar />);
    fireEvent.click(container.querySelector('.bible-tab-bar__tab')!);
    expect(mockSetShowHome).toHaveBeenCalledWith(false);
  });

  // ------------------------------------------------------------------
  // Close button
  // ------------------------------------------------------------------
  it('does NOT show the close button when there is only one tab', () => {
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__close')).toBeNull();
  });

  it('shows the close button when there are multiple tabs', () => {
    const tab2 = makeTab({ id: 'tab-2' });
    mockTabs = [makeTab(), tab2];
    const { container } = render(<BibleTabBar />);
    const closeBtns = container.querySelectorAll('.bible-tab-bar__close');
    expect(closeBtns.length).toBe(2);
  });

  it('calls removeTab when the close button is clicked', () => {
    const tab2 = makeTab({ id: 'tab-2' });
    mockTabs = [makeTab(), tab2];
    const { container } = render(<BibleTabBar />);
    fireEvent.click(container.querySelector('.bible-tab-bar__close')!);
    expect(mockRemoveTab).toHaveBeenCalledWith('tab-1');
  });

  // ------------------------------------------------------------------
  // Add-tab (new tab) button
  // ------------------------------------------------------------------
  it('renders the add-tab button', () => {
    const { container } = render(<BibleTabBar />);
    expect(container.querySelector('.bible-tab-bar__add')).toBeTruthy();
  });

  it('opens the BookChapterPicker when the add-tab button is clicked', () => {
    const { container } = render(<BibleTabBar />);
    expect(screen.queryByTestId('book-chapter-picker')).toBeNull();
    fireEvent.click(container.querySelector('.bible-tab-bar__add')!);
    expect(screen.getByTestId('book-chapter-picker')).toBeTruthy();
  });

  it('closes the BookChapterPicker when onClose is called', () => {
    const { container } = render(<BibleTabBar />);
    fireEvent.click(container.querySelector('.bible-tab-bar__add')!);
    expect(screen.getByTestId('book-chapter-picker')).toBeTruthy();
    fireEvent.click(screen.getByText('close-picker'));
    expect(screen.queryByTestId('book-chapter-picker')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Tab semantics (a11y)
  // ------------------------------------------------------------------
  describe('tab semantics', () => {
    beforeEach(() => {
      mockTabs = [makeTab(), makeTab({ id: 'tab-2', book: 19, chapter: 23 })];
    });

    it('is a tablist whose tabs expose aria-selected', () => {
      const { container } = render(<BibleTabBar />);
      expect(container.querySelector('.bible-tab-bar [role="tablist"]')).toBeTruthy();
      const tabs = screen.getAllByRole('tab', { name: /John 3|Book19 23|Psalms 23/ });
      expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
      expect(container.querySelector('.bible-tab-bar__tab--active [role="tab"]')!.getAttribute('aria-selected')).toBe('true');
    });

    it('marks Home selected (and no passage tab) when Home is shown', () => {
      mockShowHome = true;
      render(<BibleTabBar />);
      expect(screen.getByRole('tab', { name: 'bibleTabBar.home' }).getAttribute('aria-selected')).toBe('true');
      expect(document.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
    });

    it('does not nest the close button inside a tab and names it after the tab', () => {
      const { container } = render(<BibleTabBar />);
      for (const tab of Array.from(container.querySelectorAll('[role="tab"]'))) {
        expect(tab.querySelector('button')).toBeNull();
      }
      const closes = screen.getAllByRole('button', { name: /^Close / });
      expect(closes).toHaveLength(2);
      expect(new Set(closes.map(c => c.getAttribute('aria-label'))).size).toBe(2);
      expect(closes[0].getAttribute('aria-label')).toBe('Close John 3');
    });

    it('gives the + button an accessible name from the New tab string', () => {
      render(<BibleTabBar />);
      expect(screen.getByRole('button', { name: 'bibleTabBar.newTab' })).toBeTruthy();
    });

    it('activates a tab with Enter from the keyboard', () => {
      render(<BibleTabBar />);
      const second = screen.getAllByRole('tab').find(t => t.textContent?.includes('Book19') || t.textContent?.includes('Psalms'))!;
      fireEvent.keyDown(second, { key: 'Enter' });
      expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2');
    });

    it('closes the focused tab with Delete and hands focus to the active tab', () => {
      render(<BibleTabBar />);
      const second = screen.getAllByRole('tab').find(t => t.textContent?.includes('Book19') || t.textContent?.includes('Psalms'))!;
      fireEvent.keyDown(second, { key: 'Delete' });
      expect(mockRemoveTab).toHaveBeenCalledWith('tab-2');
    });

    it('does not close the last tab with Delete', () => {
      mockTabs = [makeTab()];
      render(<BibleTabBar />);
      fireEvent.keyDown(screen.getAllByRole('tab').find(t => t.textContent?.includes('John'))!, { key: 'Delete' });
      expect(mockRemoveTab).not.toHaveBeenCalled();
    });

    it('moves focus (via focusAfterTabClose) when the close button is used', () => {
      render(<BibleTabBar />);
      (focusAfterTabClose as any).mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Close John 3' }));
      expect(mockRemoveTab).toHaveBeenCalledWith('tab-1');
      expect(focusAfterTabClose).toHaveBeenCalled();
    });

    it('renders the New-tab picker outside the tablist', () => {
      const { container } = render(<BibleTabBar />);
      fireEvent.click(container.querySelector('.bible-tab-bar__add')!);
      const picker = screen.getByTestId('book-chapter-picker');
      expect(picker.closest('[role="tablist"]')).toBeNull();
      expect(container.querySelector('.bible-tab-bar__add')!.closest('[role="tablist"]')).toBeNull();
    });
  });
});
