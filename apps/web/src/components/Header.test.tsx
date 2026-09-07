/**
 * Component tests for Header.
 *
 * Pattern: Store-connected component with multiple dropdowns.
 * settingsStore, searchStore, offlineStore, and bibleStore are mocked
 * so tests control exactly what the header sees.
 * useStore is mocked to call the selector immediately (no subscription).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

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

vi.mock('../stores/settingsStore', () => ({
  settingsStore: {
    getResolvedTheme: () => mockTheme,
    setTheme: vi.fn(),
  },
}));

const mockPerformSearch = vi.fn();
const mockSetSearchType = vi.fn();
const mockWarmupSemanticSearch = vi.fn(() => Promise.resolve());

vi.mock('../stores/searchStore', () => ({
  searchStore: {
    get searchType() { return mockSearchType; },
    get query() { return mockSearchQuery; },
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

  it('calls setSearchType with "keyword" when keyword option is mousedown-ed', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    const kwOption = container.querySelector<HTMLElement>('.header__search-type-option:first-child')!;
    fireEvent.mouseDown(kwOption);
    expect(mockSetSearchType).toHaveBeenCalledWith('keyword');
  });

  it('calls setSearchType with "semantic" and warmupSemanticSearch when Ideas option is clicked', () => {
    const { container } = render(<Header />);
    fireEvent.click(container.querySelector('.header__search-type-btn')!);
    const semanticOption = container.querySelector<HTMLElement>('[data-search-type="semantic"]')!;
    fireEvent.mouseDown(semanticOption);
    expect(mockSetSearchType).toHaveBeenCalledWith('semantic');
    expect(mockWarmupSemanticSearch).toHaveBeenCalled();
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
});
