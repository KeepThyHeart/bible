/**
 * Component tests for CommentaryTabBar.
 *
 * Pattern: Store-connected tab bar with a module-selection dialog.
 * commentaryStore, moduleStore, bibleStore, and settingsStore are mocked.
 * SortableTab is mocked to a plain div (no dnd-kit context needed).
 * DndContext / SortableContext are mocked to simple pass-throughs.
 * moduleDescriptions constants are mocked for deterministic behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import type { CommentaryTab } from '../../stores/commentaryStore';
import type { ComponentChildren } from 'preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- dnd-kit: mock to plain pass-throughs --------------------------------
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ComponentChildren }) => <>{children}</>,
  closestCenter: {},
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ComponentChildren }) => <>{children}</>,
  rectSortingStrategy: {},
}));

// ---- SortableTab mock ---------------------------------------------------
vi.mock('../common/SortableTab', () => ({
  SortableTab: ({ children, class: className, onClick, title, id }: {
    children: ComponentChildren; class?: string; onClick?: () => void; title?: string; id: string
  }) => (
    <div data-testid={`sortable-tab-${id}`} class={className} onClick={onClick} title={title}>
      {children}
    </div>
  ),
}));

// ---- moduleDescriptions mock --------------------------------------------
vi.mock('../../moduleDescriptions', () => {
  const descriptions: Record<string, { description: string; priority?: number }> = {
    MHC: { description: 'Matthew Henry Commentary', priority: 1 },
  };
  return {
    getCommentaryDescription: (abbr: string) => descriptions[abbr],
    getCommentaryPriority: (abbr: string) => descriptions[abbr]?.priority ?? 999,
    DEFAULT_COMMENTARY_PRIORITY: 999,
    isDigestModule: (abbr: string) => abbr.toUpperCase() === 'SYNTHESIS',
    getDigestDisplayName: () => 'Combined Summary',
  };
});

// ---- Store state ---------------------------------------------------------
// Use literal string to avoid vi.mock hoisting issues with const declarations
const HOME_TAB_ID_VAL = 'ctab-home'; // matches HOME_TAB_ID in commentaryStore

function makeCommentaryTab(overrides: Partial<CommentaryTab> = {}): CommentaryTab {
  return {
    id: 'ctab-1',
    moduleAbbr: 'MHC',
    moduleName: 'Matthew Henry Commentary',
    temporary: false,
    pinned: false,
    ...overrides,
  };
}

let mockTabs: CommentaryTab[] = [];
let mockActiveTabId = '';
let mockCommentaryModules: { abbreviation: string; name: string; type: string }[] = [];
let mockShowOverview = true;
let mockHighlightedVerse: number | null = null;
let mockEntriesByTab = new Map<string, unknown[]>();
let mockAvailability: Record<string, unknown> = {};
let mockAvailabilityLoading = false;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockSetActiveTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockAddTab = vi.fn();
const mockReorderTabs = vi.fn();
const mockFetchAvailability = vi.fn();
// Parameters spelled out because the mock is called with them below; an
// argument-less implementation narrows the mock to zero arity.
const mockTabHasContentForVerse = vi.fn((_tabId: string, _verseId: number) => false);

vi.mock('../../stores/commentaryStore', () => ({
  commentaryStore: {
    get tabs() { return mockTabs; },
    get activeTabId() { return mockActiveTabId; },
    get entriesByTab() { return mockEntriesByTab; },
    get availability() { return mockAvailability; },
    get availabilityLoading() { return mockAvailabilityLoading; },
    setActiveTab: (id: string) => mockSetActiveTab(id),
    removeTab: (id: string) => mockRemoveTab(id),
    addTab: (abbr: string, name: string) => mockAddTab(abbr, name),
    reorderTabs: (a: string, b: string) => mockReorderTabs(a, b),
    fetchAvailability: (book: number, ch: number, v?: number) => mockFetchAvailability(book, ch, v),
    tabHasContentForVerse: (tabId: string, verseId: number) => mockTabHasContentForVerse(tabId, verseId),
  },
  // Use literal string here — vi.mock factories are hoisted above const declarations
  HOME_TAB_ID: 'ctab-home',
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    get availableModules() { return mockCommentaryModules; },
    getCommentaryModules: () => mockCommentaryModules,
    getBookName: (n: number) => (n === 43 ? 'John' : `Book ${n}`),
    getModuleDescription: vi.fn(() => null),
    getCommentarySections: vi.fn(() => null),
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({
      book: 43,
      chapter: 3,
      studyVerse: mockHighlightedVerse,
    }),
    get activeTabId() { return 'tab-1'; },
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    get showCommentaryOverview() { return mockShowOverview; },
  },
}));

import { CommentaryTabBar } from './CommentaryTabBar';

describe('CommentaryTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTabs = [];
    mockActiveTabId = '';
    mockCommentaryModules = [
      { abbreviation: 'MHC', name: 'Matthew Henry Commentary', type: 'commentary' },
    ];
    mockShowOverview = true;
    mockHighlightedVerse = null;
    mockEntriesByTab = new Map();
    mockAvailability = {};
    mockAvailabilityLoading = false;
  });

  // ------------------------------------------------------------------
  // Root rendering
  // ------------------------------------------------------------------
  it('renders the commentary-tab-bar root', () => {
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('.commentary-tab-bar')).toBeTruthy();
  });

  it('renders the add-commentary button', () => {
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('.commentary-tab-bar__add')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Home tab
  // ------------------------------------------------------------------
  it('renders home tab when showOverview is true and home tab exists', () => {
    mockTabs = [{ id: HOME_TAB_ID_VAL, moduleAbbr: HOME_TAB_ID_VAL, moduleName: 'Overview' }];
    mockShowOverview = true;
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('.commentary-tab-bar__tab--home')).toBeTruthy();
  });

  it('does not render home tab when showOverview is false', () => {
    mockTabs = [{ id: HOME_TAB_ID_VAL, moduleAbbr: HOME_TAB_ID_VAL, moduleName: 'Overview' }];
    mockShowOverview = false;
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('.commentary-tab-bar__tab--home')).toBeNull();
  });

  it('calls setActiveTab with HOME_TAB_ID when home tab is clicked', () => {
    mockTabs = [{ id: HOME_TAB_ID_VAL, moduleAbbr: HOME_TAB_ID_VAL, moduleName: 'Overview' }];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__tab--home')!);
    expect(mockSetActiveTab).toHaveBeenCalledWith(HOME_TAB_ID_VAL);
  });

  it('applies active class to home tab when it is the active tab', () => {
    mockTabs = [{ id: HOME_TAB_ID_VAL, moduleAbbr: HOME_TAB_ID_VAL, moduleName: 'Overview' }];
    mockActiveTabId = HOME_TAB_ID_VAL;
    const { container } = render(<CommentaryTabBar />);
    const homeTab = container.querySelector('.commentary-tab-bar__tab--home')!;
    expect(homeTab.className).toContain('commentary-tab-bar__tab--active');
  });

  // ------------------------------------------------------------------
  // Commentary tabs (via SortableTab mock)
  // ------------------------------------------------------------------
  it('renders a sortable tab for each non-home commentary tab', () => {
    mockTabs = [
      makeCommentaryTab({ id: 'ctab-1', moduleAbbr: 'MHC' }),
      makeCommentaryTab({ id: 'ctab-2', moduleAbbr: 'EBC', moduleName: 'Expositor\'s Bible Commentary' }),
    ];
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('[data-testid="sortable-tab-ctab-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="sortable-tab-ctab-2"]')).toBeTruthy();
  });

  it('calls setActiveTab when a commentary tab is clicked', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1' })];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('[data-testid="sortable-tab-ctab-1"]')!);
    expect(mockSetActiveTab).toHaveBeenCalledWith('ctab-1');
  });

  it('applies active class to the active commentary tab', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1' })];
    mockActiveTabId = 'ctab-1';
    const { container } = render(<CommentaryTabBar />);
    const tab = container.querySelector('[data-testid="sortable-tab-ctab-1"]')!;
    expect(tab.className).toContain('commentary-tab-bar__tab--active');
  });

  it('calls removeTab when close button is clicked on a tab', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1' })];
    const { container } = render(<CommentaryTabBar />);
    const closeBtn = container.querySelector('.commentary-tab-bar__close')!;
    fireEvent.click(closeBtn);
    expect(mockRemoveTab).toHaveBeenCalledWith('ctab-1');
  });

  it('does not call setActiveTab when close button is clicked (propagation stopped)', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1' })];
    const { container } = render(<CommentaryTabBar />);
    const closeBtn = container.querySelector('.commentary-tab-bar__close')!;
    fireEvent.click(closeBtn);
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Module selection dialog
  // ------------------------------------------------------------------
  it('module dialog is not shown initially', () => {
    const { container } = render(<CommentaryTabBar />);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('opens module dialog when add button is clicked', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeTruthy();
  });

  it('lists available commentary modules in dialog', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    const cards = container.querySelectorAll('.module-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('MHC');
  });

  it('closes dialog when cancel button is clicked', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeTruthy();
    fireEvent.click(container.querySelector('.module-dialog__btn--cancel')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('closes dialog when the close X button is clicked', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    fireEvent.click(container.querySelector('.module-dialog__close')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('closes dialog when overlay backdrop is clicked', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    fireEvent.click(container.querySelector('.module-dialog-overlay')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('shows empty state when no commentary modules are available', () => {
    mockCommentaryModules = [];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    expect(container.querySelector('.module-dialog__empty')).toBeTruthy();
  });

  it('shows no-matches when filter has no results', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    const filterInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    fireEvent.input(filterInput, { target: { value: 'ZZZNOMATCH' } });
    expect(container.querySelector('.module-dialog__empty')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Pending selection (check/uncheck)
  // ------------------------------------------------------------------
  it('pre-checks modules that already have open tabs', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1', moduleAbbr: 'MHC' })];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    // MHC should be pre-checked (has open tab)
    expect(container.querySelector('.module-card__check--on')).toBeTruthy();
  });

  it('adds tab after apply when module is checked in dialog', () => {
    // Start with no open tabs — MHC is not checked initially
    mockTabs = [];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    // Click MHC card to check it
    const card = container.querySelector('.module-card')!;
    fireEvent.click(card);
    // Apply
    fireEvent.click(container.querySelector('.module-dialog__btn--apply')!);
    expect(mockAddTab).toHaveBeenCalledWith('MHC', 'Matthew Henry Commentary');
  });

  it('removes tab after apply when module is unchecked in dialog', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1', moduleAbbr: 'MHC' })];
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    // Click MHC card to uncheck it
    const card = container.querySelector('.module-card')!;
    fireEvent.click(card);
    // Apply
    fireEvent.click(container.querySelector('.module-dialog__btn--apply')!);
    expect(mockRemoveTab).toHaveBeenCalledWith('ctab-1');
  });

  it('closes dialog after apply', () => {
    const { container } = render(<CommentaryTabBar />);
    fireEvent.click(container.querySelector('.commentary-tab-bar__add')!);
    fireEvent.click(container.querySelector('.module-dialog__btn--apply')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Tab label
  // ------------------------------------------------------------------
  it('shows module abbreviation as tab label', () => {
    mockTabs = [makeCommentaryTab({ id: 'ctab-1', moduleAbbr: 'MHC' })];
    const { container } = render(<CommentaryTabBar />);
    const label = container.querySelector('.commentary-tab-bar__label');
    expect(label?.textContent?.trim()).toContain('MHC');
  });
});
