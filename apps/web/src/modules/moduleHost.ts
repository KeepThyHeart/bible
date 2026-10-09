/**
 * The web feature-module host (task 0113): one per page. Same contract as the
 * desktop host. Entry-chunk code: it may import only core, `utils/*`, settings
 * and other host modules, never anything under `src/apps/**` or a feature's own
 * code; modules reach their code only through lazy `binding.load` / `views`.
 *
 * Dev override: `localStorage['kth.modules'] = '-quiz,timeline'` (or
 * `window.kthModules.disable('quiz')`) in a development build;
 * `window.kthModules.table()` prints each module's activation time.
 */
import {
  createFeatureModuleHost,
  createModuleTimingLog,
  createStandardPoints,
  parseFeatureModuleOverrides,
  standardPointList,
} from '@bible/core/browser';
import type { AppId, Disposable, FeatureModuleBinding, FeatureModuleManifest, VerseActionHandler } from '@bible/core/browser';
import { addAppBinding, appHost, appRegistry, verseActions } from '../host/appHost';
import type { WebAppBinding } from '../host/appHost';
import { loadNamespace } from '../i18n';
import { getClientConfig } from '../utils/clientConfig';
import { isEnabled } from '../utils/featureFlags';

/** Every contribution point except `apps` and `verseActions` (those live in the app host). */
export const modulePoints = createStandardPoints();
export const moduleTimings = createModuleTimingLog();

const OVERRIDE_KEY = 'kth.modules';

function devOverrides(): Record<string, boolean> {
  if (!import.meta.env.DEV) return {};
  try {
    return parseFeatureModuleOverrides(localStorage.getItem(OVERRIDE_KEY));
  } catch {
    return {};
  }
}

/**
 * Modules the server reports as off (`/api/config` `modules.disabled`): a
 * module whose server half is not running is off in the client too, in every
 * build. Beats the dev override.
 */
function serverDisabled(): Record<string, boolean> {
  const modules = getClientConfig().modules as { disabled?: unknown } | undefined;
  const out: Record<string, boolean> = {};
  if (Array.isArray(modules?.disabled)) for (const id of modules.disabled) if (typeof id === 'string') out[id] = false;
  return out;
}

function overrides(): Record<string, boolean> {
  return { ...devOverrides(), ...serverDisabled() };
}

let whenEvaluator: (expression: string) => boolean = () => true;

/** Hook `when` clauses are evaluated by the app's context service once it exists. */
export function setWhenEvaluator(fn: (expression: string) => boolean): void {
  whenEvaluator = fn;
}

export const featureModules = createFeatureModuleHost({
  platform: 'web',
  points: [appRegistry, verseActions, ...standardPointList(modulePoints)],
  isFlagEnabled: (flag) => isEnabled(flag),
  overrides,
  evaluateWhen: (expression) => whenEvaluator(expression),
  onActivationTiming: (t) => moduleTimings.record(t),
  onWarning: (message, error) => console.warn(`[modules] ${message}`, error ?? ''),
});

// Core event `app.didActivate`: dispatched only while some active module subscribes.
let lastActiveApp: string | null = null;
appHost.subscribe(() => {
  const id = appHost.getSnapshot().activeId;
  if (id === lastActiveApp) return;
  lastActiveApp = id;
  if (id && featureModules.hasSubscribers('app.didActivate')) featureModules.dispatch('app.didActivate', { appId: id });
});

// --- web module entries (task 0123) ---------------------------------------------

/** What a boot probe asks for. */
export interface BootProbeResult {
  /** Open this app first: beats the URL hash and the saved app. */
  readonly initialApp?: AppId;
  /** Mark these apps busy before the saved app is restored (their `restore: 'while-busy'`). */
  readonly busyApps?: readonly AppId[];
  /** Activate the module after the first paint (it has state to resume). */
  readonly activate?: boolean;
}

/**
 * A web feature module: the core manifest and binding plus the web host's own
 * pieces, all registered only while the module is enabled.
 *
 * - `apps`: app bindings for `contributes.apps` (lazy chunks). Activating one
 *   first activates the module (`onApp:<id>`); a prefetch only loads the chunk.
 * - `verseActionHandlers`: lazy handlers for `contributes.verseActions`;
 *   running one first activates the module (`onVerseAction:<id>`).
 * - `probe`: runs once at boot after the shell config is known and before the
 *   first app is chosen. Synchronous, cheap, entry-chunk code (a URL or
 *   localStorage check); it may take a handoff out of the URL.
 */
