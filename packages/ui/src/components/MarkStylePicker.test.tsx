import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkStylePicker } from './MarkStylePicker';
import type { MarkStyle } from '@bible/core/browser';

function Harness({ initial, onChange }: { initial: MarkStyle; onChange: (s: MarkStyle) => void }) {
  const [v, setV] = useState(initial);
  return <MarkStylePicker value={v} onChange={(s) => { setV(s); onChange(s); }} />;
}
function setup(initial: MarkStyle = { color: 'mark.1', line: 'solid' }) {
  const onChange = vi.fn();
  render(<Harness initial={initial} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe('MarkStylePicker', () => {
  it('renders three radio groups and two toggles', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Underline' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Symbol' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /^(Blue|Vermilion|Green|Pink|Gold|Sky blue|Purple|Grey)$/ })).toHaveLength(8);
    expect(screen.getByRole('checkbox', { name: 'Bold' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Background tint' })).not.toBeChecked();
  });

  it('checks the current values with a roving tab stop', () => {
    setup({ color: 'mark.3', line: 'dashed', symbol: '△' });
    expect(screen.getByRole('radio', { name: 'Green' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dashed underline' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Open triangle' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Green' }).tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Blue' }).tabIndex).toBe(-1);
  });

  it('shows the symbol inside the colour swatches, never colour alone', () => {
    setup({ color: 'mark.1', line: 'dotted', symbol: '▲' });
    const swatch = screen.getByRole('radio', { name: 'Vermilion' });
    expect(swatch).toHaveTextContent('▲');
    expect(swatch.className).toContain('kth-mark-swatch--line-dotted');
  });

  it('arrow keys move focus and select within a group, wrapping', async () => {
    const { onChange, user } = setup();
    screen.getByRole('radio', { name: 'Blue' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Vermilion' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.2', line: 'solid' });
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.8', line: 'solid' });
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Grey' })).toHaveFocus();
  });

  it('changes line and symbol, and removes the symbol with "No symbol"', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Thick underline' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'thick' });
    await user.click(screen.getByRole('radio', { name: 'Open square' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'thick', symbol: '□' });
    await user.click(screen.getByRole('radio', { name: 'No symbol' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'thick' });
  });

  it('toggles bold and fill', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Bold' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'solid', bold: true });
    await user.click(screen.getByRole('checkbox', { name: 'Background tint' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'solid', bold: true, fill: 'subtle' });
    await user.click(screen.getByRole('checkbox', { name: 'Bold' }));
    expect(onChange).toHaveBeenLastCalledWith({ color: 'mark.1', line: 'solid', fill: 'subtle' });
  });

  it('takes labels from props', () => {
    render(<MarkStylePicker value={{ color: 'mark.1', line: 'solid' }} onChange={() => {}}
      labels={{ colorGroup: 'Couleur', colors: { 'mark.1': 'Bleu' } }} />);
    expect(screen.getByRole('radiogroup', { name: 'Couleur' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bleu' })).toBeInTheDocument();
  });
});
