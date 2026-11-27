import { render, screen, within } from '@testing-library/react';
import type { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanWeekStrip } from './ReadingPlanWeekStrip';

const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const days: ReadingPlans.WeekStripDay[] = [
  { date: '2026-11-16', weekday: 1, state: 'read', today: false },
  { date: '2026-11-17', weekday: 2, state: 'unread', today: false },
  { date: '2026-11-18', weekday: 3, state: 'unread', today: true },
  { date: '2026-11-19', weekday: 4, state: 'future', today: false },
  { date: '2026-11-20', weekday: 5, state: 'future', today: false },
  { date: '2026-11-21', weekday: 6, state: 'rest', today: false },
  { date: '2026-11-22', weekday: 0, state: 'rest', today: false },
];

describe('ReadingPlanWeekStrip', () => {
  it('renders seven cells in the given order with a glyph and a full label each', () => {
    render(<ReadingPlanWeekStrip days={days} weekdayNames={NAMES} />);
    const items = within(screen.getByRole('list', { name: 'This week' })).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveAttribute('aria-label', 'Mon 2026-11-16: read');
    expect(items[0]).toHaveTextContent('✓');
    expect(items[1]).toHaveAttribute('aria-label', 'Tue 2026-11-17: not read');
    expect(items[5]).toHaveAttribute('aria-label', 'Sat 2026-11-21: rest day');
    expect(items[6]).toHaveAttribute('aria-label', 'Sun 2026-11-22: rest day');
  });

  it('marks today with a ring attribute and names it', () => {
    render(<ReadingPlanWeekStrip days={days} weekdayNames={NAMES} formatDate={(d) => `D${d.slice(-2)}`} />);
    const today = screen.getByLabelText('Wed D18: not read, today');
    expect(today).toHaveAttribute('data-today', 'true');
    expect(screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-today'))).toHaveLength(1);
  });

  it('takes localized labels', () => {
    render(<ReadingPlanWeekStrip days={days.slice(0, 1)} weekdayNames={NAMES} labels={{ strip: 'Semaine', read: 'lu' }} />);
    expect(screen.getByRole('list', { name: 'Semaine' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mon 2026-11-16: lu')).toBeInTheDocument();
  });
});
