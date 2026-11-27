/** Panel title override (task 0222): set, replace and clear; a repeat of the same value changes nothing. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from './useLayoutStore';

describe('setTitleOverride', () => {
  beforeEach(() => {
    useLayoutStore.setState({ titleOverrides: new Map() });
  });

  it('sets, replaces and clears a title', () => {
    const { setTitleOverride } = useLayoutStore.getState();
    setTitleOverride('p1', 'Plan - Day 3');
    expect(useLayoutStore.getState().titleOverrides.get('p1')).toBe('Plan - Day 3');
    setTitleOverride('p1', 'Plan - Day 4');
    expect(useLayoutStore.getState().titleOverrides.get('p1')).toBe('Plan - Day 4');
    setTitleOverride('p1', null);
    expect(useLayoutStore.getState().titleOverrides.has('p1')).toBe(false);
  });

  it('keeps the same map when nothing changes', () => {
    const { setTitleOverride } = useLayoutStore.getState();
    setTitleOverride('p1', 'X');
    const before = useLayoutStore.getState().titleOverrides;
    setTitleOverride('p1', 'X');
    setTitleOverride('p2', null);
    expect(useLayoutStore.getState().titleOverrides).toBe(before);
  });
});
