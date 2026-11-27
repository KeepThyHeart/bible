import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [{ id: 'list', label: 'List' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }];

function Harness({ dir, start = 'list' }: { dir?: 'ltr' | 'rtl'; start?: string }) {
  const [v, setV] = useState(start);
  return <SegmentedControl options={OPTIONS} value={v} onChange={setV} label="View" dir={dir} />;
}

describe('SegmentedControl', () => {
  it('is a named radio group with one checked radio and one tab stop', () => {
    render(<Harness start="week" />);
    const group = screen.getByRole('radiogroup', { name: 'View' });
    expect(group).toHaveClass('kth-segmented');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('makes the first option the tab stop when nothing matches the value', () => {
    render(<SegmentedControl options={OPTIONS} value="none" onChange={() => {}} label="View" />);
    expect(screen.getAllByRole('radio').map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('chooses on click', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="list" onChange={onChange} label="View" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });

  it('arrows move and choose (wrapping); Home and End', async () => {
    render(<Harness />);
    screen.getByRole('radio', { name: 'List' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });

  it('mirrors the left/right arrows in RTL', async () => {
    render(<Harness dir="rtl" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('dir', 'rtl');
    screen.getByRole('radio', { name: 'List' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  });
});
