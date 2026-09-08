import { enString, enT } from '../testing/enCatalog';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import ParallelBibleView from './ParallelBibleView';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { bibleAPI } from '../services/electronAPI';

// Mock hooks
const mockUseBiblePanel = vi.fn();
vi.mock('../stores/hooks/useBiblePanel', () => ({
  useBiblePanel: (...args: unknown[]) => mockUseBiblePanel(...args),
}));

vi.mock('../stores/useCommentaryStore', () => ({
  useCommentaryStore: () => ({ syncAllPanelsWithVerse: vi.fn() }),
}));

vi.mock('../stores/useNotesStore', () => ({
  useNotesStore: () => ({ syncAllPanelsWithVerse: vi.fn() }),
}));

vi.mock('../services/electronAPI', () => ({
  bibleAPI: {
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
  },
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: (key: string, params?: Record<string, unknown>) => enT(key, params), currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultBiblePanel = {
  parallelVersions: [],
  availableBibles: [],
  currentBook: 43,
  currentChapter: 3,
  selectedVerseId: null,
  selectionEndVerseId: null,
  setSelectedVerse: vi.fn(),
  extendSelectionTo: vi.fn(),
};

describe('ParallelBibleView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBiblePanel.mockReturnValue(defaultBiblePanel);
  });

  it('shows message when fewer than 2 versions selected', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV'],
    });
    renderWithProviders(<ParallelBibleView />);
    expect(screen.getByText(enString('parallelBibleView.selectAtLeastTwo'))).toBeInTheDocument();
  });

  it('shows message when no versions selected', () => {
    renderWithProviders(<ParallelBibleView />);
    expect(screen.getByText(enString('parallelBibleView.selectAtLeastTwo'))).toBeInTheDocument();
  });

  it('renders column headers for parallel versions', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV', 'ESV'],
      availableBibles: [
        { abbreviation: 'KJV', name: 'King James Version' },
        { abbreviation: 'ESV', name: 'English Standard Version' },
      ],
    });
    renderWithProviders(<ParallelBibleView />);
    expect(screen.getByText('KJV')).toBeInTheDocument();
    expect(screen.getByText('ESV')).toBeInTheDocument();
  });

  it('shows version full names in headers', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV', 'ESV'],
      availableBibles: [
        { abbreviation: 'KJV', name: 'King James Version' },
        { abbreviation: 'ESV', name: 'English Standard Version' },
      ],
    });
    renderWithProviders(<ParallelBibleView />);
    expect(screen.getByText('King James Version')).toBeInTheDocument();
    expect(screen.getByText('English Standard Version')).toBeInTheDocument();
  });

  it('renders a table element', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV', 'ESV'],
      availableBibles: [
        { abbreviation: 'KJV', name: 'KJV' },
        { abbreviation: 'ESV', name: 'ESV' },
      ],
    });
    const { container } = renderWithProviders(<ParallelBibleView />);
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('shows Loading text when version is loading', () => {
    // The loading state is managed internally via useState, so we test
    // that the component renders without error when versions are provided.
    // The mock i18n `t()` echoes the key back (see createMockServices), so
    // this asserts the catalog key is used rather than a raw English literal.
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV', 'ESV'],
      availableBibles: [
        { abbreviation: 'KJV', name: 'KJV' },
        { abbreviation: 'ESV', name: 'ESV' },
      ],
    });
    renderWithProviders(<ParallelBibleView />);
    // Initially loading will be true
    expect(screen.getAllByText(enString('parallelBibleView.loading'))).toHaveLength(2);
  });

  it('passes panelId to useBiblePanel', () => {
    mockUseBiblePanel.mockReturnValue(defaultBiblePanel);
    renderWithProviders(<ParallelBibleView panelId="custom" />);
    expect(mockUseBiblePanel).toHaveBeenCalledWith('custom');
  });

  it('renders resize handles between columns', () => {
    mockUseBiblePanel.mockReturnValue({
      ...defaultBiblePanel,
      parallelVersions: ['KJV', 'ESV', 'NIV'],
      availableBibles: [
        { abbreviation: 'KJV', name: 'KJV' },
        { abbreviation: 'ESV', name: 'ESV' },
        { abbreviation: 'NIV', name: 'NIV' },
      ],
    });
    const { container } = renderWithProviders(<ParallelBibleView />);
    // Should have 2 resize handles (3 columns - 1)
    const handles = container.querySelectorAll('.cursor-col-resize');
    expect(handles).toHaveLength(2);
  });

  // Mirrors BibleVerseList/StudyModeView: verse.formatting.sectionHeading is
  // Module Format v2's real-world carrier for Psalm superscriptions, ridden
  // on the verse that follows (typically verse 1) rather than stored as its
  // own verse. verse.verse === 0 is the legacy v1-style literal preface verse.
  describe('section headings and verse-0 prefaces', () => {
    function verse(overrides: Record<string, unknown> = {}) {
      return {
        verse_id: 19003001,
        book_number: 19,
        chapter: 3,
        verse: 1,
        text: 'Lord, how are they increased that trouble me!',
        text_html: 'Lord, how are they increased that trouble me!',
        ...overrides,
      };
    }

    function mockChapters(versesByAbbr: Record<string, unknown[]>) {
      (bibleAPI.getChapter as ReturnType<typeof vi.fn>).mockImplementation(
        (abbr: string) => Promise.resolve({ verses: versesByAbbr[abbr] ?? [] }),
      );
    }

    it('renders a section heading present on one translation', async () => {
      mockChapters({
        KJV: [verse({ formatting: { sectionHeading: 'A Psalm of David.' } })],
        ESV: [verse()],
      });
      mockUseBiblePanel.mockReturnValue({
        ...defaultBiblePanel,
        parallelVersions: ['KJV', 'ESV'],
        availableBibles: [
          { abbreviation: 'KJV', name: 'KJV' },
          { abbreviation: 'ESV', name: 'ESV' },
        ],
      });

      renderWithProviders(<ParallelBibleView />);

      await waitFor(() => {
        expect(screen.getByText('A Psalm of David.')).toBeInTheDocument();
      });
    });

    it('keeps both columns on a single aligned row when only one translation has the heading', async () => {
      mockChapters({
        KJV: [verse({ formatting: { sectionHeading: 'A Psalm of David.' } })],
        ESV: [verse()],
      });
      mockUseBiblePanel.mockReturnValue({
        ...defaultBiblePanel,
        parallelVersions: ['KJV', 'ESV'],
        availableBibles: [
          { abbreviation: 'KJV', name: 'KJV' },
          { abbreviation: 'ESV', name: 'ESV' },
        ],
      });

      const { container } = renderWithProviders(<ParallelBibleView />);

      await waitFor(() => {
        expect(screen.getByText('A Psalm of David.')).toBeInTheDocument();
      });

      // The heading rendered inside its column's <td> rather than as its own
      // <tr>, so there is still exactly one verse row and both columns' verse
      // 1 text sit in that same row (no drift between columns).
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      const cells = rows[0].querySelectorAll('td');
      expect(cells).toHaveLength(2);
      expect(cells[0].textContent).toContain('A Psalm of David.');
      expect(cells[0].textContent).toContain('Lord, how are they increased that trouble me!');
      expect(cells[1].textContent).not.toContain('A Psalm of David.');
      expect(cells[1].textContent).toContain('Lord, how are they increased that trouble me!');
    });

    it('gives verse numbers accent-colored styling instead of neutral gray', async () => {
      mockChapters({
        KJV: [verse()],
        ESV: [verse()],
      });
      mockUseBiblePanel.mockReturnValue({
        ...defaultBiblePanel,
        parallelVersions: ['KJV', 'ESV'],
        availableBibles: [
          { abbreviation: 'KJV', name: 'KJV' },
          { abbreviation: 'ESV', name: 'ESV' },
        ],
      });

      const { container } = renderWithProviders(<ParallelBibleView />);

      await waitFor(() => {
        expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
      });

      // The numeral lives in a <bdi> inside the verse-number button (see the
      // verse-row describe below for why it is a button at all).
      const numerals = container.querySelectorAll('tbody button bdi');
      expect(numerals.length).toBeGreaterThan(0);
      numerals.forEach((el) => {
        expect(el.className).toContain('text-accent');
        expect(el.className).toContain('font-bold');
        expect(el.className).not.toContain('text-text-secondary');
      });
    });

    it('verse 0 (chapter preface) renders with no verse-number and preface styling', async () => {
      mockChapters({
        KJV: [verse({ verse: 0, verse_id: 19003000, text: 'A Psalm of David.', text_html: 'A Psalm of David.' })],
        ESV: [verse({ verse: 0, verse_id: 19003000, text: 'A Psalm of David.', text_html: 'A Psalm of David.' })],
      });
      mockUseBiblePanel.mockReturnValue({
        ...defaultBiblePanel,
        parallelVersions: ['KJV', 'ESV'],
        availableBibles: [
          { abbreviation: 'KJV', name: 'KJV' },
          { abbreviation: 'ESV', name: 'ESV' },
        ],
      });

      const { container } = renderWithProviders(<ParallelBibleView />);

      await waitFor(() => {
        expect(screen.getAllByText('A Psalm of David.')).toHaveLength(2);
      });

      // No verse-number badge for the preface row in either column.
      expect(container.querySelectorAll('tbody button')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /Select/i })).not.toBeInTheDocument();
      const prefaceCells = container.querySelectorAll('tbody .italic.text-text-secondary');
      expect(prefaceCells.length).toBeGreaterThan(0);
    });
  });

  // The verse row in Parallel mode, matching what Standard/Reading/Study got:
  // an unconditional `.verse-row` box (cursor + themed hover wash), a verse
  // number that is no longer separately clickable but is still the keyboard
  // target, and a selection that changes colour without moving anything.
  describe('verse row: hover affordance, keyboard target, and no layout shift', () => {
    function verse(overrides: Record<string, unknown> = {}) {
      return {
        verse_id: 19003001,
        book_number: 19,
        chapter: 3,
        verse: 1,
        text: 'Lord, how are they increased that trouble me!',
        text_html: 'Lord, how are they increased that trouble me!',
        ...overrides,
      };
    }

    function mockChapters(versesByAbbr: Record<string, unknown[]>) {
      (bibleAPI.getChapter as ReturnType<typeof vi.fn>).mockImplementation(
        (abbr: string) => Promise.resolve({ verses: versesByAbbr[abbr] ?? [] }),
      );
    }

    async function renderRows(
      overrides: Record<string, unknown> = {},
    ): Promise<{ container: HTMLElement; setSelectedVerse: ReturnType<typeof vi.fn> }> {
      mockChapters({
        KJV: [verse(), verse({ verse: 2, verse_id: 19003002, text: 'Many there be', text_html: 'Many there be' })],
        ESV: [verse(), verse({ verse: 2, verse_id: 19003002, text: 'Many are saying', text_html: 'Many are saying' })],
      });
      const setSelectedVerse = vi.fn();
      mockUseBiblePanel.mockReturnValue({
        ...defaultBiblePanel,
        parallelVersions: ['KJV', 'ESV'],
        availableBibles: [
          { abbreviation: 'KJV', name: 'KJV' },
          { abbreviation: 'ESV', name: 'ESV' },
        ],
        setSelectedVerse,
        ...overrides,
      });

      const { container } = renderWithProviders(<ParallelBibleView />);
      await waitFor(() => {
        expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
      });
      return { container, setSelectedVerse };
    }

    it('puts the shared .verse-row affordance on the whole row, not on each column', async () => {
      const { container } = await renderRows();

      const rows = container.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        // `.verse-row` (themes.css) is what supplies cursor: pointer and the
        // per-theme hover wash (--theme-verse-hover-fill). jsdom loads no CSS,
        // so the class is the assertable contract.
        expect(row.className).toContain('verse-row');
      });

      // One verse spans every column, so the band hovers and selects as a
      // single unit - no per-<td> affordance.
      container.querySelectorAll('tbody td').forEach((cell) => {
        expect(cell.className).not.toContain('verse-row');
        expect(cell.className).not.toContain('verse-selected');
      });
    });

    it('clicking anywhere on the row selects the verse', async () => {
      const { container, setSelectedVerse } = await renderRows();

      // The second column's cell - furthest from the verse number.
      const cell = container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1] as HTMLElement;
      cell.click();

      expect(setSelectedVerse).toHaveBeenCalledWith(19003001);
    });

    it('ignores the click that merely ends a text drag', async () => {
      const original = window.getSelection;
      window.getSelection = () =>
        ({ isCollapsed: false, toString: () => 'how are they increased' }) as unknown as Selection;
      try {
        const { container, setSelectedVerse } = await renderRows();
        (container.querySelectorAll('tbody tr')[0] as HTMLElement).click();
        expect(setSelectedVerse).not.toHaveBeenCalled();
      } finally {
        window.getSelection = original;
      }
    });

    it('the verse number is no longer a click target of its own, but is still keyboard-reachable', async () => {
      const { container, setSelectedVerse } = await renderRows();

      const buttons = container.querySelectorAll('tbody button');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        // No second affordance on the numeral: the row already says "clickable".
        expect(button.className).not.toContain('cursor-pointer');
        expect(button.className).not.toContain('hover:');
        // ...but it stays focusable with a visible ring, because Enter/Space on
        // it fires a native click that bubbles to the row handler.
        expect(button.tagName).toBe('BUTTON');
        expect(button.className).toContain('focus-visible:ring-accent');
      });

      // The keyboard path: activating the button reaches the row's handler.
      (buttons[0] as HTMLElement).click();
      expect(setSelectedVerse).toHaveBeenCalledWith(19003001);
    });

    it('labels the verse-number button with the full reference, not a bare numeral', async () => {
      await renderRows();
      expect(screen.getAllByRole('button', { name: /Select Psalms 3:1/i }).length).toBeGreaterThan(0);
    });

    it('selecting a verse changes colour only — the row and cell geometry are untouched', async () => {
      const { container: unselected } = await renderRows();
      const beforeRow = unselected.querySelectorAll('tbody tr')[0].className;
      const beforeCells = Array.from(
        unselected.querySelectorAll('tbody tr')[0].querySelectorAll('td'),
      ).map((c) => c.className);

      const { container: selected } = await renderRows({ selectedVerseId: 19003001 });
      const afterRow = selected.querySelectorAll('tbody tr')[0].className;
      const afterCells = Array.from(
        selected.querySelectorAll('tbody tr')[0].querySelectorAll('td'),
      ).map((c) => c.className);

      // The cells - which own the padding - are byte-identical either way. This
      // is the regression: padding that arrived *with* the selection grew the
      // row and pushed every later verse down the page.
      expect(afterCells).toEqual(beforeCells);

      // The row gains exactly one class, and it is the shared colour-only one.
      const added = afterRow.split(/\s+/).filter((c) => c && !beforeRow.split(/\s+/).includes(c));
      expect(added).toEqual(['verse-selected']);
      // ...and not an ad-hoc tint, which would ignore the theme accent.
      expect(afterRow).not.toContain('bg-accent-soft');
      expect(afterCells.join(' ')).not.toContain('bg-accent-soft');
    });

    /*
      Shift-click passage selection. The row is the verse in this view (every
      column's cell carries the same verse_id), so the range washes the whole
      band - and it is a background fill only, which is the one thing Chromium
      does paint on a `<tr>` under `border-collapse: collapse`.
    */
    it('shift-clicking a row extends the selection instead of re-anchoring', async () => {
      const extendSelectionTo = vi.fn();
      const { container, setSelectedVerse } = await renderRows({
        selectedVerseId: 19003001,
        extendSelectionTo,
      });

      fireEvent.click(container.querySelectorAll('tbody tr')[1] as HTMLElement, { shiftKey: true });

      expect(extendSelectionTo).toHaveBeenCalledWith(19003002);
      expect(setSelectedVerse).not.toHaveBeenCalled();
    });

    it('a shift-click is not swallowed by the drag-selection guard', async () => {
      const original = window.getSelection;
      window.getSelection = () =>
        ({ isCollapsed: false, toString: () => 'leftover' }) as unknown as Selection;
      try {
        const extendSelectionTo = vi.fn();
        const { container } = await renderRows({ selectedVerseId: 19003001, extendSelectionTo });
        fireEvent.click(container.querySelectorAll('tbody tr')[1] as HTMLElement, { shiftKey: true });
        expect(extendSelectionTo).toHaveBeenCalledWith(19003002);
      } finally {
        window.getSelection = original;
      }
    });

    it('prevents the default on shift+mousedown so no native selection is swept', async () => {
      const { container } = await renderRows();
      const row = container.querySelectorAll('tbody tr')[0] as HTMLElement;

      // fireEvent returns false when a handler called preventDefault().
      expect(fireEvent.mouseDown(row, { shiftKey: true })).toBe(false);
      expect(fireEvent.mouseDown(row)).toBe(true);
    });

    it('washes the swept rows with .verse-in-range and leaves the anchor selected', async () => {
      const { container } = await renderRows({
        selectedVerseId: 19003001,
        selectionEndVerseId: 19003002,
      });

      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0].className).toContain('verse-selected');
      expect(rows[0].className).not.toContain('verse-in-range');
      expect(rows[1].className).toContain('verse-in-range');
      expect(rows[1].className).not.toContain('verse-selected');
    });

    it('marks the selected row for assistive tech', async () => {
      const { container } = await renderRows({ selectedVerseId: 19003002 });
      const rows = container.querySelectorAll('tbody tr');
      expect(rows[0].getAttribute('aria-current')).toBeNull();
      expect(rows[1].getAttribute('aria-current')).toBe('true');
      // The row must not itself become an interactive element - it wraps the
      // verse-number buttons, and role/tabIndex here would nest controls.
      expect(rows[1].getAttribute('role')).toBeNull();
      expect((rows[1] as HTMLElement).tabIndex).toBe(-1);
    });
  });
});
