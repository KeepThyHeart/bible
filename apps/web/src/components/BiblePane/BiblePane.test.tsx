/**
 * Component tests for BiblePane.
 *
 * Pattern: Store-connected orchestration component. Child components (BibleTabBar,
 * BibleToolbar, BackBar, BibleContent, ChapterNav, HomeScreen) are all mocked to
 * avoid pulling in their complex dependency chains. useStore calls the selector
 * immediately. Tests verify structural rendering, hideBars prop, the showHome
 * flag, and the pending-verse scroll effect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/preact';
import type { BibleTab } from '../../stores/bibleStore';
import type { VerseData, InterlinearData } from '../../types';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Mock heavy child components ----------------------------------------
vi.mock('./BibleTabBar', () => ({ BibleTabBar: () => <div data-testid="bible-tab-bar" /> }));
vi.mock('./BibleToolbar', () => ({ BibleToolbar: () => <div data-testid="bible-toolbar" /> }));
vi.mock('./BackBar', () => ({ BackBar: () => <div data-testid="back-bar" /> }));
// Surfaces the interlinear props so the fetch gating can be asserted without
// rendering real verses.
vi.mock('./BibleContent', () => ({
  BibleContent: ({ interlinearWords, interlinearUnavailable, interlinearLoading }: {
    interlinearWords?: unknown[];
    interlinearUnavailable?: boolean;
    interlinearLoading?: boolean;
  }) => {
    // Mirrors the real component's exclusive branch: while the interlinear is
    // pending the verses are replaced by a spinner, so there is no
    // [data-verse-id] node in the DOM for the scroll effect to find.
    const pending = mockActiveTab?.displayMode === 'study'
      && mockStudyShowInterlinear
      && !!interlinearLoading;
    return (
      <div
        data-testid="bible-content"
        data-interlinear-count={interlinearWords?.length ?? 0}
        data-interlinear-unavailable={interlinearUnavailable ? 'true' : 'false'}
      >
        {!pending && (mockActiveTab?.verses ?? []).map(v => (
          <div key={v.verse_id} data-verse-id={v.verse_id} />
        ))}
      </div>
    );
  },
}));
vi.mock('./ChapterNav', () => ({ ChapterNav: () => <div data-testid="chapter-nav" /> }));
vi.mock('../HomeScreen', () => ({ HomeScreen: () => <div data-testid="home-screen" /> }));

// ---- Store state ---------------------------------------------------------
function makeTab(overrides: Partial<BibleTab> = {}): BibleTab {
  return {
    id: 'tab-1',
    moduleAbbr: 'KJV',
    moduleName: 'King James Version',
    book: 43,
    chapter: 3,
    studyVerse: null,
    previewVerse: null,
    previewVerseEnd: null,
    selectionEndVerse: null,
    verses: [],
    loading: false,
    scrollPosition: 0,
    pendingScrollVerse: null,
    pendingScrollTop: null,
    hasInterlinearData: false,
    displayMode: 'standard',
    history: [],
    historyIndex: -1,
    showBackBar: false,
    ...overrides,
  };
}

let mockActiveTab: BibleTab | undefined = makeTab();
let mockActiveTabId = 'tab-1';
let mockShowHome = false;
let mockStudyShowInterlinear = true;
const mockClearPendingScrollVerse = vi.fn();

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    get activeTabId() { return mockActiveTabId; },
    get showHome() { return mockShowHome; },
    get studyShowInterlinear() { return mockStudyShowInterlinear; },
    getScrollTop: null,
    getBookTopics: vi.fn().mockResolvedValue({ topics: [] }),
    navigateTo: vi.fn(),
    // Mirrors the real store: only the caller holding the current token can
    // spend it, and clearing notifies just as setting does.
    clearPendingScrollVerse: (verseId: number) => {
      mockClearPendingScrollVerse(verseId);
      if (mockActiveTab && mockActiveTab.pendingScrollVerse === verseId) {
        mockActiveTab.pendingScrollVerse = null;
      }
    },
  },
}));

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBookByNumber: vi.fn((n: number) => ({ book_number: n, book_name: 'John', chapter_count: 21 })),
  },
}));

vi.mock('../../stores/settingsStore', () => ({
  settingsStore: {
    swipeChaptersEnabled: true,
    swipeChapterThresholdPx: 100,
  },
}));

import { BiblePane } from './BiblePane';

describe('BiblePane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = makeTab();
    mockActiveTabId = 'tab-1';
    mockShowHome = false;
    mockStudyShowInterlinear = true;
  });

  // ------------------------------------------------------------------
  // Root element
  // ------------------------------------------------------------------
  it('renders the bible-pane root element', () => {
    const { container } = render(<BiblePane />);
    expect(container.querySelector('.bible-pane')).toBeTruthy();
  });

  it('applies bible-pane--reading class in reading mode', () => {
    mockActiveTab = makeTab({ displayMode: 'reading' });
    const { container } = render(<BiblePane />);
    expect(container.querySelector('.bible-pane--reading')).toBeTruthy();
  });

  it('does not apply bible-pane--reading class in standard mode', () => {
    mockActiveTab = makeTab({ displayMode: 'standard' });
    const { container } = render(<BiblePane />);
    expect(container.querySelector('.bible-pane--reading')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Bars rendering
  // ------------------------------------------------------------------
  it('renders BibleTabBar by default', () => {
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="bible-tab-bar"]')).toBeTruthy();
  });

  it('renders BibleToolbar by default', () => {
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="bible-toolbar"]')).toBeTruthy();
  });

  it('renders BackBar by default', () => {
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="back-bar"]')).toBeTruthy();
  });

  it('does not render BibleTabBar when hideBars is true', () => {
    const { container } = render(<BiblePane hideBars />);
    expect(container.querySelector('[data-testid="bible-tab-bar"]')).toBeNull();
  });

  it('does not render BibleToolbar when hideBars is true', () => {
    const { container } = render(<BiblePane hideBars />);
    expect(container.querySelector('[data-testid="bible-toolbar"]')).toBeNull();
  });

  it('does not render BackBar when hideBars is true', () => {
    const { container } = render(<BiblePane hideBars />);
    expect(container.querySelector('[data-testid="back-bar"]')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Home screen vs Bible content
  // ------------------------------------------------------------------
  it('renders HomeScreen when showHome is true', () => {
    mockShowHome = true;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="home-screen"]')).toBeTruthy();
  });

  it('does not render HomeScreen when showHome is false', () => {
    mockShowHome = false;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="home-screen"]')).toBeNull();
  });

  it('renders BibleContent when showHome is false', () => {
    mockShowHome = false;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="bible-content"]')).toBeTruthy();
  });

  it('does not render BibleContent when showHome is true', () => {
    mockShowHome = true;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="bible-content"]')).toBeNull();
  });

  it('renders ChapterNav when not on home screen', () => {
    mockShowHome = false;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('[data-testid="chapter-nav"]')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Scroll container
  // ------------------------------------------------------------------
  it('renders scroll container when not on home screen', () => {
    mockShowHome = false;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('.bible-pane__scroll-container')).toBeTruthy();
  });

  it('renders scroll container on home screen too', () => {
    mockShowHome = true;
    const { container } = render(<BiblePane />);
    expect(container.querySelector('.bible-pane__scroll-container')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Tab bar still appears when hideBars is false and showHome is true
  // ------------------------------------------------------------------
  it('renders BibleTabBar even when showHome is true (tabs are always visible)', () => {
    mockShowHome = true;
    const { container } = render(<BiblePane hideBars={false} />);
    expect(container.querySelector('[data-testid="bible-tab-bar"]')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Interlinear loading
  // ------------------------------------------------------------------
  const interlinearAttr = (container: Element, name: string): string | null =>
    container.querySelector('[data-testid="bible-content"]')?.getAttribute(name) ?? null;

  it('loads interlinear data even when the chapter flag says there is none', async () => {
    // Chapters served from a downloaded lite DB always report false, because
    // that DB has no interlinear_word table — the server still has the words.
    mockActiveTab = makeTab({ displayMode: 'study', hasInterlinearData: false });
    const getInterlinear = vi.fn().mockResolvedValue({
      words: [{ verseId: 43003016 }],
      strongsEntries: {},
    });
    const { container } = render(<BiblePane interlinearProvider={{ getInterlinear }} />);

    // The tab's own translation, not the server's KJV default.
    await waitFor(() => expect(getInterlinear).toHaveBeenCalledWith(43, 3, 'KJV'));
    await waitFor(() => expect(interlinearAttr(container, 'data-interlinear-count')).toBe('1'));
    expect(interlinearAttr(container, 'data-interlinear-unavailable')).toBe('false');
  });

  // ------------------------------------------------------------------
  // Pending-verse scroll
  //
  // The regression: typing "John 3:16" from another book navigated to the
  // chapter but did not scroll, and only worked when typed a second time. The
  // effect consumed pendingScrollVerse up front and deferred the scroll two
  // frames; in study mode the interlinear fetch started in between and
  // BibleContent swapped every verse for a spinner, so by the time the frames
  // came round there was no [data-verse-id] to scroll to — and the token was
  // already spent.
  // ------------------------------------------------------------------
  describe('pending-verse scroll', () => {
    const JOHN_3_16 = 43003016;

    const makeVerses = (): VerseData[] => [15, 16, 17].map(v => ({
      verse_id: 43003000 + v,
      book_number: 43,
      chapter: 3,
      verse: v,
      text: `verse ${v}`,
      text_html: `verse ${v}`,
      is_paragraph_start: false,
      words_of_christ: false,
    }));

    // happy-dom gives every element a zero-sized box, which would make the
    // computed scroll target 0 and indistinguishable from "never scrolled".
    let rectSpy: ReturnType<typeof vi.spyOn> | undefined;
    const CONTAINER_HEIGHT = 400;

    beforeEach(() => {
      rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: Element) {
          const isVerse = this.hasAttribute('data-verse-id');
          return {
            top: isVerse ? 500 : 0,
            height: isVerse ? 20 : CONTAINER_HEIGHT,
            bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get() { return CONTAINER_HEIGHT; },
      });
    });

    afterEach(() => {
      rectSpy?.mockRestore();
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    });

    /**
     * Let Preact flush effects and the two nested animation frames the scroll
     * is deferred through run. Used only for the negative assertions — the
     * positive ones poll with waitFor, since the frame timing is the thing
     * under test and a fixed sleep would make them flaky.
     */
    const settle = async () => {
      await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    };

    const scrollTopOf = (container: Element): number =>
      (container.querySelector('.bible-pane__scroll-container') as HTMLElement).scrollTop;

    // 0 + (500 - 0) - (400 / 2) + (20 / 2)
    const EXPECTED_SCROLL_TOP = 310;

    it('scrolls to the pending verse once the verses are in the DOM', async () => {
      mockActiveTab = makeTab({ verses: makeVerses(), pendingScrollVerse: JOHN_3_16 });
      const { container } = render(<BiblePane />);

      await waitFor(() => expect(scrollTopOf(container)).toBe(EXPECTED_SCROLL_TOP));
      expect(mockClearPendingScrollVerse).toHaveBeenCalledWith(JOHN_3_16);
    });

    it('keeps the token armed while the interlinear spinner has replaced the verses, then scrolls when they mount', async () => {
      // The reported failure, verbatim: study mode, verses in the store but
      // not in the DOM on the first pass.
      let resolveInterlinear: (data: InterlinearData) => void = () => {};
      const getInterlinear = vi.fn(() => new Promise<InterlinearData>(resolve => { resolveInterlinear = resolve; }));
      mockActiveTab = makeTab({
        displayMode: 'study',
        verses: makeVerses(),
        pendingScrollVerse: JOHN_3_16,
      });

      const { container } = render(<BiblePane interlinearProvider={{ getInterlinear }} />);

      await settle();
      // Spinner phase: nothing to scroll to, so nothing was scrolled — and,
      // crucially, the token was not spent.
      expect(container.querySelector('[data-verse-id]')).toBeNull();
      expect(scrollTopOf(container)).toBe(0);
      expect(mockClearPendingScrollVerse).not.toHaveBeenCalled();
      expect(mockActiveTab?.pendingScrollVerse).toBe(JOHN_3_16);

      await act(async () => {
        resolveInterlinear({ words: [], strongsEntries: {} });
      });

      await waitFor(() => expect(scrollTopOf(container)).toBe(EXPECTED_SCROLL_TOP));
      expect(container.querySelector(`[data-verse-id="${JOHN_3_16}"]`)).toBeTruthy();
      expect(mockClearPendingScrollVerse).toHaveBeenCalledWith(JOHN_3_16);
      expect(mockActiveTab?.pendingScrollVerse).toBeNull();
    });

    it('drops a token for a verse the loaded chapter does not contain', async () => {
      mockActiveTab = makeTab({ verses: makeVerses(), pendingScrollVerse: 43003099 });
      const { container } = render(<BiblePane />);

      await waitFor(() => expect(mockClearPendingScrollVerse).toHaveBeenCalledWith(43003099));

      expect(scrollTopOf(container)).toBe(0);
      expect(mockActiveTab?.pendingScrollVerse).toBeNull();
    });
  });

  it('reports interlinear unavailable only once a fetch comes back empty', async () => {
    mockActiveTab = makeTab({ displayMode: 'study', hasInterlinearData: true });
    const getInterlinear = vi.fn().mockResolvedValue({ words: [], strongsEntries: {} });
    const { container } = render(<BiblePane interlinearProvider={{ getInterlinear }} />);

    expect(interlinearAttr(container, 'data-interlinear-unavailable')).toBe('false');
    await waitFor(() =>
      expect(interlinearAttr(container, 'data-interlinear-unavailable')).toBe('true'));
  });
});
