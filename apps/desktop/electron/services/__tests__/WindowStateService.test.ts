/**
 * Window geometry persistence.
 *
 * The problem this exists for: a fixed 1400x900 with no maximize means that on
 * Linux - where the window manager remembers nothing for us - the window opens
 * small on every launch and has to be maximized by hand.
 *
 * The bugs a naive fix introduces, all pinned here:
 *
 *  1. A corrupt or truncated state file takes the window down with it. Every
 *     read path here has to end in a window that opens.
 *  2. A position restored onto a monitor that has since been unplugged strands
 *     the window somewhere the user cannot reach or drag back.
 *  3. Saving `getBounds()` instead of `getNormalBounds()` records the
 *     screen-filling rectangle as the *restore* size, so "restore" does
 *     nothing and the user can never get a smaller window back.
 *  4. Writing on every `move` event hammers the disk for the whole of a drag.
 *
 * `screen` is injected rather than mocked so the display list is exact; the
 * fake `BrowserWindow` records its listeners so the geometry events can be
 * fired by hand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrowserWindow } from 'electron';

// The service imports `screen` from electron and `getWindowStatePath` (which
// reads `app.getPath`) from appPaths. Neither is exercised here - every test
// supplies an explicit path and display list - but the imports must resolve.
vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent', isPackaged: false },
  screen: { getAllDisplays: () => [] },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  WindowStateService,
  sanitizeWindowState,
  isVisibleOnAnyDisplay,
  DEFAULT_WINDOW_STATE,
  type Rect,
  type WindowState,
} from '../WindowStateService';

/** A single 1920x1080 monitor at the origin. */
const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
/** A second monitor to the right, of the sort that gets unplugged. */
const SECONDARY: Rect = { x: 1920, y: 0, width: 1920, height: 1080 };

class FakeWindow {
  normalBounds: Rect = { x: 100, y: 80, width: 1200, height: 800 };
  maximized = false;
  fullScreen = false;
  destroyed = false;
  private handlers = new Map<string, Array<() => void>>();

  getNormalBounds = (): Rect => this.normalBounds;
  // Deliberately different from `normalBounds`: a test that accidentally reads
  // this instead will produce the screen-filling rectangle and fail loudly.
  getBounds = (): Rect => ({ x: 0, y: 0, width: 1920, height: 1080 });
  isMaximized = (): boolean => this.maximized;
  isFullScreen = (): boolean => this.fullScreen;
  isDestroyed = (): boolean => this.destroyed;
  maximize = vi.fn(() => {
    this.maximized = true;
  });
  setFullScreen = vi.fn((value: boolean) => {
    this.fullScreen = value;
  });
  on = vi.fn((event: string, handler: () => void) => {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  });

  emit(event: string): void {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }

  asBrowserWindow(): BrowserWindow {
    return this as unknown as BrowserWindow;
  }
}

