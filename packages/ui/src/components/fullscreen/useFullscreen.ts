/**
 * The one full-screen mechanism for the timeline, genealogy and cross-reference views (task 0096).
 *
 * `useFullscreen(ref)` returns `{ full, toggle, enter, exit }`. While `full` is true the host adds
 * `FULLSCREEN_CLASS` to the element in `ref`, which then covers the whole window (CSS only, so the view is never
 * re-mounted and keeps its zoom, pan, selection and filters). Where the browser has a real Fullscreen API the
 * element is also asked for it; when that is missing, refused or unwanted (Electron: the app window is enough)
 * the full-window overlay alone does the job. While full: Escape leaves (unless the event was already handled or
 * `escape` is false), Tab stays inside the element, the page behind does not scroll, and focus returns to
 * where it was on leaving.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Added by the host to the full-screen element while `full` is true; styled in kth-classes.css. */
export const FULLSCREEN_CLASS = 'kth-fs-on';

export interface UseFullscreenOptions {
  /** Ask for the browser's real Fullscreen API as well. Default: yes, except inside Electron. */
  native?: boolean;
  /** Escape leaves full screen. Default true; pass false while a popup inside the view owns Escape. */
  escape?: boolean;
}

export interface FullscreenControl {
  full: boolean;
  toggle: () => void;
  enter: () => void;
  exit: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isElectron(): boolean {
  return typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
}

export function useFullscreen(ref: RefObject<HTMLElement | null>, options: UseFullscreenOptions = {}): FullscreenControl {
  const { native = !isElectron(), escape = true } = options;
  const [full, setFull] = useState(false);
  const fullRef = useRef(false);
  const opener = useRef<Element | null>(null);
  const owned = useRef(false); // this hook's element holds (or is asking for) the browser's fullscreen
  const seen = useRef(false); // the browser actually entered fullscreen for it
  const wanted = useRef(false);
  const escapeRef = useRef(escape);
  escapeRef.current = escape;

  const set = useCallback((next: boolean) => {
    if (fullRef.current === next) return;
    fullRef.current = next;
    setFull(next);
  }, []);

  const enter = useCallback(() => {
    if (fullRef.current) return;
    opener.current = document.activeElement;
    set(true);
    const el = ref.current;
    if (native && el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      owned.current = true;
      seen.current = false;
      wanted.current = true;
      el.requestFullscreen().then(
        // Left again before the browser answered: give the fullscreen back.
        () => { if (!wanted.current && document.fullscreenElement === el) document.exitFullscreen().catch(() => undefined); },
        // Refused: the full-window overlay still applies.
        () => { owned.current = false; },
      );
    }
  }, [native, ref, set]);

  const exit = useCallback(() => {
    if (!fullRef.current) return;
    wanted.current = false;
    owned.current = false;
    seen.current = false;
    if (ref.current && document.fullscreenElement === ref.current) document.exitFullscreen().catch(() => undefined);
    set(false);
  }, [ref, set]);

  const toggle = useCallback(() => (fullRef.current ? exit() : enter()), [enter, exit]);

  // The browser's own exit (its Escape) flips the state back. A request still pending fires with no element: only a real exit counts.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) { seen.current = true; return; }
      if (owned.current && seen.current) { owned.current = false; seen.current = false; wanted.current = false; set(false); }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (owned.current && document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [set]);

  // While full: Escape, Tab containment and scroll lock; on leaving, focus goes back.
  // A layout effect, so the listeners are in place as soon as the state commits (Preact runs plain effects later).
  const wasFull = useRef(false);
  useLayoutEffect(() => {
    if (!full) {
      if (wasFull.current) {
        wasFull.current = false;
        const o = opener.current;
        if (o instanceof HTMLElement && o.isConnected) o.focus();
      }
      return undefined;
    }
    wasFull.current = true;
    const doc = ref.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (!escapeRef.current) return;
        e.preventDefault();
        exit();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      const inside = active instanceof Node && el.contains(active);
      // A popover opened from inside (e.g. timeline settings) portals to <body> when no native full screen element exists (Electron): let Tab move within it.
      const pop = !inside && active instanceof Element ? active.closest<HTMLElement>('.kth-popover') : null;
      if (pop) {
        const own = Array.from(pop.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (own.length && !e.shiftKey && active === own[own.length - 1]) { e.preventDefault(); own[0].focus(); }
        else if (own.length && e.shiftKey && active === own[0]) { e.preventDefault(); own[own.length - 1].focus(); }
        return;
      }
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    doc.addEventListener('keydown', onKey);
    // A `contain: layout`/transform ancestor (dockview panes) would make the fixed overlay fill only that ancestor: lift it while full.
    const lifted: Array<{ el: HTMLElement; contain: string; transform: string }> = [];
    for (let a = ref.current?.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const contain = /layout|paint|strict|content/.test(cs.contain || '');
      const transform = !!cs.transform && cs.transform !== 'none';
      if (contain || transform) {
        lifted.push({ el: a, contain: a.style.contain, transform: a.style.transform });
        if (contain) a.style.contain = 'none';
        if (transform) a.style.transform = 'none';
      }
    }
    const prevOverflow = doc.documentElement.style.overflow;
    doc.documentElement.style.overflow = 'hidden';
    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.documentElement.style.overflow = prevOverflow;
      for (const l of lifted) { l.el.style.contain = l.contain; l.el.style.transform = l.transform; }
    };
  }, [full, ref, exit]);

  return { full, toggle, enter, exit };
}
