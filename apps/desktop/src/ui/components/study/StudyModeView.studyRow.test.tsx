/**
 * Three regressions in the Study-mode verse row, all of which looked like
 * "the feature is broken" rather than "the data is missing":
 *
 *  1. Cross-references were read from `verse.formatting.crossReferences`, which
 *     no shipped Bible module populates, so the row was always empty even with
 *     TSK installed. They now come from the cross-reference MODULES over the
 *     `xref:*` IPC - the same source the dockview Study pane uses.
 *  2. Turning Interlinear on painted the chapter as short plain text and then
 *     re-rendered every verse as a much taller stack. The verses are now
 *     withheld until the fetch resolves (mirrors the web app's
 *     `interlinearPending` branch and its BibleContent tests).
 *  3. Only the verse NUMBER selected the verse. The text does too now - but a
 *     click that merely ends a drag-selection must not steal it, or every
 *     highlight drag would re-select the verse.
 */
import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StudyModeView from './StudyModeView';
import { DEFAULT_STUDY_OPTIONS } from '../../stores/useBibleStore';
import { bibleAPI } from '../../services/electronAPI';
import { VerseIdHelper } from '@bible/core';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('./StudyControls', () => ({ default: () => <div data-testid="study-controls" /> }));
vi.mock('./FootnoteDisplay', () => ({ default: () => null }));
// VerseLinksDisplay makes its own IPC call on mount and is not under test here.
vi.mock('./VerseLinksDisplay', () => ({ default: () => null }));

// Study mode withholds the verses until the chapter's study data lands (one
// paint, fully adorned - see useChapterStudyData), and that data is now
// FETCHED by the hook rather than by this component. Stubbing the hook keeps
// these tests about what the row renders; the fetching itself, its fallbacks
// and its round-trip count are covered in useChapterStudyData.test.tsx.
let stubbedStudyData: {
  crossRefsByVerse: Map<number, unknown[]>;
  linksByVerse: Map<number, unknown>;
  resolved: boolean;
};

vi.mock('./useChapterStudyData', () => ({
  useChapterStudyData: () => stubbedStudyData,
}));

function resetStudyData(): void {
  stubbedStudyData = {
    crossRefsByVerse: new Map(),
    linksByVerse: new Map(),
    resolved: true,
  };
}
resetStudyData();

vi.mock('./InterlinearDisplay', () => ({
  default: () => <div data-testid="interlinear-display" />,
}));

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}),
    getVerseTexts: vi.fn().mockResolvedValue({}),
  },
}));

const mockUseBiblePanel = vi.fn();
vi.mock('../../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

const VERSE_ID = 43003016;
const VERSES = [{
  verse_id: VERSE_ID,
  book_number: 43,
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world',
  text_html: 'For God so loved the world',
}];

function setPanelHookState(overrides: Record<string, unknown> = {}) {
  const options = { ...DEFAULT_STUDY_OPTIONS, ...(overrides.studyOptions as object ?? {}) };
  mockUseBiblePanel.mockReturnValue({
    getStudyOptions: () => options,
    setStudyOptions: vi.fn(),
    openTabs: [{ tabId: 'tab-1', abbreviation: 'KJV' }],
    activeTabIndex: 0,
    interlinearByModule: new Map([['KJV', overrides.hasInterlinear ?? false]]),
    studyOptionsByTab: new Map([['tab-1', options]]),
    navigateToVerse: overrides.navigateToVerse ?? vi.fn(),
  });
}

function Harness(props: {
  onVerseClick?: (verseId: number, extend?: boolean) => void;
  verses?: typeof VERSES;
  selectedVerseId?: number | null;
  selectionEndVerseId?: number | null;
}) {
  const selectedVerseRef = useRef<HTMLDivElement>(null);
  return (
    <StudyModeView
      verses={props.verses ?? VERSES}
      panelId="panel-1"
      tabId="tab-1"
      moduleId={1}
      currentBookNumber={43}
      currentBookName="John"
      currentChapter={3}
      selectedVerseId={props.selectedVerseId ?? null}
      selectionEndVerseId={props.selectionEndVerseId ?? null}
      onVerseClick={props.onVerseClick ?? vi.fn()}
      selectedVerseRef={selectedVerseRef}
      scrollTrigger={0}
      scrollMode="nearest"
    />
  );
}

/** John 3:15-18, for the range tests below. */
const RANGE_VERSES = [15, 16, 17, 18].map(verse => ({
  verse_id: VerseIdHelper.calculate(43, 3, verse),
  book_number: 43,
  chapter: 3,
  verse,
  text: `Verse ${verse} text`,
  text_html: `Verse ${verse} text`,
}));

function rangeRow(container: HTMLElement, verse: number): HTMLElement {
  const el = container.querySelector(`[data-verse-id="${VerseIdHelper.calculate(43, 3, verse)}"]`);
  if (!el) throw new Error(`no row rendered for John 3:${verse}`);
  return el as HTMLElement;
}

describe('Study-mode cross-references come from the cross-reference modules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudyData();
    setPanelHookState({ studyOptions: { showCrossReferences: true } });
  });

  it('renders the module row with real book names, grouped by phrase', async () => {
    stubbedStudyData.crossRefsByVerse = new Map([[
      VERSE_ID,
      [{
        abbreviation: 'TSKxref',
        moduleName: 'Treasury of Scripture Knowledge',
        groups: [{
          groupId: 1,
          phrase: 'loved.',
          // A stored range is pre-expanded by the hook, so it prints "9-10".
          verseIds: [45005008, 62004009, 62004010],
        }],
      }],
    ]]);

    render(<Harness />);
    const row = await screen.findByTestId('cross-reference-row-TSKxref');
    expect(row.textContent).toContain('TSK:');
    expect(row.textContent).toContain('loved.');
    expect(row.textContent).toContain('Rom 5:8');
    expect(row.textContent).toContain('1 John 4:9-10');
    // The bug this replaces: an 11-book lookup table that rendered everything
    // else as "Book <n>".
    expect(row.textContent).not.toContain('Book 45');
  });

  it('renders nothing rather than throwing when the lookup fails', async () => {
    // The hook swallows a failed lookup and resolves empty - the verse still
    // paints, only the cross-reference row is absent.
    render(<Harness />);
    expect(await screen.findByTestId('verse-16')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('verse-cross-references')).toBeNull();
    });
  });
});

