import { useEffect, useRef } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';

const NAV_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

export interface UserScrollIntentOptions {
  /** The element that actually scrolls. May be null (or replaced) at any time. */
  getScrollElement: () => HTMLElement | null;
  /**
   * true: navigation keys anywhere in the document count (the Bible pane, where
   * focus is usually on the body). false: only keys whose target is inside the scroller.
   */
  keysFromDocument: boolean;
  /** Test seam. */
  now?: () => number;
}

export interface UserScrollIntent {
  /** When the reader last tried to scroll by hand (-Infinity: never). */
  lastAt: MutableRef<number>;
  /** Forget the reader's scrolling (auto-scroll may act at once). */
  clear(): void;
}

/**
 * Notices the reader's own scrolling from their intent (wheel, touch, a
 * scrollbar drag on the scroller itself, navigation keys), never from `scroll`
 * events, so scrolls the app starts can never count as the reader's.
 */
export function useUserScrollIntent({ getScrollElement, keysFromDocument, now = Date.now }: UserScrollIntentOptions): UserScrollIntent {
  const lastAt = useRef(-Infinity);
  const api = useRef<UserScrollIntent>({ lastAt, clear: () => { lastAt.current = -Infinity; } });

  useEffect(() => {
    const inScroller = (target: EventTarget | null): boolean => {
      const el = getScrollElement();
      return !!el && target instanceof Node && (target === el || el.contains(target));
    };
    const mark = () => { lastAt.current = now(); };
    const onPointer = (e: Event) => { if (e.target === getScrollElement()) mark(); }; // a scrollbar drag lands on the scroller itself
    const onPointerLike = (e: Event) => { if (inScroller(e.target)) mark(); };
    const onKey = (e: KeyboardEvent) => {
      if (!NAV_KEYS.has(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // typing, not scrolling
      if (!keysFromDocument && !inScroller(e.target)) return;
      mark();
    };
    const opts = { capture: true, passive: true } as AddEventListenerOptions;
    document.addEventListener('wheel', onPointerLike, opts);
    document.addEventListener('touchmove', onPointerLike, opts);
    document.addEventListener('pointerdown', onPointer, opts);
    document.addEventListener('keydown', onKey as EventListener, opts);
    return () => {
      document.removeEventListener('wheel', onPointerLike, opts);
      document.removeEventListener('touchmove', onPointerLike, opts);
      document.removeEventListener('pointerdown', onPointer, opts);
      document.removeEventListener('keydown', onKey as EventListener, opts);
    };
  }, [keysFromDocument]);

  return api.current;
}
