/**
 * Regression tests for the stale-closure race in the search bar's Enter handler.
 *
 * Typing "john 3:16" quickly and hitting Enter can run a full-text search
 * instead of navigating, if Enter fires before React commits the final
 * keystrokes. Reference detection is synchronous, so parsing speed is not the
 * problem: `mode` is memoized from the Zustand `query`, and Enter is decided
 * by the `handleKeyDown` closure of the last *committed* render. Fire Enter
 * before React commits the final keystrokes and `mode` is still the value
 * computed for a prefix - and every prefix a fast typist passes through
 * ("john ", "john 3:") fails the anchored reference regex, so it reads as
 * `search`. `handleSearch` then runs `performSearch()`, which re-reads the
 * store and searches the *complete* reference as free text: stale branch,
 * fresh payload, zero results.
 *
 * These tests reproduce that by letting the DOM input run ahead of the
 * committed render - which is exactly the state React is in mid-batch - and
 * asserting Enter still navigates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopSearchBar from './TopSearchBar';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

// The real ReferenceParser / ReferenceClassifier are used deliberately: the bug
// is about *when* the classification runs, so stubbing the classifier would
// test nothing.

const navigateToVerse = vi.fn().mockResolvedValue(undefined);
const performSearch = vi.fn().mockResolvedValue(undefined);
const performLiveSearch = vi.fn().mockResolvedValue(undefined);
const clearSearch = vi.fn();

const mockSearchState: Record<string, unknown> = {};

vi.mock('../stores/useSearchStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/useSearchStore')>('../stores/useSearchStore');
  return {
    normalizeSearchQuery: actual.normalizeSearchQuery,
    useSearchStore: Object.assign(
      (selector?: (s: Record<string, unknown>) => unknown) =>
        selector ? selector(mockSearchState) : mockSearchState,
      { getState: () => mockSearchState },
    ),
  };
});

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ navigateToVerseInPrimary: navigateToVerse }),
    { getState: () => ({ getPanelState: () => ({ navigationHistory: [] }) }) },
  ),
}));

vi.mock('../contexts/useCommands', () => ({
  useCommands: () => ({ query: vi.fn().mockReturnValue([]), execute: vi.fn() }),
}));

vi.mock('../contexts/useWhenContext', () => ({
  useWhenContext: () => ({ snapshot: {} }),
}));

vi.mock('./TopSearchBarDropdown', () => ({ default: () => <div data-testid="search-dropdown" /> }));
vi.mock('./LiveSearchSuggestions', () => ({ default: () => <div data-testid="live-suggestions" /> }));

function createMockServices(): AppServices {
  return {
    registry: { query: vi.fn().mockReturnValue([]), execute: vi.fn() } as unknown as AppServices['registry'],
    whenContext: { snapshot: {} } as unknown as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

/** John 3:16 == (43 * 1000000) + (3 * 1000) + 16. */
const JOHN_3_16 = 43003016;

function setup() {
  const view = render(
    <ContextProvider services={createMockServices()}>
      <TopSearchBar />
    </ContextProvider>,
  );
  const input = screen.getByTestId('search-input') as HTMLInputElement;
  /** Types `value` AND lets React commit the render for it. */
  const commit = (value: string) => {
    fireEvent.change(input, { target: { value } });
    view.rerender(
      <ContextProvider services={createMockServices()}>
        <TopSearchBar />
      </ContextProvider>,
    );
  };
  /**
   * Types `value` without letting a render commit - the DOM input and the
   * Zustand store hold it, the memoized `mode`/`query` of the mounted component
   * do not. That is precisely the state React is in when Enter arrives in the
   * same batch as the last keystrokes.
   *
   * The store is set directly rather than through `fireEvent.change` because
   * React *restores* a controlled input's DOM value after a change event that
   * is not followed by a re-render - which would undo the very thing being
   * simulated. Zustand's setter is synchronous in the real component too, so
   * the store being fresh while the render is stale is not an artifact.
   */
  const typeWithoutCommit = (value: string) => {
    input.value = value;
    (mockSearchState.setQuery as (q: string) => void)(value);
  };
  return { input, commit, typeWithoutCommit };
}

describe('TopSearchBar — Enter re-derives the mode from the live input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockSearchState)) delete mockSearchState[key];
    Object.assign(mockSearchState, {
      query: '',
      // The real store's setter: the component is controlled by it, so the
      // committed `query` only changes when a render is allowed to happen.
      setQuery: (q: string) => { mockSearchState.query = q; },
      performSearch,
      clearSearch,
      isSearching: false,
      searchResults: [],
      error: null,
      clearError: vi.fn(),
      openAdvancedDialog: vi.fn(),
      liveSuggestions: [],
      isLiveSearching: false,
      liveSearchQuery: '',
      performLiveSearch,
    });
  });

  // The two prefixes a fast typist necessarily passes through. Both fail the
  // `$`-anchored reference regex, so both can leave `mode === 'search'` if
  // Enter fires before the commit.
  it.each(['john ', 'john 3:'])(
    'navigates when Enter arrives while the committed query is still "%s"',
    (committedPrefix) => {
      const { commit, typeWithoutCommit, input } = setup();

      commit(committedPrefix);
      typeWithoutCommit('john 3:16');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16, undefined);
      expect(performSearch).not.toHaveBeenCalled();
    },
  );

  /**
   * A typed range has to select the whole span, the way clicking the first
   * verse and shift-clicking the last does. The parser always returned the far
   * end; nothing read it, so "John 3:16-17" landed on verse 16 alone.
   */
  it('selects the whole span when the reference is a range', () => {
    const { typeWithoutCommit, input } = setup();

    typeWithoutCommit('john 3:16-17');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16, 43003017);
  });

  it('carries the end chapter for a cross-chapter range', () => {
    const { typeWithoutCommit, input } = setup();

    typeWithoutCommit('john 3:16-4:2');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16, 43004002);
  });

  it('navigates when the whole reference lands before any render commits', () => {
    const { typeWithoutCommit, input } = setup();

    // Nothing committed at all - `query` is still '' and `mode` is 'empty'.
    typeWithoutCommit('john 3:16');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16, undefined);
    expect(performSearch).not.toHaveBeenCalled();
  });

  it('still searches when the live input really is free text', () => {
    const { commit, input } = setup();

    commit('love your enemies');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(performSearch).toHaveBeenCalledWith('love your enemies');
    expect(navigateToVerse).not.toHaveBeenCalled();
  });
});

describe('TopSearchBar — a pending live-suggestion fetch is cancelled by a reference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    for (const key of Object.keys(mockSearchState)) delete mockSearchState[key];
    Object.assign(mockSearchState, {
      query: '',
      setQuery: (q: string) => { mockSearchState.query = q; },
      performSearch,
      clearSearch,
      isSearching: false,
      searchResults: [],
      error: null,
      clearError: vi.fn(),
      openAdvancedDialog: vi.fn(),
      liveSuggestions: [],
      isLiveSearching: false,
      liveSearchQuery: '',
      performLiveSearch,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire the suggestion fetch armed while the string was still "john"', () => {
    const { commit, typeWithoutCommit, input } = setup();

    // "john" is a search-mode prefix of 4 characters, so it arms the 300 ms
    // live-suggestion timer.
    commit('john');
    typeWithoutCommit('john 3:16');
    fireEvent.keyDown(input, { key: 'Enter' });

    vi.advanceTimersByTime(1000);

    expect(performLiveSearch).not.toHaveBeenCalled();
    expect(navigateToVerse).toHaveBeenCalledWith(JOHN_3_16, undefined);
  });
});
