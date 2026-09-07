/**
 * Component tests for VerseRefList.
 *
 * Pattern: Store-connected component with complex dependencies (bibleStore,
 * searchStore, bibleProvider, verse popup hook). The bibleStore and
 * useVersePopup hook are mocked to isolate component rendering logic.
 * searchStore is used directly so lastClickedVerseRefId state can be manipulated.
 *
 * Tests verify: rendering, compact/expanded modes, load-more buttons,
 * click handlers, and last-clicked highlight classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

// Mock i18n before importing the component
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${key}:${opts.count}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Mock bibleStore — VerseRefList only needs getActiveTab()
vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ moduleAbbr: 'KJV' }),
    navigateToPreview: vi.fn(),
    addTabWithPassage: vi.fn(),
  },
}));

// Mock useVersePopup to avoid bibleProvider/bibleStore interaction complexity
vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({
    handleHover: vi.fn(),
    handleLeave: vi.fn(),
    handleClick: vi.fn(),
    containerProps: { onClick: vi.fn(), onMouseOver: vi.fn(), onMouseOut: vi.fn() },
    popupJsx: null,
  }),
}));

import { VerseRefList } from './VerseRefList';
import { searchStore } from '../../stores/searchStore';
import type { IBibleDataProvider } from '../../providers/interfaces';

/** Minimal stub for IBibleDataProvider */
function makeBibleProvider(
  versesMap: Record<string, { text: string; text_html: string }> = {},
): IBibleDataProvider {
  return {
    getVerse: vi.fn(),
    getVerseTexts: vi.fn().mockResolvedValue({ verses: versesMap }),
    getChapter: vi.fn(),
    getModuleInfo: vi.fn(),
    searchKeyword: vi.fn(),
    getBookTopics: vi.fn(),
  } as unknown as IBibleDataProvider;
}