describe('WindowStateService', () => {
  let dir: string;
  let statePath: string;

  const service = (overrides: { displays?: Rect[]; enabled?: boolean } = {}): WindowStateService =>
    new WindowStateService({
      filePath: statePath,
      enabled: overrides.enabled ?? true,
      listDisplayBounds: () => overrides.displays ?? [PRIMARY],
    });

  const writeState = (raw: string): void => writeFileSync(statePath, raw, 'utf-8');
  const readState = (): WindowState => JSON.parse(readFileSync(statePath, 'utf-8')) as WindowState;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'windowstate-'));
    statePath = join(dir, 'window-state.json');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('first run and damaged state', () => {
    it('opens maximized when there is no state file at all', () => {
      // The whole point of the feature: a user who has never launched the app
      // gets a maximized window, not a 1400x900 one on a 4K monitor.
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);
      expect(DEFAULT_WINDOW_STATE.isMaximized).toBe(true);
    });

    it('falls back to the defaults when the file is not JSON', () => {
      writeState('{"width": 1200, "hei');
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);
    });

    it('falls back to the defaults when the file is JSON but not an object', () => {
      writeState('"1400x900"');
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);
    });

    it('falls back to the defaults when the size is missing or not a number', () => {
      writeState(JSON.stringify({ x: 10, y: 10, isMaximized: false }));
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);

      writeState(JSON.stringify({ width: 'wide', height: null }));
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);

      writeState(JSON.stringify({ width: Number.NaN, height: 900 }));
      expect(service().read()).toEqual(DEFAULT_WINDOW_STATE);
    });

    it('survives an unreadable path rather than throwing', () => {
      // A directory where the file should be: readFileSync raises EISDIR.
      rmSync(dir, { recursive: true, force: true });
      const svc = new WindowStateService({
        filePath: dir,
        enabled: true,
        listDisplayBounds: () => [PRIMARY],
      });
      expect(() => svc.read()).not.toThrow();
      expect(svc.read()).toEqual(DEFAULT_WINDOW_STATE);
    });
  });

  describe('bounds validation', () => {
    it('restores a saved size and position unchanged', () => {
      writeState(
        JSON.stringify({ width: 1100, height: 700, x: 40, y: 60, isMaximized: false, isFullScreen: false })
      );
      expect(service().read()).toEqual({
        width: 1100,
        height: 700,
        x: 40,
        y: 60,
        isMaximized: false,
        isFullScreen: false,
      });
    });

    it('honours a stored isMaximized:false instead of re-maximizing', () => {
      // A user who deliberately un-maximized must not be overridden by the
      // first-run default on the next launch.
      writeState(JSON.stringify({ width: 1100, height: 700, isMaximized: false }));
      expect(service().read().isMaximized).toBe(false);
    });

    it('clamps a size below the window minimums rather than rejecting it', () => {
      writeState(JSON.stringify({ width: 320, height: 240, isMaximized: false }));
      const state = service().read();
      expect(state.width).toBe(800);
      expect(state.height).toBe(600);
    });

    it('drops a position whose coordinates are not both numbers', () => {
      writeState(JSON.stringify({ width: 1100, height: 700, x: 40, isMaximized: false }));
      const state = service().read();
      expect(state.x).toBeUndefined();
      expect(state.y).toBeUndefined();
      expect(state.width).toBe(1100);
    });
  });

  describe('displays that are no longer connected', () => {
    it('drops a position that lands entirely on an unplugged monitor', () => {
      // Saved while a second monitor was attached at x=1920; that monitor is
      // gone, so these coordinates would strand the window off-screen.
      writeState(
        JSON.stringify({ width: 1200, height: 800, x: 2100, y: 100, isMaximized: false })
      );
      const state = service({ displays: [PRIMARY] }).read();
      expect(state.x).toBeUndefined();
      expect(state.y).toBeUndefined();
      // The SIZE is still the user's; only the placement is surrendered.
      expect(state).toMatchObject({ width: 1200, height: 800, isMaximized: false });
    });

    it('keeps that same position when the second monitor is still attached', () => {
      writeState(
        JSON.stringify({ width: 1200, height: 800, x: 2100, y: 100, isMaximized: false })
      );
      const state = service({ displays: [PRIMARY, SECONDARY] }).read();
      expect(state).toMatchObject({ x: 2100, y: 100 });
    });

    it('drops a position when no displays can be enumerated', () => {
      writeState(JSON.stringify({ width: 1200, height: 800, x: 100, y: 100, isMaximized: false }));
      expect(service({ displays: [] }).read().x).toBeUndefined();
    });

    it('rejects a window that only just clips a display corner', () => {
      // One pixel of overlap is as unreachable as none. Requires a real
      // grabbable strip, not a non-empty intersection.
      expect(isVisibleOnAnyDisplay({ x: 1919, y: 1079, width: 1200, height: 800 }, [PRIMARY])).toBe(false);
      expect(isVisibleOnAnyDisplay({ x: 1700, y: 900, width: 1200, height: 800 }, [PRIMARY])).toBe(true);
      expect(isVisibleOnAnyDisplay({ x: -1300, y: 100, width: 1200, height: 800 }, [PRIMARY])).toBe(false);
    });

    it('sanitizes negative-but-visible coordinates on a monitor left of the primary', () => {
      const state = sanitizeWindowState(
        { width: 1200, height: 800, x: -1000, y: 50, isMaximized: false },
        [PRIMARY, { x: -1920, y: 0, width: 1920, height: 1080 }]
      );
      expect(state).toMatchObject({ x: -1000, y: 50 });
    });
  });

  describe('tracking a window', () => {
    it('maximizes a restored-maximized window before it is shown', () => {
      const win = new FakeWindow();
      service().applyAndTrack(win.asBrowserWindow(), { ...DEFAULT_WINDOW_STATE });
      expect(win.maximize).toHaveBeenCalled();
      expect(win.setFullScreen).not.toHaveBeenCalled();
    });

    it('prefers full screen over maximize when both are set', () => {
      const win = new FakeWindow();
      service().applyAndTrack(win.asBrowserWindow(), {
        ...DEFAULT_WINDOW_STATE,
        isFullScreen: true,
      });
      expect(win.setFullScreen).toHaveBeenCalledWith(true);
      expect(win.maximize).not.toHaveBeenCalled();
    });

    it('saves the NORMAL bounds of a maximized window, not the screen-filling ones', () => {
      const win = new FakeWindow();
      win.maximized = true;
      const svc = service();
      svc.track(win.asBrowserWindow());

      win.emit('maximize');

      const saved = readState();
      // 1200x800 is `getNormalBounds()`. 1920x1080 would be `getBounds()`, and
      // would leave the user with nothing to restore to.
      expect(saved).toEqual({
        width: 1200,
        height: 800,
        x: 100,
        y: 80,
        isMaximized: true,
        isFullScreen: false,
      });
    });

    it('debounces resize and move rather than writing on every event', () => {
      vi.useFakeTimers();
      const win = new FakeWindow();
      service().track(win.asBrowserWindow());

      for (let i = 0; i < 20; i++) {
        win.normalBounds = { ...win.normalBounds, x: 100 + i };
        win.emit('move');
      }
      // Mid-drag: nothing on disk yet.
      expect(existsSync(statePath)).toBe(false);

      vi.advanceTimersByTime(500);
      // Exactly one write, carrying the LAST position.
      expect(readState()).toMatchObject({ x: 119 });
    });

    it('writes on close, and only once even though close fires twice', () => {
      // `main.ts` preventDefaults `close` for the session-save handshake and
      // then calls `destroy()`, which fires `close` again.
      const win = new FakeWindow();
      service().track(win.asBrowserWindow());

      win.normalBounds = { x: 5, y: 6, width: 1000, height: 700 };
      win.emit('close');
      const first = readState();

      win.normalBounds = { x: 999, y: 999, width: 1000, height: 700 };
      win.emit('close');
      expect(readState()).toEqual(first);
    });

    it('does not write after the window is destroyed', () => {
      vi.useFakeTimers();
      const win = new FakeWindow();
      service().track(win.asBrowserWindow());

      win.emit('resize');
      win.destroyed = true;
      win.emit('closed');
      vi.advanceTimersByTime(500);

      expect(existsSync(statePath)).toBe(false);
    });

    it('logs and continues when the state file cannot be written', () => {
      const win = new FakeWindow();
      const svc = new WindowStateService({
        // A path under a file, so mkdir/write both fail.
        filePath: join(statePath, 'nested', 'window-state.json'),
        enabled: true,
        listDisplayBounds: () => [PRIMARY],
      });
      writeState('{}');
      svc.track(win.asBrowserWindow());
      expect(() => win.emit('close')).not.toThrow();
    });
  });

  describe('disabled (the e2e suite)', () => {
    it('reads nothing from disk and opens a fixed, non-maximized window', () => {
      writeState(JSON.stringify({ width: 640, height: 480, x: 7, y: 7, isMaximized: true }));
      const state = service({ enabled: false }).read();
      expect(state).toEqual({ width: 1400, height: 900, isMaximized: false, isFullScreen: false });
    });

    it('registers no listeners, so a test run cannot leave state behind', () => {
      const win = new FakeWindow();
      const svc = service({ enabled: false });
      svc.track(win.asBrowserWindow());
      expect(win.on).not.toHaveBeenCalled();

      win.emit('close');
      svc.write({ width: 1, height: 1, isMaximized: true, isFullScreen: false });
      expect(existsSync(statePath)).toBe(false);
    });

    it('defaults to disabled under NODE_ENV=test', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        const svc = new WindowStateService({ filePath: statePath, listDisplayBounds: () => [PRIMARY] });
        writeState(JSON.stringify({ width: 640, height: 480, isMaximized: true }));
        expect(svc.read().isMaximized).toBe(false);
      } finally {
        process.env.NODE_ENV = original;
      }
    });
  });
});
