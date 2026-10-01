/**
 * The Electron side of the reminder engine (one instance, main process).
 *
 * Wires core's {@link ReminderScheduler} to: OS notifications (`Notification`),
 * a JSON state file, the user-data settings document, `powerMonitor` and a
 * drift guard (re-arm after sleep, clock or zone changes), the tray and the
 * login item, the renderer (state pushes, click routing) and extensions (the
 * reminders bridge plus activation/missed callbacks).
 */
import { Notification, powerMonitor, type BrowserWindow } from 'electron';
import log from 'electron-log';
import {
  ReminderScheduler,
  NotificationSettingsStore,
  createTimeoutTimer,
  normalizeNotificationSettings,
  systemTimeZone,
  type ItemSource,
  type JsonValue,
  type NotificationDeviceSettings,
  type NotificationSettings,
  type NotificationsViewState,
  type PresentedNotification,
  type ReminderActivation,
  type ReminderCapabilities,
  type ReminderPermission,
  type ReminderSource,
  type ReminderTarget,
} from '@bible/core/browser';
import { t } from '../services/MainI18n';
import type { IRemindersBridge } from '../extensions/api-impl/IExtensionDataBridges';
import { NotificationStateFile, normalizeDeviceSettings } from './stateFile';
import type { TrayController } from './tray';

export type RemindersBridgePort = IRemindersBridge;

export interface ExtensionActivation {
  key: string;
  keys: string[];
  data?: JsonValue;
  firedAt: number;
}

export interface ExtensionMissedEvent {
  keys: string[];
  dropped: string[];
}

export interface ExtensionReminderCallbacks {
  onActivation?(extensionId: string, activation: ExtensionActivation): void | Promise<unknown>;
  onMissed?(extensionId: string, event: ExtensionMissedEvent): void;
}

export interface LoginItemPort {
  isSupported(): boolean;
  /** Apply the setting; returns whether it is now on. */
  set(enabled: boolean): boolean;
}

export interface ElectronReminderHostOptions {
  /** The settings document store (user data); may resolve later (the user DB opens async). */
  getSettingsStore: () => NotificationSettingsStore | Promise<NotificationSettingsStore>;
  stateFile: NotificationStateFile;
  /** The current main window, if any (not creating one). */
  getMainWindow: () => BrowserWindow | null;
  /** Show and focus the main window, creating it when it was closed. Resolves it once it exists. */
  showWindow: () => BrowserWindow | null | Promise<BrowserWindow | null>;
  tray: Pick<TrayController, 'enable' | 'disable' | 'active'>;
  loginItem: LoginItemPort;
  platform?: NodeJS.Platform;
  /** Whether the tray works on this machine (default true on win32, darwin, linux). */
  traySupported?: boolean;
  /** Whether an extension's reminder source may notify (installed, enabled, holds `notifications:schedule`). Default: always. */
  isExtensionAllowed?: (extensionId: string) => boolean;
  /** Delay after the page finishes loading before a routed target is sent (default 1000 ms). */
  rendererSettleMs?: number;
}

