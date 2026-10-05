/**
 * Which app is shown, which apps are mounted, and how activation proceeds
 * (task 0080). Framework-free; each platform's `AppStage` renders
 * `snapshot.mounted` (in that order, so DOM nodes never reorder) and shows
 * `snapshot.activeId`.
 *
 * ## Activation is asynchronous
 *
 * `activate(id)` first awaits every `onWillActivate` listener. That is where a
 * platform loads the app's code chunk and runs its `activate(ctx)` (store
 * setup) before the view is shown (see `createAppBindingController`). Only
 * then does the activation *commit*: `activeId` changes and, on the first
 * activation, the app joins `mounted`. Nothing is mounted at construction:
 * a cold boot at `#/@present` mounts the Presenter only, and Study mounts the
 * first time it is activated (lean loading).
 *
 * ## Racing activations: latest request wins
 *
 * Every call takes a ticket. When its listeners settle, an activation commits
 * only if no later `activate`/`back` call was made in the meantime; otherwise
 * it resolves `superseded` and changes nothing (the loaded chunk stays cached,
 * so the work is not wasted). A request for the app that is already active
 * supersedes a pending one too ("click Presenter, change your mind, click
 * Study" stays on Study). Listeners can poll `event.isCurrent()` to skip
 * expensive work for a request that is already stale.
 *
 * ## Keep-alive and eviction (by the app's `lifecycle.keepAlive`)
 *
 * - `always`: never unmounted.
 * - `never`: unmounted when another app commits.
 * - `while-busy`: when hidden and not busy, unmounted after `idleGraceMs`
 *   (default 60 s). Turning busy, or being activated (even while that
 *   activation is still pending), cancels the timer; turning idle while hidden
 *   starts it.
 * - An app that leaves the registry (feature switched off, extension removed)
 *   or becomes unavailable (`isAvailable` false, after `revalidate()`) is
 *   unmounted at once; if it was active, the default app is activated.
 *
 * ## Persistence
 *
 * Only `activeId` and the per-app routes are persisted; app internals are the
 * app's own business. `restore()` loads the routes and returns the app to
 * open under the active app's `lifecycle.restore` policy; it does not
 * activate (the shell decides between links, restore and the default).
 */

import type { ReadableStore } from '../Ui/ReadableStore';
import { toDisposable } from '../Modules/types';
import type { Disposable } from '../Modules/types';
import { STUDY_APP_ID } from './AppDescriptor';
import type { AppDescriptor, AppId } from './AppDescriptor';
import type { IAppRegistry } from './AppRegistry';

export type ActivateSource = 'boot' | 'restore' | 'link' | 'nav' | 'shortcut' | 'back' | 'fallback' | 'api';

export interface ActivateOptions {
  /** The app's route (deep-link tail). Omitted: keep the last known route. */
  readonly route?: string;
  readonly source?: ActivateSource;
}

export type ActivateResult =
  | { readonly status: 'activated'; readonly id: AppId }
  /** It was already the active app (its route may have been updated). */
  | { readonly status: 'already'; readonly id: AppId }
  /** A later activate/back call won the race; nothing changed. */
  | { readonly status: 'superseded'; readonly id: AppId }
  /** Unknown id, or `isAvailable` said no (at request or at commit). */
  | { readonly status: 'unavailable'; readonly id: AppId }
  /** A will-activate listener threw (e.g. the chunk failed to load). Nothing changed. */
  | { readonly status: 'failed'; readonly id: AppId; readonly error: unknown };

export interface WillActivateEvent {
  readonly id: AppId;
  readonly descriptor: AppDescriptor;
  /** The route the app will open at ('' when none). */
  readonly route: string;
  readonly source: ActivateSource;
  /** True when the app is not mounted yet (first activation, or after an eviction). */
  readonly firstMount: boolean;
  /** False once a later activation has superseded this one. */
  isCurrent(): boolean;
}

export type WillActivateListener = (event: WillActivateEvent) => void | Promise<void>;

