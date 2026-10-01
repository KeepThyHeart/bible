// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { makeSql } from '../../services/__tests__/helpers/testSql';

const h = vi.hoisted(() => ({ shown: [] as unknown[], supported: { value: true } }));

vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('events');
  class FakeNotification extends EE {
    static isSupported() {
      return h.supported.value;
    }
    closed = false;
    constructor(public opts: { title: string; body: string; silent?: boolean }) {
      super();
      h.shown.push(this);
    }
    show() {}
    close() {
      this.closed = true;
      this.emit('close');
    }
  }
  return {
    Notification: FakeNotification,
    powerMonitor: new EE(),
    app: { isPackaged: false, getName: () => 'Test App', getPath: () => os.tmpdir() },
  };
});
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { powerMonitor } from 'electron';
import { UserDataRepository } from '@bible/core';
import { NotificationSettingsStore, DEFAULT_NOTIFICATION_SETTINGS } from '@bible/core/browser';
import { initializeUserSchema } from '../../schema/userSchema';
import { ElectronReminderHost } from '../ElectronReminderHost';
import { NotificationStateFile } from '../stateFile';
import { createVotdSource, VOTD_SOURCE_ID } from '../votdSource';

type Fake = { opts: { title: string; body: string }; emit(e: string): void; closed: boolean };
const shown = () => h.shown as Fake[];

let dir: string;
let host: ElectronReminderHost;
let win: { isDestroyed: () => boolean; webContents: { isLoading: () => boolean; send: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn> } };
let showWindow: ReturnType<typeof vi.fn>;
let tray: { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn>; active: boolean };
let loginItem: { isSupported: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

function build(opts: { stateFile?: NotificationStateFile; withVotd?: boolean } = {}): ElectronReminderHost {
  const db = new Database(':memory:');
  const sql = makeSql(db);
  initializeUserSchema(sql);
  const store = new NotificationSettingsStore(new UserDataRepository(sql));
  const instance = new ElectronReminderHost({
    getSettingsStore: async () => store,
    stateFile: opts.stateFile ?? new NotificationStateFile(path.join(dir, 'notifications.json')),
    getMainWindow: () => win as never,
    showWindow: showWindow as never,
    tray: tray as never,
    loginItem: loginItem as never,
    platform: 'linux',
    rendererSettleMs: 0,
  });
  if (opts.withVotd !== false) {
    instance.registerSource(createVotdSource({ getVerseText: () => 'For God so loved the world, that he gave his only begotten Son.' }));
  }
  return instance;
}

beforeEach(() => {
  h.shown.length = 0;
  h.supported.value = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-host-'));
  win = { isDestroyed: () => false, webContents: { isLoading: () => false, send: vi.fn(), once: vi.fn() } };
  showWindow = vi.fn(async () => win);
  tray = { enable: vi.fn(() => true), disable: vi.fn(), active: false };
  loginItem = { isSupported: vi.fn(() => true), set: vi.fn((on: boolean) => on) };
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 1, 7, 59, 0));
});

afterEach(() => {
  host?.stop();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const enableVotd = () =>
  host.setSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, sources: { [VOTD_SOURCE_ID]: { enabled: true } } });

