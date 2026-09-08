/**
 * FIX 1 - scroll-to-verse in Study (interlinear) display mode.
 *
 * Two things must hold:
 *  1. StudyModeView must not keep its own local `selectedVerseRef` that
 *     nothing outside it ever sees: useBibleScrolling's
 *     `if (selectedVerseRef.current)` guard would always be false in Study
 *     mode and scrolling would silently do nothing.
 *  2. Interlinear data for the chapter loads asynchronously. The verses are
 *     withheld entirely until that fetch resolves - painting them as short
 *     plain text and then reflowing when the much taller <InterlinearDisplay>
 *     swaps in would run useBibleScrolling's own effect while
 *     `selectedVerseRef.current` is still null and do nothing. StudyModeView
 *     therefore fires the scroll itself, once, when the verses first paint.
 *
 * These tests exercise StudyModeView together with the REAL useBibleScrolling
 * hook (not mocked) in a small harness that mirrors the slice of BiblePane
 * responsible for wiring bibleTextRef/selectedVerseRef together - the exact
 * wiring the fix restores.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import StudyModeView from './StudyModeView';
import { useBibleScrolling } from '../../hooks/useBibleScrolling';
import { DEFAULT_STUDY_OPTIONS } from '../../stores/useBibleStore';
import { bibleAPI } from '../../services/electronAPI';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

// Keep the harness focused on ref-wiring and the reflow effect: none of these
// sub-components' own behavior (footnotes, cross-refs, verse links, IPC-backed
// popovers) is relevant here, and VerseLinksDisplay in particular makes its
// own IPC calls on mount that would otherwise need separate mocking.
vi.mock('./StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('./FootnoteDisplay', () => ({ default: () => null }));
vi.mock('./CrossReferenceDisplay', () => ({ default: () => null }));
vi.mock('./VerseLinksDisplay', () => ({ default: () => null }));

// Study mode now withholds the verses until the chapter's study data lands
// (one paint, fully adorned - see useChapterStudyData). None of that data is
// under test here, so resolve it synchronously rather than making every
// assertion await a microtask.
vi.mock('./useChapterStudyData', () => ({
  useChapterStudyData: () => ({
    crossRefsByVerse: new Map(),
    linksByVerse: new Map(),
    resolved: true,
  }),
}));

vi.mock('./InterlinearDisplay', () => ({
  default: ({ interlinearWords }: { interlinearWords: unknown[] }) => (
    <div data-testid="interlinear-display">{interlinearWords.length} words</div>
  ),
}));

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getInterlinearWordsForChapter: vi.fn(),
    getVerseTexts: vi.fn().mockResolvedValue({}),
  },
}));

const mockUseBiblePanel = vi.fn();
vi.mock('../../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

function makeVerse(overrides: Record<string, unknown> = {}) {
  return {
    verse_id: 19003001,
    book_number: 19,
    chapter: 3,
    verse: 1,
    text: 'Verse one text',
    text_html: 'Verse one text',
    is_paragraph_start: true,
    ...overrides,
  };
}

const VERSES = [
  makeVerse(),
  makeVerse({ verse_id: 19003002, verse: 2, text: 'Verse two text', text_html: 'Verse two text' }),
];

function setPanelHookState(overrides: Record<string, unknown> = {}) {
  mockUseBiblePanel.mockReturnValue({
    getStudyOptions: () => DEFAULT_STUDY_OPTIONS,
    setStudyOptions: vi.fn(),
    openTabs: [{ tabId: 'tab-1', abbreviation: 'KJV' }],
    activeTabIndex: 0,
    interlinearByModule: new Map([['KJV', true]]),
    studyOptionsByTab: new Map([['tab-1', { ...DEFAULT_STUDY_OPTIONS, showInterlinear: true }]]),
    ...overrides,
  });
}

/**
 * Mimics the slice of BiblePane responsible for the scroll wiring: creates
 * the real refs, runs the real useBibleScrolling hook against them, and
 * forwards them into StudyModeView exactly as BiblePane -> BibleVerseList ->
 * StudyModeView do post-fix.
 */
function Harness(props: {
  selectedVerseId: number | null;
  /** The verse a link landed on - the scroll target that beats the selection. */
  previewVerseId?: number | null;
  scrollTrigger: number;
  scrollMode: 'center' | 'nearest';
  verses?: typeof VERSES;
}) {
  const bibleTextRef = useRef<HTMLDivElement>(null);
  const selectedVerseRef = useRef<HTMLDivElement>(null);
  const verses = props.verses ?? VERSES;

  useBibleScrolling(
    'panel-1', bibleTextRef, selectedVerseRef, props.selectedVerseId,
    props.previewVerseId ?? null,
    props.scrollTrigger, props.scrollMode, verses, false,
    vi.fn(), vi.fn(), vi.fn(),
  );

  return (
    <div ref={bibleTextRef}>
      <StudyModeView
        verses={verses}
        panelId="panel-1"
        tabId="tab-1"
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={props.selectedVerseId}
        previewVerseId={props.previewVerseId ?? null}
        onVerseClick={vi.fn()}
        selectedVerseRef={selectedVerseRef}
        scrollTrigger={props.scrollTrigger}
        scrollMode={props.scrollMode}
      />
    </div>
  );
}

