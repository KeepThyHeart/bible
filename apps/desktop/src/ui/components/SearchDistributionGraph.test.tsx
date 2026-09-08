import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SearchDistributionGraph from './SearchDistributionGraph';
import type { SearchResult } from '@bible/core';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import type { SemanticResult } from '../stores/useSearchStore';
import { IntlMessageFormat } from 'intl-messageformat';
import enUi from '../../../locales/en/ui.json';
import { SECTION_COLOR_TOKEN } from '../constants/bibleSections';

// The captions and bar labels are ICU plurals owned by the catalog, so the
// stub resolves against the real `en` catalog and formats it synchronously.
// `I18nService` loads `intl-messageformat` lazily, so its own `t()` returns the
// unformatted message on a first synchronous render - no use to an assertion
// about what the reader sees. A stub that echoed the key back would be worse
// still: it would accept a component that never passed `count` at all.
const catalog = enUi as Record<string, string>;

function stubT(key: string, params?: Record<string, unknown>): string {
  const message = catalog[key];
  if (message === undefined) return `[${key}]`;
  if (!message.includes('{')) return message;
  return String(new IntlMessageFormat(message, 'en').format(params ?? {}));
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: stubT,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

function keywordResult(
  verseId: number,
  type: SearchResult['type'] = 'exact',
): SearchResult {
  return {
    verseId,
    module: 'kjv',
    reference: String(verseId),
    text: 'text',
    matches: [],
    score: 1,
    type,
  };
}

function semanticResult(startVerseId: number, id: string): SemanticResult {
  return {
    id,
    startVerseId,
    endVerseId: startVerseId,
    reference: String(startVerseId),
    text: 'text',
    textPreview: 'text',
    similarity: 0.9,
    level: 'verse',
  } as SemanticResult;
}

/** Genesis 1:1, John 3:16, John 3:17, Revelation 22:21. */
const GEN_1_1 = 1001001;
const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;
const REV_22_21 = 66022021;

const bars = () => screen.getAllByTestId('distribution-bar');
const barFor = (bookNumber: number) =>
  bars().find(el => el.dataset.book === String(bookNumber))!;

describe('SearchDistributionGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one bar per book, all of them the same width', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    const all = bars();
    expect(all).toHaveLength(66);
    // Books 1..66 in canonical order, each cell an equal flex share. Equal
    // widths are the whole reason Obadiah is as clickable as Psalms, so the
    // flex basis is asserted rather than assumed.
    expect(all.map(el => el.dataset.book)).toEqual(
      Array.from({ length: 66 }, (_, i) => String(i + 1)),
    );
    for (const el of all) {
      expect(el.style.flex).toBe('1 1 0%');
    }
  });

  it('colours each bar by its canonical section, matching the book picker', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(GEN_1_1), keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    // Genesis is Pentateuch, John is a Gospel, Romans is Pauline (and empty).
    const fill = (bookNumber: number) =>
      barFor(bookNumber).querySelector<HTMLElement>('span')!.style.backgroundColor;

    expect(fill(1)).toContain(`--theme-${SECTION_COLOR_TOKEN.pentateuch}-rgb`);
    expect(fill(43)).toContain(`--theme-${SECTION_COLOR_TOKEN.gospels}-rgb`);
    expect(fill(45)).toContain(`--theme-${SECTION_COLOR_TOKEN.pauline}-rgb`);
  });

  it('leaves a hairline in the section hue for books with no matches', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    // 65 of the 66 books have nothing, and each one still draws.
    expect(screen.getAllByTestId('distribution-bar-empty')).toHaveLength(65);
    const obadiah = barFor(31);
    const hairline = obadiah.querySelector<HTMLElement>('span')!;
    expect(hairline.style.height).toBe('2px');
    // Not a control: nothing to select, so it must not take a tab stop.
    expect(obadiah.tagName).toBe('DIV');
    expect(obadiah).toHaveAttribute('role', 'img');
    expect(obadiah).toHaveAttribute('aria-label', 'Obadiah — no matches');
  });

  it('draws a one-match book taller than the no-match hairline', () => {
    // The floor is a % of the plot and the hairline is in px, so the two can
    // cross: at a 3% floor on a 34px plot a single match came out a pixel tall
    // - shorter than a book with no matches at all.
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        // Genesis has to dominate, or the floor never comes into play: it is
        // only the single match standing beside a big count that gets clamped.
        results={[
          keywordResult(JOHN_3_16),
          ...Array.from({ length: 20 }, (_, i) => keywordResult(GEN_1_1 + i)),
        ]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    const john = barFor(43).querySelector<HTMLElement>('span')!;
    const plotHeight = 34;
    const hairlineHeight = 2;
    const johnHeight = (parseFloat(john.style.height) / 100) * plotHeight;

    expect(johnHeight).toBeGreaterThan(hairlineHeight);
  });

  it('excludes fuzzy results from the counts but keeps stem results', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[
          keywordResult(JOHN_3_16, 'exact'),
          keywordResult(JOHN_3_17, 'stem'),
          keywordResult(GEN_1_1, 'fuzzy'),
        ]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    expect(barFor(43).dataset.count).toBe('2');
    // A fuzzy hit is a different word that looks like the query, so Genesis
    // stays empty rather than showing a match the reader never asked for.
    expect(barFor(1).dataset.count).toBe('0');
    expect(barFor(1).tagName).toBe('DIV');

    expect(screen.getByTestId('distribution-caption')).toHaveTextContent(
      '2 matches in 1 book.',
    );
    expect(screen.getByTestId('distribution-fuzzy-note')).toHaveTextContent(
      'Approximate matches are not counted.',
    );
  });

  it('omits the fuzzy note when nothing was excluded', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('distribution-fuzzy-note')).not.toBeInTheDocument();
  });

  it('says so in the caption when the result set was truncated by the fetch cap', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(GEN_1_1), keywordResult(JOHN_3_16)]}
        isCapped
        onSelectBook={vi.fn()}
      />,
    );

    const caption = screen.getByTestId('distribution-caption');
    expect(caption).toHaveTextContent('First 2 matches in 2 books');
    expect(caption).toHaveTextContent('this is not a full count');
  });

  it('states a plain count when the set is complete', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(GEN_1_1), keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    const caption = screen.getByTestId('distribution-caption');
    expect(caption).toHaveTextContent('2 matches in 2 books.');
    expect(caption).not.toHaveTextContent('not a full count');
  });

  it('reports a book and its count on hover, on focus, and to a screen reader', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16), keywordResult(JOHN_3_17)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    const john = barFor(43);
    expect(john).toHaveAttribute('aria-label', 'John — 2 matches');

    expect(screen.queryByTestId('distribution-tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(john);
    expect(screen.getByTestId('distribution-tooltip')).toHaveTextContent('John — 2 matches');
    fireEvent.mouseLeave(john);
    expect(screen.queryByTestId('distribution-tooltip')).not.toBeInTheDocument();

    // Keyboard focus raises the same tip - a bar reached by Tab must say what
    // it is before it is activated.
    fireEvent.focus(john);
    expect(screen.getByTestId('distribution-tooltip')).toHaveTextContent('John — 2 matches');
  });

  it('names an empty book on hover too', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(barFor(31));
    expect(screen.getByTestId('distribution-tooltip')).toHaveTextContent('Obadiah — no matches');
  });

  it('keeps an edge book\'s tooltip inside the chart', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(GEN_1_1), keywordResult(REV_22_21)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(barFor(1));
    // Pinned to the leading edge rather than centred on a bar that is already
    // at the edge, which would hang the tip outside the pane.
    expect(screen.getByTestId('distribution-tooltip').style.insetInlineStart).toBe('0px');
    fireEvent.mouseLeave(barFor(1));

    fireEvent.mouseEnter(barFor(66));
    expect(screen.getByTestId('distribution-tooltip').style.insetInlineEnd).toBe('0px');
  });

  it('reports the clicked book, and only for books that have matches', () => {
    const onSelectBook = vi.fn();
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={onSelectBook}
      />,
    );

    fireEvent.click(barFor(43));
    expect(onSelectBook).toHaveBeenCalledWith(43);

    onSelectBook.mockClear();
    fireEvent.click(barFor(31));
    expect(onSelectBook).not.toHaveBeenCalled();
  });

  it('marks the testament break between Malachi and Matthew', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(JOHN_3_16)]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );

    expect(screen.getByTestId('testament-divider')).toBeInTheDocument();
    // The two testament labels sit on the same flex proportions as the bars,
    // so "New Testament" starts under Matthew rather than floating at the end.
    const ot = screen.getByText('Old Testament');
    const nt = screen.getByText('New Testament');
    expect(ot.style.flex).toBe('39 1 0%');
    expect(nt.style.flex).toBe('27 1 0%');
  });

  it('renders nothing when no result survives the count', () => {
    const { container } = renderWithProviders(
      <SearchDistributionGraph
        mode="keyword"
        results={[keywordResult(GEN_1_1, 'fuzzy')]}
        isCapped={false}
        onSelectBook={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the semantic chart as the retrieved results rather than a tally', () => {
    renderWithProviders(
      <SearchDistributionGraph
        mode="semantic"
        results={[semanticResult(JOHN_3_16, 'a'), semanticResult(GEN_1_1, 'b')]}
        onSelectBook={vi.fn()}
      />,
    );

    expect(barFor(43).dataset.count).toBe('1');
    expect(barFor(1).dataset.count).toBe('1');
    const caption = screen.getByTestId('distribution-caption');
    expect(caption).toHaveTextContent('2 matches shown, in 2 books');
    expect(caption).toHaveTextContent('not a full count');
  });
});
