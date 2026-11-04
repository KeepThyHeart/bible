import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollCenterOnceLaidOut } from './useBibleScrolling';

/** B-027: a pane that mounts before dockview has sized it must still scroll to its verse. */
describe('scrollCenterOnceLaidOut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for the container to be laid out, then centers the verse', () => {
    const verse = document.createElement('div');
    verse.scrollIntoView = vi.fn();
    const container = document.createElement('div');
    let h = 0;
    container.getBoundingClientRect = () => ({ width: 400, height: h, top: 0, bottom: h, left: 0, right: 400, x: 0, y: 0, toJSON() {} });

    scrollCenterOnceLaidOut(verse, container);
    expect(verse.scrollIntoView).not.toHaveBeenCalled(); // zero height: would be a no-op scroll

    vi.advanceTimersByTime(48);
    expect(verse.scrollIntoView).not.toHaveBeenCalled();

    h = 600; // dockview finished layout
    vi.advanceTimersByTime(32);
    expect(verse.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  });

  it('centers immediately when already laid out, and gives up quietly if never laid out', () => {
    const verse = document.createElement('div');
    verse.scrollIntoView = vi.fn();
    const sized = document.createElement('div');
    sized.getBoundingClientRect = () => ({ width: 1, height: 1 } as DOMRect);
    scrollCenterOnceLaidOut(verse, sized);
    expect(verse.scrollIntoView).toHaveBeenCalledTimes(1);

    const never = document.createElement('div');
    never.getBoundingClientRect = () => ({ width: 0, height: 0 } as DOMRect);
    const v2 = document.createElement('div');
    v2.scrollIntoView = vi.fn();
    scrollCenterOnceLaidOut(v2, never);
    vi.advanceTimersByTime(16 * 40);
    expect(v2.scrollIntoView).not.toHaveBeenCalled();
  });
});

import { renderHook } from '@testing-library/react';
import { useBibleScrolling } from './useBibleScrolling';

describe('useBibleScrolling after a layout switch (B-027)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not spend its one scroll while the pane is still zero-sized', () => {
    const verse = document.createElement('div');
    verse.scrollIntoView = vi.fn();
    const container = document.createElement('div');
    let h = 0;
    container.getBoundingClientRect = () => ({ width: 400, height: h, top: 0, bottom: h, left: 0, right: 400, x: 0, y: 0, toJSON() {} });

    renderHook(() =>
      useBibleScrolling(
        'p-b027', { current: container }, { current: verse }, 28, null, 1, 'center',
        [{ verse: 28 }], false, vi.fn(), vi.fn(), vi.fn(),
      ),
    );

    vi.advanceTimersByTime(48); // mount effect fires while dockview has not sized the pane
    expect(verse.scrollIntoView).not.toHaveBeenCalled();

    h = 600;
    vi.advanceTimersByTime(48);
    expect(verse.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
