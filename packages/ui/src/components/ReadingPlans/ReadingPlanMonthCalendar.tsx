/**
 * ReadingPlanMonthCalendar: dates of a plan as a grid, a whole month or (`size="week"`) one row of seven larger
 * blocks. Each date is tinted by its state with a small mark under the number (✓ read, ◐ partly, ! missed, • to read,
 * – rest); today is ringed in the accent colour and the selected date in the text colour. Clicking a date (or the
 * arrow keys, Home / End, Page Up / Page Down for the previous / next page) selects it; the caller shows that date's
 * readings. Stateless; the cells come from `monthCalendar()` in core, or `agenda()` for a week.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ReadingPlans } from '@bible/core/browser';

export interface ReadingPlanMonthCalendarLabels {
  /** Accessible name of the grid. */
  grid: string;
  previousMonth: string;
  nextMonth: string;
  /** The "go to today" button. */
  thisMonth: string;
  today: string;
  /** "1 reading" / "3 readings": the readings on a date (from one or more plans), for its accessible name. */
  entries: (entries: readonly ReadingPlans.AgendaEntry[]) => string;
  states: Record<ReadingPlans.CalendarDay['state'], string>;
}

export const DEFAULT_READING_PLAN_MONTH_CALENDAR_LABELS: ReadingPlanMonthCalendarLabels = {
  grid: 'Reading calendar',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  thisMonth: 'Today',
  today: 'today',
  entries: (entries) => (entries.length === 1 ? '1 reading' : `${entries.length} readings`),
  states: {
    done: 'read', partial: 'partly read', missed: 'not read, behind', due: 'to read today', upcoming: 'coming up',
    rest: 'rest day', none: 'no reading',
  },
};

