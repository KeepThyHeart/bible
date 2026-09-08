/**
 * Unit tests for WindowManager - the main-process half of pop-out.
 *
 * `WindowManager` owns every detached window's lifecycle: creating the
 * `BrowserWindow`, deferring the `initialize-pane` handover until the renderer
 * has actually mounted, tracking link state, and broadcasting verse changes to
 * the windows that are still following the main window.
 *
 * The bugs this class can produce are all quiet ones - a window that never
 * receives its state, a `send()` on a destroyed webContents, a map entry that
 * outlives its window and leaks - so the tests here drive the Electron event
 * callbacks by hand rather than trusting a happy path.
 *
 * `BrowserWindow` is replaced with a fake that records constructor options and
 * lets tests fire `ready-to-show` / `closed` on demand.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted so the `vi.mock('electron')` factory - which vitest lifts to the top
// of the module - can reference the fake class.
const { FakeBrowserWindow, constructed } = vi.hoisted(() => {
  let nextWebContentsId = 1;

  class FakeWebContents {
    // Electron gives every webContents an id; `broadcastVerseChange` uses it
    // to skip the window that sent the navigation.
    id = nextWebContentsId++;
    sent: Array<{ channel: string; payload: unknown }> = [];
    send = vi.fn((channel: string, payload: unknown) => {
      this.sent.push({ channel, payload });
    });
    openDevTools = vi.fn();
    setWindowOpenHandler = vi.fn();
    on = vi.fn();
  }

  class FakeBrowserWindow {
    options: any;
    webContents = new FakeWebContents();
    destroyed = false;
    shown = false;
    menu: unknown = 'default';
    loadedUrl: string | null = null;
    loadedFile: { path: string; options?: unknown } | null = null;

    private onceHandlers = new Map<string, Array<() => void>>();
    private onHandlers = new Map<string, Array<() => void>>();

    constructor(options: any) {
      this.options = options;
      constructed.push(this);
    }

    once = vi.fn((event: string, handler: () => void) => {
      const list = this.onceHandlers.get(event) ?? [];
      list.push(handler);
      this.onceHandlers.set(event, list);
    });

    on = vi.fn((event: string, handler: () => void) => {
      const list = this.onHandlers.get(event) ?? [];
      list.push(handler);
      this.onHandlers.set(event, list);
    });

    setMenu = vi.fn((menu: unknown) => { this.menu = menu; });
    show = vi.fn(() => { this.shown = true; });
    loadURL = vi.fn((url: string) => { this.loadedUrl = url; });
    loadFile = vi.fn((path: string, options?: unknown) => { this.loadedFile = { path, options }; });
    isDestroyed = vi.fn(() => this.destroyed);

    close = vi.fn(() => {
      this.destroyed = true;
      this.emit('closed');
    });

    /** Fire an Electron event the way the real BrowserWindow would. */
    emit(event: string) {
      for (const handler of this.onceHandlers.get(event) ?? []) handler();
      this.onceHandlers.delete(event);
      for (const handler of this.onHandlers.get(event) ?? []) handler();
    }
  }

  /** Every fake window constructed during the current test. */
  const constructed: FakeBrowserWindow[] = [];

  return { FakeBrowserWindow, constructed };
});

type FakeWindow = InstanceType<typeof FakeBrowserWindow>;

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const applyWindowSecurity = vi.fn();
vi.mock('../../utils/windowSecurity', () => ({
  applyWindowSecurity: (...args: unknown[]) => applyWindowSecurity(...args),
}));

import { WindowManager } from '../WindowManager';

function makeManager() {
  return new WindowManager();
}

function detach(manager: WindowManager, overrides: Partial<Parameters<WindowManager['detachPane']>[0]> = {}) {
  return manager.detachPane({
    paneType: 'bible',
    title: 'Bible - KJV - John 3',
    initialState: { currentChapter: 3 },
    ...overrides,
  });
}

/** The most recently constructed fake window. */
function lastWindow(): FakeWindow {
  return constructed[constructed.length - 1];
}

beforeEach(() => {
  constructed.length = 0;
  applyWindowSecurity.mockClear();
  delete process.env.ELECTRON_RENDERER_URL;
  delete process.env.NODE_ENV;
});

