import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFollowScroll, USER_SCROLL_PAUSE_MS } from './useFollowScroll';
import { audioStore } from '../stores/audioStore';

interface Geometry { top: number; bottom: number }

let scroller: HTMLElement;
let container: HTMLElement;
let verseGeometry: Geometry;
let scrollTo: ReturnType<typeof vi.fn>;
let clock = 0;

function Harness({ tabId }: { tabId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFollowScroll({
    getScrollElement: () => scroller,
    getContainer: () => container,
    activeTabId: tabId,
    now: () => clock,
  });
  return <div ref={ref} />;
}

const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 100_000;
  document.body.innerHTML = '';
  scroller = document.createElement('div');
  container = document.createElement('div');
  const verse = document.createElement('div');
  verse.setAttribute('data-verse-id', '43003016');
  container.appendChild(verse);
  scroller.appendChild(container);
  document.body.appendChild(scroller);
  verseGeometry = { top: 300, bottom: 340 };
  scroller.getBoundingClientRect = () => rect(0, 600);
  verse.getBoundingClientRect = () => rect(verseGeometry.top, verseGeometry.bottom);
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', { value: 1000, configurable: true, writable: true });
  scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  audioStore.reset();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { vi.useRealTimers(); audioStore.reset(); });

async function frames(n = 3) { for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(20); }

describe('useFollowScroll', () => {
  it('does nothing when the verse is already comfortably in view', async () => {
    render(<Harness tabId="t1" />);
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls, smoothly, when the verse is near an edge or outside the view', async () => {
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 560, bottom: 600 };
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const arg = scrollTo.mock.calls[0][0] as { top: number; behavior: string };
    expect(arg.behavior).toBe('smooth');
    expect(arg.top).toBe(1000 + 560 - 300 + 20); // centre the verse
  });

  it('scrolls instantly for people who prefer reduced motion', async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 900, bottom: 940 };
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect((scrollTo.mock.calls[0][0] as { behavior: string }).behavior).toBe('auto');
  });

  it('ignores another tab, and respects the follow and auto-scroll switches', async () => {
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 900, bottom: 940 };
    audioStore.follow.set('t2', 43003016);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled();
    audioStore.setPrefs({ autoScroll: false });
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a scroll event alone never pauses following; the reader\'s wheel does, for 8 seconds', async () => {
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 900, bottom: 940 };
    scroller.dispatchEvent(new Event('scroll')); // what our own smooth scrolling produces
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    scroller.dispatchEvent(new Event('wheel'));
    audioStore.follow.set('t1', 43003017);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1); // the reader is scrolling: stay out of the way

    clock += USER_SCROLL_PAUSE_MS + 1;
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('touch, navigation keys and a scrollbar drag also count as the reader scrolling', async () => {
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 900, bottom: 940 };
    let n = 0;
    const attempt = async (fire: () => void) => {
      clock += USER_SCROLL_PAUSE_MS + 1; // reset
      fire();
      audioStore.follow.set('t1', 43003000 + (++n));
      await frames();
    };
    await attempt(() => scroller.dispatchEvent(new Event('touchmove')));
    await attempt(() => scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' })));
    await attempt(() => scroller.dispatchEvent(new Event('pointerdown')));
    expect(scrollTo).not.toHaveBeenCalled();
    // A key that does not scroll (typing) does not pause it.
    clock += USER_SCROLL_PAUSE_MS + 1;
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    container.querySelector('[data-verse-id]')!.setAttribute('data-verse-id', '43003099');
    audioStore.follow.set('t1', 43003099);
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('switching to the tab being read scrolls to its verse at once, even right after the reader scrolled', async () => {
    audioStore.follow.set('t1', 43003016);
    verseGeometry = { top: 320, bottom: 360 }; // comfortably in view: still centred on arrival
    render(<Harness tabId="t1" />);
    scroller.dispatchEvent(new Event('wheel'));
    await frames();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect((scrollTo.mock.calls[0][0] as { behavior: string }).behavior).toBe('auto');
  });

  it('waits for the verses of a just-turned chapter to mount', async () => {
    render(<Harness tabId="t1" />);
    verseGeometry = { top: 900, bottom: 940 };
    audioStore.follow.set('t1', 43004001); // not in the DOM yet
    await frames(2);
    expect(scrollTo).not.toHaveBeenCalled();
    const late = document.createElement('div');
    late.setAttribute('data-verse-id', '43004001');
    late.getBoundingClientRect = () => rect(900, 940);
    container.appendChild(late);
    await frames(2);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('stops listening on unmount', async () => {
    const view = render(<Harness tabId="t1" />);
    view.unmount();
    verseGeometry = { top: 900, bottom: 940 };
    audioStore.follow.set('t1', 43003016);
    await frames();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