describe('StudyModeView scroll wiring (FIX 1)', () => {
  let scrolledElements: Element[];

  beforeEach(() => {
    vi.clearAllMocks();
    setPanelHookState();
    scrolledElements = [];
    // Capture `this` per call instead of relying on mock internals, so we can
    // assert exactly which element was scrolled.
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledElements.push(this);
    });
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockImplementation(
      () => new Promise(() => {}), // never resolves unless a test overrides it
    );
  });

  it('scrolls the DOM node for the selected verse specifically, not just any verse', async () => {
    // Resolve immediately: this test is about *which* element is scrolled, so
    // the verses have to be on screen.
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockResolvedValue({});
    render(<Harness selectedVerseId={19003002} scrollTrigger={1} scrollMode="center" />);

    // Flush useBibleScrolling's requestAnimationFrame-scheduled effect.
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    expect(scrolledElements.length).toBeGreaterThan(0);
    expect(scrolledElements[scrolledElements.length - 1]).toBe(screen.getByTestId('verse-2'));
  });

  it('scrolls to the selected verse when the verses first paint after the interlinear fetch (center mode)', async () => {
    let resolveInterlinear!: (value: Awaited<ReturnType<typeof bibleAPI.getInterlinearWordsForChapter>>) => void;
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockReturnValue(
      new Promise((resolve) => { resolveInterlinear = resolve; }),
    );

    render(<Harness selectedVerseId={19003002} scrollTrigger={5} scrollMode="center" />);

    // While the fetch is in flight there are no verses to scroll to - that is
    // the whole point of the loading gate, and it is why useBibleScrolling
    // alone is not enough here.
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    expect(screen.queryByTestId('verse-2')).toBeNull();
    expect(scrolledElements.length).toBe(0);

    await act(async () => {
      resolveInterlinear({ '19003002': [{ wordPositionStart: 0, wordPositionEnd: 1, originalWord: 'foo' }] });
      await new Promise(r => setTimeout(r, 50));
    });

    expect(screen.getByTestId('interlinear-display')).toBeInTheDocument();
    expect(scrolledElements.length).toBeGreaterThan(0);
    expect(scrolledElements[scrolledElements.length - 1]).toBe(screen.getByTestId('verse-2'));
  });

  it('does NOT scroll after interlinear data loads in "nearest" mode', async () => {
    // Renders StudyModeView directly (not through the useBibleScrolling
    // harness) so this isolates StudyModeView's own scroll effect from
    // useBibleScrolling's separate 'nearest'-mode layout-retry behavior.
    let resolveInterlinear!: (value: Awaited<ReturnType<typeof bibleAPI.getInterlinearWordsForChapter>>) => void;
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockReturnValue(
      new Promise((resolve) => { resolveInterlinear = resolve; }),
    );

    const ref = React.createRef<HTMLDivElement>();
    render(
      <StudyModeView
        verses={VERSES}
        panelId="panel-1"
        tabId="tab-1"
        moduleId={1}
        currentBookNumber={19}
        currentBookName="Psalms"
        currentChapter={3}
        selectedVerseId={19003002}
        onVerseClick={vi.fn()}
        selectedVerseRef={ref}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    await act(async () => {
      resolveInterlinear({ '19003002': [{ wordPositionStart: 0, wordPositionEnd: 1, originalWord: 'foo' }] });
      await new Promise(r => setTimeout(r, 50));
    });

    expect(screen.getByTestId('interlinear-display')).toBeInTheDocument();
    // 'nearest' means the verse arrived from a plain click, not a navigation -
    // re-centering it after an unrelated data fetch would be an unrequested jump.
    expect(scrolledElements.length).toBe(0);
  });
  // A verse reached by following a scripture link. `previewVerseId` is set and
  // `selectedVerseId` deliberately is NOT moved (see previewSlice.ts), so
  // centring the selection would scroll to the verse the reader came from -
  // and cross-chapter, where the selection points outside the loaded chapter,
  // nothing carried `selectedVerseRef` and nothing scrolled at all.
  describe('a previewed verse', () => {
    beforeEach(() => {
      vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockResolvedValue({});
    });

    it('scrolls to the previewed verse, not the selected one', async () => {
      render(
        <Harness
          selectedVerseId={19003001}
          previewVerseId={19003002}
          scrollTrigger={1}
          scrollMode="center"
        />,
      );

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      const scrolled = scrolledElements.at(-1) as HTMLElement;
      expect(scrolled.getAttribute('data-verse-id')).toBe('19003002');
    });

    it('flashes the verse it landed on', async () => {
      render(
        <Harness
          selectedVerseId={19003001}
          previewVerseId={19003002}
          scrollTrigger={1}
          scrollMode="center"
        />,
      );

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      const landed = document.querySelector('[data-verse-id="19003002"]');
      expect(landed?.classList.contains('verse-flash')).toBe(true);
      // Only the verse arrived at.
      expect(document.querySelectorAll('.verse-flash').length).toBe(1);
    });

    it('still scrolls to the selection when nothing is previewed', async () => {
      render(
        <Harness selectedVerseId={19003002} previewVerseId={null} scrollTrigger={1} scrollMode="center" />,
      );

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(scrolledElements.length).toBeGreaterThan(0);
      expect(document.querySelectorAll('.verse-flash').length).toBe(0);
    });
  });
});
