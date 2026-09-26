import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HighlightSwatch } from './HighlightSwatch';
import type { HighlightSwatchProps } from './HighlightSwatch';

function setup(props: HighlightSwatchProps = {}) {
  const onChange = vi.fn();
  const utils = render(<HighlightSwatch onChange={onChange} {...props} />);
  return { onChange, user: userEvent.setup(), ...utils };
}

describe('HighlightSwatch', () => {
  it('renders a radiogroup with six named radios filled from the palette', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Highlight colour' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Yellow', 'Green', 'Blue', 'Red', 'Purple', 'Orange']);
    expect((radios[0] as HTMLElement).style.backgroundColor).toBe('rgb(255, 243, 163)');
    expect(radios[0]).toHaveAttribute('title', 'Yellow');
  });

  it('checks the swatch for a stored hex, roving tabindex on it', () => {
    setup({ value: '#FFF3A3' });
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it('matches a palette name and lower-case hex', () => {
    const { rerender } = setup({ value: 'blue' });
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
    rerender(<HighlightSwatch value="#b7e4c7" />);
    expect(screen.getByRole('radio', { name: 'Green' })).toHaveAttribute('aria-checked', 'true');
  });

  it('checks none for a custom hex and gives the first radio the tab stop', () => {
    setup({ value: '#123456' });
    const radios = screen.getAllByRole('radio');
    expect(radios.some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);
  });

  it('ArrowRight moves the check, focus and fires onChange', async () => {
    const { onChange, user } = setup({ value: 'yellow' });
    screen.getByRole('radio', { name: 'Yellow' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith({ color: 'green', hex: '#B7E4C7' });
    const green = screen.getByRole('radio', { name: 'Green' });
    expect(green).toHaveAttribute('aria-checked', 'true');
    expect(green).toHaveFocus();
    expect(green.tabIndex).toBe(0);
  });

  it('wraps, and Home/End/Down/Up work', async () => {
    const { onChange, user } = setup({ value: 'yellow' });
    screen.getByRole('radio', { name: 'Yellow' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'orange', hex: '#FBD1A2' });
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'yellow', hex: '#FFF3A3' });
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'orange', hex: '#FBD1A2' });
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'purple', hex: '#D9C2F0' });
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'orange', hex: '#FBD1A2' });
  });

  it('swaps Left and Right in RTL', async () => {
    const { onChange, user } = setup({ value: 'yellow', dir: 'rtl' });
    screen.getByRole('radio', { name: 'Yellow' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'green', hex: '#B7E4C7' });
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith({ color: 'yellow', hex: '#FFF3A3' });
  });

  it('selects on click', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    expect(onChange).toHaveBeenCalledWith({ color: 'red', hex: '#F7B7B7' });
    expect(screen.getByRole('radio', { name: 'Red' })).toHaveAttribute('aria-checked', 'true');
  });

  it('follows a changed value prop', () => {
    const { rerender } = setup({ value: 'yellow' });
    rerender(<HighlightSwatch value="purple" />);
    expect(screen.getByRole('radio', { name: 'Purple' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Yellow' })).toHaveAttribute('aria-checked', 'false');
  });

  it('does nothing when disabled', async () => {
    const { onChange, user } = setup({ disabled: true });
    const radios = screen.getAllByRole('radio');
    expect(radios.every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    await user.click(radios[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports a colour subset, a custom fill and size', () => {
    setup({ colors: ['red', 'blue'], colorValue: (c) => `var(--x-${c})`, size: 'sm' });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveClass('kth-swatch--sm');
    expect((radios[0] as HTMLElement).style.backgroundColor).toBe('var(--x-red)');
  });

  it('renders label strings as text', () => {
    const { container } = setup({ labels: { group: '<img src=x onerror=alert(1)>', colors: { yellow: '<b>Y</b>' } } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', '<img src=x onerror=alert(1)>');
    expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-label', '<b>Y</b>');
  });
});
