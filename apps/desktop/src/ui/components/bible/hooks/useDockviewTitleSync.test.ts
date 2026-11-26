/** useDockviewTitleSync: passage title, with a module's title override winning while set (task 0222). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDockviewTitleSync } from './useDockviewTitleSync';
import { useLayoutStore } from '../../../stores/useLayoutStore';

describe('useDockviewTitleSync title override', () => {
  beforeEach(() => {
    useLayoutStore.setState({ titleOverrides: new Map(), dynamicSubtitles: new Map() });
  });

  it('uses the override when set and the passage title again when cleared', () => {
    const setTitle = vi.fn();
    renderHook(() =>
      useDockviewTitleSync({
        dockviewPanelApi: { setTitle },
        panelId: 'p1',
        hasPassage: true,
        abbreviation: 'KJV',
        currentBookName: 'John',
        currentChapter: 3,
      }),
    );
    expect(setTitle).toHaveBeenLastCalledWith('John 3');
    act(() => useLayoutStore.getState().setTitleOverride('p1', 'Plan - Day 2'));
    expect(setTitle).toHaveBeenLastCalledWith('Plan - Day 2');
    act(() => useLayoutStore.getState().setTitleOverride('p1', null));
    expect(setTitle).toHaveBeenLastCalledWith('John 3');
  });

  it('ignores an override for another panel', () => {
    const setTitle = vi.fn();
    useLayoutStore.getState().setTitleOverride('other', 'Nope');
    renderHook(() =>
      useDockviewTitleSync({
        dockviewPanelApi: { setTitle },
        panelId: 'p1',
        hasPassage: true,
        abbreviation: undefined,
        currentBookName: 'John',
        currentChapter: 3,
      }),
    );
    expect(setTitle).toHaveBeenLastCalledWith('John 3');
  });
});
