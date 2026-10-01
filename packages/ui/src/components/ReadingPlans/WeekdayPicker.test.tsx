import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeekdayPicker } from './WeekdayPicker';

describe('WeekdayPicker', () => {
  it('toggles days, keeping them sorted', async () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[1, 2]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sun' }));
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 2]);
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  it('never clears the last day', async () => {
    const onChange = vi.fn();
    render(<WeekdayPicker value={[3]} onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Wed' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can start the week on Monday and use custom names', () => {
    render(<WeekdayPicker value={[1]} onChange={vi.fn()} firstDay={1} weekdayNames={['D', 'L', 'M', 'X', 'J', 'V', 'S']} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  });
});
