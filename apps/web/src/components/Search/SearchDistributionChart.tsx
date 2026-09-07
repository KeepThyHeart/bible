import { useState, useMemo, useRef, useLayoutEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { getBibleSection } from '@bible/core/browser';
import { getLocalizedBookName } from '../../utils/bookNames';
import { parseVerseId } from '../../utils/verseId';
import type { SearchResultData } from '../../types';

/** Books in the Protestant canon. The chart always draws all of them. */
const BOOK_COUNT = 66;

/** Last book of the Old Testament — the testament break goes after it. */
const LAST_OT_BOOK = 39;

/**
 * Floor for a book that has at least one match, as a percentage of the plot.
 *
 * Without it a single hit next to a 15-hit neighbour is a sub-pixel smear. The
 * floor has to clear the empty-book hairline (2px of a ~34px plot, so ~6%) by
 * enough that "one match" and "no matches" are never confusable at a glance —
 * hence 12% rather than the ~3% that would be needed merely to round up to a
 * visible pixel.
 */
const MIN_BAR_PERCENT = 12;

export type SearchDistributionMode = 'keyword' | 'semantic' | 'strongs';

interface SearchDistributionChartProps {
  /** The rows the panel is currently holding. They supply the click targets, and
   *  the counts too when `bookCounts` is absent. */
  results: SearchResultData[];
  /**
   * Matches per book across the *whole* search, when the search can report it —
   * keyword search does, from the server, so the bars describe every match
   * rather than the first page of rows. Absent for the modes that cannot, which
   * fall back to counting `results`.
   *
   * A book can therefore have a bar and no loaded row behind it. Such a bar is
   * still a button: selecting it is what makes the panel go and fetch the rest.
   */
  bookCounts?: Record<number, number>;
  /**
   * Which search produced `results`. This gates the fuzzy exclusion: only
   * keyword-family results carry a `MatchType` in `type`, while a semantic row's
   * `type` is its retrieval level ('verse' | 'paragraph' | 'chapter'), which
   * must never be read as a match type.
   */
  mode: SearchDistributionMode;
  /** Whether a fetch limit cut the result set short — see `searchStore.resultsTruncated`. */
  truncated: boolean;
  /**
   * Called with the clicked book, and with its first counted result when one is
   * loaded. Deliberately not a navigation: a mis-click on a 5px bar should cost
   * nothing more than moving the selection in the list beside it.
   */
  onSelectBook: (bookNumber: number, first?: SearchResultData) => void;
}

interface BookBar {
  bookNumber: number;
  name: string;
  section: string;
  count: number;
  /**
   * First counted result in this book among the loaded rows. Undefined when the
   * book has no matches at all — but also when it has matches the panel has not
   * fetched yet, which is why a bar's interactivity keys off `count`.
   */
  first?: SearchResultData;
}

/**
 * A row of 66 equal-width bars, one per book, showing where the search results
 * currently in the panel fall across the canon.
 *
 * Equal widths rather than width-by-length: the bar is a click target as much
 * as a datum, and Obadiah has to be as reachable as Psalms. Height carries the
 * count. Colour carries the canonical section, taken from the same scheme as the
 * passage picker (see `_bible-sections.scss`) — unlabelled on purpose, because a
 * legend costs a row of vertical space and its swatches would not line up with
 * the bars they describe. The tooltip names the bar instead, on hover *and* on
 * keyboard focus, for empty books as well as full ones.
 */
export function SearchDistributionChart({ results, bookCounts, mode, truncated, onSelectBook }: SearchDistributionChartProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const { bars, max, total } = useMemo(() => {
    // Approximate spellings are excluded: they are not occurrences of the term
    // the reader searched for, so counting them would overstate the book. Stem
    // matches (a different form of the same word) are real and do count.
    // Keyed off the mode, never off `type` alone — see the `mode` prop.
    const counted = mode === 'semantic'
      ? results
      : results.filter(r => r.type !== 'fuzzy');

    const byBook = new Map<number, SearchResultData[]>();
    for (const r of counted) {
      const { bookNumber } = parseVerseId(r.verseId);
      if (bookNumber < 1 || bookNumber > BOOK_COUNT) continue;
      const list = byBook.get(bookNumber);
      if (list) list.push(r);
      else byBook.set(bookNumber, [r]);
    }

    const built: BookBar[] = [];
    for (let bookNumber = 1; bookNumber <= BOOK_COUNT; bookNumber++) {
      const hits = byBook.get(bookNumber);
      built.push({
        bookNumber,
        name: getLocalizedBookName(bookNumber),
        section: getBibleSection(bookNumber),
        // The server's count when there is one, because the loaded rows are only
        // the first page of a longer list; never below what is actually loaded,
        // so a bar can't claim fewer matches than the panel is showing.
        count: bookCounts ? Math.max(bookCounts[bookNumber] ?? 0, hits?.length ?? 0) : hits?.length ?? 0,
        first: hits?.[0],
      });
    }

    return {
      bars: built,
      max: built.reduce((m, b) => Math.max(m, b.count), 0),
      total: built.reduce((sum, b) => sum + b.count, 0),
    };
  }, [results, bookCounts, mode]);

  // Keep the tip inside the plot. A bar at either end would otherwise centre its
  // tip half outside the panel and get clipped by the scroll container.
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const tip = tipRef.current;
    if (!plot || !tip || active === null) return;
    const cell = plot.querySelector<HTMLElement>(`[data-book="${active}"]`);
    if (!cell) return;
    const plotWidth = plot.clientWidth;
    const tipWidth = tip.offsetWidth;
    // Zero in jsdom and before first layout; leave the CSS default in place.
    if (plotWidth <= 0 || tipWidth <= 0) return;
    const centre = cell.offsetLeft + cell.offsetWidth / 2;
    const left = Math.min(Math.max(centre - tipWidth / 2, 0), Math.max(0, plotWidth - tipWidth));
    tip.style.left = `${left}px`;
  }, [active]);

  if (total === 0) return null;

  const activeBar = active === null ? undefined : bars[active - 1];

  const caption = mode === 'semantic'
    ? t('search.distribution.captionSemantic', { count: total })
    : mode === 'strongs'
      ? t('search.distribution.captionStrongs', { count: total })
      : t('search.distribution.captionKeyword', { count: total });

  return (
    <div class="search-distribution" data-testid="search-distribution">
      <div
        class="search-distribution__plot"
        ref={plotRef}
        role="group"
        aria-label={t('search.distribution.label')}
        onMouseLeave={() => setActive(null)}
      >
        {bars.flatMap((bar) => {
          const label = bar.count > 0
            ? t('search.distribution.bar', { book: bar.name, count: bar.count })
            : t('search.distribution.barEmpty', { book: bar.name });
          const height = bar.count > 0
            ? Math.max(MIN_BAR_PERCENT, (bar.count / max) * 100)
            : 0;
          const fill = (
            <span
              class={`search-distribution__bar search-distribution__bar--${bar.section}${bar.count > 0 ? '' : ' search-distribution__bar--empty'}`}
              style={bar.count > 0 ? { height: `${height}%` } : undefined}
            />
          );
          const cellClass = `search-distribution__cell${active === bar.bookNumber ? ' search-distribution__cell--active' : ''}`;
          const show = () => setActive(bar.bookNumber);

          // A book with no matches has nothing to scroll to, so it is not a
          // control — but it still announces itself, which is the whole point of
          // drawing the hairline in the first place. A book that has matches is
          // always a control, loaded or not: the panel fetches what it needs.
          const cell = bar.count > 0 ? (
            <button
              key={bar.bookNumber}
              type="button"
              data-book={bar.bookNumber}
              class={cellClass}
              aria-label={label}
              onClick={() => onSelectBook(bar.bookNumber, bar.first)}
              onMouseEnter={show}
              onFocus={show}
              onBlur={() => setActive(null)}
            >
              {fill}
            </button>
          ) : (
            <span
              key={bar.bookNumber}
              data-book={bar.bookNumber}
              class={`${cellClass} search-distribution__cell--empty`}
              role="img"
              aria-label={label}
              onMouseEnter={show}
            >
              {fill}
            </span>
          );

          // The testament break: a gap with a dashed rule between Malachi and
          // Matthew. It lives in the same flex row as the bars so the label row
          // below can mirror its width exactly.
          return bar.bookNumber === LAST_OT_BOOK
            ? [cell, (
                <span
                  key="testament-break"
                  class="search-distribution__break"
                  aria-hidden="true"
                  onMouseEnter={() => setActive(null)}
                />
              )]
            : [cell];
        })}
        {activeBar && (
          <div class="search-distribution__tip" ref={tipRef} aria-hidden="true" data-testid="search-distribution-tip">
            {activeBar.count > 0
              ? t('search.distribution.bar', { book: activeBar.name, count: activeBar.count })
              : t('search.distribution.barEmpty', { book: activeBar.name })}
          </div>
        )}
      </div>

      {/* Same flex proportions as the plot (39 / break / 27), so "New Testament"
          starts under Matthew and marks the division rather than drifting to the
          right-hand end of the row. */}
      <div class="search-distribution__testaments" aria-hidden="true">
        <span class="search-distribution__testament" style={{ flex: `${LAST_OT_BOOK} 1 0` }}>
          {t('search.distribution.oldTestament')}
        </span>
        <span class="search-distribution__break" />
        <span class="search-distribution__testament" style={{ flex: `${BOOK_COUNT - LAST_OT_BOOK} 1 0` }}>
          {t('search.distribution.newTestament')}
        </span>
      </div>

      <div class="search-distribution__caption">
        {caption}
        {/* Two different shortfalls. Counting the loaded rows means the Bible
            holds matches the chart knows nothing about; counting the whole
            search means it knows about all of them up to the server's ceiling,
            and only a term busier than that is short. */}
        {truncated && (
          <> {bookCounts
            ? t('search.distribution.captionCeiling', { count: total })
            : t('search.distribution.captionCapped')}</>
        )}
      </div>
    </div>
  );
}
