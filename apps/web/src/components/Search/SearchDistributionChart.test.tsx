/**
 * Component tests for SearchDistributionChart.
 *
 * The real `getBibleSection` from @bible/core is used on purpose — the point of
 * the section colouring is that it agrees with the canonical mapping, so mocking
 * it would test nothing. `getLocalizedBookName` is stubbed to keep the labels
 * independent of the i18n catalogs.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import type { SearchResultData } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('../../utils/bookNames', () => ({
  getLocalizedBookName: (n: number) => `Book ${n}`,
}));

import { SearchDistributionChart } from './SearchDistributionChart';

/** Build a result in `book`, with a distinct verse so ids stay unique. */
function result(book: number, verse: number, type: SearchResultData['type'] = 'exact'): SearchResultData {
  return {
    verseId: book * 1000000 + 1000 + verse,
    reference: `Book ${book} 1:${verse}`,
    text: 'text',
    module: 'KJV',
    type,
  };
}

function renderChart(props: Partial<Parameters<typeof SearchDistributionChart>[0]> = {}) {
  const onSelectBook = vi.fn();
  const view = render(
    <SearchDistributionChart
      results={props.results ?? [result(1, 1)]}
      mode={props.mode ?? 'keyword'}
      truncated={props.truncated ?? false}
      onSelectBook={props.onSelectBook ?? onSelectBook}
    />,
  );
  return { ...view, onSelectBook: props.onSelectBook ?? onSelectBook };
}

function cells(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.search-distribution__cell'));
}

