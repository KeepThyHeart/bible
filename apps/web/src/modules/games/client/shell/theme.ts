/**
 * Applying a theme to the page, and a player's local override of it.
 *
 * `RoomSettings.theme` decides what a joining player sees first; from there it
 * is exactly as untouched as any other room setting, until this device
 * chooses to override it. The override lives in this browser's localStorage,
 * so it survives a reload but never reaches another player, another device,
 * or the room's own settings, and it never rides over the wire — the room
 * never learns a player overrode anything.
 *
 * Reading and writing storage is wrapped the way `session.ts` wraps it: a
 * private window, a blocked cookie jar or a webview that only pretends to
 * have storage all throw or return null, and a phone that cannot remember an
 * override still plays fine on the room's theme.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { DEFAULT_THEME, THEME_TOKEN_KEYS, isThemeColor, type ThemeTokens } from '../../shared/theme.js';

const CSS_VARS: Readonly<Record<keyof ThemeTokens, string>> = {
  bg: '--bg',
  bgRaised: '--bg-raised',
  bgSunken: '--bg-sunken',
  fg: '--fg',
  fgMuted: '--fg-muted',
  border: '--border',
  accent: '--accent',
  accentFg: '--accent-fg',
  correct: '--correct',
  wrong: '--wrong',
  warn: '--warn',
};

/** Perceived luminance of a 6-digit hex colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ---------------------------------------------------------------------------
// Where the theme goes (task 0115)
// ---------------------------------------------------------------------------

/**
 * Standalone (the phone page) the theme is written on <html>. Embedded in the
 * reader it goes on the games' own root element, so a room's theme cannot
 * recolour the reader around it; and with `followHost` set, a room or device
 * that has no theme of its own leaves the element unstyled, so the colour
 * tokens resolve to the reader's `--kth-*` tokens (see `styles/app.css`).
 */
let hostElement: HTMLElement | null = null;
let followHostTheme = false;

export function configureThemeHost(element: HTMLElement | null, followHost: boolean): void {
  if (hostElement && hostElement !== element) clearTheme(hostElement);
  hostElement = element;
  followHostTheme = element !== null && followHost;
}

function themeTarget(): HTMLElement {
  return hostElement ?? document.documentElement;
}

/** Removes every theme token from an element's inline style. */
export function clearTheme(target: HTMLElement = themeTarget()): void {
  for (const key of THEME_TOKEN_KEYS) target.style.removeProperty(CSS_VARS[key]);
  target.style.removeProperty('color-scheme');
}

function applyActive(theme: ThemeTokens, explicit: boolean): void {
  if (followHostTheme && !explicit) clearTheme();
  else applyTheme(theme);
}

/**
 * Writes a theme's tokens onto an element's inline style, which is what wins
 * over the fallback values in `app.css`'s `:root` with no specificity fight.
 * `color-scheme` rides along, derived from the background's own lightness
 * rather than kept as a separate flag, so a host-edited theme still gets
 * native widgets (scrollbars, form controls) that match it.
 */
export function applyTheme(theme: ThemeTokens, target: HTMLElement = themeTarget()): void {
  for (const key of THEME_TOKEN_KEYS) {
    target.style.setProperty(CSS_VARS[key], theme[key]);
  }
  target.style.colorScheme = luminance(theme.bg) < 0.5 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// Local override
// ---------------------------------------------------------------------------

const OVERRIDE_KEY = 'bible-games:theme-override';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadThemeOverride(): ThemeTokens | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(OVERRIDE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A half-written value from a killed tab, or someone else's key.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const source = parsed as Record<string, unknown>;

  const theme = {} as ThemeTokens;
  for (const key of THEME_TOKEN_KEYS) {
    const value = source[key];
    if (!isThemeColor(value)) return null;
    theme[key] = value;
  }
  return theme;
}

export function saveThemeOverride(theme: ThemeTokens): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(OVERRIDE_KEY, JSON.stringify(theme));
  } catch {
    // Out of quota, or a window that only pretends to have storage. The
    // override is a convenience; losing it costs a reset back to the room's
    // theme, not a broken page.
    return;
  }
}

export function clearThemeOverride(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(OVERRIDE_KEY);
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Wiring the two together
// ---------------------------------------------------------------------------

export interface ThemeControl {
  /** What is actually applied: the override if there is one, else the room's. */
  theme: ThemeTokens;
  /** Whether `theme` is this device's own override rather than the room's. */
  isOverridden: boolean;
  /** Sets (and persists) a local override, or, given `null`, clears it. */
  setOverride(theme: ThemeTokens | null): void;
}

function themeKey(theme: ThemeTokens): string {
  return THEME_TOKEN_KEYS.map((key) => theme[key]).join('|');
}

/**
 * Applies whichever theme wins — this device's override, else the room's,
 * else the default — and keeps the page in step as either one changes.
 *
 * `roomTheme` is `null` before any snapshot has arrived; the default carries
 * the page until one does, which is only ever a moment; a stored override, if
 * there is one, wins from the very first paint.
 */
export function useTheme(roomTheme: ThemeTokens | null): ThemeControl {
  const [override, setOverrideState] = useState<ThemeTokens | null>(() => loadThemeOverride());
  const active = override ?? roomTheme ?? DEFAULT_THEME;
  const activeKey = themeKey(active);

  // `active` is a fresh object on every snapshot; `activeKey` is what
  // actually changed, and is what should decide whether to touch the DOM.
  const explicit = override !== null || roomTheme !== null;
  useEffect(() => {
    applyActive(active, explicit);
  }, [activeKey, explicit]);

  const setOverride = useCallback((theme: ThemeTokens | null) => {
    if (theme) saveThemeOverride(theme);
    else clearThemeOverride();
    setOverrideState(theme);
  }, []);

  return { theme: active, isOverridden: override !== null, setOverride };
}

/**
 * Applies the room's theme with no local override: for the projector, which
 * is the one screen everyone in the room is looking at together. A private
 * override there would mean the host's laptop no longer shows what the group
 * sees, so `ScreenApp` uses this instead of `useTheme`. A player's own phone,
 * and a solo player's — nobody else's screen — use `useTheme`.
 */
export function useRoomTheme(roomTheme: ThemeTokens | null): void {
  const active = roomTheme ?? DEFAULT_THEME;
  const activeKey = themeKey(active);
  const explicit = roomTheme !== null;
  useEffect(() => {
    applyActive(active, explicit);
  }, [activeKey, explicit]);
}
