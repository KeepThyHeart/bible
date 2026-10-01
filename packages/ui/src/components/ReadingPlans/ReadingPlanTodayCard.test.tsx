import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanTodayCard } from './ReadingPlanTodayCard';
import type { ReadingPlanTodayCardProps } from './ReadingPlanTodayCard';
import { enrollment, fmt, smallPlan } from './fixtures';

function setup(view: ReadingPlans.TodayView, props: Partial<ReadingPlanTodayCardProps> = {}) {
  const fns = {
    onToggleReading: vi.fn(), onToggleDay: vi.fn(), onOpenReading: vi.fn(), onOpenPlan: vi.fn(), onShift: vi.fn(),
    onSwitchToFlexible: vi.fn(),
  };
  render(<ReadingPlanTodayCard view={view} formatReading={fmt} percent={12.5} {...fns} {...props} />);
  return { ...fns, user: userEvent.setup() };
}

const plan = smallPlan();

describe('ReadingPlanTodayCard', () => {
  it('shows the day, percent, readings with minutes and toggles them', async () => {
    const view = ReadingPlans.todayView(plan, enrollment(), [], '2026-01-05');
    const { user, onToggleReading, onToggleDay, onOpenReading } = setup(view);
    expect(screen.getByText('Day 1 of 5')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBe(view.readings.length);
    expect(screen.getAllByText(/^~\d+ min$/).length).toBe(view.readings.length);
    await user.click(boxes[0]);
    expect(onToggleReading).toHaveBeenCalledWith(0, true);
    await user.click(screen.getAllByRole('button', { name: /^Open / })[0]);
    expect(onOpenReading).toHaveBeenCalledWith(view.readings[0].reading);
    await user.click(screen.getByRole('button', { name: 'Mark day read' }));
    expect(onToggleDay).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers to mark a finished day unread', async () => {
    const view = { ...ReadingPlans.todayView(plan, enrollment(), [], '2026-01-05'), dayDone: true };
    const { user, onToggleDay } = setup(view);
    await user.click(screen.getByRole('button', { name: 'Mark day unread' }));
    expect(onToggleDay).toHaveBeenCalledWith(false);
  });

  it('prefixes the track name and opens the plan from the title', async () => {
    const base = ReadingPlans.todayView(plan, enrollment(), [], '2026-01-05');
    const view = { ...base, readings: base.readings.map((r) => ({ ...r, reading: { ...r.reading, track: 't1' } })) };
    const { user, onOpenPlan } = setup(view, { trackName: () => 'Family' });
    expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName(/^Family: /);
    await user.click(screen.getByRole('button', { name: 'Short epistles' }));
    expect(onOpenPlan).toHaveBeenCalled();
  });

  it('shows the behind banner, catch-up hint and missed days', async () => {
    const view = ReadingPlans.todayView(plan, enrollment(), [], '2026-01-08');
    expect(view.behindBy).toBe(3);
    const { user, onShift } = setup(view, { catchUp: ReadingPlans.catchUpSuggestion(3, 3) });
    expect(screen.getByRole('status')).toHaveTextContent('You are 3 days behind');
    expect(screen.getByText('Read 1 extra day each day for 3 days to catch up')).toBeInTheDocument();
    expect(screen.getByText('Missed: day 1, 2, 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reschedule from today' }));
    expect(onShift).toHaveBeenCalled();
  });

  it('switch to flexible needs confirmation; Cancel does nothing', async () => {
    const view = ReadingPlans.todayView(plan, enrollment(), [], '2026-01-08');
    const { user, onSwitchToFlexible } = setup(view);
    await user.click(screen.getByRole('button', { name: 'Switch to flexible' }));
    expect(onSwitchToFlexible).not.toHaveBeenCalled();
    expect(screen.getByText(/does not keep track of missed days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSwitchToFlexible).not.toHaveBeenCalled();
    expect(screen.queryByText(/does not keep track/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Switch to flexible' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSwitchToFlexible).toHaveBeenCalledTimes(1);
  });

  it('shows no banner for flexible plans', () => {
    const view = ReadingPlans.todayView(plan, enrollment({ pacing: 'flexible' }), [], '2026-01-20');
    setup(view);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the completed, not started and rest day states', () => {
    const done = { ...ReadingPlans.todayView(plan, enrollment(), [], '2026-01-05'), completed: true, day: null, readings: [] };
    const first = render(<ReadingPlanTodayCard view={done} formatReading={fmt} onToggleReading={vi.fn()} onToggleDay={vi.fn()} onOpenReading={vi.fn()} />);
    expect(screen.getByText(/plan is finished/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    first.unmount();

    const future = ReadingPlans.todayView(plan, enrollment(), [], '2026-01-01');
    expect(future.notStarted).toBe(true);
    const second = render(<ReadingPlanTodayCard view={future} formatReading={fmt} onToggleReading={vi.fn()} onToggleDay={vi.fn()} onOpenReading={vi.fn()} />);
    expect(screen.getByText(/not started/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark day read' })).toBeNull();
    second.unmount();

    // 2026-01-11 is a Sunday; Monday-Friday plan.
    const rest = ReadingPlans.todayView(plan, enrollment({ readingDays: [1, 2, 3, 4, 5] }), [], '2026-01-11');
    expect(rest.restDay).toBe(true);
    expect(rest.day).toBeNull();
    setup(rest);
    expect(screen.getByText('Rest day')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/behind/);
  });
});