describe('ElectronReminderHost', () => {
  it('fires the verse of the day at 08:00 and routes a click to the renderer', async () => {
    host = build();
    await host.start();
    await enableVotd();
    expect(shown()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(90_000);
    expect(shown()).toHaveLength(1);
    const n = shown()[0];
    expect(n.opts.title).toBe('Verse of the day');
    expect(n.opts.body).toMatch(/^.+ \d+:\d+ — For God so loved/);

    n.emit('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(showWindow).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('notifications:open-target', { kind: 'verse', verseId: expect.any(Number) });
  });

  it('shows the reference only when no text is available', async () => {
    host = build({ withVotd: false });
    host.registerSource(createVotdSource({ getVerseText: () => null }));
    await host.start();
    await enableVotd();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(shown()[0].opts.body).toMatch(/^[^—]+ \d+:\d+$/);
  });

  it('calls the extension callback for an extension item, with no open-target message', async () => {
    host = build({ withVotd: false });
    const onActivation = vi.fn();
    host.setExtensionCallbacks({ onActivation });
    await host.start();
    const dueAt = Date.now() + 60_000;
    const res = await host.remindersBridge.replaceAll('acme.mem', 'Memory cards', [
      { key: 'k1', fireAt: dueAt, title: 'Card', body: 'Review John 3:16', data: { deck: 1 } },
    ]);
    expect(res.accepted).toBe(1);
    expect((await host.remindersBridge.list('acme.mem')).map((i) => i.key)).toEqual(['k1']);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(shown()).toHaveLength(1);
    expect(shown()[0].opts.title).toBe('Card');
    shown()[0].emit('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(onActivation).toHaveBeenCalledWith('acme.mem', { key: 'k1', keys: ['k1'], data: { deck: 1 }, firedAt: dueAt });
    expect(win.webContents.send).not.toHaveBeenCalledWith('notifications:open-target', expect.anything());
  });

  it('collapses a multi-day sleep to one notification on resume', async () => {
    host = build();
    await host.start();
    await enableVotd();
    vi.setSystemTime(new Date(2026, 9, 3, 10, 0, 0)); // asleep ~2 days; 08:00 of day 3 was 2 h ago
    (powerMonitor as unknown as EventEmitter).emit('resume');
    await vi.advanceTimersByTimeAsync(10);
    expect(shown()).toHaveLength(1);
  });

  it('re-arms when the wall clock drifts from the monotonic clock', async () => {
    host = build();
    await host.start();
    await enableVotd();
    vi.setSystemTime(new Date(2026, 9, 3, 10, 0, 0)); // clock jumped; performance.now did not
    await vi.advanceTimersByTimeAsync(61_000); // next 60 s guard tick
    expect(shown().length).toBeGreaterThanOrEqual(1);
  });

  it('restores state from the file across restarts (no duplicate fire)', async () => {
    const file = path.join(dir, 'notifications.json');
    host = build({ stateFile: new NotificationStateFile(file) });
    await host.start();
    await enableVotd();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(shown()).toHaveLength(1);
    host.stop();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.scheduler.checkpoints[VOTD_SOURCE_ID]).toBeGreaterThan(0);
    host = build({ stateFile: new NotificationStateFile(file) });
    await host.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown()).toHaveLength(1);
  });

  it('creates and destroys the tray and drives the login item from device settings', async () => {
    host = build();
    await host.start();
    expect(tray.enable).not.toHaveBeenCalled();
    expect(loginItem.set).not.toHaveBeenCalled();

    const on = host.setDevice({ tray: true, openAtLogin: true });
    expect(tray.enable).toHaveBeenCalledTimes(1);
    expect(loginItem.set).toHaveBeenLastCalledWith(true);
    expect(on.device).toEqual({ tray: true, openAtLogin: true });
    expect(on.capabilities).toEqual({ permission: 'granted', whenClosed: 'fires', actions: false });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'notifications.json'), 'utf8')).device).toEqual({ tray: true, openAtLogin: true });

    const off = host.setDevice({ tray: false });
    expect(tray.disable).toHaveBeenCalled();
    expect(off.device).toEqual({ tray: false, openAtLogin: true });
    expect(off.capabilities.whenClosed).toBe('never');
  });

  it('reports support and refuses device options the machine lacks', async () => {
    loginItem.isSupported.mockReturnValue(false);
    host = build();
    await host.start();
    const state = host.setDevice({ openAtLogin: true });
    expect(state.deviceSupport).toEqual({ tray: true, openAtLogin: false });
    expect(state.device?.openAtLogin).toBe(false);
    expect(loginItem.set).not.toHaveBeenCalledWith(true);
  });

  it('reports permission unsupported when notifications are unavailable', async () => {
    h.supported.value = false;
    host = build();
    await host.start();
    expect(await host.requestPermission()).toBe('unsupported');
    await host.sendTest();
    expect(shown()).toHaveLength(0);
  });

  it('sends a test notification regardless of quiet hours, and pushes state changes', async () => {
    host = build();
    await host.start();
    await host.setSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, quiet: { start: '00:00', end: '23:59' } });
    await host.sendTest();
    expect(shown()).toHaveLength(1);
    expect(shown()[0].opts.title).toBe('Test notification');
    await vi.advanceTimersByTimeAsync(200);
    expect(win.webContents.send).toHaveBeenCalledWith('notifications:state-changed', expect.objectContaining({ timeZone: expect.any(String) }));
  });

  it('keeps notifications referenced until closed', async () => {
    host = build();
    await host.start();
    await host.sendTest();
    await host.sendTest();
    shown()[0].emit('close');
    // no throw; second still referenced and clickable
    shown()[1].emit('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(showWindow).toHaveBeenCalledTimes(1);
  });
});
