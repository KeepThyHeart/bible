/**
 * SearchDistributionGraph - where the matches fell across the canon.
 *
 * One row of 66 bars above the search results, inside the pane's scroll area.
 * The design rules it follows, and why:
 *
 *  - **Equal widths.** Every book gets the same slice, so Obadiah is exactly as
 *    easy to hit as Psalms. Width proportional to book length (the previous
 *    version of this file) made the one-chapter books unclickable slivers and
 *    encoded a fact - how long a book is - that nobody came here to read.
 *  - **Height is the raw match count**, scaled to the largest book, with a
 *    floor of `MIN_BAR_PERCENT` so a single match is still a visible mark
 *    beside a fifteen-match neighbour.
 *  - **Colour is the canonical section**, from the same `SECTION_COLOR_TOKEN`
 *    the book picker uses, so a book is the same hue wherever it is met.
 *    Books with no matches keep a hairline in their own section's hue, so the
 *    shape of the canon and its divisions read across the whole width instead
 *    of the chart dissolving into gaps.
 *  - **A click selects, it does not navigate.** It highlights that book's
 *    first match in the list below and scrolls it into view; the Bible pane
 *    does not move. A mis-click on a 6px-wide target must cost nothing.
 *  - **Every bar is named**, including the empty ones - hover and keyboard
 *    focus both raise the tooltip, and the same text is the `aria-label`.
 *
 * The counting lives here rather than in the pane because what is counted is
 * part of the chart's meaning: fuzzy results are excluded (they are close
 * spellings, not occurrences of the word), stem results are not.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { VerseIdHelper } from '@bible/core';
import type { SearchResult } from '@bible/core/types/search';
import { useI18n } from '../contexts/useI18n';
import type { SemanticResult } from '../stores/useSearchStore';
import { sectionColorToken } from '../constants/bibleSections';
import { BOOK_NAMES } from '../constants/bibleBooks';
import { bibleAPI } from '../services/electronAPI';
import { loadBookNamesCache, getBookNameFromCache } from '../utils/verseReference';

/** Books 1-66, standard English versification - the only scheme this app has. */
const BOOK_COUNT = 66;
/** Last book of the Old Testament. Malachi | Matthew is where the rule goes. */
const LAST_OT_BOOK = 39;
/** Plot height in px. Tall enough to rank, short enough to sit above a list. */
const PLOT_HEIGHT = 34;
/**
 * Shortest bar drawn for a book with at least one match, as a % of the plot.
 *
 * It has to clear `EMPTY_BAR_HEIGHT`, not merely be visible: at 3% of a 34px
 * plot a one-match book came out a pixel tall - *shorter* than the hairline
 * drawn for a book with no matches at all, which read as the exact opposite of
 * what it meant. 12% of 34px is 4px, comfortably above the 2px hairline.
 */
const MIN_BAR_PERCENT = 12;
/** Height in px of the hairline drawn for a book with no matches. */
const EMPTY_BAR_HEIGHT = 2;
/** Width of the testament break, in px. */
const TESTAMENT_GAP = 12;
/**
 * How close to an edge a bar has to be before its tooltip stops being centred
 * on it and pins to that edge of the chart instead. Keeps the tip inside the
 * pane without measuring anything - jsdom has no layout, and neither does the
 * first paint.
 */
const EDGE_ANCHOR_BOOKS = 10;

type DistributionProps =
  | {
      mode: 'keyword';
      results: SearchResult[];
      /**
       * The result set came back full against the fetch cap, so it is a page
       * of the matches rather than all of them. See `SearchResultsPane`.
       */
      isCapped: boolean;
      onSelectBook: (bookNumber: number) => void;
    }
  | {
      mode: 'semantic';
      results: SemanticResult[];
      onSelectBook: (bookNumber: number) => void;
    };

interface BookBar {
  bookNumber: number;
  count: number;
}

/**
 * Match counts per book number.
 *
 * Keyword mode drops `type === 'fuzzy'`: a fuzzy hit is a *different* word that
 * looks like the query, so counting it would inflate the bar with something the
 * reader did not search for. `'stem'` hits are real occurrences of the word in
 * another inflection and are counted.
 */
function countByBook(props: DistributionProps): Map<number, number> {
  const counts = new Map<number, number>();
  const bump = (verseId: number): void => {
    const { bookNumber } = VerseIdHelper.parse(verseId);
    if (bookNumber < 1 || bookNumber > BOOK_COUNT) return;
    counts.set(bookNumber, (counts.get(bookNumber) ?? 0) + 1);
  };

  if (props.mode === 'keyword') {
    for (const result of props.results) {
      if (result.type === 'fuzzy') continue;
      bump(result.verseId);
    }
  } else {
    for (const result of props.results) {
      bump(result.startVerseId);
    }
  }
  return counts;
}

