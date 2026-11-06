import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { Store } from '../stores/Store';
import { useStore } from './useStore';

class Flag extends Store {
  on = false;
  set(v: boolean) { this.on = v; this.notify(); }
}

describe('useStore', () => {
  it('follows later changes', () => {
    const store = new Flag();
    const { result } = renderHook(() => useStore(store, () => store.on));
    expect(result.current).toBe(false);
    act(() => store.set(true));
    expect(result.current).toBe(true);
  });

  it('catches a change made between the render and the subscription', () => {
    // A store set once (a follow link's "active") by code that runs while the first render is still
    // waiting for its effect: no later change is coming, so the component must catch up on its own.
    const store = new Flag();
    const { result } = renderHook(() => {
      const value = useStore(store, () => store.on);
      if (!store.on) store.on = true; // flips during the first render, before any subscription exists
      return value;
    });
    expect(result.current).toBe(true);
  });
});
