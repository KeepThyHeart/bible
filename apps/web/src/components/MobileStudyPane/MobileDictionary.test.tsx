/**
 * Component tests for MobileDictionary.
 *
 * Pattern: Store-connected component with local async state.
 * dictionaryStore and offlineStore are mocked; useVersePopup is mocked so
 * tests don't depend on DOM geometry APIs. useStore calls the selector
 * immediately.
 *
 * Tests cover: search bar rendering, suggestions display, entry display,
 * empty state, loading states, cancel/clear actions, and offline notice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- useStore shim -------------------------------------------------------
vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

// ---- useVersePopup mock --------------------------------------------------
vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({
    containerProps: { onClick: vi.fn(), onMouseOver: vi.fn(), onMouseOut: vi.fn() },
    popupJsx: null,
  }),
}));

// ---- Utility mocks -------------------------------------------------------
vi.mock('../../utils/strongsLinks', () => ({
  linkStrongsRefs: (html: string) => html,
}));
vi.mock('../../../../../packages/core/src/Services/CommentaryLinkProcessor', () => ({
  processCommentaryLinks: (html: string) => html,
}));

// ---- Store state holders -------------------------------------------------
let mockSuggestions: {
  entry_key: string;
  word: string;
  transliteration?: string;
  definition?: string;
  part_of_speech?: string;
  module_abbr: string;
  module_name: string;
}[] = [];
let mockSearchLoading = false;
let mockIsOnline = true;

const mockSetHomeSearchQuery = vi.fn();
const mockOpenStrongs = vi.fn();

vi.mock('../../stores/dictionaryStore', () => ({
  dictionaryStore: {
    get homeSuggestions() { return mockSuggestions; },
    get homeSearchLoading() { return mockSearchLoading; },
    setHomeSearchQuery: (q: string) => mockSetHomeSearchQuery(q),
    openStrongs: (n: string) => mockOpenStrongs(n),
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
  },
}));

// ---- fetch mock ----------------------------------------------------------
global.fetch = vi.fn();

import { MobileDictionary } from './MobileDictionary';

function makeSuggestion(entryKey: string, word: string, moduleAbbr = 'strongsgreek') {
  return {
    entry_key: entryKey,
    word,
    module_abbr: moduleAbbr,
    module_name: moduleAbbr === 'strongsgreek' ? "Strong's Greek" : "Strong's Hebrew",
    transliteration: undefined,
    definition: `Definition of ${word}`,
    part_of_speech: 'noun',
  };
}

describe('MobileDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestions = [];
    mockSearchLoading = false;
    mockIsOnline = true;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
  });

  // ---- Basic rendering ---------------------------------------------------
  it('renders the search bar', () => {
    const { container } = render(<MobileDictionary />);
    expect(container.querySelector('.mobile-dictionary__search-bar')).toBeTruthy();
    expect(container.querySelector('.mobile-dictionary__search-input')).toBeTruthy();
  });

  it('renders the empty state when no query and no entry', () => {
    const { container } = render(<MobileDictionary />);
    expect(container.querySelector('.mobile-dictionary__empty-state')).toBeTruthy();
    expect(screen.getByText('mobileDictionary.searchPrompt')).toBeTruthy();
  });

  it('does not show suggestions when search query is empty', () => {
    const { container } = render(<MobileDictionary />);
    expect(container.querySelector('.mobile-dictionary__suggestions')).toBeNull();
  });

  // ---- Input handling ----------------------------------------------------
  it('calls setHomeSearchQuery when user types in the search input', () => {
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    expect(mockSetHomeSearchQuery).toHaveBeenCalledWith('love');
  });

  it('shows suggestions dropdown when query is entered', () => {
    mockSuggestions = [makeSuggestion('G25', 'agapaō')];
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    expect(container.querySelector('.mobile-dictionary__suggestions')).toBeTruthy();
  });

  // ---- Suggestions -------------------------------------------------------
  it('renders suggestion items when suggestions are available', () => {
    mockSuggestions = [makeSuggestion('G25', 'agapaō'), makeSuggestion('G26', 'agapē')];
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    expect(container.querySelectorAll('.mobile-dictionary__suggestion').length).toBe(2);
  });

  it('shows module name in suggestion metadata', () => {
    mockSuggestions = [makeSuggestion('G25', 'agapaō')];
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    expect(screen.getByText("Strong's Greek")).toBeTruthy();
  });

  it('shows loading indicator when searchLoading is true', () => {
    mockSearchLoading = true;
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    expect(container.querySelector('.mobile-dictionary__loading')).toBeTruthy();
    expect(screen.getByText('mobileDictionary.searching')).toBeTruthy();
  });

  it('shows no-entries message when offline, not loading, query >= 2 chars, no suggestions', () => {
    mockIsOnline = false;
    mockSearchLoading = false;
    mockSuggestions = [];
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'lo' } });
    expect(screen.getByText('mobileDictionary.offlineNotice')).toBeTruthy();
  });

  it('shows no-entries message when online, not loading, query >= 2 chars, no suggestions', () => {
    mockIsOnline = true;
    mockSearchLoading = false;
    mockSuggestions = [];
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'lo' } });
    expect(screen.getByText('mobileDictionary.noEntries')).toBeTruthy();
  });

  // ---- Cancel / Clear actions --------------------------------------------
  it('shows cancel button when there is a search query', () => {
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    const action = container.querySelector('.mobile-dictionary__search-action')!;
    expect(action).toBeTruthy();
    // Shows text "cancel" when there is a query
    expect(screen.getByText('mobileDictionary.cancel')).toBeTruthy();
  });

  it('clears the query when cancel is clicked', () => {
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    const action = container.querySelector('.mobile-dictionary__search-action')!;
    fireEvent.click(action);
    expect((container.querySelector('.mobile-dictionary__search-input') as HTMLInputElement).value).toBe('');
  });

  // ---- Entry display -----------------------------------------------------
  it('shows the entry word when an entry is loaded', async () => {
    mockSuggestions = [makeSuggestion('G25', 'agapaō')];
    const jsonFn = vi.fn().mockResolvedValue({
      word: 'agapaō',
      transliteration: 'agapaō',
      definition: 'to love',
      etymology: null,
      usage_notes: null,
      part_of_speech: 'verb',
      pronunciation: null,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: jsonFn });
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    const suggestionBtn = container.querySelector<HTMLButtonElement>('.mobile-dictionary__suggestion')!;
    await act(async () => {
      fireEvent.click(suggestionBtn);
      // allow the fetch + json promises to resolve
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.mobile-dictionary__entry')).toBeTruthy();
    expect(container.querySelector('.dictionary-pane__entry-word')).toBeTruthy();
  });

  it('shows close icon button (not text) when an entry is displayed and no query', async () => {
    mockSuggestions = [makeSuggestion('G25', 'agapaō')];
    const jsonFn = vi.fn().mockResolvedValue({ word: 'agapaō', definition: 'to love' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: jsonFn });
    const { container } = render(<MobileDictionary />);
    const input = container.querySelector<HTMLInputElement>('.mobile-dictionary__search-input')!;
    fireEvent.input(input, { target: { value: 'ag' } });
    await act(async () => {
      fireEvent.click(container.querySelector('.mobile-dictionary__suggestion')!);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Action button shows the xmark icon (close), not the "cancel" text
    const action = container.querySelector('.mobile-dictionary__search-action');
    expect(action).toBeTruthy();
    expect(action!.querySelector('.fa-xmark')).toBeTruthy();
  });
});
