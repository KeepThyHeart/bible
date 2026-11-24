import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import type { ReaderPaintProps } from '../host/slots';

const follow = { tabId: 'p1' as string | null, verseId: 43003016 as number | null };
const prefs = { followAlong: true, autoScroll: true };
const listeners = new Set<() => void>();
vi.mock('./audioState', () => ({
  useFollow: () => follow,
  useAudio: (sel: (s: unknown) => unknown) => sel({ prefs }),
  audioStore: {},
}));
vi.mock('./desktopPorts', () => ({ panelIdOfTab: (t?: string) => (t === 'tab-1' ? 'p1' : t === 'tab-2' ? 'p2' : undefined) }));

import { PlayingVerseController, applyPlayingVerse, scrollVerseIntoView } from './PlayingVerseController';

function container() {
  const el = document.createElement('div');
  el.innerHTML = [15, 16, 17].map(v => `<div class="verse-row" data-verse-id="430030${v}">v${v}</div>`).join('');
  el.scrollTo = vi.fn() as never;
  // jsdom has no layout: the pane is 100 tall and every verse sits far below it.
  el.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 }) as DOMRect;
  for (const row of el.children) (row as HTMLElement).getBoundingClientRect = () => ({ top: 500, bottom: 520, height: 20 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}
const props = (el: HTMLElement, tabId: string) => ({ tabId, containerRef: { current: el } }) as unknown as ReaderPaintProps;

beforeEach(() => { follow.tabId = 'p1'; follow.verseId = 43003016; prefs.followAlong = true; prefs.autoScroll = true; listeners.clear(); document.body.innerHTML = ''; });

describe('applyPlayingVerse', () => {
  it('marks one verse and clears the others', () => {
    const el = container();
    applyPlayingVerse(el, 43003015);
    applyPlayingVerse(el, 43003016);
    expect([...el.querySelectorAll('.verse--playing')].map(e => (e as HTMLElement).dataset.verseId)).toEqual(['43003016']);
    applyPlayingVerse(el, null);
    expect(el.querySelector('.verse--playing')).toBeNull();
  });
});

describe('scrollVerseIntoView', () => {
  it('false when the row is not mounted, scrolls when it is', () => {
    const el = container();
    expect(scrollVerseIntoView(el, 1)).toBe(false);
    expect(scrollVerseIntoView(el, 43003016, true)).toBe(true);
    expect(el.scrollTo).toHaveBeenCalled();
  });
});

describe('PlayingVerseController', () => {
  it('highlights in the followed pane only, re-applies after a redraw, never selects', async () => {
    const el = container();
    const other = container();
    render(<><PlayingVerseController {...props(el, 'tab-1')} /><PlayingVerseController {...props(other, 'tab-2')} /></>);
    expect(el.querySelector('[data-verse-id="43003016"]')!.classList.contains('verse--playing')).toBe(true);
    expect(other.querySelector('.verse--playing')).toBeNull();
    // React redraws the row and drops the class.
    await act(async () => { el.querySelector('[data-verse-id="43003016"]')!.className = 'verse-row'; await Promise.resolve(); });
    expect(el.querySelector('[data-verse-id="43003016"]')!.classList.contains('verse--playing')).toBe(true);
    expect(el.scrollTo).toHaveBeenCalled();
    expect(window.getSelection()?.toString() ?? '').toBe('');
  });

  it('followAlong off: no highlight; autoScroll off: no scroll', () => {
    const el = container();
    prefs.followAlong = false;
    render(<PlayingVerseController {...props(el, 'tab-1')} />);
    expect(el.querySelector('.verse--playing')).toBeNull();
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('autoScroll off still highlights', () => {
    const el = container();
    prefs.autoScroll = false;
    render(<PlayingVerseController {...props(el, 'tab-1')} />);
    expect(el.querySelector('.verse--playing')).not.toBeNull();
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('removes the highlight on unmount', () => {
    const el = container();
    const r = render(<PlayingVerseController {...props(el, 'tab-1')} />);
    r.unmount();
    expect(el.querySelector('.verse--playing')).toBeNull();
  });
});
