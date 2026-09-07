import type { ComponentChildren } from 'preact';
/**
 * Component tests for DictionaryTabBar.
 *
 * Pattern: Store-connected component with drag-and-drop and a module-selection
 * dialog (the shared ModuleSelectDialog, rendered for real).
 * dictionaryStore and moduleStore are mocked directly; useStore calls the
 * selector immediately. @dnd-kit is mocked so no pointer/touch events are
 * needed for drag testing. SortableTab is stubbed to a plain div so the
 * test can assert on tab labels without DnD internals.
 * Tests cover: home tab rendering, module tabs, active classes, temporary
 * tabs, close buttons, the add-dictionary dialog, and module sections.
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

// ---- @dnd-kit/core: stub DndContext, sensors, etc. ----------------------
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: unknown }) => children,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  rectSortingStrategy: vi.fn(),
}));

// ---- SortableTab: render a plain div with the forwarded props -----------
vi.mock('../common/SortableTab', () => ({
  SortableTab: ({
    children,
    id,
    class: cls,
    onClick,
    title,
  }: {
    children: ComponentChildren;
    id: string;
    class?: string;
    onClick?: () => void;
    title?: string;
  }) => (
    <div data-testid={`sortable-tab-${id}`} class={cls} onClick={onClick} title={title}>
      {children}
    </div>
  ),
}));

// ---- dictionaryStore mock ------------------------------------------------
import type { DictionaryTab } from '../../stores/dictionaryStore';

let mockTabs: DictionaryTab[] = [];
let mockActiveTabId = 'dtab-home';
let mockModules: { abbreviation: string; name: string; language_code: string }[] = [];

const mockSetActiveTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockAddTab = vi.fn();
const mockReorderTabs = vi.fn();

vi.mock('../../stores/dictionaryStore', () => ({
  DICT_HOME_TAB_ID: 'dtab-home',
  dictionaryStore: {
    get tabs() { return mockTabs; },
    get activeTabId() { return mockActiveTabId; },
    get modules() { return mockModules; },
    setActiveTab: (id: string) => mockSetActiveTab(id),
    removeTab: (id: string) => mockRemoveTab(id),
    addTab: (abbr: string, name: string) => mockAddTab(abbr, name),
    reorderTabs: (from: string, to: string) => mockReorderTabs(from, to),
  },
}));

// ---- moduleStore mock ---------------------------------------------------
let mockDictionarySections: { title: string; modules: string[] }[] | null = null;

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getDictionarySections: () => mockDictionarySections,
    getModuleDescription: () => null,
  },
}));

import { DictionaryTabBar } from './DictionaryTabBar';

function makeTab(overrides: Partial<DictionaryTab> = {}): DictionaryTab {
  return {
    id: 'dtab-1',
    moduleAbbr: 'strongs',
    moduleName: "Strong's Concordance",
    ...overrides,
  };
}

describe('DictionaryTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTabId = 'dtab-home';
    mockTabs = [{ id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' }];
    mockModules = [];
    mockDictionarySections = null;
  });

  // ------------------------------------------------------------------
  // Container
  // ------------------------------------------------------------------
  it('renders the tab bar container', () => {
    const { container } = render(<DictionaryTabBar />);
    expect(container.querySelector('.dictionary-tab-bar')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Home tab
  // ------------------------------------------------------------------
  it('renders the home tab', () => {
    render(<DictionaryTabBar />);
    expect(screen.getByText(/dictionaryTabBar\.home/)).toBeTruthy();
  });

  it('marks the home tab as active when activeTabId is home', () => {
    mockActiveTabId = 'dtab-home';
    const { container } = render(<DictionaryTabBar />);
    const homeTab = container.querySelector('.dictionary-tab-bar__tab--home');
    expect(homeTab?.classList.contains('dictionary-tab-bar__tab--active')).toBe(true);
  });

  it('does not mark the home tab active when another tab is selected', () => {
    const tab = makeTab();
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = tab.id;
    const { container } = render(<DictionaryTabBar />);
    const homeTab = container.querySelector('.dictionary-tab-bar__tab--home');
    expect(homeTab?.classList.contains('dictionary-tab-bar__tab--active')).toBe(false);
  });

  it('calls setActiveTab(home) when the home tab is clicked', () => {
    const { container } = render(<DictionaryTabBar />);
    const homeTab = container.querySelector('.dictionary-tab-bar__tab--home') as HTMLElement;
    fireEvent.click(homeTab);
    expect(mockSetActiveTab).toHaveBeenCalledWith('dtab-home');
  });

  // ------------------------------------------------------------------
  // Module tabs
  // ------------------------------------------------------------------
  it('renders a SortableTab for each non-home tab', () => {
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleName: "Strong's Concordance" }),
    ];
    render(<DictionaryTabBar />);
    expect(screen.getByTestId('sortable-tab-dtab-1')).toBeTruthy();
  });

  it('shows the module name label in the tab', () => {
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleName: "Strong's Concordance" }),
    ];
    render(<DictionaryTabBar />);
    expect(screen.getByText("Strong's Concordance")).toBeTruthy();
  });

  it('marks a module tab active when it is the active tab', () => {
    const tab = makeTab({ id: 'dtab-1' });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    mockActiveTabId = 'dtab-1';
    render(<DictionaryTabBar />);
    const el = screen.getByTestId('sortable-tab-dtab-1');
    expect(el.className).toContain('dictionary-tab-bar__tab--active');
  });

  it('applies the temporary CSS modifier to temporary tabs', () => {
    const tab = makeTab({ id: 'dtab-temp', temporary: true });
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      tab,
    ];
    render(<DictionaryTabBar />);
    const el = screen.getByTestId('sortable-tab-dtab-temp');
    expect(el.className).toContain('dictionary-tab-bar__tab--temporary');
  });

  it('calls setActiveTab when a module tab is clicked', () => {
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1' }),
    ];
    render(<DictionaryTabBar />);
    const tabEl = screen.getByTestId('sortable-tab-dtab-1');
    fireEvent.click(tabEl);
    expect(mockSetActiveTab).toHaveBeenCalledWith('dtab-1');
  });

  // ------------------------------------------------------------------
  // Close button
  // ------------------------------------------------------------------
  it('renders a close button inside each module tab', () => {
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1' }),
    ];
    const { container } = render(<DictionaryTabBar />);
    const tabEl = screen.getByTestId('sortable-tab-dtab-1');
    expect(tabEl.querySelector('.dictionary-tab-bar__close')).toBeTruthy();
  });

  it('calls removeTab when the close button is clicked', () => {
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1' }),
    ];
    render(<DictionaryTabBar />);
    const tabEl = screen.getByTestId('sortable-tab-dtab-1');
    const closeBtn = tabEl.querySelector('.dictionary-tab-bar__close') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(mockRemoveTab).toHaveBeenCalledWith('dtab-1');
  });

  // ------------------------------------------------------------------
  // Add dictionary button + module dialog
  //
  // The "+" opens the same centered picker the Commentaries pane uses: every
  // dictionary is listed with a checkbox, so it both opens and closes tabs.
  // The old anchored dropdown listed only unopened modules and added one per
  // click, which could not close anything.
  // ------------------------------------------------------------------
  it('renders the add-dictionary button', () => {
    const { container } = render(<DictionaryTabBar />);
    expect(container.querySelector('.dictionary-tab-bar__add')).toBeTruthy();
  });

  it('dialog is not shown initially', () => {
    const { container } = render(<DictionaryTabBar />);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('opens the dialog when the add button is clicked', () => {
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    expect(container.querySelector('.module-dialog-overlay')).toBeTruthy();
  });

  it('closes the dialog on cancel', () => {
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.module-dialog__btn--cancel') as HTMLButtonElement);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('shows the empty state when no dictionary modules are available', () => {
    mockModules = [];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    expect(container.querySelector('.module-dialog__empty')).toBeTruthy();
    expect(screen.getByText('dictionaryTabBar.noModules')).toBeTruthy();
  });

  it('lists every dictionary, including ones already open', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
      { abbreviation: 'vine', name: "Vine's Dictionary", language_code: 'en' },
    ];
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleAbbr: 'strongs' }),
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    expect(container.querySelectorAll('.module-card').length).toBe(2);
  });

  it('pre-checks dictionaries that already have a tab open', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
      { abbreviation: 'vine', name: "Vine's Dictionary", language_code: 'en' },
    ];
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleAbbr: 'strongs' }),
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    expect(container.querySelectorAll('.module-card__check--on').length).toBe(1);
  });

  it('adds a tab for a dictionary checked in the dialog', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.module-card') as HTMLElement);
    fireEvent.click(container.querySelector('.module-dialog__btn--apply') as HTMLButtonElement);
    expect(mockAddTab).toHaveBeenCalledWith('strongs', "Strong's Concordance");
  });

  it('closes the tab for a dictionary unchecked in the dialog', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
    ];
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleAbbr: 'strongs' }),
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.module-card') as HTMLElement);
    fireEvent.click(container.querySelector('.module-dialog__btn--apply') as HTMLButtonElement);
    expect(mockRemoveTab).toHaveBeenCalledWith('dtab-1');
    expect(mockAddTab).not.toHaveBeenCalled();
  });

  it('leaves the open tabs alone when the dialog is cancelled', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
    ];
    mockTabs = [
      { id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' },
      makeTab({ id: 'dtab-1', moduleAbbr: 'strongs' }),
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.module-card') as HTMLElement);
    fireEvent.click(container.querySelector('.module-dialog__btn--cancel') as HTMLButtonElement);
    expect(mockRemoveTab).not.toHaveBeenCalled();
    expect(mockAddTab).not.toHaveBeenCalled();
  });

  it('closes the dialog after apply', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    fireEvent.click(container.querySelector('.module-dialog__btn--apply') as HTMLButtonElement);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('filters the list as the reader types', () => {
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'en' },
      { abbreviation: 'vine', name: "Vine's Dictionary", language_code: 'en' },
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    const filterInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.input(filterInput, { target: { value: 'vine' } });
    expect(container.querySelectorAll('.module-card').length).toBe(1);
    fireEvent.input(filterInput, { target: { value: 'ZZZNOMATCH' } });
    expect(screen.getByText('dictionaryTabBar.noMatches')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Sectioned module list
  // ------------------------------------------------------------------
  it('renders section headers when getDictionarySections returns sections', () => {
    mockDictionarySections = [
      { title: 'Greek', modules: ['strongs'] },
    ];
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'el' },
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    expect(container.querySelector('.module-dialog__section-label')).toBeTruthy();
    expect(screen.getByText('Greek')).toBeTruthy();
  });

  it('renders unsectioned modules under an "other" header', () => {
    mockDictionarySections = [
      { title: 'Greek', modules: ['strongs'] },
    ];
    mockModules = [
      { abbreviation: 'strongs', name: "Strong's Concordance", language_code: 'el' },
      { abbreviation: 'vine', name: "Vine's Dictionary", language_code: 'en' },
    ];
    const { container } = render(<DictionaryTabBar />);
    fireEvent.click(container.querySelector('.dictionary-tab-bar__add') as HTMLButtonElement);
    const sections = container.querySelectorAll('.module-dialog__section-label');
    expect(sections.length).toBe(2);
    expect(screen.getByText('dictionaryTabBar.other')).toBeTruthy();
  });
});