export interface AppHostSnapshot {
  /** The app on screen; null before the first activation commits (or after the active app vanished). */
  readonly activeId: AppId | null;
  /** The app whose activation is in flight, if any. Surfaces may show it as "opening". */
  readonly pendingId: AppId | null;
  /** Apps whose views are mounted, in first-mount order. */
  readonly mounted: readonly AppId[];
  /** Each app's last route ('' entries are omitted). */
  readonly routes: Readonly<Record<AppId, string>>;
  readonly canGoBack: boolean;
}

export interface AppHostPersisted {
  readonly v: 1;
  readonly activeId: AppId | null;
  readonly routes: Readonly<Record<AppId, string>>;
}

export interface TimerPort {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AppHostOptions {
  readonly registry: IAppRegistry;
  /** The fallback app (Back target of last resort, restore default). Default `study`. */
  readonly defaultAppId?: AppId;
  /** The shell's cheap `when`/platform check. Default: every registered app is available. */
  readonly isAvailable?: (descriptor: AppDescriptor) => boolean;
  /** Grace before an idle hidden `while-busy` app is unmounted. Default 60 000 ms. */
  readonly idleGraceMs?: number;
  /** Back-stack depth. Default 20. */
  readonly maxHistory?: number;
  readonly timers?: TimerPort;
}

export interface IAppHostState extends ReadableStore<AppHostSnapshot> {
  activate(id: AppId, options?: ActivateOptions): Promise<ActivateResult>;
  /** Activate the previous app on the host's own back stack, else the default app. */
  back(): Promise<ActivateResult>;
  /** The active app reports its route changed (the web router mirrors it into the hash). */
  setRoute(id: AppId, route: string): void;
  /** Re-check availability of mounted and active apps (call when `when` context changes). */
  revalidate(): void;
  serialize(): AppHostPersisted;
  /** Load persisted routes; returns the app to open under the active app's restore policy. */
  restore(persisted: unknown): AppId;
  onWillActivate(listener: WillActivateListener): Disposable;
  onDidMount(listener: (id: AppId) => void): Disposable;
  onDidUnmount(listener: (id: AppId) => void): Disposable;
  dispose(): void;
}

const DEFAULT_IDLE_GRACE_MS = 60_000;
const MAX_PERSISTED_ROUTES = 32;
const MAX_ROUTE_LENGTH = 512;

const globalTimers: TimerPort = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createAppHostState(options: AppHostOptions): IAppHostState {
  return new AppHostState(options);
}

class AppHostState implements IAppHostState {
  private readonly registry: IAppRegistry;
  private readonly defaultAppId: AppId;
  private readonly isAvailableFn: (d: AppDescriptor) => boolean;
  private readonly idleGraceMs: number;
  private readonly maxHistory: number;
  private readonly timers: TimerPort;

  private activeId: AppId | null = null;
  private pendingId: AppId | null = null;
  private readonly mounted: AppId[] = [];
  private readonly routes = new Map<AppId, string>();
  private readonly history: AppId[] = [];
  private ticket = 0;
  private readonly evictionTimers = new Map<AppId, unknown>();
  private lastBusy = new Set<AppId>();

  private readonly listeners = new Set<() => void>();
  private readonly willActivate = new Set<WillActivateListener>();
  private readonly didMount = new Set<(id: AppId) => void>();
  private readonly didUnmount = new Set<(id: AppId) => void>();
  private snapshot: AppHostSnapshot;
  private readonly unsubscribeRegistry: () => void;
  private disposed = false;

  constructor(options: AppHostOptions) {
    this.registry = options.registry;
    this.defaultAppId = options.defaultAppId ?? STUDY_APP_ID;
    this.isAvailableFn = options.isAvailable ?? (() => true);
    this.idleGraceMs = options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
    this.maxHistory = Math.max(1, options.maxHistory ?? 20);
    this.timers = options.timers ?? globalTimers;
    this.snapshot = this.buildSnapshot();
    this.unsubscribeRegistry = this.registry.state.subscribe(() => this.onRegistryChanged());
  }