describe('detachPane: window creation', () => {
  it('returns a window id and tracks the window', () => {
    const manager = makeManager();
    const id = detach(manager);

    expect(id).toBe('detached-1');
    expect(manager.getDetachedWindowCount()).toBe(1);
    expect(manager.getDetachedWindow(id)?.paneType).toBe('bible');
  });

  it('issues a unique id per detached window', () => {
    const manager = makeManager();
    const ids = [detach(manager), detach(manager), detach(manager)];

    expect(new Set(ids).size).toBe(3);
    expect(manager.getDetachedWindowCount()).toBe(3);
  });

  it('does not reuse an id after a window closes', () => {
    // Reusing ids would let a stale renderer address a window that has since
    // been replaced by a different pane.
    const manager = makeManager();
    const first = detach(manager);
    lastWindow().emit('closed');

    const second = detach(manager);
    expect(second).not.toBe(first);
  });

  it('applies the requested dimensions and title', () => {
    const manager = makeManager();
    detach(manager, { width: 640, height: 480, title: 'Commentary - MHC' });

    expect(lastWindow().options.width).toBe(640);
    expect(lastWindow().options.height).toBe(480);
    expect(lastWindow().options.title).toBe('Commentary - MHC');
  });

  it('falls back to default dimensions when none are given', () => {
    const manager = makeManager();
    detach(manager, { width: undefined, height: undefined });

    expect(lastWindow().options.width).toBe(900);
    expect(lastWindow().options.height).toBe(700);
  });

  it('creates the window hidden and strips its menu', () => {
    // Showing before `ready-to-show` gives the user a white flash; leaving the
    // menu on gives detached panes a File/Edit bar they have no use for.
    const manager = makeManager();
    detach(manager);

    expect(lastWindow().options.show).toBe(false);
    expect(lastWindow().setMenu).toHaveBeenCalledWith(null);
  });

  it('keeps its computed title instead of letting the page overwrite it', () => {
    // detached.html has its own <title>; Electron pushes a loaded page's title
    // onto the window unless the event is cancelled, which made every detached
    // window read "Detached Pane - ..." and rendered paneConfig.titleFormat
    // dead code.
    const manager = makeManager();
    detach(manager, { title: 'Bible - KJV - John 3' });

    // Must be registered on the BrowserWindow: the webContents event of the
    // same name fires but does not gate the native window title.
    const registered = lastWindow().on.mock.calls
      .find(([event]) => event === 'page-title-updated');
    expect(registered, 'page-title-updated handler on the window').toBeDefined();

    // The handler must actually cancel the event, not merely be registered.
    const preventDefault = vi.fn();
    const handler = registered![1] as unknown as (event: { preventDefault: () => void }) => void;
    handler({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('hardens the renderer the same way the main window is hardened', () => {
    const manager = makeManager();
    detach(manager);

    expect(lastWindow().options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(applyWindowSecurity).toHaveBeenCalledTimes(1);
    expect(applyWindowSecurity.mock.calls[0][0]).toBe(lastWindow().webContents);
  });

  it('loads the dev server URL with pane type and id when running under vite', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const manager = makeManager();
    const id = detach(manager, { paneType: 'commentary' });

    expect(lastWindow().loadedUrl).toBe(
      `http://localhost:5173/detached.html?type=commentary&id=${id}`
    );
    expect(lastWindow().loadFile).not.toHaveBeenCalled();
  });

  it('loads detached.html from disk in a packaged build', () => {
    const manager = makeManager();
    const id = detach(manager, { paneType: 'book' });

    expect(lastWindow().loadURL).not.toHaveBeenCalled();
    expect(lastWindow().loadedFile?.path).toContain('detached.html');
    expect(lastWindow().loadedFile?.options).toEqual({ query: { type: 'book', id } });
  });
});

describe('detachPane: state handover', () => {
  it('does not send initialize-pane before the renderer is ready', () => {
    // 'did-finish-load' fires before React mounts, so the listener is not yet
    // registered and the state would be dropped on the floor - the window would
    // come up blank. 'ready-to-show' is the trigger for that reason.
    const manager = makeManager();
    detach(manager);

    expect(lastWindow().webContents.send).not.toHaveBeenCalled();
    expect(lastWindow().shown).toBe(false);
  });

  it('shows the window and sends the full payload on ready-to-show', () => {
    const manager = makeManager();
    const id = detach(manager, { paneType: 'commentary', initialState: { currentVerseId: 43003016 } });

    lastWindow().emit('ready-to-show');

    expect(lastWindow().shown).toBe(true);
    expect(lastWindow().webContents.sent).toEqual([
      {
        channel: 'initialize-pane',
        payload: {
          paneType: 'commentary',
          windowId: id,
          componentName: 'CommentaryPane',
          state: { currentVerseId: 43003016 },
        },
      },
    ]);
  });

  it('resolves the component name from paneConfig for each pane type', () => {
    const cases: Array<[string, string]> = [
      ['bible', 'BiblePane'],
      ['commentary', 'CommentaryPane'],
      ['book', 'BookPane'],
      ['verse-notes', 'UserNotesPane'],
      ['topics', 'TopicsPane'],
      ['study', 'StudyPane'],
    ];

    for (const [paneType, expected] of cases) {
      const manager = makeManager();
      detach(manager, { paneType });
      lastWindow().emit('ready-to-show');

      const payload = lastWindow().webContents.sent[0].payload as { componentName: string };
      expect(payload.componentName, paneType).toBe(expected);
    }
  });

  // 'dictionary' is deliberately NOT a detachable pane type. A dictionary is
  // rendered by BookPane (see PanelContentRenderer), and both pop-out paths -
  // `POP_OUT_PANE_TYPE` in DockviewTabRenderer and `popOutModuleToWindow` - rewrite
  // it to 'book' before calling detachPane. A `paneConfig.dictionary` entry or
  // a DictionaryPane component-map entry would therefore be unreachable; this
  // pins that so neither can be quietly added.
  it('does not treat dictionary as a detachable pane type', () => {
    const manager = makeManager();
    detach(manager, { paneType: 'dictionary' });
    lastWindow().emit('ready-to-show');

    const payload = lastWindow().webContents.sent[0].payload as { componentName: string };
    expect(payload.componentName).toBe('BiblePane');
  });

  it('falls back to BiblePane for an unrecognized pane type', () => {
    const manager = makeManager();
    detach(manager, { paneType: 'nonsense' });
    lastWindow().emit('ready-to-show');

    const payload = lastWindow().webContents.sent[0].payload as { componentName: string };
    expect(payload.componentName).toBe('BiblePane');
  });

  it('hands over the state object untouched', () => {
    const manager = makeManager();
    const state = {
      openTabs: [{ abbreviation: 'KJV', name: 'King James' }],
      activeTabIndex: 0,
      entriesByTab: [['KJV', []]],
    };
    detach(manager, { initialState: state });
    lastWindow().emit('ready-to-show');

    const payload = lastWindow().webContents.sent[0].payload as { state: unknown };
    expect(payload.state).toEqual(state);
  });
});

describe('window lifecycle', () => {
  it('drops the window from the registry when it closes on its own', () => {
    const manager = makeManager();
    const id = detach(manager);

    lastWindow().emit('closed');

    expect(manager.getDetachedWindowCount()).toBe(0);
    expect(manager.getDetachedWindow(id)).toBeUndefined();
  });

  it('closes a tracked window on request', () => {
    const manager = makeManager();
    const id = detach(manager);

    expect(manager.closeDetachedWindow(id)).toBe(true);
    expect(lastWindow().close).toHaveBeenCalled();
    expect(manager.getDetachedWindowCount()).toBe(0);
  });

  it('reports failure for an unknown window id', () => {
    const manager = makeManager();
    expect(manager.closeDetachedWindow('detached-999')).toBe(false);
  });

  it('survives a close that throws', () => {
    const manager = makeManager();
    const id = detach(manager);
    lastWindow().close.mockImplementation(() => { throw new Error('already destroyed'); });

    expect(manager.closeDetachedWindow(id)).toBe(false);
  });

  it('closes every window on closeAllDetachedWindows', () => {
    const manager = makeManager();
    detach(manager, { paneType: 'bible' });
    detach(manager, { paneType: 'commentary' });
    detach(manager, { paneType: 'book' });

    manager.closeAllDetachedWindows();

    expect(manager.getDetachedWindowCount()).toBe(0);
    for (const win of constructed) expect(win.close).toHaveBeenCalled();
  });

  it('filters tracked windows by pane type', () => {
    const manager = makeManager();
    detach(manager, { paneType: 'bible' });
    detach(manager, { paneType: 'commentary' });
    detach(manager, { paneType: 'bible' });

    expect(manager.getDetachedWindowsByType('bible')).toHaveLength(2);
    expect(manager.getDetachedWindowsByType('commentary')).toHaveLength(1);
    expect(manager.getDetachedWindowsByType('book')).toHaveLength(0);
  });

  it('lists all tracked windows', () => {
    const manager = makeManager();
    const a = detach(manager, { paneType: 'bible' });
    const b = detach(manager, { paneType: 'book' });

    expect(manager.getAllDetachedWindows().map(w => w.id)).toEqual([a, b]);
  });
});

describe('link state', () => {
  it('starts linked to the main window', () => {
    const manager = makeManager();
    const id = detach(manager);
    expect(manager.getDetachedWindow(id)?.linkedToMain).toBe(true);
  });

  it('toggles and returns the new link state', () => {
    const manager = makeManager();
    const id = detach(manager);

    expect(manager.toggleLink(id)).toBe(false);
    expect(manager.getDetachedWindow(id)?.linkedToMain).toBe(false);
    expect(manager.toggleLink(id)).toBe(true);
    expect(manager.getDetachedWindow(id)?.linkedToMain).toBe(true);
  });

  it('reports false for an unknown window rather than throwing', () => {
    const manager = makeManager();
    expect(manager.toggleLink('detached-999')).toBe(false);
  });

  it('records the latest state for a window', () => {
    const manager = makeManager();
    const id = detach(manager);

    manager.updateWindowState(id, { currentChapter: 9 });
    expect(manager.getDetachedWindow(id)?.currentState).toEqual({ currentChapter: 9 });
  });

  it('ignores a state update for an unknown window', () => {
    const manager = makeManager();
    expect(() => manager.updateWindowState('detached-999', {})).not.toThrow();
  });
});

describe('broadcastVerseChange', () => {
  it('notifies every linked window', () => {
    const manager = makeManager();
    detach(manager, { paneType: 'commentary' });
    const first = lastWindow();
    detach(manager, { paneType: 'verse-notes' });
    const second = lastWindow();

    manager.broadcastVerseChange(43003016);

    expect(first.webContents.send).toHaveBeenCalledWith('verse-changed', 43003016);
    expect(second.webContents.send).toHaveBeenCalledWith('verse-changed', 43003016);
  });

  it('does not echo a navigation back to the window that made it', () => {
    // Traffic runs both ways now: a detached Bible window broadcasts its own
    // verse changes so the main window's study panes can follow. Without the
    // sender exclusion the originating window would be told to navigate to
    // where it already is.
    const manager = makeManager();
    detach(manager, { paneType: 'bible' });
    const sender = lastWindow();
    detach(manager, { paneType: 'commentary' });
    const other = lastWindow();

    manager.broadcastVerseChange(43003016, sender.webContents.id);

    expect(sender.webContents.send).not.toHaveBeenCalledWith('verse-changed', 43003016);
    expect(other.webContents.send).toHaveBeenCalledWith('verse-changed', 43003016);
  });

  it('skips windows the user has unlinked', () => {
    // An unlinked window is in "browse mode" - following the main window's
    // navigation would yank the user off whatever they went there to read.
    const manager = makeManager();
    const linkedId = detach(manager);
    const linked = lastWindow();
    const unlinkedId = detach(manager);
    const unlinked = lastWindow();

    manager.toggleLink(unlinkedId);
    manager.broadcastVerseChange(1001001);

    expect(linked.webContents.send).toHaveBeenCalledWith('verse-changed', 1001001);
    expect(unlinked.webContents.send).not.toHaveBeenCalled();
    expect(manager.getDetachedWindow(linkedId)?.linkedToMain).toBe(true);
    expect(manager.getDetachedWindow(unlinkedId)?.linkedToMain).toBe(false);
  });

  it('skips destroyed windows', () => {
    // A window destroyed without its 'closed' handler having run yet is still
    // in the map; send() on destroyed webContents throws in Electron.
    const manager = makeManager();
    detach(manager);
    const win = lastWindow();
    win.destroyed = true;

    expect(() => manager.broadcastVerseChange(43003016)).not.toThrow();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is detached', () => {
    const manager = makeManager();
    expect(() => manager.broadcastVerseChange(43003016)).not.toThrow();
  });

  it('does not send the verse change to windows that have already closed', () => {
    const manager = makeManager();
    detach(manager);
    const win = lastWindow();
    win.emit('closed');

    manager.broadcastVerseChange(43003016);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
