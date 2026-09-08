/**
 * WindowStateService - remembers the main window's geometry across launches,
 * and defaults a fresh install to **maximized**.
 *
 * Without this, a fixed `1400x900` with no maximize means that on Linux (where
 * the window manager does not remember anything for us) the user has to
 * maximize by hand on every single launch. Almost nobody wants a 1400x900
 * window on a 2560-wide monitor for a reading app whose whole layout is panes
 * side by side, so "maximized" is the first-run default, not "restore
 * whatever we last saw" - there is nothing to restore on a first run.
 *
 * State lives in a single small JSON file at `{userData}/window-state.json`
 * (see `getWindowStatePath`). No dependency is pulled in for this;
 * `electron-window-state` is ~100 lines of the same, plus a transitive tree.
 *
 * Sync fs is deliberate, mirroring `NetworkConfig` / `DiagnosticsConfig`: the
 * file is a few dozen bytes, read exactly once at startup, and written on a
 * debounced timer or at close. Nothing hot touches it.
 *
 * ## Why every read is validated
 *
 * The two ways this feature strands a user are both handled here:
 *
 *  1. **A corrupt or truncated file.** The window must still open. Every read
 *     path lands on {@link DEFAULT_WINDOW_STATE} rather than throwing.
 *  2. **A monitor that is no longer plugged in.** Restoring `x/y` from a
 *     display that no longer exists puts the window somewhere the user cannot
 *     reach and cannot drag back. Saved coordinates are therefore checked
 *     against the *current* displays and dropped if the window would not land
 *     meaningfully on one, which makes Electron centre it instead.
 */

import fs from 'fs';
import path from 'path';
import { screen, type BrowserWindow } from 'electron';
import log from 'electron-log';
import { getWindowStatePath } from '../utils/appPaths';

/** Persisted geometry. `x`/`y` are absent when the window has never been placed. */
export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

/** A screen or window rectangle. Matches Electron's `Rectangle`. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * First-run geometry: the historical 1400x900 restore size, shown maximized.
 *
 * The size still matters even though the window starts maximized - it is what
 * the user gets the moment they hit "restore".
 */
export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1400,
  height: 900,
  isMaximized: true,
  isFullScreen: false,
};

/**
 * Geometry used when persistence is switched off (the e2e suite). Explicitly
 * NOT maximized: see the `enabled` option below.
 */
export const TEST_WINDOW_STATE: WindowState = {
  width: 1400,
  height: 900,
  isMaximized: false,
  isFullScreen: false,
};

/** Must match `createWindow()`'s `minWidth` / `minHeight`. */
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * How much of the window has to fall inside a display for the saved position to
 * be considered usable.
 *
 * Bare intersection is not enough: a window overlapping a display by one pixel
 * is as unreachable as one entirely off-screen. This is roughly "enough title
 * bar to grab".
 */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 40;

/** How long the window has to sit still before a resize/move is written out. */
const SAVE_DEBOUNCE_MS = 400;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * True when `bounds` lands far enough onto at least one of `displays` to be
 * usable. An empty display list (which should not happen, but is what a stubbed
 * or not-yet-ready `screen` returns) rejects the position rather than trusting
 * it - the default centred placement is always safe.
 */
export function isVisibleOnAnyDisplay(bounds: Rect, displays: readonly Rect[]): boolean {
  return displays.some((display) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x);
    const overlapY =
      Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y);
    return overlapX >= MIN_VISIBLE_WIDTH && overlapY >= MIN_VISIBLE_HEIGHT;
  });
}

/**
 * Turn whatever was on disk into a state the window can actually be opened
 * with. Never throws.
 *
 * - A non-object, or anything whose size is missing/NaN/negative, falls back to
 *   the defaults wholesale - including `isMaximized: true`, because a file we
 *   cannot read is indistinguishable from a first run.
 * - A size below the window's minimums is clamped, not rejected: the user's
 *   intent ("small") is still honoured as far as the window allows.
 * - A position is kept only if BOTH coordinates are numbers and the resulting
 *   rectangle is visible on a currently-connected display.
 */
export function sanitizeWindowState(raw: unknown, displays: readonly Rect[]): WindowState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_WINDOW_STATE };

  const candidate = raw as Partial<WindowState>;
  if (!isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height)) {
    return { ...DEFAULT_WINDOW_STATE };
  }

  const state: WindowState = {
    width: Math.max(MIN_WIDTH, Math.round(candidate.width)),
    height: Math.max(MIN_HEIGHT, Math.round(candidate.height)),
    // A stored `false` is a real choice and is honoured. Only a missing or
    // non-boolean value falls back to the maximized default.
    isMaximized:
      typeof candidate.isMaximized === 'boolean'
        ? candidate.isMaximized
        : DEFAULT_WINDOW_STATE.isMaximized,
    isFullScreen: candidate.isFullScreen === true,
  };

  if (isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)) {
    const x = Math.round(candidate.x);
    const y = Math.round(candidate.y);
    if (isVisibleOnAnyDisplay({ x, y, width: state.width, height: state.height }, displays)) {
      state.x = x;
      state.y = y;
    } else {
      log.info(
        `[windowState] Saved position ${x},${y} is not on any connected display; centring instead.`
      );
    }
  }

  return state;
}

