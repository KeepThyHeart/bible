import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { onRadioGroupKeyDown } from './radioGroupKeys';

const Group = () => {
  const [value, setValue] = useState('b');
  return (
    <div role="radiogroup" aria-label="g" onKeyDown={onRadioGroupKeyDown}>
      {['a', 'b', 'c'].map((v) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          onClick={() => setValue(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
};

describe('onRadioGroupKeyDown', () => {
  it('arrows move focus and selection, wrapping, and Home/End jump', () => {
    render(<Group />);
    const radio = (n: string) => screen.getByRole('radio', { name: n });
    radio('b').focus();
    fireEvent.keyDown(radio('b'), { key: 'ArrowDown' });
    expect(radio('c')).toHaveFocus();
    expect(radio('c')).toHaveAttribute('aria-checked', 'true');
    expect(radio('c')).toHaveAttribute('tabindex', '0');
    expect(radio('b')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(radio('c'), { key: 'ArrowRight' });
    expect(radio('a')).toHaveFocus();
    fireEvent.keyDown(radio('a'), { key: 'ArrowUp' });
    expect(radio('c')).toHaveFocus();
    fireEvent.keyDown(radio('c'), { key: 'Home' });
    expect(radio('a')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(radio('a'), { key: 'End' });
    expect(radio('c')).toHaveAttribute('aria-checked', 'true');
  });

  it('mirrors Left/Right in RTL', () => {
    render(<Group />);
    const group = screen.getByRole('radiogroup');
    group.setAttribute('dir', 'rtl');
    group.style.direction = 'rtl';
    const radio = (n: string) => screen.getByRole('radio', { name: n });
    radio('b').focus();
    fireEvent.keyDown(radio('b'), { key: 'ArrowLeft' });
    expect(radio('c')).toHaveFocus();
  });
});