/** Escape `&`, `<` and `>` (the characters markup-aware notification servers interpret). */
export function escapeMarkup(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const OPEN_TARGET_TTL_MS = 60_000;
const LOAD_WAIT_MS = 15_000;
const STATE_DEBOUNCE_MS = 100;
const GUARD_INTERVAL_MS = 60_000;
const DRIFT_LIMIT_MS = 2 * 60_000;

export class ElectronReminderHost {
  readonly scheduler: ReminderScheduler;
  /** Connect to the extension host: `extensionHost.deliverReminderActivation` / `deliverReminderMissed`. */
  readonly remindersBridge: RemindersBridgePort;

  private settings: NotificationSettings = normalizeNotificationSettings(null);
  private store: NotificationSettingsStore | null = null;
  private device: NotificationDeviceSettings;
  private readonly shown = new Map<string, Notification>();
  private readonly extSources = new Map<string, { label: string; unregister: () => void }>();
  private extCallbacks: ExtensionReminderCallbacks = {};
  private guard: ReturnType<typeof setInterval> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTz = systemTimeZone();
  private lastWall = Date.now();
  private lastMono = globalThis.performance.now();
  /** Resolves when {@link start} has loaded the settings and started the scheduler. */
  private starting: Promise<void> | null = null;
  /** A click-through target the renderer has not taken yet (see {@link takeOpenTarget}). */
  private pendingOpenTarget: { target: ReminderTarget; at: number } | null = null;
  private readonly platform: NodeJS.Platform;
  private readonly onResume = () => void this.wake();

  constructor(private readonly opts: ElectronReminderHostOptions) {
    this.platform = opts.platform ?? process.platform;
    this.device = opts.stateFile.getDevice();
    this.scheduler = new ReminderScheduler({
      timer: createTimeoutTimer(),
      presenter: { show: (n) => this.present(n) },
      state: opts.stateFile.statePort(),
      settings: () => this.settings,
      // `ext:<id>` sources only notify while the extension is allowed (disabled or revoked ones go quiet).
      isItemSourceAllowed: (sourceId) =>
        sourceId.startsWith('ext:') ? (opts.isExtensionAllowed?.(sourceId.slice(4)) ?? true) : true,
      strings: {
        collapsed: (label, count) => ({
          title: label,
          body: t('main.notifications.collapsed', { count }),
        }),
      },
      onChange: () => this.scheduleStateChanged(),
      onError: (err, context) => log.warn(`[notifications] ${context}:`, err),
    });
    this.remindersBridge = {
      replaceAll: (extensionId, label, items) => this.replaceExtensionItems(extensionId, label, items),
      list: async (extensionId) => this.scheduler.listItems(`ext:${extensionId}`),
      capabilities: async () => this.capabilities(),
      requestPermission: () => this.requestPermission(),
    };
  }

  // --- lifecycle ------------------------------------------------------------

  /** Register an app rule source (before or after {@link start}). */
  registerSource(source: ReminderSource): () => void {
    return this.scheduler.registerSource(source);
  }

  /** Load settings, apply the device settings, and start the engine. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart();
    return this.starting;
  }

  /** Re-evaluate what may fire (an extension was enabled, disabled or had its permissions changed). */
  refresh(): Promise<void> {
    return this.scheduler.refresh();
  }

  private async doStart(): Promise<void> {
    try {
      this.store = await this.opts.getSettingsStore();
      this.settings = this.store.get();
    } catch (err) {
      log.warn('[notifications] could not load settings; using defaults:', err);
    }
    // Remembered extension sources get their click target and missed callback
    // back before the first wake, which may show reminders that came due while closed.
    for (const id of Object.keys(this.opts.stateFile.read().scheduler?.labels ?? {})) {
      if (id.startsWith('ext:')) this.ensureExtensionSource(id.slice(4), this.opts.stateFile.read().scheduler!.labels[id]);
    }
    this.applyDevice(this.device, true);
    await this.scheduler.start();

    powerMonitor.on('resume', this.onResume);
    powerMonitor.on('unlock-screen', this.onResume);
    this.lastWall = Date.now();
    this.lastMono = globalThis.performance.now();
    this.guard = setInterval(() => this.guardTick(), GUARD_INTERVAL_MS);
    (this.guard as { unref?: () => void }).unref?.();
  }

  stop(): void {
    this.starting = null;
    this.scheduler.stop();
    powerMonitor.removeListener('resume', this.onResume);
    powerMonitor.removeListener('unlock-screen', this.onResume);
    if (this.guard) clearInterval(this.guard);
    this.guard = null;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    for (const n of this.shown.values()) {
      try {
        n.close();
      } catch {
        /* already gone */
      }
    }
    this.shown.clear();
    this.opts.tray.disable();
  }

  /** Re-check what is due (resume from sleep, unlock, clock or zone change). */
  wake(): Promise<void> {
    this.lastWall = Date.now();
    this.lastMono = globalThis.performance.now();
    this.lastTz = systemTimeZone();
    return this.scheduler.wake();
  }

  /**
   * The 60 s guard: wall clock vs the monotonic clock, and the time zone.
   * Note: in Electron's main process `Intl` may keep the zone it saw at startup, so a
   * runtime OS zone change is not always visible to `systemTimeZone()`; a restart
   * picks it up.
   */
  private guardTick(): void {
    const wall = Date.now();
    const mono = globalThis.performance.now();
    const drift = Math.abs(wall - this.lastWall - (mono - this.lastMono));
    const tz = systemTimeZone();
    if (drift > DRIFT_LIMIT_MS || tz !== this.lastTz) {
      void this.wake();
    } else {
      this.lastWall = wall;
      this.lastMono = mono;
    }
  }

  // --- extension integration -------------------------------------------------

  setExtensionCallbacks(callbacks: ExtensionReminderCallbacks): void {
    this.extCallbacks = callbacks;
  }

  private ensureExtensionSource(extensionId: string, label: string): void {
    const id = `ext:${extensionId}`;
    const existing = this.extSources.get(id);
    if (existing && existing.label === label) return;
    existing?.unregister();
    const source: ItemSource = {
      id,
      kind: 'items',
      label,
      target: { kind: 'extension', extensionId },
      onMissed: (e) => {
        try {
          this.extCallbacks.onMissed?.(extensionId, { keys: e.summarized, dropped: e.dropped });
        } catch (err) {
          log.warn('[notifications] extension missed callback failed:', err);
        }
      },
    };
    this.extSources.set(id, { label, unregister: this.scheduler.registerSource(source) });
  }

  private async replaceExtensionItems(extensionId: string, label: string, items: unknown): Promise<{ accepted: number }> {
    this.ensureExtensionSource(extensionId, label);
    return this.scheduler.replaceItems(`ext:${extensionId}`, items, label);
  }

  /** An extension was uninstalled: forget its reminders and source. */
  async forgetExtension(extensionId: string): Promise<void> {
    const id = `ext:${extensionId}`;
    this.extSources.get(id)?.unregister();
    this.extSources.delete(id);
    await this.scheduler.forgetSource(id);
  }

  // --- presenting and clicks -------------------------------------------------

  private present(n: PresentedNotification): void {
    if (!Notification.isSupported()) return;
    // Some Linux notification servers interpret markup in the title and body.
    const text = (v: string): string => (this.platform === 'linux' ? escapeMarkup(v) : v);
    const notification = new Notification({ title: text(n.title), body: text(n.body), silent: n.silent ?? false });
    // Hold a reference until it is closed or clicked, or it may be garbage-collected and never fire 'click'.
    this.shown.set(n.id, notification);
    const release = () => {
      this.shown.delete(n.id);
    };
    notification.on('click', () => {
      release();
      void this.handleClick(n.id);
    });
    notification.on('close', release);
    notification.on('failed', release);
    notification.show();
    if (this.shown.size > 100) this.shown.delete(this.shown.keys().next().value as string);
  }

  private async handleClick(presentedId: string): Promise<void> {
    const activation = this.scheduler.activate(presentedId);
    let win: BrowserWindow | null = null;
    try {
      win = await this.opts.showWindow();
    } catch (err) {
      log.warn('[notifications] could not show the window:', err);
    }
    if (!activation) return;
    await this.route(activation, win);
  }

  private async route(activation: ReminderActivation, win: BrowserWindow | null): Promise<void> {
    const target = activation.target;
    if (!target) return;
    if (target.kind === 'extension') {
      try {
        await this.extCallbacks.onActivation?.(target.extensionId, {
          key: activation.keys[0],
          keys: activation.keys,
          data: activation.data,
          firedAt: activation.dueAt,
        });
      } catch (err) {
        log.warn('[notifications] extension activation failed:', err);
      }
      return;
    }
    await this.sendOpenTarget(target, win);
  }

  /**
   * Route a click to the renderer. The target is also kept as pending until the renderer
   * takes it (`notifications:take-open-target`, called once when its hook subscribes), so
   * a click that lands while the page is loading is not lost. A renderer that is already
   * loaded gets the event right away and the pending target is cleared.
   */
  async sendOpenTarget(target: ReminderTarget, win: BrowserWindow | null = this.opts.getMainWindow()): Promise<void> {
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    this.pendingOpenTarget = { target, at: Date.now() };
    if (wc.isLoading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LOAD_WAIT_MS);
        wc.once('did-finish-load', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await new Promise<void>((resolve) => setTimeout(resolve, this.opts.rendererSettleMs ?? 1000));
      // Still pending: the renderer has not taken it. Send the event too, but keep it for a late subscriber.
      if (this.pendingOpenTarget?.target === target && !win.isDestroyed()) wc.send('notifications:open-target', target);
      return;
    }
    this.pendingOpenTarget = null;
    wc.send('notifications:open-target', target);
  }

  /** The renderer's one-shot pickup of a click-through that arrived before it subscribed. */
  takeOpenTarget(): ReminderTarget | null {
    const pending = this.pendingOpenTarget;
    this.pendingOpenTarget = null;
    if (!pending || Date.now() - pending.at > OPEN_TARGET_TTL_MS) return null;
    return pending.target;
  }

  // --- renderer-facing -------------------------------------------------------

  private scheduleStateChanged(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.emitStateChanged();
    }, STATE_DEBOUNCE_MS);
  }

  private emitStateChanged(): void {
    const win = this.opts.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('notifications:state-changed', this.getViewState());
  }

  capabilities(): ReminderCapabilities {
    return {
      permission: Notification.isSupported() ? 'granted' : 'unsupported',
      // macOS keeps running after the last window closes, so reminders still fire there.
      whenClosed: this.platform === 'darwin' || this.device.tray ? 'fires' : 'never',
      actions: false,
    };
  }

  async requestPermission(): Promise<ReminderPermission> {
    return this.capabilities().permission;
  }

  deviceSupport(): { tray: boolean; openAtLogin: boolean } {
    return {
      tray: this.opts.traySupported ?? ['win32', 'darwin', 'linux'].includes(this.platform),
      openAtLogin: this.opts.loginItem.isSupported(),
    };
  }

  getViewState(): NotificationsViewState {
    return {
      settings: this.settings,
      sources: this.scheduler.listSources(),
      capabilities: this.capabilities(),
      timeZone: this.scheduler.timeZone(),
      device: { ...this.device },
      deviceSupport: this.deviceSupport(),
    };
  }

  /** Normalize, persist and apply new settings; returns the new view state. */
  async setSettings(next: unknown): Promise<NotificationsViewState> {
    // Wait for start() to load the stored settings, or this write would be overwritten by them.
    if (this.starting) await this.starting.catch(() => undefined);
    const clean = normalizeNotificationSettings(next);
    this.settings = this.store ? this.store.put(clean) : clean;
    await this.scheduler.refresh();
    return this.getViewState();
  }

  /** Persist and apply device settings (tray, login item); returns the new view state. */
  setDevice(patch: Partial<NotificationDeviceSettings>): NotificationsViewState {
    const next = normalizeDeviceSettings({ ...this.device, ...patch });
    const support = this.deviceSupport();
    if (!support.tray) next.tray = false;
    if (!support.openAtLogin) next.openAtLogin = false;
    this.device = next;
    this.opts.stateFile.setDevice(next);
    this.applyDevice(next, false);
    return this.getViewState();
  }

  private applyDevice(device: NotificationDeviceSettings, startup: boolean): void {
    if (device.tray) {
      if (!this.opts.tray.enable()) {
        this.device = { ...this.device, tray: false };
      }
    } else {
      this.opts.tray.disable();
    }
    // At startup only re-assert an enabled login item (a path may have moved); never create one unasked.
    if (!startup || device.openAtLogin) {
      const on = this.opts.loginItem.set(device.openAtLogin);
      if (device.openAtLogin && !on) this.device = { ...this.device, openAtLogin: false };
    }
    if (this.device.tray !== device.tray || this.device.openAtLogin !== device.openAtLogin) {
      this.opts.stateFile.setDevice(this.device);
    }
  }

  /** The tray option is on (the icon may not exist yet during startup). */
  get trayEnabled(): boolean {
    return this.device.tray;
  }

  /** The tray option is on and the icon exists: closing the window hides it instead of quitting. */
  get trayMode(): boolean {
    return this.device.tray && this.opts.tray.active;
  }

  async sendTest(): Promise<void> {
    await this.scheduler.presentNow('app:notifications', {
      title: t('main.notifications.test.title'),
      body: t('main.notifications.test.body'),
    });
  }
}
