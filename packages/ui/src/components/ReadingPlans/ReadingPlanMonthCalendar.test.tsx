import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanMonthCalendar } from './ReadingPlanMonthCalendar';

const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Two weeks, Monday first: 2026-10-05 .. 2026-10-18, today the 7th. */
function cells(): ReadingPlans.CalendarDay[] {
  const states: ReadingPlans.CalendarDay['state'][] = ['done', 'missed', 'due', 'upcoming', 'partial', 'rest', 'none'];
  return Array.from({ length: 14 }, (_, i) => {
    const date = `2026-10-${String(5 + i).padStart(2, '0')}`;
    const state = i < 7 ? states[i] : 'upcoming';
    return {
      date, weekday: ((1 + i) % 7) as ReadingPlans.Weekday, inMonth: true, today: i === 2,
      entries: state === 'rest' || state === 'none' ? [] : [{ enrollmentId: 'e1', day: i + 1, state }], state,
    };
  });
}

function setup(selectedDate: string | null = null) {
  const cb = { onSelectDate: vi.fn(), onPreviousMonth: vi.fn(), onNextMonth: vi.fn(), onThisMonth: vi.fn() };
  render(<ReadingPlanMonthCalendar cells={cells()} monthLabel="October 2026" weekdayNames={NAMES} selectedDate={selectedDate} {...cb} />);
  return cb;
}

describe('ReadingPlanMonthCalendar', () => {
  it('draws weeks of dates with a state each and names every date in full', () => {
    setup();
    expect(screen.getByRole('table', { name: 'Reading calendar, October 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(screen.getByRole('button', { name: '2026-10-05, 1 reading, read' })).toHaveAttribute('data-state', 'done');
    expect(screen.getByRole('button', { name: '2026-10-06, 1 reading, not read, behind' })).toHaveAttribute('data-state', 'missed');
    const today = screen.getByRole('button', { name: '2026-10-07, 1 reading, to read today, today' });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('button', { name: '2026-10-10, rest day' })).toBeInTheDocument();
  });

  it('a read date has a check mark (not a box); today is the one tab stop when nothing is selected', () => {
    setup();
    // A plain mark (no checkbox-like box): the cell selects the date, it does not tick anything.
    const read = screen.getByRole('button', { name: /2026-10-05/ });
    expect(read.querySelector('.kth-rpcal__mark')).toHaveTextContent('✓');
    expect(read.querySelector('.kth-weekbox')).toBeNull();
    const stops = screen.getAllByRole('button').filter((b) => b.dataset.date && b.tabIndex === 0);
    expect(stops.map((b) => b.dataset.date)).toEqual(['2026-10-07']);
  });

  it('clicking a date selects it; the selected date is pressed', () => {
    const cb = setup('2026-10-06');
    expect(screen.getByRole('button', { name: /2026-10-06/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /2026-10-08/ }));
    expect(cb.onSelectDate).toHaveBeenCalledWith('2026-10-08');
  });

  it('arrow keys move the selection; past the grid they change the month', () => {
    const cb = setup('2026-10-06');
    const grid = screen.getByRole('table');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(cb.onSelectDate).toHaveBeenLastCalledWith('2026-10-07');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(cb.onSelectDate).toHaveBeenLastCalledWith('2026-10-13');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(cb.onSelectDate).toHaveBeenLastCalledWith('2026-10-11');
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    expect(cb.onPreviousMonth).toHaveBeenCalled();
    fireEvent.keyDown(grid, { key: 'PageDown' });
    expect(cb.onNextMonth).toHaveBeenCalled();
  });

  it('has month buttons and a Today button', () => {
    const cb = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(cb.onPreviousMonth).toHaveBeenCalledTimes(1);
    expect(cb.onNextMonth).toHaveBeenCalledTimes(1);
    expect(cb.onThisMonth).toHaveBeenCalledTimes(1);
  });

  it('is normal size by default and compact on request (data-size on the root)', () => {
    const props = { cells: cells(), monthLabel: 'October 2026', weekdayNames: NAMES, selectedDate: null,
      onSelectDate: vi.fn(), onPreviousMonth: vi.fn(), onNextMonth: vi.fn() };
    const { rerender } = render(<ReadingPlanMonthCalendar {...props} />);
    expect(screen.getByTestId('month-calendar')).toHaveAttribute('data-size', 'normal');
    rerender(<ReadingPlanMonthCalendar {...props} size="compact" />);
    expect(screen.getByTestId('month-calendar')).toHaveAttribute('data-size', 'compact');
    rerender(<ReadingPlanMonthCalendar {...props} cells={cells().slice(0, 7)} size="week" />);
    expect(screen.getByTestId('month-calendar')).toHaveAttribute('data-size', 'week');
    expect(screen.getAllByRole('row')).toHaveLength(2); // the weekday names and one row of seven blocks
  });

  it('describe replaces the whole accessible name of a cell; entries label is overridable', () => {
    const base = { cells: cells(), monthLabel: 'October 2026', weekdayNames: NAMES, selectedDate: null,
      onSelectDate: vi.fn(), onPreviousMonth: vi.fn(), onNextMonth: vi.fn() };
    const { unmount } = render(<ReadingPlanMonthCalendar {...base}
      describe={(c) => `${c.date}: ${c.entries.map((e) => `Plan ${e.enrollmentId} day ${e.day}`).join('; ') || 'nothing'}`} />);
    expect(screen.getByRole('button', { name: '2026-10-05: Plan e1 day 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026-10-10: nothing' })).toBeInTheDocument();
    unmount();
    render(<ReadingPlanMonthCalendar {...base} labels={{ entries: (e) => `${e.length} item` }} />);
    expect(screen.getByRole('button', { name: '2026-10-05, 1 item, read' })).toBeInTheDocument();
  });
});