describe('Study-mode interlinear does not paint twice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudyData();
    setPanelHookState({ studyOptions: { showInterlinear: true }, hasInterlinear: true });
  });

  it('hides the verses while interlinear data loads', async () => {
    // Never resolves: this is the window during which the verses must stay
    // hidden - painting a short plain-text fallback and then reflowing the
    // whole chapter here would flash before the real content lands.
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockReturnValue(new Promise(() => {}));
    render(<Harness />);
    expect(screen.queryByTestId('verse-16')).toBeNull();
  });

  it('renders the verses once the fetch resolves, even with no interlinear rows', async () => {
    vi.mocked(bibleAPI.getInterlinearWordsForChapter).mockResolvedValue({});
    render(<Harness />);
    // An empty result is meaningful once resolved - it must not withhold the
    // chapter forever.
    expect(await screen.findByTestId('verse-16')).toBeInTheDocument();
  });
});

/**
 * The verse has to out-weigh its own apparatus. jsdom resolves neither `var()`
 * nor `calc()`, so the assertion is on the mechanism: the paragraph carries
 * `.study-verse-text` (globals.css, a multiple of the Bible pane's own font
 * size) and no fixed Tailwind size class. `text-lg` would fix it at a flat
 * 18px, *below* the pane's 20px default, so scripture would render smaller
 * than the rest of the pane and level with the footnote and cross-reference
 * rows.
 */
