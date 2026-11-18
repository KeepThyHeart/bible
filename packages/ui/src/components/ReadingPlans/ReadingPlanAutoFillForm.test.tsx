import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanAutoFillForm } from './ReadingPlanAutoFillForm';

function setup(existingDays = 0) {
  const onApply = vi.fn(); const onCancel = vi.fn();
  render(<ReadingPlanAutoFillForm today="2026-02-01" existingDays={existingDays} onApply={onApply} onCancel={onCancel} />);
  return { onApply, onCancel, user: userEvent.setup() };
}

describe('ReadingPlanAutoFillForm', () => {
  it('asks for something to read and disables the action', () => {
    setup();
    expect(screen.getByText('Choose something to read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fill plan' })).toBeDisabled();
  });

  it('Gospels over the default 30 days gives a 30-day summary and applies', async () => {
    const { onApply, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Gospels' }));
    expect(screen.getByText(/^30 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill plan' }));
    const [days, mode] = onApply.mock.calls[0] as [ReadingPlans.PlanDay[], string];
    expect(mode).toBe('replace');
    expect(days).toHaveLength(30);
    expect(days[0].readings[0]).not.toHaveProperty('track');
  });

  it('counts a passage that is typed but not yet entered', async () => {
    const { onApply, user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add passage' }), 'John 1-3');
    expect(screen.queryByText('Choose something to read')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill plan' }));
    const [days] = onApply.mock.calls[0] as [ReadingPlans.PlanDay[], string];
    expect(days.length).toBeGreaterThan(0);
  });

  it('shows the invalid-passage message as visible text', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add passage' }), 'Nonsense 99{Enter}');
    const shown = screen.getAllByText(/That is not a passage|Not a valid reference/).filter((el) => !el.classList.contains('kth-visually-hidden'));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]).toHaveClass('kth-combobox__error');
  });

  it('changing the pace value and kind changes the summary', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Gospels' }));
    const n = screen.getByRole('spinbutton', { name: 'Number of days' });
    await user.clear(n);
    await user.type(n, '60');
    expect(screen.getByText(/^60 days/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Pace'), 'chaptersPerDay');
    const c = screen.getByRole('spinbutton', { name: 'Chapters a day' });
    await user.clear(c);
    await user.type(c, '4');
    expect(screen.getByText(/^23 days/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Pace'), 'endDate');
    expect(screen.getByText('The pace is not valid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fill plan' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Finish by', { selector: 'input[type=date]' }), { target: { value: '2026-02-10' } });
    expect(screen.getByText(/^10 days/)).toBeInTheDocument();
  });

  it('John 1-3 over 10 days shows the split note', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add passage' }), 'John 1-3{Enter}');
    expect(screen.getByRole('button', { name: /^Remove John/ })).toBeInTheDocument();
    const n = screen.getByRole('spinbutton', { name: 'Number of days' });
    await user.clear(n);
    await user.type(n, '10');
    expect(screen.getByText(/fewer chapters than days/)).toBeInTheDocument();
  });

  it('notes when there are fewer days than asked', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('combobox', { name: 'Add passage' }), 'John 1:1-2{Enter}');
    await user.click(screen.getByRole('radio', { name: /Balanced/ }));
    const n = screen.getByRole('spinbutton', { name: 'Number of days' });
    await user.clear(n);
    await user.type(n, '10');
    expect(screen.getByText(/This makes only 2 days/)).toBeInTheDocument();
  });

  it('offers replace and append when the plan has days', async () => {
    const { onApply, onCancel, user } = setup(12);
    await user.click(screen.getByRole('button', { name: 'Gospels' }));
    await user.click(screen.getByRole('button', { name: 'Add after day 12' }));
    expect(onApply.mock.calls[0][1]).toBe('append');
    await user.click(screen.getByRole('button', { name: 'Replace all days' }));
    expect(onApply.mock.calls[1][1]).toBe('replace');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
