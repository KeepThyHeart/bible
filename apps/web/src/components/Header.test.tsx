/**
 * Component tests for Header.
 *
 * Pattern: Store-connected component with multiple dropdowns.
 * settingsStore, searchStore, offlineStore, and bibleStore are mocked
 * so tests control exactly what the header sees.
 * useStore is mocked to call the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Store mock ----------------------------------------------------------
vi.mock('../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

let mockTheme = 'light';
let mockSearchType: 'keyword' | 'semantic' = 'keyword';
let mockSearchQuery = '';
let mockIsOnline = true;
let mockOfflineEnabled = false;
let mockStoredTheme: string | undefined;

vi.mock('../stores/settingsStore', () => ({
  settingsStore: {
    getResolvedTheme: () => mockTheme,
    get theme() { return mockStoredTheme ?? mockTheme; },
    setTheme: vi.fn(),
  },
}));

const mockPerformSearch = vi.fn();
const mockSetSearchType = vi.fn();
const mockClear = vi.fn();
let mockClearSeq = 0;
const mockWarmupSemanticSearch = vi.fn(() => Promise.resolve());

vi.mock('../stores/searchStore', () => ({
  searchStore: {
    get searchType() { return mockSearchType; },
    get query() { return mockSearchQuery; },
    get clearSeq() { return mockClearSeq; },
    clear: () => mockClear(),
    performSearch: (...args: unknown[]) => mockPerformSearch(...args),
    setSearchType: (...args: unknown[]) => mockSetSearchType(...args),
    warmupSemanticSearch: () => mockWarmupSemanticSearch(),
  },
}));

vi.mock('../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
    get enabled() { return mockOfflineEnabled; },
  },
}));

const mockNavigateTo = vi.fn();
const mockOpenBookPicker = vi.fn();

vi.mock('../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ book: 43, chapter: 3, moduleAbbr: 'KJV' }),
    navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
    openBookPicker: () => mockOpenBookPicker(),
  },
}));

vi.mock('../utils/bookNames', () => ({
  getAllBookNames: () => ({ '43': 'John' }),
  getLocalizedBookName: (n: number) => `Book${n}`,
}));

import { Header } from './Header';

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = 'light';
    mockSearchType = 'keyword';
    mockSearchQuery = '';
    mockClearSeq = 0;
    mockIsOnline = true;
    mockOfflineEnabled = false;
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  it('renders the header element', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header')).toBeTruthy();
  });

  it('renders the app name', () => {
    render(<Header />);
    expect(screen.getByText('app.name')).toBeTruthy();
  });

  it('renders the search input', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header__search-field')).toBeTruthy();
  });

  it('renders the TOC button', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header__toc-btn')).toBeTruthy();
  });

  it('calls openBookPicker when TOC button is clicked', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__toc-btn')!);
    expect(mockOpenBookPicker).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Settings and Help buttons
  // ------------------------------------------------------------------
  it('renders the settings button when onSettingsClick is provided', () => {
    const onSettingsClick = vi.fn();
    const { container } = render(<Header onSettingsClick={onSettingsClick} />);
    expect(container.querySelector('[data-testid="header-settings-btn"]')).toBeTruthy();
  });

  it('does not render the settings button when onSettingsClick is not provided', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('[data-testid="header-settings-btn"]')).toBeNull();
  });

  it('calls onSettingsClick when the settings button is clicked', () => {
    const onSettingsClick = vi.fn();
    const { container } = render(<Header onSettingsClick={onSettingsClick} />);
    fireEvent.click(container.querySelector('[data-testid="header-settings-btn"]')!);
    expect(onSettingsClick).toHaveBeenCalled();
  });

  it('renders the help button when onHelpClick is provided', () => {
    const onHelpClick = vi.fn();
    render(<Header onHelpClick={onHelpClick} />);
    // Help button has title="header.help"
    const btn = document.querySelector('.header__action-btn[title="header.help"]');
    expect(btn).toBeTruthy();
  });

  it('calls onHelpClick when the help button is clicked', () => {
    const onHelpClick = vi.fn();
    render(<Header onHelpClick={onHelpClick} />);
    const btn = document.querySelector<HTMLElement>('.header__action-btn[title="header.help"]');
    fireEvent.click(btn!);
    expect(onHelpClick).toHaveBeenCalled();
  });

  it('renders no feedback button unless onFeedbackClick is provided', () => {
    // Mobile deliberately omits it — feedback is reached from the Help dialog
    // there, so the narrow action row keeps four buttons.
    const { container } = render(<Header onHelpClick={vi.fn()} />);
    expect(container.querySelector('[data-testid="header-feedback-btn"]')).toBeNull();
  });

  it('calls onFeedbackClick when the feedback button is clicked', () => {
    const onFeedbackClick = vi.fn();
    const { container } = render(<Header onFeedbackClick={onFeedbackClick} />);
    fireEvent.click(container.querySelector('[data-testid="header-feedback-btn"]')!);
    expect(onFeedbackClick).toHaveBeenCalled();
  });

  it('calls onLogoClick when the logo is clicked', () => {
    const onLogoClick = vi.fn();
    const { container } = render(<Header onLogoClick={onLogoClick} />);
    fireEvent.click(container.querySelector('.header__logo')!);
    expect(onLogoClick).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Theme dropdown
  // ------------------------------------------------------------------
  it('does not show the theme dropdown initially', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header__theme-dropdown')).toBeNull();
  });

  it('opens the theme dropdown when the theme button is clicked', () => {
    const { container } = render(<Header />);
    const themeBtn = container.querySelector<HTMLElement>('.header__theme-wrapper .header__action-btn')!;
    fireEvent.click(themeBtn);
    expect(container.querySelector('.header__theme-dropdown')).toBeTruthy();
  });

  it('shows theme options in the dropdown', () => {
    const { container } = render(<Header />);
    const themeBtn = container.querySelector<HTMLElement>('.header__theme-wrapper .header__action-btn')!;
    fireEvent.click(themeBtn);
    // First 3 options: light, dark, sepia
    const options = container.querySelectorAll('.header__theme-option');
    expect(options.length).toBeGreaterThan(0);
  });

  it('calls onSettingsClick with "theme" when "More" is clicked in theme dropdown', () => {
    const onSettingsClick = vi.fn();
    const { container } = render(<Header onSettingsClick={onSettingsClick} />);
    const themeBtn = container.querySelector<HTMLElement>('.header__theme-wrapper .header__action-btn')!;
    fireEvent.click(themeBtn);
    const moreBtn = screen.getByText('header.more');
    fireEvent.click(moreBtn);
    expect(onSettingsClick).toHaveBeenCalledWith('theme');
  });

  // ------------------------------------------------------------------
  // Search type dropdown
  // ------------------------------------------------------------------
  it('shows the keyword search type button by default', () => {
    render(<Header />);
    expect(screen.getByText('header.search')).toBeTruthy();
  });

  it('opens the search type dropdown when the search type button is clicked', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    expect(container.querySelector('.header__search-type-dropdown')).toBeTruthy();
  });

  it('calls setSearchType with "keyword" when keyword option is clicked', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    const kwOption = container.querySelector<HTMLElement>('.header__search-type-option:first-child')!;
    fireEvent.click(kwOption);
    expect(mockSetSearchType).toHaveBeenCalledWith('keyword');
  });

  it('calls setSearchType with "semantic" and warmupSemanticSearch when Ideas option is clicked', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    const semanticOption = container.querySelector<HTMLElement>('[data-search-type="semantic"]')!;
    fireEvent.click(semanticOption);
    expect(mockSetSearchType).toHaveBeenCalledWith('semantic');
    expect(mockWarmupSemanticSearch).toHaveBeenCalled();
  });

  // 0209 W3: search-type button / menu semantics and focus.
  it('gives the search-type button a stable name, haspopup and expanded state', () => {
    const { container } = render(<Header />);
    const btn = container.querySelector<HTMLElement>('.header__search-type-btn')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    // The mocked t() returns the key: the name comes from one key, not from the Search/Ideas label.
    expect(btn.getAttribute('aria-label')).toBe('header.searchTypeCurrent');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('exposes the selected search type in the menu with menuitemradio', () => {
    mockSearchType = 'semantic';
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    expect(screen.getByRole('menuitemradio', { name: 'header.ideasSearch' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'header.standardSearch' }).getAttribute('aria-checked')).toBe('false');
  });

  it('returns focus to the search field after choosing a search type', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'header.standardSearch' }));
    expect(document.activeElement).toBe(container.querySelector('.header__search-field'));
  });

  it('marks the Ideas help button expanded and gives its popup a dialog role and name', () => {
    mockSearchType = 'semantic';
    const { container } = render(<Header />);
    const btn = container.querySelector<HTMLElement>('.header__ideas-help-btn')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'header.ideasHelpTitle' })).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Search form submission
  // ------------------------------------------------------------------
  it('navigates to a Bible reference when a valid reference is submitted', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'John 3:16' } });
    fireEvent.submit(container.querySelector('.header__search')!);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 3, 16, { endVerse: undefined });
  });

  it('performs a search when the input is not a Bible reference', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'love' } });
    fireEvent.submit(container.querySelector('.header__search')!);
    expect(mockPerformSearch).toHaveBeenCalledWith('love', undefined, expect.any(Array));
  });

  // W-039: Enter in the header search used to blur the field everywhere.
  it('keeps focus in the search field after a search on desktop', () => {
    const { container } = render(<Header />, { container: document.body.appendChild(document.createElement('div')) });
    const input = container.querySelector('.header__search-field') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'love' } });
    fireEvent.submit(container.querySelector('.header__search')!);
    expect(mockPerformSearch).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('blurs the search field after a search on the phone (hides the keyboard)', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    try {
      const { container } = render(<Header />, { container: document.body.appendChild(document.createElement('div')) });
      const input = container.querySelector('.header__search-field') as HTMLInputElement;
      input.focus();
      fireEvent.input(input, { target: { value: 'love' } });
      fireEvent.submit(container.querySelector('.header__search')!);
      expect(document.activeElement).not.toBe(input);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('does not submit empty searches', () => {
    const { container } = render(<Header />);
    fireEvent.submit(container.querySelector('.header__search')!);
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(mockPerformSearch).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Clear button
  // ------------------------------------------------------------------
  it('shows the clear button when input has text', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'test' } });
    expect(container.querySelector('.header__search-clear')).toBeTruthy();
  });

  it('hides the clear button when input is empty', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header__search-clear')).toBeNull();
  });

  it('clears the input when the clear button is clicked', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'test' } });
    const clearBtn = container.querySelector<HTMLElement>('.header__search-clear')!;
    fireEvent.click(clearBtn);
    expect(container.querySelector('.header__search-clear')).toBeNull();
  });

  // 0209 W3: Clear must reset the store too, or a later re-render puts the old query back.
  it('clears the search store when the clear button is clicked', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'mercy' } });
    fireEvent.click(container.querySelector<HTMLElement>('.header__search-clear')!);
    expect(mockClear).toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('empties the box and focuses it when the store is cleared elsewhere (Close search)', () => {
    const { container, rerender } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'mercy' } });
    expect(input.value).toBe('mercy');
    mockClearSeq = 1;
    rerender(<Header />);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('keeps the typed text when the search type changes (query is not re-synced from the store)', () => {
    const { container, rerender } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'mercy' } });
    mockSearchType = 'semantic';
    rerender(<Header />);
    expect(input.value).toBe('mercy');
  });

  // 0209 U-001: the clear button had no name, and Preact reused the "Go to Passage" button's
  // element for it, so a screen reader heard an unnamed button where Go to Passage had been.
  it('names the clear button and keeps "Go to Passage" named after typing', () => {
    const { container } = render(<Header />);
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.input(input, { target: { value: 'love' } });
    expect(screen.getByRole('button', { name: 'header.clearSearch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'bookChapterPicker.goToPassage' })).toBeTruthy();
    for (const b of Array.from(container.querySelectorAll('header button'))) {
      expect(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent?.trim()).toBeTruthy();
    }
  });

  // 0209 U-003/U-004: the theme picker is a non-modal popup with pressed state on the current theme.
  it('theme options expose which theme is selected', () => {
    mockTheme = 'dark';
    render(<Header />);
    fireEvent.click(screen.getByTitle('header.theme'));
    expect(screen.getByRole('button', { name: 'themes.dark' }).getAttribute('aria-pressed')).toBe('true');
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
  });

  // 0209 U-225: with the stored setting on Auto, no concrete theme may show as pressed.
  it('shows Auto pressed (and names the resolved theme) when the stored theme is auto', () => {
    mockTheme = 'light';
    mockStoredTheme = 'auto';
    try {
      render(<Header />);
      const btn = screen.getByTitle('header.theme');
      expect(btn.getAttribute('aria-label')).toBe('header.theme: themes.auto (themes.light)');
      fireEvent.click(btn);
      expect(screen.getByRole('button', { name: 'themes.auto' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: 'themes.light' }).getAttribute('aria-pressed')).toBe('false');
    } finally {
      mockStoredTheme = undefined;
    }
  });

  it('theme popup is not aria-modal and reports expanded on its button', () => {
    render(<Header />);
    const btn = screen.getByTitle('header.theme');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog', { name: 'header.theme' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
  });

  it('theme popup closes when focus moves to the search field', () => {
    const { container } = render(<Header />);
    fireEvent.click(screen.getByTitle('header.theme'));
    const option = container.querySelector<HTMLElement>('.header__theme-option')!;
    const input = container.querySelector<HTMLInputElement>('.header__search-field')!;
    fireEvent.focusOut(option, { relatedTarget: input });
    expect(container.querySelector('.header__theme-dropdown')).toBeNull();
  });

  it('theme popup closes on a pointer press outside it', () => {
    const { container } = render(<Header />);
    fireEvent.click(screen.getByTitle('header.theme'));
    expect(container.querySelector('.header__theme-dropdown')).toBeTruthy();
    fireEvent.pointerDown(container.querySelector('.header__search-field')!);
    expect(container.querySelector('.header__theme-dropdown')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Offline badge
  // ------------------------------------------------------------------
  it('does not show offline badge when online', () => {
    mockOfflineEnabled = true;
    mockIsOnline = true;
    const { container } = render(<Header />);
    expect(container.querySelector('.header__offline-badge')).toBeNull();
  });

  it('shows offline badge when offline mode is enabled and offline', () => {
    mockOfflineEnabled = true;
    mockIsOnline = false;
    const { container } = render(<Header />);
    expect(container.querySelector('.header__offline-badge')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Semantic search help popup
  // ------------------------------------------------------------------
  it('shows the ideas help button when search type is semantic', () => {
    mockSearchType = 'semantic';
    const { container } = render(<Header />);
    expect(container.querySelector('.header__ideas-help-btn')).toBeTruthy();
  });

  it('does not show the ideas help button when search type is keyword', () => {
    mockSearchType = 'keyword';
    const { container } = render(<Header />);
    expect(container.querySelector('.header__ideas-help-btn')).toBeNull();
  });

  // 0209 W6: WAI-ARIA menu-button keyboard behaviour for the search-type menu.
  describe('search-type menu keyboard', () => {
    it('opens on ArrowDown and focuses the checked item; arrows, Home and End move', async () => {
      mockSearchType = 'semantic';
      const { container } = render(<Header />);
      const btn = container.querySelector<HTMLElement>('.header__search-type-btn')!;
      btn.focus();
      fireEvent.keyDown(btn, { key: 'ArrowDown' });
      const ideas = await screen.findByRole('menuitemradio', { name: 'header.ideasSearch' });
      await waitFor(() => expect(document.activeElement).toBe(ideas));
      const standard = screen.getByRole('menuitemradio', { name: 'header.standardSearch' });
      fireEvent.keyDown(ideas, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(standard);
      fireEvent.keyDown(standard, { key: 'End' });
      expect(document.activeElement).toBe(ideas);
      fireEvent.keyDown(ideas, { key: 'Home' });
      expect(document.activeElement).toBe(standard);
    });

    it('opens on Enter with focus on the first item', async () => {
      mockSearchType = 'keyword';
      const { container } = render(<Header />);
      const btn = container.querySelector<HTMLElement>('.header__search-type-btn')!;
      btn.focus();
      fireEvent.keyDown(btn, { key: 'Enter' });
      const first = await screen.findByRole('menuitemradio', { name: 'header.standardSearch' });
      await waitFor(() => expect(document.activeElement).toBe(first));
    });

    it('Escape from an item closes the menu and focuses the trigger', async () => {
      const { container } = render(<Header />);
      const btn = container.querySelector<HTMLElement>('.header__search-type-btn')!;
      fireEvent.keyDown(btn, { key: 'ArrowDown' });
      const item = await screen.findByRole('menuitemradio', { name: 'header.standardSearch' });
      await waitFor(() => expect(document.activeElement).toBe(item));
      fireEvent.keyDown(item, { key: 'Escape' });
      expect(container.querySelector('.header__search-type-dropdown')).toBeNull();
      expect(document.activeElement).toBe(btn);
    });

    it('Tab closes the menu', async () => {
      const { container } = render(<Header />);
      const btn = container.querySelector<HTMLElement>('.header__search-type-btn')!;
      fireEvent.keyDown(btn, { key: 'ArrowDown' });
      const item = await screen.findByRole('menuitemradio', { name: 'header.standardSearch' });
      fireEvent.keyDown(item, { key: 'Tab' });
      expect(container.querySelector('.header__search-type-dropdown')).toBeNull();
    });
  });
});
