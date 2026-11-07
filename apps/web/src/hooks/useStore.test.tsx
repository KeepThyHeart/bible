import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import { Store } from '../stores/Store';
import { useStore } from './useStore';

class Flag extends Store {
  on = false;
  set(on: boolean): void {
    this.on = on;
    this.notify();
  }
}

describe('useStore', () => {
  it('shows a change made between the first render and the subscription', () => {
    const flag = new Flag();
    // A sibling effect runs before useStore's own (it is declared first) and flips the
    // store, while the consumer is not yet subscribed.
    function Consumer() {
      useEffect(() => flag.set(true), []);
      const on = useStore(flag, () => flag.on);
      return <p>{on ? 'on' : 'off'}</p>;
    }
    render(<Consumer />);
    expect(screen.getByText('on')).toBeTruthy();
  });

  it('follows later changes', () => {
    const flag = new Flag();
    function Consumer() {
      return <p>{useStore(flag, () => flag.on) ? 'on' : 'off'}</p>;
    }
    render(<Consumer />);
    expect(screen.getByText('off')).toBeTruthy();
    act(() => flag.set(true));
    expect(screen.getByText('on')).toBeTruthy();
  });
});