describe('SearchDistributionChart', () => {
  // ------------------------------------------------------------------
  // Shape of the plot
  // ------------------------------------------------------------------
  it('renders one cell per book, all 66, in canonical order', () => {
    const { container } = renderChart({ results: [result(43, 16)] });
    const list = cells(container);
    expect(list.length).toBe(66);
    expect(list.map(c => Number(c.dataset.book))).toEqual(
      Array.from({ length: 66 }, (_, i) => i + 1),
    );
  });

  it('gives every cell the same width by leaving sizing to the flex row', () => {
    // Equal widths are the whole point of the layout: Obadiah has to be as
    // clickable as Psalms. That is `flex: 1 1 0` in CSS, which only holds if no
    // cell carries a width of its own — the inline style is reserved for bar
    // height.
    const { container } = renderChart({ results: [result(1, 1), result(19, 1)] });
    for (const cell of cells(container)) {
      expect(cell.style.width).toBe('');
      expect(cell.style.flex).toBe('');
      expect(cell.className).toContain('search-distribution__cell');
    }
  });

  it('splits the testaments with a break between Malachi and Matthew', () => {
    const { container } = renderChart();
    const plot = container.querySelector('.search-distribution__plot')!;
    const children = Array.from(plot.children).filter(el => !el.classList.contains('search-distribution__tip'));
    const breakIndex = children.findIndex(el => el.classList.contains('search-distribution__break'));
    expect(breakIndex).toBe(39); // after the 39 OT cells
    expect((children[38] as HTMLElement).dataset.book).toBe('39');
    expect((children[40] as HTMLElement).dataset.book).toBe('40');
  });

  it('lays the testament labels out on the same 39 / break / 27 proportions', () => {
    const { container } = renderChart();
    const labels = container.querySelectorAll<HTMLElement>('.search-distribution__testament');
    expect(labels.length).toBe(2);
    expect(labels[0].style.flex).toBe('39 1 0px');
    expect(labels[1].style.flex).toBe('27 1 0px');
    // The same break element sits between them, so "New Testament" starts under
    // Matthew rather than drifting to the right-hand end.
    expect(
      container.querySelectorAll('.search-distribution__testaments .search-distribution__break').length,
    ).toBe(1);
  });

  // ------------------------------------------------------------------
  // Colour
  // ------------------------------------------------------------------
  it('colours each bar by its canonical section', () => {
    const { container } = renderChart({ results: [result(1, 1)] });
    const barFor = (book: number) =>
      container.querySelector(`[data-book="${book}"] .search-distribution__bar`)!.className;

    expect(barFor(1)).toContain('search-distribution__bar--pentateuch');   // Genesis
    expect(barFor(19)).toContain('search-distribution__bar--wisdom');      // Psalms
    expect(barFor(39)).toContain('search-distribution__bar--minor-prophets'); // Malachi
    expect(barFor(40)).toContain('search-distribution__bar--gospels');     // Matthew
    expect(barFor(44)).toContain('search-distribution__bar--acts');        // Acts
    expect(barFor(66)).toContain('search-distribution__bar--revelation');  // Revelation
  });

  // ------------------------------------------------------------------
  // Heights, and the empty-book hairline
  // ------------------------------------------------------------------
  it('scales bar height to the busiest book and floors a single match', () => {
    const results = [
      ...Array.from({ length: 10 }, (_, i) => result(19, i + 1)), // Psalms ×10
      result(1, 1),                                               // Genesis ×1
    ];
    const { container } = renderChart({ results });
    const height = (book: number) =>
      container.querySelector<HTMLElement>(`[data-book="${book}"] .search-distribution__bar`)!.style.height;

    expect(height(19)).toBe('100%');
    // 1/10 would be 10%, below the floor that keeps one match visible next to a
    // ten-match neighbour.
    expect(height(1)).toBe('12%');
  });

  it('draws a hairline in the section hue for books with no matches', () => {
    const { container } = renderChart({ results: [result(1, 1)] });
    const obadiah = container.querySelector(`[data-book="31"] .search-distribution__bar`)!;
    expect(obadiah.className).toContain('search-distribution__bar--empty');
    // Section colour is kept, so the canon's divisions read across the full width.
    expect(obadiah.className).toContain('search-distribution__bar--minor-prophets');
    // Height comes from the stylesheet's 2px, not an inline percentage.
    expect((obadiah as HTMLElement).style.height).toBe('');
  });

  // ------------------------------------------------------------------
  // Fuzzy exclusion
  // ------------------------------------------------------------------
  it('excludes fuzzy results from the counts in keyword mode', () => {
    const results = [
      result(1, 1, 'exact'),
      result(1, 2, 'stem'),   // a real occurrence — counts
      result(1, 3, 'fuzzy'),  // a close spelling — does not
      result(1, 4, 'fuzzy'),
    ];
    const { container } = renderChart({ results, mode: 'keyword' });
    const genesis = container.querySelector(`[data-book="1"]`)!;
    expect(genesis.getAttribute('aria-label')).toContain('"count":2');
    expect(container.querySelector('.search-distribution__caption')!.textContent).toContain('"count":2');
  });

  it('does not treat a semantic retrieval level as a match type', () => {
    // Semantic rows carry 'verse' | 'paragraph' | 'chapter' in `type`. None of
    // them is excluded, and the filter must not fire on them by accident.
    const results = [
      result(40, 1, 'verse'),
      result(40, 2, 'paragraph'),
      result(40, 3, 'chapter'),
    ];
    const { container } = renderChart({ results, mode: 'semantic' });
    expect(container.querySelector(`[data-book="40"]`)!.getAttribute('aria-label')).toContain('"count":3');
  });

  it('renders nothing when every result was excluded', () => {
    const { container } = renderChart({ results: [result(1, 1, 'fuzzy')], mode: 'keyword' });
    expect(container.querySelector('.search-distribution')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Selection
  // ------------------------------------------------------------------
  it('selects the book\'s first counted match when a bar is clicked', () => {
    const first = result(19, 23, 'exact');
    const second = result(19, 24, 'exact');
    const { container, onSelectBook } = renderChart({ results: [result(1, 1), first, second] });

    fireEvent.click(container.querySelector(`[data-book="19"]`)!);
    expect(onSelectBook).toHaveBeenCalledTimes(1);
    expect(onSelectBook).toHaveBeenCalledWith(first);
  });

  it('never selects a fuzzy result, even when it comes first in the list', () => {
    const fuzzy = result(19, 1, 'fuzzy');
    const exact = result(19, 2, 'exact');
    const { container, onSelectBook } = renderChart({ results: [fuzzy, exact] });

    fireEvent.click(container.querySelector(`[data-book="19"]`)!);
    expect(onSelectBook).toHaveBeenCalledWith(exact);
  });

  it('makes books with matches buttons and books without them non-interactive', () => {
    const { container, onSelectBook } = renderChart({ results: [result(1, 1)] });

    const genesis = container.querySelector(`[data-book="1"]`)!;
    expect(genesis.tagName).toBe('BUTTON');

    const obadiah = container.querySelector(`[data-book="31"]`)!;
    expect(obadiah.tagName).not.toBe('BUTTON');
    expect(obadiah.getAttribute('role')).toBe('img');
    fireEvent.click(obadiah);
    expect(onSelectBook).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Naming: hover and focus, matched and empty alike
  // ------------------------------------------------------------------
  it('names every bar, including the empty ones', () => {
    const { container } = renderChart({ results: [result(1, 1)] });
    expect(container.querySelector(`[data-book="1"]`)!.getAttribute('aria-label'))
      .toBe('search.distribution.bar:{"book":"Book 1","count":1}');
    expect(container.querySelector(`[data-book="31"]`)!.getAttribute('aria-label'))
      .toBe('search.distribution.barEmpty:{"book":"Book 31"}');
  });

  it('shows the tip on hover and on keyboard focus', () => {
    const { container } = renderChart({ results: [result(1, 1)] });
    expect(container.querySelector('.search-distribution__tip')).toBeNull();

    fireEvent.mouseEnter(container.querySelector(`[data-book="31"]`)!);
    expect(container.querySelector('.search-distribution__tip')!.textContent)
      .toContain('search.distribution.barEmpty');

    fireEvent.focus(container.querySelector(`[data-book="1"]`)!);
    expect(container.querySelector('.search-distribution__tip')!.textContent)
      .toContain('search.distribution.bar:');
  });

  // ------------------------------------------------------------------
  // Caption
  // ------------------------------------------------------------------
  it('says so when the result set was cut short by a fetch limit', () => {
    const { container } = renderChart({ results: [result(1, 1)], truncated: true });
    expect(container.querySelector('.search-distribution__caption')!.textContent)
      .toContain('search.distribution.captionCapped');
  });

  it('omits the capped notice when the whole result set is present', () => {
    const { container } = renderChart({ results: [result(1, 1)], truncated: false });
    expect(container.querySelector('.search-distribution__caption')!.textContent)
      .not.toContain('search.distribution.captionCapped');
  });

  it('labels a semantic chart as a retrieval, not a Bible-wide tally', () => {
    const { container } = renderChart({ results: [result(1, 1, 'verse')], mode: 'semantic' });
    expect(container.querySelector('.search-distribution__caption')!.textContent)
      .toContain('search.distribution.captionSemantic');
  });
});
