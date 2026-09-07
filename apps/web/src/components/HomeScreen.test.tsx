// @vitest-environment jsdom
// ^ These components sanitize module HTML, and DOMPurify mangles its own
// output under the happy-dom this suite otherwise runs on — it drops the first
// node of a fragment. Browsers are unaffected; see src/utils/sanitize.test.ts.
/**
 * Component tests for HomeScreen.
 *
 * Pattern: Store-connected component with async data loading (VOTD) and i18n.
 * Both bibleStore and commentaryStore are mocked with minimal stubs.
 * react-i18next is mocked to return translation keys as-is.
 * VOTD fetch is simulated by resolving/rejecting the mocked promise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/preact';

// Mock i18n before component imports
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.holiday) return `bibleContent.votdHoliday:${opts.holiday}`;
      if (opts?.ns === 'books') return `book:${key}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

// Stub stores
const { stubBibleStore, stubCommentaryStore, stubSearchStore, stubFocusSearchField } = vi.hoisted(() => {
  let _votdResolve: (data: unknown) => void = () => {};
  let _votdReject: (err: unknown) => void = () => {};

  const stubBibleStore = {
    getVerseOfTheDay: vi.fn(() => new Promise((res, rej) => {
      _votdResolve = res;
      _votdReject = rej;
    })),
    setShowHome: vi.fn(),
    navigateTo: vi.fn(),
    _resolveVotd: (data: unknown) => { _votdResolve(data); },
    _rejectVotd: (err: unknown) => { _votdReject(err); },
  };

  const stubCommentaryStore = {
    setRightPaneMode: vi.fn(),
    expand: vi.fn(),
  };

  const stubSearchStore = { open: vi.fn() };
  const stubFocusSearchField = vi.fn(() => true);

  return { stubBibleStore, stubCommentaryStore, stubSearchStore, stubFocusSearchField };
});

vi.mock('../stores/bibleStore', () => ({ bibleStore: stubBibleStore }));
vi.mock('../stores/commentaryStore', () => ({ commentaryStore: stubCommentaryStore }));
// searchStore reaches Header (for parseReference) and therefore src/i18n, which
// the react-i18next mock above cannot satisfy — so it is stubbed outright.
vi.mock('../stores/searchStore', () => ({ searchStore: stubSearchStore }));
vi.mock('../utils/focusSearchField', () => ({ focusSearchField: stubFocusSearchField }));

import { HomeScreen } from './HomeScreen';

const sampleVotd = {
  book: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world...',
  text_html: '<span>For God so loved the world...</span>',
};

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset getVerseOfTheDay to return a new controllable promise each time
    let res: (v: unknown) => void = () => {};
    let rej: (e: unknown) => void = () => {};
    stubBibleStore.getVerseOfTheDay.mockImplementation(() => new Promise((r, j) => { res = r; rej = j; }));
    (stubBibleStore as any)._resolveVotd = (d: unknown) => res(d);
    (stubBibleStore as any)._rejectVotd = (e: unknown) => rej(e);
  });

  // ---------------------------------------------------------------------------
  // Structure / static rendering
  // ---------------------------------------------------------------------------

  it('renders the app title via i18n key', () => {
    render(<HomeScreen />);
    expect(screen.getByText('app.name')).toBeTruthy();
  });

  it('renders the app icon', () => {
    const { container } = render(<HomeScreen />);
    expect(container.querySelector('.home-screen__icon')).toBeTruthy();
  });

  it('renders the Read Bible and Search action buttons', () => {
    render(<HomeScreen />);
    expect(screen.getByText('homeScreen.readBible')).toBeTruthy();
    expect(screen.getByText('homeScreen.search')).toBeTruthy();
  });

  it('shows a skeleton the size of the card while VOTD is loading', () => {
    // A spinner used to stand in for the card, and swapping a ~30px spinner for
    // a ~170px card re-centred the whole column — the flicker on first load.
    // The skeleton deliberately reuses .home-screen__votd so it occupies the
    // same box; the real card is told apart by the absence of --skeleton.
    const { container } = render(<HomeScreen />);
    expect(container.querySelector('.home-screen__votd--skeleton')).toBeTruthy();
    expect(container.querySelector('.home-screen__skeleton-line')).toBeTruthy();
    expect(container.querySelector('.home-screen__votd-text')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // VOTD rendering
  // ---------------------------------------------------------------------------

  it('renders VOTD content after data loads', async () => {
    const { container } = render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(sampleVotd);
      await Promise.resolve();
    });

    expect(container.querySelector('.home-screen__votd')).toBeTruthy();
    expect(container.querySelector('.home-screen__votd--skeleton')).toBeNull();
  });

  it('renders the VOTD label key when no holiday', async () => {
    render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(sampleVotd);
      await Promise.resolve();
    });

    expect(screen.getByText('bibleContent.votdLabel')).toBeTruthy();
  });

  it('renders the holiday label when votd has a holiday', async () => {
    const holidayVotd = { ...sampleVotd, holiday: 'Christmas' };
    render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(holidayVotd);
      await Promise.resolve();
    });

    expect(screen.getByText('bibleContent.votdHoliday:Christmas')).toBeTruthy();
  });

  it('renders text_html content via dangerouslySetInnerHTML', async () => {
    const { container } = render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(sampleVotd);
      await Promise.resolve();
    });

    const textEl = container.querySelector('.home-screen__votd-text');
    expect(textEl?.innerHTML).toBe(sampleVotd.text_html);
  });

  it('falls back to plain text when text_html is absent', async () => {
    const noHtmlVotd = { ...sampleVotd, text_html: '' };
    const { container } = render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(noHtmlVotd);
      await Promise.resolve();
    });

    const textEl = container.querySelector('.home-screen__votd-text');
    expect(textEl?.innerHTML).toBe(sampleVotd.text);
  });

  it('renders the chapter:verse reference', async () => {
    render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(sampleVotd);
      await Promise.resolve();
    });

    // Reference format: "book:43 3:16"
    expect(screen.getByText(/3:16/)).toBeTruthy();
  });

  it('keeps showing spinner when VOTD fetch fails', async () => {
    const { container } = render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._rejectVotd(new Error('Network error'));
      await Promise.resolve();
    });

    // votd stays null — the skeleton remains rather than collapsing the slot
    expect(container.querySelector('.home-screen__loading')).toBeTruthy();
    expect(container.querySelector('.home-screen__votd--skeleton')).toBeTruthy();
    expect(container.querySelector('.home-screen__votd-text')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Button interactions
  // ---------------------------------------------------------------------------

  it('calls bibleStore.setShowHome(false) when Read Bible is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText('homeScreen.readBible'));
    expect(stubBibleStore.setShowHome).toHaveBeenCalledWith(false);
  });

  it('calls onNavigate("bible") when Read Bible is clicked', () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('homeScreen.readBible'));
    expect(onNavigate).toHaveBeenCalledWith('bible');
  });

  it('calls commentaryStore.setRightPaneMode("search") when Search is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText('homeScreen.search'));
    expect(stubCommentaryStore.setRightPaneMode).toHaveBeenCalledWith('search');
  });

  it('opens the search store when Search is clicked', () => {
    // On desktop the right-pane Search tab only renders while searchStore.isOpen
    // is true. Without this the pane switched to a mode that had no tab and no
    // input, and the click looked like it did nothing at all.
    render(<HomeScreen />);
    fireEvent.click(screen.getByText('homeScreen.search'));
    expect(stubSearchStore.open).toHaveBeenCalledTimes(1);
  });

  it('focuses the header search field when Search is clicked', async () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText('homeScreen.search'));
    // Focus is deferred a frame so the pane has rendered first.
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    expect(stubFocusSearchField).toHaveBeenCalled();
  });

  it('calls commentaryStore.expand() when Search is clicked', () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByText('homeScreen.search'));
    expect(stubCommentaryStore.expand).toHaveBeenCalledTimes(1);
  });

  it('calls onNavigate("search") when Search is clicked', () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('homeScreen.search'));
    expect(onNavigate).toHaveBeenCalledWith('search');
  });

  it('does not call onNavigate when prop is not provided', () => {
    // Should not throw — onNavigate is optional
    expect(() => {
      render(<HomeScreen />);
      fireEvent.click(screen.getByText('homeScreen.readBible'));
    }).not.toThrow();
  });

  it('navigates to VOTD verse when VOTD card is clicked', async () => {
    const { container } = render(<HomeScreen />);

    await act(async () => {
      (stubBibleStore as any)._resolveVotd(sampleVotd);
      await Promise.resolve();
    });

    fireEvent.click(container.querySelector('.home-screen__votd')!);
    expect(stubBibleStore.navigateTo).toHaveBeenCalledWith(
      sampleVotd.book,
      sampleVotd.chapter,
      sampleVotd.verse,
    );
  });

  // ---------------------------------------------------------------------------
  // CSS classes
  // ---------------------------------------------------------------------------

  it('applies the primary modifier class to the Read Bible button', () => {
    const { container } = render(<HomeScreen />);
    const btn = container.querySelector('.home-screen__action-btn--primary');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain('homeScreen.readBible');
  });
});
