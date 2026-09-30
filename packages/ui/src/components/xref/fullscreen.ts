/**
 * Full-screen for the cross-reference graph (task 0068). Self-contained so the timeline and genealogy views can
 * adopt or replace it: `useXrefFullscreen(ref)` returns `{ full, toggle }`. `full` is the state to style with (the
 * host stretches its dialog over the whole window when it is true); on top of that the element is asked for the
 * browser's real Fullscreen API when it has one. Leaving through the browser's own Escape flips `full` back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useXrefFullscreen(ref: RefObject<HTMLElement | null>): { full: boolean; toggle: () => void } {
  const [full, setFull] = useState(false);
  const native = useRef(false);

  const toggle = useCallback(() => {
    const next = !full;
    setFull(next);
    const el = ref.current;
    if (next) {
      if (el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
        el.requestFullscreen().then(() => { native.current = true; }, () => { /* the full-window style still applies */ });
      }
    } else if (document.fullscreenElement) {
      native.current = false;
      document.exitFullscreen().catch(() => undefined);
    }
  }, [full, ref]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && native.current) {
        native.current = false;
        setFull(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (native.current && document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  return { full, toggle };
}