  // --- ReadableStore ---------------------------------------------------------

  getSnapshot(): AppHostSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Activation ------------------------------------------------------------

  activate(id: AppId, options: ActivateOptions = {}): Promise<ActivateResult> {
    return this.request(id, options);
  }

  back(): Promise<ActivateResult> {
    // Drop entries that can no longer be shown; they are not a useful Back target.
    while (this.history.length > 0) {
      const top = this.history[this.history.length - 1];
      if (top !== this.activeId && this.available(top)) break;
      this.history.pop();
    }
    const target = this.history.length > 0 ? this.history[this.history.length - 1] : this.defaultAppId;
    if (target === this.activeId) {
      // Nothing to go back to. Still supersede a pending activation: Back means "not that".
      this.ticket++;
      if (this.pendingId !== null) {
        this.pendingId = null;
        this.emit();
      }
      return Promise.resolve(
        this.activeId === null
          ? { status: 'unavailable', id: target }
          : { status: 'already', id: this.activeId },
      );
    }
    return this.request(target, { source: 'back' });
  }

  private async request(id: AppId, options: ActivateOptions): Promise<ActivateResult> {
    if (this.disposed) return { status: 'unavailable', id };
    const ticket = ++this.ticket;
    const source = options.source ?? 'api';
    const descriptor = this.registry.get(id);
    if (!descriptor || !this.isAvailableSafe(descriptor)) {
      // An unavailable request still cancels an older pending one: the user moved on.
      if (this.pendingId !== null) {
        this.pendingId = null;
        this.emit();
      }
      return { status: 'unavailable', id };
    }

    if (id === this.activeId) {
      const changed = this.pendingId !== null || this.applyRoute(id, options.route);
      this.pendingId = null;
      if (changed) this.emit();
      return { status: 'already', id };
    }

    // Activating an app cancels its pending eviction right away, so the
    // timer cannot unmount it while its own activation is in flight.
    this.cancelEviction(id);
    this.pendingId = id;
    this.emit();

    const route = options.route ?? this.routes.get(id) ?? '';
    const isCurrent = () => !this.disposed && ticket === this.ticket;
    const event: WillActivateEvent = {
      id,
      descriptor,
      route,
      source,
      firstMount: !this.mounted.includes(id),
      isCurrent,
    };

    try {
      await Promise.all([...this.willActivate].map((listener) => listener(event)));
    } catch (error) {
      if (!isCurrent()) return this.superseded(id);
      this.pendingId = null;
      this.reconsiderEviction(id);
      this.emit();
      return { status: 'failed', id, error };
    }

    if (!isCurrent()) return this.superseded(id);
    // Re-check: the app may have been switched off while it loaded.
    const latest = this.registry.get(id);
    if (!latest || !this.isAvailableSafe(latest)) {
      this.pendingId = null;
      this.emit();
      return { status: 'unavailable', id };
    }
    this.commit(id, options.route, source);
    return { status: 'activated', id };
  }

  /** A stale request resolves here; its eviction timer (cancelled at request time) may restart. */
  private superseded(id: AppId): ActivateResult {
    this.reconsiderEviction(id);
    return { status: 'superseded', id };
  }

  private commit(id: AppId, route: string | undefined, source: ActivateSource): void {
    const prev = this.activeId;
    if (prev !== null && prev !== id) {
      if (source === 'back') {
        if (this.history[this.history.length - 1] === id) this.history.pop();
      } else {
        this.history.push(prev);
        if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
      }
    }
    this.activeId = id;
    this.pendingId = null;
    this.applyRoute(id, route);
    this.cancelEviction(id);
    const newlyMounted = !this.mounted.includes(id);
    if (newlyMounted) this.mounted.push(id);

    const unmounted: AppId[] = [];
    if (prev !== null && prev !== id) {
      const desc = this.registry.get(prev);
      const keepAlive = desc?.lifecycle.keepAlive ?? 'never';
      if (keepAlive === 'never') {
        if (this.removeMounted(prev)) unmounted.push(prev);
      } else if (keepAlive === 'while-busy') {
        this.reconsiderEviction(prev);
      }
    }
    this.emit();
    if (newlyMounted) this.fire(this.didMount, id);
    for (const gone of unmounted) this.fire(this.didUnmount, gone);
  }