describe('VerseRefList', () => {
  beforeEach(() => {
    localStorage.clear();
    searchStore.setLastClickedVerseRefId(null);
  });

  it('renders nothing when verses array is empty', () => {
    const { container } = render(<VerseRefList verses={[]} />);
    expect(container.querySelector('.verse-ref-list')).toBeNull();
  });

  it('renders the compact list container when verses are provided', () => {
    const { container } = render(
      <VerseRefList verses={[{ startVerseId: 43003016 }]} />,
    );

    expect(container.querySelector('.verse-ref-list')).toBeTruthy();
    expect(container.querySelector('.verse-ref-list__compact')).toBeTruthy();
  });

  it('renders verse reference links in compact mode', () => {
    const { container } = render(
      <VerseRefList verses={[{ startVerseId: 43003016 }]} />,
    );

    const links = container.querySelectorAll('.verse-ref-list__ref-link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders multiple verse links', () => {
    const { container } = render(
      <VerseRefList
        verses={[
          { startVerseId: 43003016 },
          { startVerseId: 45008028 },
        ]}
      />,
    );

    const links = container.querySelectorAll('.verse-ref-list__ref-link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('does not show toggle button when bibleProvider is not provided', () => {
    const { container } = render(
      <VerseRefList verses={[{ startVerseId: 43003016 }]} />,
    );

    expect(container.querySelector('.verse-ref-list__toggle')).toBeNull();
  });

  it('shows toggle button when bibleProvider is provided', () => {
    const provider = makeBibleProvider();
    const { container } = render(
      <VerseRefList verses={[{ startVerseId: 43003016 }]} bibleProvider={provider} />,
    );

    expect(container.querySelector('.verse-ref-list__toggle')).toBeTruthy();
  });

  it('shows "more" text when totalCount exceeds displayed verses and no onLoadMore', () => {
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={10}
      />,
    );

    expect(container.querySelector('.verse-ref-list__more')).toBeTruthy();
  });

  it('shows load-more-inline button when totalCount exceeds verses and onLoadMore is provided', () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={10}
        onLoadMore={onLoadMore}
      />,
    );

    expect(container.querySelector('.verse-ref-list__load-more-inline')).toBeTruthy();
  });

  it('calls onLoadMore when inline load-more button is clicked', () => {
    const onLoadMore = vi.fn();
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={10}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(container.querySelector('.verse-ref-list__load-more-inline')!);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables inline load-more button when loadingMore is true', () => {
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={10}
        onLoadMore={vi.fn()}
        loadingMore={true}
      />,
    );

    const btn = container.querySelector('.verse-ref-list__load-more-inline') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not show "more" text when totalCount equals verses length', () => {
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={1}
      />,
    );

    expect(container.querySelector('.verse-ref-list__more')).toBeNull();
    expect(container.querySelector('.verse-ref-list__load-more-inline')).toBeNull();
  });

  it('sets last-clicked class on link after setting searchStore state', () => {
    const storageKey = 'test-list-key';
    const verseId = 43003016;
    const expectedId = `${storageKey}|${verseId}`;

    act(() => {
      searchStore.setLastClickedVerseRefId(expectedId);
    });

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: verseId }]}
        storageKey={storageKey}
      />,
    );

    expect(container.querySelector('.verse-ref-list__ref-link--last-clicked')).toBeTruthy();
  });

  it('does not apply last-clicked class when storageKey/verseId does not match', () => {
    act(() => {
      searchStore.setLastClickedVerseRefId('other-key|99999999');
    });

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        storageKey="my-list"
      />,
    );

    expect(container.querySelector('.verse-ref-list__ref-link--last-clicked')).toBeNull();
  });

  it('starts expanded when localStorage pref is true', () => {
    const storageKey = 'expanded-pref-test';
    localStorage.setItem(storageKey, 'true');
    const provider = makeBibleProvider();

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        bibleProvider={provider}
        storageKey={storageKey}
      />,
    );

    expect(container.querySelector('.verse-ref-list__expanded')).toBeTruthy();
  });

  it('starts collapsed when localStorage pref is false', () => {
    const storageKey = 'collapsed-pref-test';
    localStorage.setItem(storageKey, 'false');
    const provider = makeBibleProvider();

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        bibleProvider={provider}
        storageKey={storageKey}
      />,
    );

    expect(container.querySelector('.verse-ref-list__expanded')).toBeNull();
  });

  it('toggles to expanded when the toggle button is clicked', () => {
    const provider = makeBibleProvider();
    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        bibleProvider={provider}
        storageKey="toggle-test"
      />,
    );

    // Initially collapsed (no pref stored)
    expect(container.querySelector('.verse-ref-list__expanded')).toBeNull();

    fireEvent.click(container.querySelector('.verse-ref-list__toggle')!);
    expect(container.querySelector('.verse-ref-list__expanded')).toBeTruthy();
  });

  it('renders load-more button inside expanded view when there are more items', () => {
    const storageKey = 'load-more-expanded';
    localStorage.setItem(storageKey, 'true');
    const provider = makeBibleProvider();
    const onLoadMore = vi.fn();

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={5}
        bibleProvider={provider}
        storageKey={storageKey}
        onLoadMore={onLoadMore}
      />,
    );

    expect(container.querySelector('.verse-ref-list__load-more')).toBeTruthy();
  });

  it('calls onLoadMore when the expanded load-more button is clicked', () => {
    const storageKey = 'load-more-click';
    localStorage.setItem(storageKey, 'true');
    const provider = makeBibleProvider();
    const onLoadMore = vi.fn();

    const { container } = render(
      <VerseRefList
        verses={[{ startVerseId: 43003016 }]}
        totalCount={5}
        bibleProvider={provider}
        storageKey={storageKey}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(container.querySelector('.verse-ref-list__load-more')!);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
  // Regression: `totalCount` and `verses` can be counted in different units
  // (topics count verses inside ranges; each row here is one range), which used
  // to render a "Load more" button that never went away and did nothing.
  describe('hasMore overrides an inflated totalCount', () => {
    it('hides the inline load-more when hasMore is false, however large totalCount is', () => {
      const onLoadMore = vi.fn();
      const { container } = render(
        <VerseRefList
          verses={[{ startVerseId: 43003016 }, { startVerseId: 43003017 }]}
          totalCount={22}
          hasMore={false}
          onLoadMore={onLoadMore}
        />,
      );
      expect(container.querySelector('.verse-ref-list__load-more-inline')).toBeNull();
      expect(container.querySelector('.verse-ref-list__more')).toBeNull();
    });

    it('hides the expanded load-more when hasMore is false', () => {
      const storageKey = 'has-more-false-expanded';
      localStorage.setItem(storageKey, 'true');
      const { container } = render(
        <VerseRefList
          verses={[{ startVerseId: 43003016 }]}
          totalCount={22}
          hasMore={false}
          bibleProvider={makeBibleProvider()}
          storageKey={storageKey}
          onLoadMore={vi.fn()}
        />,
      );
      expect(container.querySelector('.verse-ref-list__load-more')).toBeNull();
    });

    it('still shows load-more when hasMore is true', () => {
      const { container } = render(
        <VerseRefList
          verses={[{ startVerseId: 43003016 }]}
          totalCount={5}
          hasMore
          onLoadMore={vi.fn()}
        />,
      );
      expect(container.querySelector('.verse-ref-list__load-more-inline')).toBeTruthy();
    });

    it('never claims more when totalCount is below the rendered count', () => {
      const { container } = render(
        <VerseRefList
          verses={[{ startVerseId: 43003016 }, { startVerseId: 43003017 }]}
          totalCount={1}
          hasMore
          onLoadMore={vi.fn()}
        />,
      );
      expect(container.querySelector('.verse-ref-list__load-more-inline')).toBeNull();
    });
  });
});
