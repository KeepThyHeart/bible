/**
 * Component tests for DictionaryPane.
 *
 * Pattern: Store-connected component with child components.
 * dictionaryStore is mocked directly; useStore is mocked to call the selector
 * immediately (no subscription). Child components (DictionaryTabBar,
 * DictionaryHome, DictionaryContent) are stubbed to keep tests focused on
 * DictionaryPane's own logic: nav-bar rendering, back-button behaviour,
 * and conditional child selection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ---- useStore: call selector immediately --------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- Stub child components -----------------------------------------------
vi.mock('./DictionaryTabBar', () => ({
  DictionaryTabBar: () => <div data-testid="dict-tab-bar" />,
}));
vi.mock('./DictionaryHome', () => ({
  DictionaryHome: () => <div data-testid="dict-home" />,
}));
vi.mock('./DictionaryContent', () => ({
  DictionaryContent: ({ tabId }: { tabId: string }) => (
    <div data-testid="dict-content" data-tab-id={tabId} />
  ),
}));

// ---- dictionaryStore mock ------------------------------------------------
import type { DictionaryTab } from '../../stores/dictionaryStore';

let mockTabs: DictionaryTab[] = [];
let mockActiveTabId = 'dtab-home';
const mockRemoveTab = vi.fn();
const mockSetActiveTab = vi.fn();
const mockKeepTab = vi.fn();

vi.mock('../../stores/dictionaryStore', () => ({
  DICT_HOME_TAB_ID: 'dtab-home',
  dictionaryStore: {
    get tabs() { return mockTabs; },
    get activeTabId() { return mockActiveTabId; },
    removeTab: (id: string) => mockRemoveTab(id),
    setActiveTab: (id: string) => mockSetActiveTab(id),
    keepTab: (id: string) => mockKeepTab(id),
  },
}));

import { DictionaryPane } from './DictionaryPane';

function makeTab(overrides: Partial<DictionaryTab> = {}): DictionaryTab {
  return {
    id: 'dtab-1',
    moduleAbbr: 'strongs',
    moduleName: "Strong's Concordance",
    ...overrides,
  };
}

describe('DictionaryPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTabId = 'dtab-home';
    mockTabs = [{ id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' }];
  });

  // ------------------------------------------------------------------
  // Container always renders
  // ------------------------------------------------------------------
  it('renders the dictionary-pane container', () => {
    const { container } = render(<DictionaryPane />);
    expect(container.querySelector('.dictionary-pane')).toBeTruthy();
  });

  it('always renders the DictionaryTabBar', () => {
    render(<DictionaryPane />);
    expect(screen.getByTestId('dict-tab-bar')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Home tab: shows DictionaryHome, no nav bar
  // ------------------------------------------------------------------
  it('shows DictionaryHome when active tab is home', () => {
    render(<DictionaryPane />);
    expect(screen.getByTestId('dict-home')).toBeTruthy();
    expect(screen.queryByTestId('dict-content')).toBeNull();
  });

  it('does not show the nav bar on the home tab', () => {
    const { container } = render(<DictionaryPane />);
    expect(container.querySelector('.dictionary-nav-bar')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Non-home tab: shows DictionaryContent + nav bar
  // ------------------------------------------------------------------
  it('shows DictionaryContent when a non-home tab is active', () => {
    const tab = makeTab();
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    render(<DictionaryPane />);
    expect(screen.getByTestId('dict-content')).toBeTruthy();
    expect(screen.queryByTestId('dict-home')).toBeNull();
  });

  it('passes the active tabId to DictionaryContent', () => {
    const tab = makeTab({ id: 'dtab-99' });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = 'dtab-99';
    render(<DictionaryPane />);
    expect(screen.getByTestId('dict-content').getAttribute('data-tab-id')).toBe('dtab-99');
  });

  it('shows the nav bar when a non-home tab is active', () => {
    const tab = makeTab();
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    const { container } = render(<DictionaryPane />);
    expect(container.querySelector('.dictionary-nav-bar')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Back button on permanent tab → setActiveTab(home)
  // ------------------------------------------------------------------
  it('back button calls setActiveTab(home) for a permanent tab', () => {
    const tab = makeTab({ temporary: false });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    const { container } = render(<DictionaryPane />);
    const backBtn = container.querySelector('.dictionary-nav-bar__back') as HTMLButtonElement;
    fireEvent.click(backBtn);
    expect(mockSetActiveTab).toHaveBeenCalledWith('dtab-home');
    expect(mockRemoveTab).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Back button on temporary tab → removeTab
  // ------------------------------------------------------------------
  it('back button calls removeTab for a temporary tab', () => {
    const tab = makeTab({ id: 'dtab-temp', temporary: true });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = 'dtab-temp';
    const { container } = render(<DictionaryPane />);
    const backBtn = container.querySelector('.dictionary-nav-bar__back') as HTMLButtonElement;
    fireEvent.click(backBtn);
    expect(mockRemoveTab).toHaveBeenCalledWith('dtab-temp');
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // "Add to tabs" button only appears on temporary tabs
  // ------------------------------------------------------------------
  it('add-to-tabs button is visible for temporary tabs', () => {
    const tab = makeTab({ temporary: true });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    const { container } = render(<DictionaryPane />);
    expect(container.querySelector('.dictionary-nav-bar__add')).toBeTruthy();
  });

  it('add-to-tabs button is NOT visible for permanent tabs', () => {
    const tab = makeTab({ temporary: false });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    const { container } = render(<DictionaryPane />);
    expect(container.querySelector('.dictionary-nav-bar__add')).toBeNull();
  });

  it('add-to-tabs button calls keepTab', () => {
    const tab = makeTab({ id: 'dtab-temp2', temporary: true });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = 'dtab-temp2';
    const { container } = render(<DictionaryPane />);
    const addBtn = container.querySelector('.dictionary-nav-bar__add') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(mockKeepTab).toHaveBeenCalledWith('dtab-temp2');
  });
});