  // --- Eviction --------------------------------------------------------------

  /** Start or cancel `id`'s idle timer to match its current state. */
  private reconsiderEviction(id: AppId): void {
    const desc = this.registry.get(id);
    const shouldTime =
      !!desc &&
      desc.lifecycle.keepAlive === 'while-busy' &&
      this.mounted.includes(id) &&
      id !== this.activeId &&
      id !== this.pendingId &&
      !this.registry.isBusy(id);
    if (!shouldTime) {
      this.cancelEviction(id);
      return;
    }
    if (this.evictionTimers.has(id)) return;
    const handle = this.timers.setTimeout(() => this.onEvictionTimer(id), this.idleGraceMs);
    this.evictionTimers.set(id, handle);
  }

  private cancelEviction(id: AppId): void {
    if (!this.evictionTimers.has(id)) return;
    this.timers.clearTimeout(this.evictionTimers.get(id));
    this.evictionTimers.delete(id);
  }

  private onEvictionTimer(id: AppId): void {
    this.evictionTimers.delete(id);
    if (this.disposed) return;
    // Belt and braces: the state may have moved on without cancelling.
    if (id === this.activeId || id === this.pendingId || this.registry.isBusy(id)) return;
    if (this.removeMounted(id)) {
      this.emit();
      this.fire(this.didUnmount, id);
    }
  }

  private removeMounted(id: AppId): boolean {
    const i = this.mounted.indexOf(id);
    if (i === -1) return false;
    this.mounted.splice(i, 1);
    this.cancelEviction(id);
    return true;
  }

  // --- Registry / availability changes ----------------------------------------

  private onRegistryChanged(): void {
    if (this.disposed) return;
    const busyNow = new Set<AppId>();
    for (const e of this.registry.state.getSnapshot().apps) if (e.busy) busyNow.add(e.item.id);
    const busyChanged = new Set<AppId>();
    for (const id of busyNow) if (!this.lastBusy.has(id)) busyChanged.add(id);
    for (const id of this.lastBusy) if (!busyNow.has(id)) busyChanged.add(id);
    this.lastBusy = busyNow;
    for (const id of busyChanged) this.reconsiderEviction(id);
    this.revalidate();
  }

  revalidate(): void {
    if (this.disposed) return;
    const unmounted: AppId[] = [];
    let activeGone = false;
    for (const id of [...this.mounted]) {
      if (this.available(id)) continue;
      this.removeMounted(id);
      unmounted.push(id);
      if (id === this.activeId) activeGone = true;
    }
    if (this.activeId !== null && !this.available(this.activeId)) activeGone = true;
    if (activeGone) this.activeId = null;
    if (this.pendingId !== null && !this.available(this.pendingId)) {
      // Its request resolves `unavailable` at commit; stop showing it as opening.
      this.pendingId = null;
    }
    const needsEmit = unmounted.length > 0 || activeGone || this.snapshotStale();
    if (needsEmit) this.emit();
    for (const id of unmounted) this.fire(this.didUnmount, id);
    if (activeGone && this.pendingId === null) {
      void this.request(this.defaultAppId, { source: 'fallback' });
    }
  }

  private snapshotStale(): boolean {
    return this.snapshot.pendingId !== this.pendingId || this.snapshot.activeId !== this.activeId;
  }

  // --- Routes and persistence ------------------------------------------------

  setRoute(id: AppId, route: string): void {
    if (!this.registry.has(id)) return;
    if (this.applyRoute(id, route)) this.emit();
  }

