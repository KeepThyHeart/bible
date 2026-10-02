import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DirectionProvider } from '@bible/ui';
import { useTabKeyboardNav } from './useTabKeyboardNav';

function Tabs({ onActivate }: { onActivate: (i: number) => void }) {
  const { tablistRef, onKeyDown } = useTabKeyboardNav({ tabCount: 3, activeIndex: 1, onActivate });
  return (
    <div role="tablist" ref={tablistRef} onKeyDown={onKeyDown}>
      {[0, 1, 2].map(i => (
        <button key={i} role="tab" data-testid={`tab-${i}`}>
          {i}
        </button>
      ))}
    </div>
  );
}

afterEach(() => document.documentElement.removeAttribute('dir'));

function press(key: string, dir: 'ltr' | 'rtl'): number[] {
  const calls: number[] = [];
  render(
    <DirectionProvider value={{ ui: dir, locale: dir === 'rtl' ? 'ar' : 'en' }}>
      <Tabs onActivate={(i) => calls.push(i)} />
    </DirectionProvider>,
  );
  fireEvent.keyDown(screen.getByTestId('tab-1'), { key });
  return calls;
}

describe('useTabKeyboardNav direction', () => {
  it('LTR: ArrowRight is next, ArrowLeft is previous', () => {
    expect(press('ArrowRight', 'ltr')).toEqual([2]);
  });
  it('LTR: ArrowLeft goes to the previous tab', () => {
    expect(press('ArrowLeft', 'ltr')).toEqual([0]);
  });
  it('RTL: ArrowLeft is next', () => {
    expect(press('ArrowLeft', 'rtl')).toEqual([2]);
  });
  it('RTL: ArrowRight is previous', () => {
    expect(press('ArrowRight', 'rtl')).toEqual([0]);
  });
  it('Home/End stay logical (first/last) in RTL', () => {
    expect(press('Home', 'rtl')).toEqual([0]);
  });
  it('ignores unrelated keys', () => {
    expect(press('a', 'rtl')).toEqual([]);
  });
});
