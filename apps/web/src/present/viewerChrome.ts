/**
 * The small pieces of behaviour that belong to the physical screen rather than
 * to the session: keeping it awake, filling it, and keeping text off the bezel.
 *
 * None of these travel over the protocol. They are properties of one display,
 * and broadcasting them would push a television's quirks onto every phone
 * following along in the pews.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { MAX_FONT_STEP, MIN_FONT_STEP, type PresentDisplay, type PresentTheme } from './protocol';

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
/** `null` disables the keys entirely -- used by the controller's preview pane. */
export function useSetupKeys(handlers: {
  toggleFullscreen(): void;
  adjustOverscan(delta: number): void;
} | null): void {
  useEffect(() => {
    if (!handlers) return;
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

// ---------------------------------------------------------------------------
// Local override
// ---------------------------------------------------------------------------

const OVERRIDE_KEY = 'present-viewer-override';

interface StoredOverride {
  theme?: PresentTheme;
  fontStep?: number;
}

function isPresentTheme(value: unknown): value is PresentTheme {
  return value === 'light' || value === 'dark' || value === 'max';
}

/** Parse whatever this browser last saved, dropping anything that no longer makes sense. */
export function parseStoredOverride(raw: string | null): StoredOverride {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOverride>;
    const out: StoredOverride = {};
    if (isPresentTheme(parsed.theme)) out.theme = parsed.theme;
    if (typeof parsed.fontStep === 'number' && parsed.fontStep >= MIN_FONT_STEP && parsed.fontStep <= MAX_FONT_STEP) {
      out.fontStep = parsed.fontStep;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * What this screen actually shows: the presenter's own choice, unless this
 * browser has overridden one or both -- see the hover menu (`ScreenMenu.tsx`).
 * A pure function so the one rule ("an override wins; otherwise the
 * presenter's setting stands") is exercised directly rather than only through
 * a rendered component.
 */
export function effectiveDisplay(
  presenter: Pick<PresentDisplay, 'theme' | 'fontStep'>,
  override: StoredOverride,
): { theme: PresentTheme; fontStep: number } {
  return {
    theme: override.theme ?? presenter.theme,
    fontStep: override.fontStep ?? presenter.fontStep,
  };
}

/**
 * This screen's own theme and size, kept in this browser only -- never sent
 * anywhere. "Use the presenter's settings" simply clears it, which is why
 * `theme`/`fontStep` are `null` rather than always holding some value: `null`
 * means "no opinion", not "some default".
 *
 * Reported to the presenter is not implemented by this hook: that needs a
 * channel from a viewer (which holds no control token) back to the
 * controller, which is a server-side addition of its own. See the task
 * thread's question 1.
 */
export function useLocalOverride(): {
  theme: PresentTheme | null;
  fontStep: number | null;
  hasOverride: boolean;
  setTheme(theme: PresentTheme): void;
  setFontStep(step: number): void;
  clear(): void;
} {
  const [stored, setStored] = useState<StoredOverride>(() => {
    try {
      return parseStoredOverride(localStorage.getItem(OVERRIDE_KEY));
    } catch {
      return {};
    }
  });

  const persist = useCallback((next: StoredOverride) => {
    setStored(next);
    try {
      if (next.theme === undefined && next.fontStep === undefined) {
        localStorage.removeItem(OVERRIDE_KEY);
      } else {
        localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
      }
    } catch {
      // Private mode: the override lasts for this tab only.
    }
  }, []);

  return {
    theme: stored.theme ?? null,
    fontStep: stored.fontStep ?? null,
    hasOverride: stored.theme !== undefined || stored.fontStep !== undefined,
    setTheme: theme => persist({ ...stored, theme }),
    setFontStep: step => persist({ ...stored, fontStep: Math.min(Math.max(step, MIN_FONT_STEP), MAX_FONT_STEP) }),
    clear: () => persist({}),
  };
}

// ---------------------------------------------------------------------------
// Hover menu
// ---------------------------------------------------------------------------

/** How long the pointer may sit still before the menu hides again. */
const HOVER_HIDE_MS = 3000;

/**
 * Whether the hover options (`ScreenMenu.tsx`) should currently be shown: on
 * pointer movement, hidden again after `HOVER_HIDE_MS` of stillness.
 *
 * `disabled` covers two cases that must never show it: the controller's own
 * preview (a rendering of the wall, not a screen someone is standing in front
 * of) and a lobby with nothing yet on the wall (nothing to adjust the display
 * of). A screen with no mouse attached simply never moves one, so it never
 * appears there either -- no separate "is this a TV" detection is needed.
 */
export function useHoverMenu(disabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disabled) {
      setVisible(false);
      return;
    }

    const onMove = (): void => {
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), HOVER_HIDE_MS);
    };

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [disabled]);

  return visible && !disabled;
}