describe('Study-mode verse emphasis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudyData();
    setPanelHookState();
  });

  it('sizes the verse text from the pane font size, not a fixed class', () => {
    const { container } = render(<Harness />);

    const paragraph = container.querySelector('p.study-verse-text');
    expect(paragraph).not.toBeNull();
    expect(paragraph!.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});

describe('Study-mode verse selection', () => {
  const originalGetSelection = window.getSelection;

  beforeEach(() => {
    vi.clearAllMocks();
    setPanelHookState();
  });

  afterEach(() => {
    window.getSelection = originalGetSelection;
  });

  it('selects the verse when its text is clicked', () => {
    const onVerseClick = vi.fn();
    const { container } = render(<Harness onVerseClick={onVerseClick} />);
    // A word of the verse text - the text is rendered as one `.word` span per
    // word (that is what highlights address), so there is no single text node
    // to aim at. The click bubbles to the verse-text wrapper's handler.
    fireEvent.click(container.querySelector('.word')!);
    expect(onVerseClick).toHaveBeenCalledWith(VERSE_ID, false);
  });

  it('does NOT select the verse on the click that ends a text drag', () => {
    // A drag across the verse for a highlight ends with mouseup + click while
    // the DOM Selection is still non-collapsed.
    window.getSelection = () => ({
      isCollapsed: false,
      toString: () => 'God so loved',
    }) as unknown as Selection;

    const onVerseClick = vi.fn();
    const { container } = render(<Harness onVerseClick={onVerseClick} />);
    fireEvent.click(container.querySelector('.word')!);
    expect(onVerseClick).not.toHaveBeenCalled();
  });

  it('puts the selection styling on the verse row, never on the words', () => {
    const selectedVerseRef = React.createRef<HTMLDivElement>();
    const { container } = render(
      <StudyModeView
        verses={VERSES}
        panelId="panel-1"
        tabId="tab-1"
        moduleId={1}
        currentBookNumber={43}
        currentBookName="John"
        currentChapter={3}
        selectedVerseId={VERSE_ID}
        onVerseClick={vi.fn()}
        selectedVerseRef={selectedVerseRef}
        scrollTrigger={0}
        scrollMode="nearest"
      />,
    );

    expect(container.querySelector(`[data-verse-id="${VERSE_ID}"]`)?.className)
      .toContain('verse-selected');
    // Highlight colours are painted as backgrounds on `.word` spans; the
    // selection must not add one of its own there or it shifts every
    // highlight's hue (a 22%-alpha row wash does exactly this).
    for (const word of container.querySelectorAll<HTMLElement>('.word')) {
      expect(word.className).not.toContain('verse-selected');
      expect(word.style.backgroundColor).toBe('');
    }
  });
});

/**
 * Shift-click passage selection in Study mode. The store owns the anchor/end
 * model (verseSlice.rangeSelection.test.ts); what matters here is that the
 * shift key reaches `onVerseClick` from both click targets Study mode offers
 * (the verse text and the verse number), that the drag guard does not swallow
 * it, and that the swept verses carry `.verse-in-range` while the anchor keeps
 * `.verse-selected`.
 */
describe('Study-mode shift-click range selection', () => {
  const originalGetSelection = window.getSelection;

  beforeEach(() => {
    vi.clearAllMocks();
    setPanelHookState();
  });

  afterEach(() => {
    window.getSelection = originalGetSelection;
  });

  it('passes the shift key through when the verse text is clicked', () => {
    const onVerseClick = vi.fn();
    const { container } = render(<Harness onVerseClick={onVerseClick} />);

    fireEvent.click(container.querySelector('.word')!, { shiftKey: true });

    expect(onVerseClick).toHaveBeenCalledWith(VERSE_ID, true);
  });

  it('passes the shift key through when the verse NUMBER is clicked', () => {
    const onVerseClick = vi.fn();
    const { container } = render(<Harness onVerseClick={onVerseClick} />);

    // The number is its own click target in Study mode (unlike Standard,
    // where the whole row handles it), so it needs the shift key too.
    fireEvent.click(container.querySelector('span.w-10')!, { shiftKey: true });

    expect(onVerseClick).toHaveBeenCalledWith(VERSE_ID, true);
  });

  it('is NOT swallowed by the drag-selection guard', () => {
    window.getSelection = () => ({
      isCollapsed: false,
      toString: () => 'leftover',
    }) as unknown as Selection;

    const onVerseClick = vi.fn();
    const { container } = render(<Harness onVerseClick={onVerseClick} />);
    fireEvent.click(container.querySelector('.word')!, { shiftKey: true });

    expect(onVerseClick).toHaveBeenCalledWith(VERSE_ID, true);
  });

  it('prevents the default on shift+mousedown but not on a plain one', () => {
    const { container } = render(<Harness />);
    const word = container.querySelector('.word')!;

    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.mouseDown(word, { shiftKey: true })).toBe(false);
    expect(fireEvent.mouseDown(word)).toBe(true);
  });

  it('washes the swept verses with .verse-in-range and leaves the anchor selected', () => {
    const { container } = render(
      <Harness
        verses={RANGE_VERSES}
        selectedVerseId={VerseIdHelper.calculate(43, 3, 16)}
        selectionEndVerseId={VerseIdHelper.calculate(43, 3, 18)}
      />,
    );

    expect(rangeRow(container, 16).className).toContain('verse-selected');
    expect(rangeRow(container, 16).className).not.toContain('verse-in-range');
    expect(rangeRow(container, 17).className).toContain('verse-in-range');
    expect(rangeRow(container, 18).className).toContain('verse-in-range');
    expect(rangeRow(container, 15).className).not.toContain('verse-in-range');
  });

  it('handles an UPWARD range (the end below the anchor)', () => {
    const { container } = render(
      <Harness
        verses={RANGE_VERSES}
        selectedVerseId={VerseIdHelper.calculate(43, 3, 18)}
        selectionEndVerseId={VerseIdHelper.calculate(43, 3, 16)}
      />,
    );

    expect(rangeRow(container, 16).className).toContain('verse-in-range');
    expect(rangeRow(container, 17).className).toContain('verse-in-range');
    expect(rangeRow(container, 18).className).toContain('verse-selected');
    expect(rangeRow(container, 15).className).not.toContain('verse-in-range');
  });

  it('marks nothing when there is no extension', () => {
    const { container } = render(
      <Harness
        verses={RANGE_VERSES}
        selectedVerseId={VerseIdHelper.calculate(43, 3, 16)}
        selectionEndVerseId={null}
      />,
    );

    for (const verse of [15, 16, 17, 18]) {
      expect(rangeRow(container, verse).className).not.toContain('verse-in-range');
    }
  });
});