  /** Returns true when the stored route changed. */
  private applyRoute(id: AppId, route: string | undefined): boolean {
    if (route === undefined) return false;
    const clean = route.slice(0, MAX_ROUTE_LENGTH);
    const prev = this.routes.get(id) ?? '';
    if (prev === clean) return false;
    if (clean === '') this.routes.delete(id);
    else this.routes.set(id, clean);
    return true;
  }

  serialize(): AppHostPersisted {
    const routes: Record<AppId, string> = {};
    let n = 0;
    for (const [id, route] of this.routes) {
      if (n++ >= MAX_PERSISTED_ROUTES) break;
      routes[id] = route;
    }
    return { v: 1, activeId: this.activeId, routes };
  }

  restore(persisted: unknown): AppId {
    const p = readPersisted(persisted);
    if (!p) return this.defaultAppId;
    // Routes of apps not registered yet (extensions registering later) are kept.
    let changed = false;
    for (const [id, route] of Object.entries(p.routes)) {
      if (!this.routes.has(id)) changed = this.applyRoute(id, route) || changed;
    }
    if (changed) this.emit();
    const id = p.activeId;
    if (id === null) return this.defaultAppId;
    const desc = this.registry.get(id);
    if (!desc || !this.isAvailableSafe(desc)) return this.defaultAppId;
    switch (desc.lifecycle.restore) {
      case 'reopen':
        return id;
      case 'while-busy':
        return this.registry.isBusy(id) ? id : this.defaultAppId;
      default:
        return this.defaultAppId;
    }
  }

  // --- Events ----------------------------------------------------------------

  onWillActivate(listener: WillActivateListener): Disposable {
    this.willActivate.add(listener);
    return toDisposable(() => this.willActivate.delete(listener));
  }

  onDidMount(listener: (id: AppId) => void): Disposable {
    this.didMount.add(listener);
    return toDisposable(() => this.didMount.delete(listener));
  }

  onDidUnmount(listener: (id: AppId) => void): Disposable {
    this.didUnmount.add(listener);
    return toDisposable(() => this.didUnmount.delete(listener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRegistry();
    for (const handle of this.evictionTimers.values()) this.timers.clearTimeout(handle);
    this.evictionTimers.clear();
    this.listeners.clear();
    this.willActivate.clear();
    this.didMount.clear();
    this.didUnmount.clear();
  }

  // --- Helpers ---------------------------------------------------------------

  private available(id: AppId): boolean {
    const desc = this.registry.get(id);
    return !!desc && this.isAvailableSafe(desc);
  }

  private isAvailableSafe(desc: AppDescriptor): boolean {
    try {
      return this.isAvailableFn(desc);
    } catch {
      return false;
    }
  }

  private fire(set: Set<(id: AppId) => void>, id: AppId): void {
    for (const listener of [...set]) {
      try {
        listener(id);
      } catch {
        // A faulty listener must not break the host's state machine.
      }
    }
  }

  private buildSnapshot(): AppHostSnapshot {
    const routes: Record<AppId, string> = {};
    for (const [id, route] of this.routes) routes[id] = route;
    return {
      activeId: this.activeId,
      pendingId: this.pendingId,
      mounted: [...this.mounted],
      routes,
      canGoBack:
        this.history.some((id) => id !== this.activeId && this.available(id)) ||
        (this.activeId !== null && this.activeId !== this.defaultAppId && this.available(this.defaultAppId)),
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }
}

function readPersisted(value: unknown): AppHostPersisted | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return null;
  const activeId = typeof v.activeId === 'string' && v.activeId !== '' ? v.activeId : null;
  const routes: Record<AppId, string> = {};
  if (v.routes && typeof v.routes === 'object') {
    let n = 0;
    for (const [id, route] of Object.entries(v.routes as Record<string, unknown>)) {
      if (n >= MAX_PERSISTED_ROUTES) break;
      if (typeof route === 'string' && route !== '') {
        routes[id] = route.slice(0, MAX_ROUTE_LENGTH);
        n++;
      }
    }
  }
  return { v: 1, activeId, routes };
}
