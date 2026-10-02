import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanDayGrid } from './ReadingPlanDayGrid';
import { enrollment, smallPlan } from './fixtures';

describe('ReadingPlanDayGrid', () => {
  it('renders a labelled button per day and selects on click', async () => {
    const statuses: ReadingPlans.DayStatus[] = ['done', 'partial', 'missed', 'current', 'upcoming'];
    const onSelectDay = vi.fn();
    render(<ReadingPlanDayGrid statuses={statuses} selectedDay={4} onSelectDay={onSelectDay} />);
    expect(screen.getByRole('button', { name: 'Day 1, read' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Day 3, missed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Day 4, today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Day 1, read' })).toHaveClass('kth-rp-grid__day--done');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Day 5, upcoming' }));
    expect(onSelectDay).toHaveBeenCalledWith(5);
  });

  it('works with core dayStatuses', () => {
    const statuses = ReadingPlans.dayStatuses(smallPlan(), enrollment(), [], '2026-01-07');
    render(<ReadingPlanDayGrid statuses={statuses} onSelectDay={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Day 1, missed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Day 3, today' })).toBeInTheDocument();
  });
});