export interface ReadingPlanMonthCalendarProps {
  cells: readonly ReadingPlans.CalendarDay[];
  /** "October 2026", already localized. */
  monthLabel: string;
  /** Short weekday names, Sunday first (index = `weekday`). */
  weekdayNames: readonly string[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  /** Jump to today's month and select today. Hidden when not given. */
  onThisMonth?: () => void;
  /** Localizes an ISO date for the accessible name of a cell. Default: the ISO string. */
  formatDate?: (iso: string) => string;
  /** Localizes the day-of-month numeral. Default: plain digits. */
  formatDayNumber?: (n: number) => string;
  labels?: Partial<ReadingPlanMonthCalendarLabels>;
  /** The whole accessible name of a date cell (e.g. with plan names). Default: date, readings, state, "today". */
  describe?: (cell: ReadingPlans.CalendarDay) => string;
  /**
   * 'compact': smaller cells and text, for a calendar beside a side panel. 'week': one row of larger blocks (the
   * cells are one week; the previous / next buttons and labels then mean weeks). Default 'normal'.
   */
  size?: 'normal' | 'compact' | 'week';
  dir?: 'ltr' | 'rtl';
}

export function ReadingPlanMonthCalendar({
  cells, monthLabel, weekdayNames, selectedDate, onSelectDate, onPreviousMonth, onNextMonth, onThisMonth,
  formatDate, formatDayNumber, labels, describe, size = 'normal', dir,
}: ReadingPlanMonthCalendarProps) {
  const l = { ...DEFAULT_READING_PLAN_MONTH_CALENDAR_LABELS, ...labels, states: { ...DEFAULT_READING_PLAN_MONTH_CALENDAR_LABELS.states, ...labels?.states } };
  const gridRef = useRef<HTMLTableElement>(null);
  const weeks: ReadingPlans.CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // The one tab stop: the selected date when it is on screen, else today, else the first date of the month.
  const focusDate = cells.find((c) => c.date === selectedDate)?.date
    ?? cells.find((c) => c.today)?.date
    ?? cells.find((c) => c.inMonth)?.date
    ?? null;

  // Keep keyboard focus on the selected date when the arrow keys move it.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDate}"]`)?.focus();
  }, [focusDate, cells]);

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const at = cells.findIndex((c) => c.date === focusDate);
    if (at < 0) return;
    const rtl = dir === 'rtl';
    let to: number | null = null;
    switch (event.key) {
      case 'ArrowLeft': to = at + (rtl ? 1 : -1); break;
      case 'ArrowRight': to = at + (rtl ? -1 : 1); break;
      case 'ArrowUp': to = at - 7; break;
      case 'ArrowDown': to = at + 7; break;
      case 'Home': to = at - (at % 7); break;
      case 'End': to = at - (at % 7) + 6; break;
      case 'PageUp': event.preventDefault(); onPreviousMonth(); return;
      case 'PageDown': event.preventDefault(); onNextMonth(); return;
      default: return;
    }
    event.preventDefault();
    if (to < 0) { onPreviousMonth(); return; }
    if (to >= cells.length) { onNextMonth(); return; }
    moved.current = true;
    onSelectDate(cells[to].date);
  };

  const nameOf = (c: ReadingPlans.CalendarDay) => {
    if (describe) return describe(c);
    const parts = [formatDate ? formatDate(c.date) : c.date];
    if (c.entries.length > 0) parts.push(l.entries(c.entries));
    parts.push(l.states[c.state]);
    if (c.today) parts.push(l.today);
    return parts.join(', ');
  };

  return (
    <div className="kth-rpcal" dir={dir} data-size={size} data-testid="month-calendar">
      <div className="kth-rpcal__head">
        <button type="button" className="kth-btn kth-btn--sm kth-rpcal__nav" onClick={onPreviousMonth} aria-label={l.previousMonth} title={l.previousMonth}>
          <span aria-hidden="true">{dir === 'rtl' ? '›' : '‹'}</span>
        </button>
        <span className="kth-rpcal__month" aria-live="polite" data-testid="month-label">{monthLabel}</span>
        <button type="button" className="kth-btn kth-btn--sm kth-rpcal__nav" onClick={onNextMonth} aria-label={l.nextMonth} title={l.nextMonth}>
          <span aria-hidden="true">{dir === 'rtl' ? '‹' : '›'}</span>
        </button>
        {onThisMonth ? (
          <button type="button" className="kth-btn kth-btn--sm" onClick={onThisMonth}>{l.thisMonth}</button>
        ) : null}
      </div>
      <table ref={gridRef} className="kth-rpcal__grid" aria-label={`${l.grid}, ${monthLabel}`} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {(weeks[0] ?? []).map((c) => (
              <th key={c.weekday} scope="col" className="kth-rpcal__weekday">{weekdayNames[c.weekday] ?? ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((c) => {
                const selected = c.date === selectedDate;
                const n = Number(c.date.slice(8, 10));
                return (
                  <td key={c.date} className="kth-rpcal__td">
                    <button
                      type="button"
                      className="kth-rpcal__cell"
                      data-date={c.date}
                      data-state={c.state}
                      data-in-month={c.inMonth ? 'true' : 'false'}
                      data-today={c.today ? 'true' : undefined}
                      data-selected={selected ? 'true' : undefined}
                      aria-label={nameOf(c)}
                      aria-pressed={selected}
                      aria-current={c.today ? 'date' : undefined}
                      tabIndex={c.date === focusDate ? 0 : -1}
                      onClick={() => onSelectDate(c.date)}
                    >
                      <span className="kth-rpcal__num" aria-hidden="true">{formatDayNumber ? formatDayNumber(n) : n}</span>
                      {/* A plain mark, not a box: the cell selects the date, it does not tick anything. */}
                      <span aria-hidden="true" className="kth-rpcal__mark">{MARK[c.state]}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The small symbol under the date, so a state is never told by the cell's tint alone. */
const MARK: Record<ReadingPlans.CalendarDay['state'], string> = {
  done: '✓', partial: '◐', missed: '!', due: '•', upcoming: '•', rest: '–', none: '',
};
