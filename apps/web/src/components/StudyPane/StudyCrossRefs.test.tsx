/**
 * Component tests for StudyCrossRefs.
 *
 * Pattern: Store-connected component with complex rendering logic.
 * studyStore, offlineStore, bibleStore are mocked via useStore/direct mocks.
 * collapseReferencesStructured and useVersePopup are mocked. Tests cover
 * loading state, empty state, cross-reference group rendering, phrase/overall
 * labels, verse list toggle, click callbacks, and splitPhrase logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import type { IBibleDataProvider } from '../../providers/interfaces';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ---- useVersePopup -------------------------------------------------------
const mockHandleHover = vi.fn();
const mockHandleLeave = vi.fn();
const mockHandleClick = vi.fn();

vi.mock('../../hooks/useVersePopup', () => ({
  useVersePopup: () => ({
    handleHover: mockHandleHover,
    handleLeave: mockHandleLeave,
    handleClick: mockHandleClick,
    popupJsx: null,
  }),
}));

// ---- collapseReferencesStructured mock -----------------------------------
const mockCollapseReferencesStructured = vi.fn();
vi.mock('../../utils/collapseReferences', () => ({
  collapseReferencesStructured: (...args: unknown[]) => mockCollapseReferencesStructured(...args),
}));

// ---- parseVerseId mock ---------------------------------------------------
vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
}));

// ---- formatPassageRef mock -----------------------------------------------
vi.mock('../../constants', () => ({
  formatPassageRef: (b: number, c: number, v?: number) => `Book${b} ${c}:${v ?? 0}`,
}));

// ---- Store state ---------------------------------------------------------
type CrossRefEntry = {
  entry_id: number;
  target_verse_id: number;
  target_verse_end_id: number | null;
};
type CrossRefGroup = {
  group: { group_id: number; phrase: string | null; sort_order: number };
  entries: CrossRefEntry[];
};

let mockCrossRefGroups: CrossRefGroup[] = [];
let mockCrossRefLoading = false;
let mockIsOnline = true;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get crossRefGroups() { return mockCrossRefGroups; },
    get crossRefLoading() { return mockCrossRefLoading; },
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
  },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => ({ moduleAbbr: 'KJV' }),
  },
}));

import { StudyCrossRefs } from './StudyCrossRefs';

function makeGroup(overrides: Partial<{
  group_id: number;
  phrase: string | null;
  sort_order: number;
  entries: CrossRefEntry[];
}> = {}): CrossRefGroup {
  return {
    group: {
      group_id: 1,
      phrase: null,
      sort_order: 0,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k]) => ['group_id', 'phrase', 'sort_order'].includes(k))
      ),
    },
    entries: overrides.entries ?? [
      { entry_id: 1, target_verse_id: 43001001, target_verse_end_id: null },
    ],
  };
}

function makeRefSegment(verseId: number, label: string) {
  return { type: 'ref' as const, label, verseId, endVerseId: undefined };
}

function makeSepSegment(text: string) {
  return { type: 'sep' as const, text };
}

describe('StudyCrossRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCrossRefGroups = [];
    mockCrossRefLoading = false;
    mockIsOnline = true;
    // Default: return a simple ref segment per verse
    mockCollapseReferencesStructured.mockImplementation((ids: number[]) =>
      ids.flatMap((id, i) => [
        ...(i > 0 ? [makeSepSegment(', ')] : []),
        makeRefSegment(id, `Ref${id}`),
      ])
    );
    // Reset localStorage
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  it('renders loading indicator when crossRefLoading is true', () => {
    mockCrossRefLoading = true;
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs__loading')).toBeTruthy();
    expect(screen.getByText('studyCrossRefs.loading')).toBeTruthy();
  });

  it('does not render crossrefs container while loading', () => {
    mockCrossRefLoading = true;
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Empty state
  // ------------------------------------------------------------------
  it('renders noData message when online and no groups', () => {
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs__empty')).toBeTruthy();
    expect(screen.getByText('studyCrossRefs.noData')).toBeTruthy();
  });

  it('renders offlineNotice when offline and no groups', () => {
    mockIsOnline = false;
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs__empty')).toBeTruthy();
    expect(screen.getByText('studyCrossRefs.offlineNotice')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Cross-reference list rendering
  // ------------------------------------------------------------------
  it('renders the crossrefs container when groups are present', () => {
    mockCrossRefGroups = [makeGroup()];
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs')).toBeTruthy();
  });

  it('renders one list item per group', () => {
    mockCrossRefGroups = [
      makeGroup({ group_id: 1, phrase: null }),
      makeGroup({ group_id: 2, phrase: 'believed', sort_order: 1 }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const items = container.querySelectorAll('.study-crossrefs__list > li');
    expect(items.length).toBe(2);
  });

  it('renders "overall" label for groups with null phrase', () => {
    mockCrossRefGroups = [makeGroup({ phrase: null })];
    render(<StudyCrossRefs />);
    expect(screen.getByText('studyCrossRefs.overall', { exact: false })).toBeTruthy();
  });

  it('renders quoted keyword for groups with a phrase', () => {
    mockCrossRefGroups = [makeGroup({ phrase: 'believed', sort_order: 1 })];
    const { container } = render(<StudyCrossRefs />);
    const phraseEl = container.querySelector('.study-crossrefs__phrase-inline');
    expect(phraseEl?.textContent).toContain('believed');
  });

  it('renders reference links for entries', () => {
    mockCrossRefGroups = [
      makeGroup({
        entries: [
          { entry_id: 1, target_verse_id: 43003016, target_verse_end_id: null },
        ],
      }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const links = container.querySelectorAll('.study-crossrefs__ref-link');
    expect(links.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Phrase splitting — aside detection
  // ------------------------------------------------------------------
  it('renders aside text for TSK phrases with embedded commentary', () => {
    // splitPhrase requires: phrase.length >= 30, period at i >= 4, aside >= 10 chars
    // "locusts.The word arbeh Locust is from ravah" — period at index 7, aside is 35+ chars
    const phrase = 'locusts.The word arbeh Locust is derived from ravah meaning multiply';
    mockCrossRefGroups = [
      makeGroup({ phrase, sort_order: 1 }),
    ];
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs__aside')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Sorting: null phrase first
  // ------------------------------------------------------------------
  it('places the null-phrase (overall) group first regardless of sort_order', () => {
    mockCrossRefGroups = [
      makeGroup({ group_id: 2, phrase: 'believed', sort_order: 0 }),
      makeGroup({ group_id: 1, phrase: null, sort_order: 5 }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const items = container.querySelectorAll('.study-crossrefs__list > li');
    // First item should contain the "overall" label
    expect(items[0].textContent).toContain('studyCrossRefs.overall');
  });

  // ------------------------------------------------------------------
  // Verse list toggle button
  // ------------------------------------------------------------------
  it('renders the toggle button', () => {
    mockCrossRefGroups = [makeGroup()];
    const { container } = render(<StudyCrossRefs />);
    expect(container.querySelector('.study-crossrefs__table-toggle')).toBeTruthy();
  });

  it('shows showVerses label when verse list is hidden', () => {
    mockCrossRefGroups = [makeGroup()];
    render(<StudyCrossRefs />);
    expect(screen.getByText('studyCrossRefs.showVerses', { exact: false })).toBeTruthy();
  });

  it('toggles to show verse list when toggle button is clicked', () => {
    mockCrossRefGroups = [makeGroup()];
    const { container } = render(<StudyCrossRefs />);
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);
    expect(container.querySelector('.study-crossrefs__verse-list')).toBeTruthy();
  });

  it('shows hideVerses label after toggling verse list on', () => {
    mockCrossRefGroups = [makeGroup()];
    const { container } = render(<StudyCrossRefs />);
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);
    expect(screen.getByText('studyCrossRefs.hideVerses', { exact: false })).toBeTruthy();
  });

  it('hides verse list again after second toggle click', () => {
    mockCrossRefGroups = [makeGroup()];
    const { container } = render(<StudyCrossRefs />);
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);
    expect(container.querySelector('.study-crossrefs__verse-list')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Ref link hover/click callbacks
  // ------------------------------------------------------------------
  it('calls handleClick when a reference link is clicked', () => {
    mockCrossRefGroups = [
      makeGroup({
        entries: [{ entry_id: 1, target_verse_id: 43003016, target_verse_end_id: null }],
      }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const link = container.querySelector<HTMLAnchorElement>('.study-crossrefs__ref-link')!;
    fireEvent.click(link);
    expect(mockHandleClick).toHaveBeenCalledWith(43003016, expect.anything(), undefined);
  });

  it('calls handleHover when a reference link receives mouseenter', () => {
    mockCrossRefGroups = [
      makeGroup({
        entries: [{ entry_id: 1, target_verse_id: 43003016, target_verse_end_id: null }],
      }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const link = container.querySelector<HTMLAnchorElement>('.study-crossrefs__ref-link')!;
    fireEvent.mouseEnter(link);
    expect(mockHandleHover).toHaveBeenCalledWith(43003016, expect.anything());
  });

  it('calls handleLeave when a reference link receives mouseleave', () => {
    mockCrossRefGroups = [
      makeGroup({
        entries: [{ entry_id: 1, target_verse_id: 43003016, target_verse_end_id: null }],
      }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const link = container.querySelector<HTMLAnchorElement>('.study-crossrefs__ref-link')!;
    fireEvent.mouseLeave(link);
    expect(mockHandleLeave).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Verse text fetching — must batch, never fan out per verse
  // ------------------------------------------------------------------
  function makeBibleProvider(
    versesMap: Record<string, { verse_id: number; text: string; text_html: string }> = {},
  ): IBibleDataProvider {
    return {
      getVerse: vi.fn(),
      getVerseTexts: vi.fn().mockResolvedValue({ verses: versesMap }),
      getChapter: vi.fn(),
      getBookTopics: vi.fn(),
      getVerseOfTheDay: vi.fn(),
    } as unknown as IBibleDataProvider;
  }

  it('fetches cross-ref verse texts with a single batched request, not one per verse', async () => {
    const targets = [43001001, 45008028, 40022012, 19023001];
    mockCrossRefGroups = [
      makeGroup({
        group_id: 1,
        phrase: null,
        entries: targets.map((id, i) => ({ entry_id: i, target_verse_id: id, target_verse_end_id: null })),
      }),
    ];
    const provider = makeBibleProvider(
      Object.fromEntries(targets.map(id => [String(id), { verse_id: id, text: `Text ${id}`, text_html: `Text ${id}` }])),
    );

    const { container } = render(<StudyCrossRefs bibleProvider={provider} />);
    // Expand the verse list — this triggers the fetch
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);

    await waitFor(() => {
      expect(provider.getVerseTexts).toHaveBeenCalledTimes(1);
    });

    // The batch must contain every target verse in ONE call...
    const [, requestedIds] = (provider.getVerseTexts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([...requestedIds].sort()).toEqual([...targets].sort());
    // ...and the per-verse endpoint must never be used for the list (the fan-out regression).
    expect(provider.getVerse).not.toHaveBeenCalled();
  });

  it('de-duplicates target verses shared across phrase groups into one batch entry', async () => {
    // Same verse (43001001) appears in two different phrase groups.
    mockCrossRefGroups = [
      makeGroup({ group_id: 1, phrase: 'first', entries: [{ entry_id: 1, target_verse_id: 43001001, target_verse_end_id: null }] }),
      makeGroup({ group_id: 2, phrase: 'second', sort_order: 1, entries: [{ entry_id: 2, target_verse_id: 43001001, target_verse_end_id: null }] }),
    ];
    const provider = makeBibleProvider({ '43001001': { verse_id: 43001001, text: 'x', text_html: 'x' } });

    const { container } = render(<StudyCrossRefs bibleProvider={provider} />);
    fireEvent.click(container.querySelector('.study-crossrefs__table-toggle')!);

    await waitFor(() => {
      expect(provider.getVerseTexts).toHaveBeenCalledTimes(1);
    });
    const [, requestedIds] = (provider.getVerseTexts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(requestedIds).toEqual([43001001]);
  });

  // ------------------------------------------------------------------
  // Separator segments
  // ------------------------------------------------------------------
  it('renders separator elements between references', () => {
    mockCollapseReferencesStructured.mockReturnValue([
      makeRefSegment(43003016, 'John 3:16'),
      makeSepSegment('; '),
      makeRefSegment(45008028, 'Rom 8:28'),
    ]);
    mockCrossRefGroups = [
      makeGroup({
        entries: [
          { entry_id: 1, target_verse_id: 43003016, target_verse_end_id: null },
          { entry_id: 2, target_verse_id: 45008028, target_verse_end_id: null },
        ],
      }),
    ];
    const { container } = render(<StudyCrossRefs />);
    const seps = container.querySelectorAll('.study-crossrefs__sep');
    expect(seps.length).toBeGreaterThan(0);
    expect(seps[0].textContent).toBe('; ');
  });
});