export interface WindowStateServiceOptions {
  /** Override the state file. Defaults to `{userData}/window-state.json`. */
  filePath?: string;
  /**
   * Whether geometry is read from and written to disk at all.
   *
   * Defaults to `false` under `NODE_ENV=test`, which is what the Playwright
   * fixture sets. Two reasons. First, the fixture resolves `userData` to a
   * per-worker temp dir but the app's *other* dev-mode path helpers resolve
   * into the repository, so a stray state file is easy to leak between runs.
   * Second, and decisive: the e2e suite asserts on pane layout, tab strips and
   * element visibility, all of which move when the window is maximized to
   * whatever size the CI display happens to be. Tests keep the fixed,
   * non-maximized 1400x900 window they were written against.
   */
  enabled?: boolean;
  /** Injectable display list, for tests. Defaults to Electron's `screen`. */
  listDisplayBounds?: () => Rect[];
}

export class WindowStateService {
  private readonly filePath: string;
  private readonly enabled: boolean;
  private readonly listDisplayBounds: () => Rect[];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WindowStateServiceOptions = {}) {
    this.enabled = options.enabled ?? process.env.NODE_ENV !== 'test';
    // Resolved lazily so a caller that supplies a path never touches Electron's
    // `app`, and so a disabled service never needs a userData directory at all.
    this.filePath = options.filePath ?? (this.enabled ? getWindowStatePath() : '');
    this.listDisplayBounds =
      options.listDisplayBounds ?? (() => screen.getAllDisplays().map((d) => d.workArea));
  }

  /**
   * The geometry `createWindow()` should open with. Always returns something
   * usable, whatever is (or is not) on disk.
   */
  read(): WindowState {
    if (!this.enabled) return { ...TEST_WINDOW_STATE };

    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch {
      // Overwhelmingly ENOENT - a first run. Not worth a log line per launch.
      return { ...DEFAULT_WINDOW_STATE };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // This one IS worth naming: the file exists and is garbage, so the user
      // is about to silently lose their geometry.
      log.warn(`[windowState] Ignoring unreadable ${this.filePath}:`, err);
      return { ...DEFAULT_WINDOW_STATE };
    }

    return sanitizeWindowState(parsed, this.safeDisplayBounds());
  }

  /** Write geometry immediately. Failures are logged, never thrown. */
  write(state: WindowState): void {
    if (!this.enabled) return;
    this.cancelPendingSave();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      log.error('[windowState] Failed to persist window state:', err);
    }
  }

  /**
   * Read the window's current geometry.
   *
   * `getNormalBounds()`, never `getBounds()`: on a maximized or full-screen
   * window the latter returns the screen-filling rectangle, which would be
   * saved as the *restore* size and leave the user with no way back to a
   * smaller window.
   */
  capture(window: BrowserWindow): WindowState {
    const bounds = window.getNormalBounds();
    return {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
    };
  }

  /**
   * Apply saved geometry to a freshly created window and start tracking it.
   *
   * Maximizing here - before `ready-to-show`, while the window is still hidden
   * - is what keeps the user from watching it paint at 1400x900 and then jump.
   */
  applyAndTrack(window: BrowserWindow, state: WindowState): void {
    if (state.isFullScreen) {
      window.setFullScreen(true);
    } else if (state.isMaximized) {
      window.maximize();
    }
    this.track(window);
  }

  /**
   * Persist geometry whenever it changes.
   *
   * `close` writes synchronously and without `preventDefault()`, so it composes
   * with `main.ts`'s session-save handshake (which does prevent the default and
   * later calls `destroy()`, firing `close` a second time) instead of racing
   * it. `closed` is the last chance to cancel a pending debounce.
   */
  track(window: BrowserWindow): void {
    if (!this.enabled) return;

    const scheduleSave = (): void => {
      this.cancelPendingSave();
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        if (window.isDestroyed()) return;
        this.write(this.capture(window));
      }, SAVE_DEBOUNCE_MS);
    };

    // Dragging a window fires `move` continuously; debouncing keeps that off
    // the disk until the pointer stops.
    window.on('resize', scheduleSave);
    window.on('move', scheduleSave);
    // Maximize state is a discrete user action - write it straight away, so a
    // crash before the next debounce still remembers the right mode.
    window.on('maximize', () => this.write(this.capture(window)));
    window.on('unmaximize', () => this.write(this.capture(window)));
    window.on('enter-full-screen', () => this.write(this.capture(window)));
    window.on('leave-full-screen', () => this.write(this.capture(window)));

    let savedOnClose = false;
    window.on('close', () => {
      if (savedOnClose || window.isDestroyed()) return;
      savedOnClose = true;
      this.write(this.capture(window));
    });

    window.on('closed', () => this.cancelPendingSave());
  }

  private cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * `screen` is only usable after `app.whenReady()`. A window opened outside
   * that window of validity should still open, so a failure here degrades to
   * "no display information", which drops the saved position.
   */
  private safeDisplayBounds(): Rect[] {
    try {
      return this.listDisplayBounds();
    } catch (err) {
      log.warn('[windowState] Could not enumerate displays:', err);
      return [];
    }
  }
}
