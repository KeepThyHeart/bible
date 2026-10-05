/**
 * The web app host: the registry of apps, the host state (which app is shown,
 * which are mounted) and the bindings that load each app's chunk lazily.
 * Entry-chunk code: it may import only core, `utils/*`, settings and other
 * host modules, never anything under `src/apps/**`.
 */
import { AppRegistry, VerseActionRegistry, createAppBindingController, createAppHostState } from '@bible/core/browser';
import type { ActivateOptions, ActivateResult, AppBinding, AppCompanionBinding, AppId, Disposable } from '@bible/core/browser';
import type { ComponentType } from 'preact';
import { reloadForUpdateOnce } from '../utils/bootGuard';
import type { ShellContext } from '../boot/shellContext';

export type AppView = ComponentType<any>;
export type WebAppBinding = AppBinding<AppView>;

export const appRegistry = new AppRegistry();
export const appHost = createAppHostState({ registry: appRegistry });
/** The verse-action contribution point (context menu entries); handlers load lazily on first run. */
export const verseActions = new VerseActionRegistry();
const controller = createAppBindingController<AppView>({
  host: appHost,
  onError: (err, id, phase) => console.warn(`[AppHost] ${phase} of "${id}" failed:`, err),
});

// --- shell context ---------------------------------------------------------

let shellContext: ShellContext | null = null;

/** Set once by the boot, before the first activation. */
export function setShellContext(ctx: ShellContext | null): void {
  shellContext = ctx;
}

export function getShellContext(): ShellContext {
  if (!shellContext) throw new Error('[AppHost] shell context is not set yet');
  return shellContext;
}

export function peekShellContext(): ShellContext | null {
  return shellContext;
}

// --- bindings ----------------------------------------------------------------

export function addAppBinding(binding: WebAppBinding): Disposable {
  return controller.add(binding);
}

/** Start loading an app's chunk without activating it (idle, hover or focus). */
export function prefetchApp(id: AppId): void {
  controller.prefetch(id);
}

export function getAppView(id: AppId): AppView | undefined {
  return controller.getView(id);
}

/** The slim strip an app shows inside Study (loaded only while it applies), if the app has one. */
export function getAppCompanion(id: AppId): AppCompanionBinding<AppView> | undefined {
  return controller.getCompanion(id);
}

// --- navigation ----------------------------------------------------------------

/** Implemented by webRoute (URL + history); injected to avoid an import cycle. */
export interface AppNavigator {
  open(id: AppId, route?: string): Promise<void>;
  back(): Promise<void>;
}
let navigator: AppNavigator | null = null;

export function setAppNavigator(n: AppNavigator | null): void {
  navigator = n;
}

/** Open an app (pushes `#/@id` on web). */
export function openApp(id: AppId, route?: string): Promise<void> {
  if (navigator) return navigator.open(id, route);
  return activateWithRecovery(id, { route, source: 'nav' }).then(() => undefined);
}

/** Leave the current app for Study, restoring the reader's own hash. */
export function backToStudy(): Promise<void> {
  if (navigator) return navigator.back();
  return activateWithRecovery('study', { source: 'back' }).then(() => undefined);
}

export function isAppActive(id: AppId): boolean {
  return appHost.getSnapshot().activeId === id;
}

/**
 * True when Study's own Back handling must stand down because another app is
 * (or is about to be) on screen: the Back belongs to that app, and Study is
 * only kept alive behind it. Phones push a dummy history entry per Back press;
 * a Back from any non-Study app returns to Study before Study takes a step.
 */
export function studyShouldIgnoreBack(): boolean {
  if (consumeAppPop()) return true;
  const s = appHost.getSnapshot();
  const current = s.pendingId ?? s.activeId;
  return current !== null && current !== 'study';
}

let popped = false;

/** Called by webRoute from its popstate handler: the pop changed the active app. */
export function noteAppPop(changed: boolean): void {
  popped = changed;
}

/**
 * True once, right after a Back/Forward that changed the active app. The hash
 * has already changed by the time other `popstate` listeners run, so they
 * cannot tell; the hidden mobile Study uses this to skip its own back step.
 */
export function consumeAppPop(): boolean {
  const was = popped;
  popped = false;
  return was;
}

// --- activation with recovery ---------------------------------------------------

export interface AppFailure {
  id: AppId;
  error: unknown;
}

let failure: AppFailure | null = null;
const failureListeners = new Set<() => void>();
let reloading = false;

export const appFailures = {
  getSnapshot: (): AppFailure | null => failure,
  subscribe(fn: () => void): () => void {
    failureListeners.add(fn);
    return () => {
      failureListeners.delete(fn);
    };
  },
};

function setFailure(next: AppFailure | null): void {
  if (failure === next) return;
  failure = next;
  for (const fn of [...failureListeners]) fn();
}

/** True when a failed chunk load triggered a one-off reload for a fresh build. */
export function isReloadingForUpdate(): boolean {
  return reloading;
}

/**
 * True for a failed dynamic import of an app chunk (a deploy replaced the
 * chunk URLs, or the network dropped), as the browsers word it.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return typeof message === 'string'
    && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS/i.test(message);
}

/**
 * Activate, and deal with a failed load: for a chunk-load failure reload once
 * (a deploy may have replaced the chunk URLs); any other failure, or a spent
 * reload, is recorded for the stage's error state (with Retry).
 */
export async function activateWithRecovery(id: AppId, options: ActivateOptions = {}): Promise<ActivateResult> {
  const result = await appHost.activate(id, options);
  if (result.status === 'failed') {
    console.error(`[AppHost] "${id}" failed to start:`, result.error);
    if (isChunkLoadError(result.error) && reloadForUpdateOnce()) reloading = true;
    else setFailure({ id, error: result.error });
  } else if (result.status === 'activated' || result.status === 'already') {
    if (failure?.id === id) setFailure(null);
  }
  return result;
}

/** The stage's Retry button. */
export function retryFailedApp(): Promise<void> {
  const f = failure;
  if (!f) return Promise.resolve();
  setFailure(null);
  return openApp(f.id);
}

// --- persistence ----------------------------------------------------------------

const PERSIST_KEY = 'app-host';

export function loadPersistedAppHost(): unknown {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save `{ activeId, routes }` whenever the active app or a route changes. */
export function startPersistingAppHost(): () => void {
  let last = '';
  return appHost.subscribe(() => {
    if (appHost.getSnapshot().activeId === null) return;
    const json = JSON.stringify(appHost.serialize());
    if (json === last) return;
    last = json;
    try {
      localStorage.setItem(PERSIST_KEY, json);
    } catch {
      // Storage blocked: the hash is the source of truth anyway.
    }
  });
}