export interface WebFeatureModule {
  readonly manifest: FeatureModuleManifest;
  readonly binding?: FeatureModuleBinding;
  readonly apps?: readonly WebAppBinding[];
  readonly verseActionHandlers?: readonly { readonly id: string; load(): Promise<VerseActionHandler> }[];
  probe?(): BootProbeResult | null;
  /**
   * Runs first thing at boot, before the shell fetches its config, for every
   * built-in module whether or not it turns out enabled. Only for taking a
   * secret out of the address bar (a handoff token); keep what it took for `probe`.
   */
  takeUrl?(): void;
}

interface WebRecord {
  readonly entry: WebFeatureModule;
  handles: Disposable[] | null;
}

const webRecords = new Map<string, WebRecord>();

/** Add a built-in module (data now, code later). Call before `reconcileModules()`. */
export function addBuiltinModule(manifest: FeatureModuleManifest, binding?: FeatureModuleBinding): void {
  addWebModule({ manifest, binding });
}

/** Add a web module. Its code (binding.load) waits for its i18n namespace, so the strings are there when it renders. */
export function addWebModule(entry: WebFeatureModule): void {
  const ns = entry.manifest.contributes.i18nNamespace;
  const binding = entry.binding;
  const load = binding?.load;
  featureModules.add(
    entry.manifest,
    binding && ns && load ? { ...binding, load: async () => (await Promise.all([load(), loadNamespace(ns)]))[0] } : binding,
  );
  webRecords.set(entry.manifest.id, { entry, handles: null });
}

function syncWebPieces(): void {
  for (const [id, rec] of webRecords) {
    const on = featureModules.isEnabled(id);
    if (on && !rec.handles) {
      const { apps = [], verseActionHandlers = [] } = rec.entry;
      rec.handles = [
        ...apps.map((b) =>
          addAppBinding({
            ...b,
            // `load` stays a pure chunk load (prefetched on hover); the module activates
            // when the app does, and a failed activation fails the app's (with Retry).
            load: async () => {
              const app = await b.load();
              return {
                ...app,
                activate: async (ctx) => {
                  await featureModules.fire(`onApp:${b.id}`);
                  if (rec.entry.binding?.load && !featureModules.isActive(id)) {
                    throw new Error(`[modules] ${id} did not activate for app "${b.id}"`);
                  }
                  await app.activate?.(ctx);
                },
              };
            },
          }),
        ),
        ...verseActionHandlers.map((hb) =>
          verseActions.bindHandler({
            id: hb.id,
            load: async () => {
              await featureModules.fire(`onVerseAction:${hb.id}`);
              return hb.load();
            },
          }),
        ),
      ];
    } else if (!on && rec.handles) {
      for (const d of rec.handles.splice(0)) d.dispose();
      rec.handles = null;
    }
  }
}

/** Register the contributions of every enabled module (loads no module code). */
export function reconcileModules(): void {
  featureModules.reconcile();
  syncWebPieces();
}

export interface BootIntents {
  readonly initialApp?: AppId;
  readonly busyApps: readonly AppId[];
  /** Modules to activate after the first paint. */
  readonly activate: readonly string[];
}

/** Run the boot probes of enabled modules (once, before the first app is chosen). */
export function runBootProbes(): BootIntents {
  let initialApp: AppId | undefined;
  const busyApps: AppId[] = [];
  const activate: string[] = [];
  for (const [id, rec] of webRecords) {
    if (!rec.entry.probe || !featureModules.isEnabled(id)) continue;
    let result: BootProbeResult | null = null;
    try {
      result = rec.entry.probe();
    } catch (err) {
      console.warn(`[modules] ${id}: boot probe failed`, err);
    }
    if (!result) continue;
    if (result.initialApp && !initialApp) initialApp = result.initialApp;
    busyApps.push(...(result.busyApps ?? []));
    if (result.activate) activate.push(id);
  }
  return { initialApp, busyApps, activate };
}

/** Activate the modules a boot probe asked for (after first paint). */
export function activateProbedModules(ids: readonly string[]): void {
  for (const id of ids) void featureModules.activateNow(id, 'onBootProbe');
}

/** Fire an activation event and ignore the result (callers that must wait use `featureModules.fire`). */
export function fireActivation(event: string): void {
  void featureModules.fire(event);
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const setOverride = (id: string, on: boolean) => {
    const current = devOverrides();
    current[id] = on;
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(current));
    } catch {
      // storage blocked: the override is per session only
    }
    reconcileModules();
  };
  (window as unknown as { kthModules: unknown }).kthModules = {
    list: () => featureModules.list(),
    timings: () => moduleTimings.list(),
    table: () => {
      console.info(moduleTimings.format());
      return moduleTimings.list();
    },
    disable: (id: string) => setOverride(id, false),
    enable: (id: string) => setOverride(id, true),
  };
}
