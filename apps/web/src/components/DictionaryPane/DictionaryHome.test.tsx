/**
 * Component tests for DictionaryHome.
 *
 * Pattern: Store-connected component.
 * dictionaryStore is mocked directly; useStore is mocked to call the
 * selector immediately (no subscription).
 * Tests cover: search input, suggestions list, module cards, starring,
 * keyboard navigation, empty states.
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

// ---- dictionaryStore mock ------------------------------------------------
import type { DictionaryModule } from '../../stores/dictionaryStore';

interface HomeSuggestion {
  entry_key: string;
  word: string;
  module_abbr: string;
  module_name: string;
  transliteration?: string;
}

let mockHomeSearchQuery = '';
let mockHomeSuggestions: HomeSuggestion[] = [];
let mockHomeSearchLoading = false;
let mockModules: DictionaryModule[] = [];
let mockStarredModules: Set<string> = new Set();

const mockSetHomeSearchQuery = vi.fn();
const mockOpenDictionaryEntry = vi.fn();
const mockOpenTemporaryTab = vi.fn();
const mockToggleStarred = vi.fn();

vi.mock('../../stores/dictionaryStore', () => ({
  DICT_HOME_TAB_ID: 'dtab-home',
  dictionaryStore: {
    get homeSearchQuery() { return mockHomeSearchQuery; },
    get homeSuggestions() { return mockHomeSuggestions; },
    get homeSearchLoading() { return mockHomeSearchLoading; },
    get modules() { return mockModules; },
    get starredModules() { return mockStarredModules; },
    setHomeSearchQuery: (q: string) => mockSetHomeSearchQuery(q),
    openDictionaryEntry: (key: string, abbr: string, name: string) =>
      mockOpenDictionaryEntry(key, abbr, name),
    openTemporaryTab: (abbr: string, name: string) => mockOpenTemporaryTab(abbr, name),
    toggleStarred: (abbr: string) => mockToggleStarred(abbr),
  },
}));

import { DictionaryHome } from './DictionaryHome';

function makeModule(overrides: Partial<DictionaryModule> = {}): DictionaryModule {
  return {
    abbreviation: 'strongs',
    name: "Strong's Concordance",
    language_code: 'en',
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<HomeSuggestion> = {}): HomeSuggestion {
  return {
    entry_key: 'agape',
    word: 'Agape',
    module_abbr: 'strongs',
    module_name: "Strong's",
    ...overrides,
  };
}

describe('DictionaryHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHomeSearchQuery = '';
    mockHomeSuggestions = [];
    mockHomeSearchLoading = false;
    mockModules = [];
    mockStarredModules = new Set();
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  it('renders the search input', () => {
    render(<DictionaryHome />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('search input placeholder uses the i18n key', () => {
    render(<DictionaryHome />);
    const input = screen.getByRole('textbox');
    expect((input as HTMLInputElement).placeholder).toBe('dictionaryHome.searchAll');
  });

  // ------------------------------------------------------------------
  // Loading indicator
  // ------------------------------------------------------------------
  it('shows loading text when homeSearchLoading is true', () => {
    mockHomeSearchLoading = true;
    render(<DictionaryHome />);
    expect(screen.getByText('dictionaryHome.searching')).toBeTruthy();
  });

  it('does not show loading text when homeSearchLoading is false', () => {
    mockHomeSearchLoading = false;
    render(<DictionaryHome />);
    expect(screen.queryByText('dictionaryHome.searching')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Suggestions list
  // ------------------------------------------------------------------
  it('shows suggestions when homeSuggestions is non-empty', () => {
    mockHomeSuggestions = [makeSuggestion()];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__suggestions')).toBeTruthy();
  });

  it('renders each suggestion word and source module name', () => {
    mockHomeSuggestions = [
      makeSuggestion({ word: 'Agape', module_name: "Strong's" }),
      makeSuggestion({ entry_key: 'logos', word: 'Logos', module_abbr: 'lsj', module_name: 'LSJ' }),
    ];
    render(<DictionaryHome />);
    expect(screen.getByText('Agape')).toBeTruthy();
    expect(screen.getByText("Strong's")).toBeTruthy();
    expect(screen.getByText('Logos')).toBeTruthy();
    expect(screen.getByText('LSJ')).toBeTruthy();
  });

  it('calls openDictionaryEntry when a suggestion is clicked', () => {
    mockHomeSuggestions = [
      makeSuggestion({ entry_key: 'agape', module_abbr: 'strongs', module_name: "Strong's" }),
    ];
    render(<DictionaryHome />);
    const suggestionBtn = screen.getByText('Agape').closest('button')!;
    fireEvent.click(suggestionBtn);
    expect(mockOpenDictionaryEntry).toHaveBeenCalledWith('agape', 'strongs', "Strong's");
  });

  it('does not show suggestions block when homeSuggestions is empty', () => {
    mockHomeSuggestions = [];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__suggestions')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Module cards (shown when no search query)
  // ------------------------------------------------------------------
  it('shows module cards when no search query is set', () => {
    mockModules = [makeModule()];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__cards')).toBeTruthy();
  });

  it('hides module cards when a search query is active', () => {
    mockHomeSearchQuery = 'love';
    mockModules = [makeModule()];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__cards')).toBeNull();
  });

  it('renders a card for each module', () => {
    mockModules = [
      makeModule({ abbreviation: 'strongs', name: "Strong's Concordance" }),
      makeModule({ abbreviation: 'vine', name: "Vine's Dictionary" }),
    ];
    render(<DictionaryHome />);
    expect(screen.getByText("Strong's Concordance")).toBeTruthy();
    expect(screen.getByText("Vine's Dictionary")).toBeTruthy();
  });

  it('shows noDictionaries placeholder when module list is empty and no search', () => {
    mockModules = [];
    render(<DictionaryHome />);
    expect(screen.getByText('dictionaryHome.noDictionaries')).toBeTruthy();
  });

  it('calls openTemporaryTab when a module card body is clicked', () => {
    mockModules = [makeModule({ abbreviation: 'strongs', name: "Strong's Concordance" })];
    const { container } = render(<DictionaryHome />);
    const cardBody = container.querySelector('.dictionary-home__card-body') as HTMLButtonElement;
    fireEvent.click(cardBody);
    expect(mockOpenTemporaryTab).toHaveBeenCalledWith('strongs', "Strong's Concordance");
  });

  // ------------------------------------------------------------------
  // Starring / favoriting
  // ------------------------------------------------------------------
  it('applies the starred CSS modifier to starred modules', () => {
    mockStarredModules = new Set(['strongs']);
    mockModules = [makeModule({ abbreviation: 'strongs' })];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__card--starred')).toBeTruthy();
  });

  it('does not apply starred modifier to unstarred modules', () => {
    mockStarredModules = new Set();
    mockModules = [makeModule({ abbreviation: 'strongs' })];
    const { container } = render(<DictionaryHome />);
    expect(container.querySelector('.dictionary-home__card--starred')).toBeNull();
  });

  it('calls toggleStarred when the star icon is clicked', () => {
    mockModules = [makeModule({ abbreviation: 'strongs' })];
    const { container } = render(<DictionaryHome />);
    const star = container.querySelector('.dictionary-home__card-star') as HTMLElement;
    fireEvent.click(star);
    expect(mockToggleStarred).toHaveBeenCalledWith('strongs');
  });

  // ------------------------------------------------------------------
  // Sorted order: starred modules appear first
  // ------------------------------------------------------------------
  it('renders starred modules before unstarred modules', () => {
    mockStarredModules = new Set(['vine']);
    mockModules = [
      makeModule({ abbreviation: 'strongs', name: "Strong's Concordance" }),
      makeModule({ abbreviation: 'vine', name: "Vine's Dictionary" }),
    ];
    const { container } = render(<DictionaryHome />);
    const names = [...container.querySelectorAll('.dictionary-home__card-name')].map(
      el => el.textContent,
    );
    expect(names[0]).toBe("Vine's Dictionary");
    expect(names[1]).toBe("Strong's Concordance");
  });

  // ------------------------------------------------------------------
  // Search input change
  // ------------------------------------------------------------------
  it('calls setHomeSearchQuery on input change', () => {
    render(<DictionaryHome />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'grace' } });
    expect(mockSetHomeSearchQuery).toHaveBeenCalledWith('grace');
  });

  // ------------------------------------------------------------------
  // Keyboard navigation in suggestions
  // ------------------------------------------------------------------
  it('highlights the first suggestion on ArrowDown', () => {
    mockHomeSuggestions = [makeSuggestion(), makeSuggestion({ entry_key: 'logos', word: 'Logos' })];
    const { container } = render(<DictionaryHome />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const buttons = container.querySelectorAll('.dictionary-home__suggestion');
    expect(buttons[0].classList.contains('dictionary-home__suggestion--highlighted')).toBe(true);
  });

  it('calls openDictionaryEntry on Enter when a suggestion is highlighted', () => {
    mockHomeSuggestions = [
      makeSuggestion({ entry_key: 'agape', module_abbr: 'strongs', module_name: "Strong's" }),
    ];
    render(<DictionaryHome />);
    const input = screen.getByRole('textbox');
    // Move highlight to index 0
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOpenDictionaryEntry).toHaveBeenCalledWith('agape', 'strongs', "Strong's");
  });
});
