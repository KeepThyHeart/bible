import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanBuilderForm } from './ReadingPlanBuilderForm';
import { bookName } from './fixtures';

function setup() {
  const onCreate = vi.fn(); const onCancel = vi.fn();
  render(<ReadingPlanBuilderForm onCreate={onCreate} onCancel={onCancel} today="2026-02-01" bookName={(b) => bookName(b)} />);
  return { onCreate, onCancel, user: userEvent.setup() };
}

describe('ReadingPlanBuilderForm', () => {
  it('asks for something to read and disables Create until there is a scope', () => {
    setup();
    expect(screen.getByText('Choose something to read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create plan' })).toBeDisabled();
  });

  it('builds a spec for Jude over three days split by verses, with a preview', async () => {
    const { onCreate, user } = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Jude' }));
    const days = screen.getByRole('spinbutton', { name: 'Number of days' });
    await user.clear(days);
    await user.type(days, '3');
    await user.click(screen.getByRole('radio', { name: /Balanced by verses/ }));
    await user.type(screen.getByLabelText('Plan name'), 'Jude plan');
    expect(screen.getByText('3 days · about 1 min a day')).toBeInTheDocument();
    expect(screen.getByText(/^Day 1: Jude 1-/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [spec, start] = onCreate.mock.calls[0] as [ReadingPlans.BuilderSpec, { startDate: string; pacing: string; readingDays: number[] }];
    expect(spec).toMatchObject({
      name: 'Jude plan', scope: [ReadingPlans.booksRange(65)], order: 'canonical', pace: { by: 'days', days: 3 }, split: 'verse',
    });
    expect(start).toEqual({ startDate: '2026-02-01', pacing: 'flexible', readingDays: [0, 1, 2, 3, 4, 5, 6] });
  });

  it('shortcuts select books, passages become chips and end date paces carry the dates', async () => {
    const { onCreate, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Gospels' }));
    expect(screen.getByRole('checkbox', { name: 'Book 40' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('checkbox', { name: 'Book 40' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Philemon' }));
    await user.click(screen.getByRole('checkbox', { name: '2 John' }));
    const input = screen.getByRole('combobox');
    await user.type(input, 'Jude 1-8{Enter}');
    expect(screen.getByRole('button', { name: /^Remove Jude/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Finish by' }));
    fireEvent.change(screen.getByLabelText('Finish by', { selector: 'input[type=date]' }), { target: { value: '2026-02-05' } });
    await user.click(screen.getByRole('radio', { name: /^Fixed/ }));
    await user.click(screen.getByRole('button', { name: 'Create plan' }));
    const [spec, start] = onCreate.mock.calls[0] as [ReadingPlans.BuilderSpec, { pacing: string }];
    expect(spec.scope).toEqual([ReadingPlans.booksRange(57), ReadingPlans.booksRange(63), { start: 65_001_001, end: 65_001_008 }]);
    expect(spec.pace).toEqual({ by: 'endDate', startDate: '2026-02-01', endDate: '2026-02-05' });
    expect(start.pacing).toBe('fixed');
  }, 30000);

  it('Cancel calls onCancel', async () => {
    const { onCancel, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
