/**
 * The small pieces of behaviour that belong to the physical screen rather than
 * to the session: keeping it awake, filling it, and keeping text off the bezel.
 *
 * None of these travel over the protocol. They are properties of one display,
 * and broadcasting them would push a television's quirks onto every phone
 * following along in the pews.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';

const OVERSCAN_KEY = 'present-viewer-overscan';
export const MAX_OVERSCAN = 5;

/**
 * Keep the panel from sleeping partway through a sermon.
 *
 * The lock is dropped by the browser whenever the tab is hidden, so it has to
 * be re-taken on every `visibilitychange`. Missing that is why "the screen
 * still went black" survives a first implementation.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (!nav.wakeLock) return;

    let sentinel: { release(): Promise<void> } | null = null;
    let disposed = false;

    const acquire = async (): Promise<void> => {
      if (disposed || document.visibilityState !== 'visible') return;
      try {
        sentinel = await nav.wakeLock!.request('screen');
      } catch {
        // Denied, unsupported, or the document is not visible. Nothing to do
        // and nothing worth putting on screen about it.
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * Percentage of each edge to keep clear.
 *
 * Older televisions overscan: they crop a few percent off every side of the
 * signal, which eats the first and last line of anything that assumes it owns
 * the panel. This is set once when the room is set up and then never touched,
 * so it lives in this browser's storage and is nudged from the keyboard -- the
 * machine driving the TV has one attached, since somebody plugged it in.
 */
export function useOverscan(): { overscan: number; adjust(delta: number): void } {
  const [overscan, setOverscan] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(OVERSCAN_KEY));
      return Number.isFinite(saved) ? Math.min(Math.max(saved, 0), MAX_OVERSCAN) : 0;
    } catch {
      return 0;
    }
  });

  const adjust = useCallback((delta: number) => {
    setOverscan(current => {
      const next = Math.min(Math.max(current + delta, 0), MAX_OVERSCAN);
      try {
        localStorage.setItem(OVERSCAN_KEY, String(next));
      } catch {
        // Private mode: the setting lasts for this session only.
      }
      return next;
    });
  }, []);

  return { overscan, adjust };
}

/**
 * Fullscreen, which browsers will only grant in response to a real gesture.
 *
 * That constraint is the reason the lobby screen exists in the form it does:
 * it gives whoever is setting up something obvious to click, and the click is
 * what buys the fullscreen.
 */
export function useFullscreen(): { isFullscreen: boolean; toggle(): void } {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);

  useEffect(() => {
    const onChange = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return { isFullscreen, toggle };
}

/**
 * The viewer's own keyboard, which is for setting the room up and nothing else.
 *
 * There is deliberately no navigation here. The wall is driven from the
 * controller; a stray key press at the lectern machine must not move what the
 * congregation is reading.
 */
export function useSetupKeys(handlers: {
  toggleFullscreen(): void;
  adjustOverscan(delta: number): void;
}): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      switch (event.key) {
        case 'f':
        case 'F':
          handlers.toggleFullscreen();
          break;
        case '[':
          handlers.adjustOverscan(-1);
          break;
        case ']':
          handlers.adjustOverscan(1);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
