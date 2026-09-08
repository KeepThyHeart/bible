/**
 * Unit tests for the Bible pane's detached seeding hook.
 *
 * A detached renderer runs none of the app's startup path - no session load -
 * so `useInitialDataLoader` never fires and this hook is the *only* thing that
 * puts a passage on screen in a popped-out Bible window. If it no-ops, the user
 * gets "No Bible translation open" even though the main process shipped the
 * passage over.
 *
 * The behaviours worth pinning: it runs only when detached, it runs exactly
 * once (re-running would clobber navigation the user has since done in the new
 * window), and it declines gracefully on a junk payload rather than throwing
 * inside an effect - which in React 18 would tear down the whole window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const restoreFromSession = vi.fn();

vi.mock('../../../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ restoreFromSession }) },
}));

import { useDetachedInit } from './useDetachedInit';

const SEED = {
  openTabs: [{ abbreviation: 'KJV', name: 'King James Version' }],
  activeTabIndex: 0,
  currentBook: 43,
  currentChapter: 3,
  currentBookName: 'John',
  selectedVerseId: 43003016,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDetachedInit (Bible)', () => {
  it('seeds the panel from the handed-over state when detached', () => {
    renderHook(() => useDetachedInit({ panelId: 'panel-1', isDetached: true, seed: SEED }));

    expect(restoreFromSession).toHaveBeenCalledTimes(1);
    expect(restoreFromSession).toHaveBeenCalledWith('panel-1', SEED);
  });

  it('does nothing in the main window', () => {
    renderHook(() => useDetachedInit({ panelId: 'panel-1', isDetached: false, seed: SEED }));
    expect(restoreFromSession).not.toHaveBeenCalled();
  });

  it('seeds only once even across re-renders', () => {
    // The seed prop is a fresh object on every render of the detached root, so
    // a naive dependency array would re-restore and stomp on any navigation the
    // user did in the popped-out window.
    const { rerender } = renderHook(
      ({ seed }) => useDetachedInit({ panelId: 'panel-1', isDetached: true, seed }),
      { initialProps: { seed: SEED } }
    );

    rerender({ seed: { ...SEED, currentChapter: 4 } });
    rerender({ seed: { ...SEED, currentChapter: 5 } });

    expect(restoreFromSession).toHaveBeenCalledTimes(1);
    expect(restoreFromSession).toHaveBeenCalledWith('panel-1', SEED);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'not-a-session'],
    ['a number', 42],
  ])('ignores a seed that is %s', (_label, seed) => {
    renderHook(() => useDetachedInit({ panelId: 'panel-1', isDetached: true, seed }));
    expect(restoreFromSession).not.toHaveBeenCalled();
  });

  it('accepts an empty object so the pane falls through to its picker', () => {
    // `{}` is a real payload - panes popped out before a translation is chosen
    // send it - and must reach the store rather than being screened out here.
    renderHook(() => useDetachedInit({ panelId: 'panel-1', isDetached: true, seed: {} }));
    expect(restoreFromSession).toHaveBeenCalledWith('panel-1', {});
  });

  it('does not throw when the restore rejects', () => {
    // A failed restore must leave the window on the empty state with a
    // translation picker, not surface an unhandled rejection.
    restoreFromSession.mockRejectedValueOnce(new Error('db locked'));

    expect(() =>
      renderHook(() => useDetachedInit({ panelId: 'panel-1', isDetached: true, seed: SEED }))
    ).not.toThrow();
  });

  it('seeds the panel it was told to, not a default', () => {
    renderHook(() => useDetachedInit({ panelId: 'detached-3', isDetached: true, seed: SEED }));
    expect(restoreFromSession).toHaveBeenCalledWith('detached-3', SEED);
  });
});
