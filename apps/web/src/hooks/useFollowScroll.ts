import { useEffect, useRef } from 'preact/hooks';
import { audioStore } from '../stores/audioStore';

/** After the reader scrolls by hand, auto-scroll stays out of the way for this long. */
export const USER_SCROLL_PAUSE_MS = 8000;
/** A verse this close to the top or bottom edge (a fraction of the height) is scrolled to centre. */
const COMFORT_MARGIN = 0.15;
const RETRY_FRAMES = 12;

export interface FollowScrollOptions {
  /** The element that actually scrolls (on phones, the outer wrapper, not the pane). */
  getScrollElement: () => HTMLElement | null;
  /** The element holding the verses (`[data-verse-id]`). */
  getContainer: () => HTMLElement | null;
  activeTabId: string;
  /** Test seam. */
  now?: () => number;
}

const NAV_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/**
 * Scrolls the Bible pane to the verse being read aloud, without ever fighting
 * the reader.
 *
 * Whether a scroll was the reader's is decided from their *intent* (wheel,
 * touch, keys, a scrollbar drag), never from `scroll` events, so the smooth
 * scrolls this hook starts itself can never pause it. It does nothing when the
 * verse is already comfortably in view, scrolls instantly for people who ask
 * for reduced motion, and never touches the selection or history: it only moves
 * the viewport.
 */
export function useFollowScroll({ getScrollElement, getContainer, activeTabId, now = Date.now }: FollowScrollOptions): void {
  const lastUserScrollAt = useRef(-Infinity);

  // The reader's own scrolling.
  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    const mark = () => { lastUserScrollAt.current = now(); };
    const onPointerDown = (e: Event) => { if (e.target === el) mark(); }; // a scrollbar drag lands on the scroller itself
    const onKey = (e: KeyboardEvent) => { if (NAV_KEYS.has(e.key)) mark(); };
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('touchmove', mark, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('keydown', onKey as EventListener);
    return () => {
      el.removeEventListener('wheel', mark);
      el.removeEventListener('touchmove', mark);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('keydown', onKey as EventListener);
    };
  }, [activeTabId]);

  // Follow the verse being read.
  useEffect(() => {
    let frame = 0;
    const cancel = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };

    const scrollTo = (verseId: number, instant: boolean, attemptsLeft: number) => {
      const scrollEl = getScrollElement();
      const container = getContainer();
      const verseEl = container?.querySelector<HTMLElement>(`[data-verse-id="${verseId}"]`);
      if (!scrollEl || !verseEl) {
        // A chapter turned a moment ago may not have mounted its verses yet.
        if (attemptsLeft > 0) frame = requestAnimationFrame(() => scrollTo(verseId, instant, attemptsLeft - 1));
        return;
      }
      const scroller = scrollEl.getBoundingClientRect();
      const verse = verseEl.getBoundingClientRect();
      const margin = scroller.height * COMFORT_MARGIN;
      const comfortable = verse.top >= scroller.top + margin && verse.bottom <= scroller.bottom - margin;
      if (comfortable && !instant) return;
      const target = scrollEl.scrollTop + (verse.top - scroller.top) - scrollEl.clientHeight / 2 + verse.height / 2;
      const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      scrollEl.scrollTo({ top: Math.max(0, target), behavior: instant || reduced ? 'auto' : 'smooth' });
    };

    const onFollow = () => {
      const { tabId, verseId } = audioStore.follow;
      if (verseId === null || tabId !== activeTabId) return;
      if (!audioStore.prefs.followAlong || !audioStore.prefs.autoScroll) return;
      if (now() - lastUserScrollAt.current < USER_SCROLL_PAUSE_MS) return;
      cancel();
      scrollTo(verseId, false, RETRY_FRAMES);
    };

    // Coming back to the tab that is being read: land on the verse at once,
    // whatever the reader did before (their scrolling was on another tab).
    const { tabId, verseId } = audioStore.follow;
    if (verseId !== null && tabId === activeTabId && audioStore.prefs.followAlong && audioStore.prefs.autoScroll) {
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => scrollTo(verseId, true, RETRY_FRAMES)); });
    }

    const off = audioStore.follow.subscribe(onFollow);
    return () => { off(); cancel(); };
  }, [activeTabId]);
}
