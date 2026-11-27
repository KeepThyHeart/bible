import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeekdayPicker } from './WeekdayPicker';

describe('WeekdayPicker', () => {
  it('toggles day checkboxes, keeping them sorted', async () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[1, 2]} onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sun' })).not.toBeChecked();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Sun' }));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 2]);
    await user.click(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  it('never clears the last day', async () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[3]} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Wed' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can start the week on Monday and use custom names', () => {
    render(<WeekdayPicker value={[1]} onChange={vi.fn()} firstDay={1} weekdayNames={['D', 'L', 'M', 'X', 'J', 'V', 'S']} />);
    const names = screen.getAllByRole('checkbox').map((b) => b.closest('label')?.textContent);
    expect(names).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  });

  it('is a group named by the label, or by a visible legend', () => {
    const { rerender } = render(<WeekdayPicker value={[1]} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Reading days' })).toBeInTheDocument();
    rerender(<WeekdayPicker value={[1]} onChange={vi.fn()} legend="Days" />);
    expect(screen.getByRole('group', { name: 'Days' })).toBeInTheDocument();
  });

  it('disables every checkbox', () => {
    render(<WeekdayPicker value={[1]} onChange={vi.fn()} disabled />);
    for (const c of screen.getAllByRole('checkbox')) expect(c).toBeDisabled();
  });
});