const SearchDistributionGraph: React.FC<DistributionProps> = (props) => {
  const { t } = useI18n();
  const { onSelectBook } = props;

  // Localized book names come from the module database via the same cache the
  // verse-preview tooltip uses. Until it resolves (and if it never does - the
  // loader swallows its own failure and leaves an empty cache) the English
  // table is the fallback, so a bar is never nameless.
  const [bookNames, setBookNames] = useState<Record<number, string>>(BOOK_NAMES);
  useEffect(() => {
    let cancelled = false;
    void loadBookNamesCache(bibleAPI).then(() => {
      if (cancelled) return;
      const resolved: Record<number, string> = {};
      let differs = false;
      for (let n = 1; n <= BOOK_COUNT; n += 1) {
        const cached = getBookNameFromCache(n);
        resolved[n] = cached === 'Unknown' ? (BOOK_NAMES[n] ?? String(n)) : cached;
        if (resolved[n] !== BOOK_NAMES[n]) differs = true;
      }
      // No re-render when the module's names are the English ones anyway -
      // which is also what happens when the cache could not be loaded at all.
      if (differs) setBookNames(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bookName = (bookNumber: number): string => bookNames[bookNumber] ?? String(bookNumber);

  const counts = useMemo(
    () => countByBook(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.mode, props.results],
  );

  const bars: BookBar[] = useMemo(
    () =>
      Array.from({ length: BOOK_COUNT }, (_, i) => ({
        bookNumber: i + 1,
        count: counts.get(i + 1) ?? 0,
      })),
    [counts],
  );

  const maxCount = useMemo(() => bars.reduce((m, b) => Math.max(m, b.count), 0), [bars]);
  const countedTotal = useMemo(() => bars.reduce((sum, b) => sum + b.count, 0), [bars]);
  const booksWithMatches = useMemo(() => bars.filter((b) => b.count > 0).length, [bars]);

  const [hoveredBook, setHoveredBook] = useState<number | null>(null);

  // Nothing counted means nothing to plot. Reachable in keyword mode when every
  // hit was fuzzy: a wall of 66 hairlines would say "no matches anywhere" above
  // a list that plainly has some.
  if (countedTotal === 0) return null;

  const fuzzyExcluded =
    props.mode === 'keyword' && props.results.some((r) => r.type === 'fuzzy');

  const caption =
    props.mode === 'semantic'
      ? t('searchDistributionGraph.captionSemantic', {
          count: countedTotal,
          books: booksWithMatches,
        })
      : props.isCapped
        ? t('searchDistributionGraph.captionCapped', {
            count: countedTotal,
            books: booksWithMatches,
          })
        : t('searchDistributionGraph.captionComplete', {
            count: countedTotal,
            books: booksWithMatches,
          });

  const labelFor = (bar: BookBar): string =>
    bar.count > 0
      ? t('searchDistributionGraph.bookMatches', {
          book: bookName(bar.bookNumber),
          count: bar.count,
        })
      : t('searchDistributionGraph.bookNoMatches', { book: bookName(bar.bookNumber) });

  const hovered = hoveredBook === null ? null : bars[hoveredBook - 1];

  const renderBar = (bar: BookBar): React.ReactElement => {
    const token = sectionColorToken(bar.bookNumber);
    const label = labelFor(bar);
    const show = (): void => setHoveredBook(bar.bookNumber);
    const hide = (): void => setHoveredBook((current) => (current === bar.bookNumber ? null : current));

    const fill =
      bar.count > 0 ? (
        <span
          aria-hidden="true"
          data-testid="distribution-bar-fill"
          className="block w-full rounded-t-[1px]"
          style={{
            height: `${Math.max(MIN_BAR_PERCENT, (bar.count / maxCount) * 100)}%`,
            backgroundColor: `rgb(var(--theme-${token}-rgb) / 0.85)`,
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          data-testid="distribution-bar-empty"
          className="block w-full"
          style={{
            height: `${EMPTY_BAR_HEIGHT}px`,
            backgroundColor: `rgb(var(--theme-${token}-rgb) / 0.35)`,
          }}
        />
      );

    // Equal widths: every cell is `flex: 1 1 0%` inside a testament segment
    // whose own grow factor is its book count, so all 66 come out the same.
    const cellStyle: React.CSSProperties = { flex: '1 1 0%', minWidth: 0 };

    // A book with no matches has nothing to select, so it is not a control -
    // making it focusable would put 40-odd dead stops in the tab order. It
    // still carries its name for a screen reader.
    if (bar.count === 0) {
      return (
        <div
          key={bar.bookNumber}
          role="img"
          aria-label={label}
          data-testid="distribution-bar"
          data-book={bar.bookNumber}
          data-count={0}
          className="h-full flex items-end px-px"
          style={cellStyle}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {fill}
        </div>
      );
    }

    return (
      <button
        key={bar.bookNumber}
        type="button"
        aria-label={label}
        data-testid="distribution-bar"
        data-book={bar.bookNumber}
        data-count={bar.count}
        // `transition-opacity` is safe under `prefers-reduced-motion`: the
        // global rule in globals.css zeroes every transition duration.
        className="h-full flex items-end px-px cursor-pointer opacity-90 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        style={cellStyle}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => onSelectBook(bar.bookNumber)}
      >
        {fill}
      </button>
    );
  };

  // Tooltip placement without measurement: centred on its bar, except near
  // either end where it pins to that edge of the chart so it cannot spill out
  // of the pane.
  const tipStyle = (): React.CSSProperties => {
    if (hoveredBook === null) return {};
    if (hoveredBook <= EDGE_ANCHOR_BOOKS) return { insetInlineStart: '0px' };
    if (hoveredBook > BOOK_COUNT - EDGE_ANCHOR_BOOKS) return { insetInlineEnd: '0px' };
    return {
      insetInlineStart: `${((hoveredBook - 0.5) / BOOK_COUNT) * 100}%`,
      transform: 'translateX(-50%)',
    };
  };

  return (
    <div
      className="px-md pt-sm pb-xs border-b border-border"
      data-testid="search-distribution"
    >
      <div className="relative">
        {hovered && (
          <div
            role="tooltip"
            data-testid="distribution-tooltip"
            className="absolute bottom-full mb-1 z-10 px-2 py-1 rounded border border-border bg-surface-elevated text-text-primary shadow-lg text-xs whitespace-nowrap pointer-events-none"
            style={tipStyle()}
          >
            {labelFor(hovered)}
          </div>
        )}

        <div
          className="flex items-end"
          style={{ height: `${PLOT_HEIGHT}px` }}
          role="group"
          aria-label={t('searchDistributionGraph.heading')}
        >
          <div className="h-full flex items-end" style={{ flex: `${LAST_OT_BOOK} 1 0%`, minWidth: 0 }}>
            {bars.slice(0, LAST_OT_BOOK).map(renderBar)}
          </div>
          {/* Testament break: a gap with a dashed rule, between Malachi and Matthew. */}
          <div
            aria-hidden="true"
            data-testid="testament-divider"
            className="h-full flex justify-center"
            style={{ flex: `0 0 ${TESTAMENT_GAP}px` }}
          >
            <span className="h-full border-s border-dashed border-border" />
          </div>
          <div
            className="h-full flex items-end"
            style={{ flex: `${BOOK_COUNT - LAST_OT_BOOK} 1 0%`, minWidth: 0 }}
          >
            {bars.slice(LAST_OT_BOOK).map(renderBar)}
          </div>
        </div>
      </div>

      {/* Testament labels, on the same flex proportions as the bars, so "New
          Testament" starts under Matthew and marks the division rather than
          floating at the far end of the row. */}
      <div className="flex text-[10px] uppercase tracking-wide text-text-muted mt-1">
        <div style={{ flex: `${LAST_OT_BOOK} 1 0%`, minWidth: 0 }} className="truncate">
          {t('searchDistributionGraph.oldTestament')}
        </div>
        <div aria-hidden="true" style={{ flex: `0 0 ${TESTAMENT_GAP}px` }} />
        <div style={{ flex: `${BOOK_COUNT - LAST_OT_BOOK} 1 0%`, minWidth: 0 }} className="truncate">
          {t('searchDistributionGraph.newTestament')}
        </div>
      </div>

      <div className="text-xs text-text-secondary mt-1" data-testid="distribution-caption">
        {caption}
        {fuzzyExcluded && (
          <span className="ms-1" data-testid="distribution-fuzzy-note">
            {t('searchDistributionGraph.fuzzyExcludedNote')}
          </span>
        )}
      </div>
    </div>
  );
};

export default SearchDistributionGraph;
