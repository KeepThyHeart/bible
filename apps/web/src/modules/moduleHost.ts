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
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { appHost, appRegistry, verseActions } from '../host/appHost';
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

let whenEvaluator: (expression: string) => boolean = () => true;

/** Hook `when` clauses are evaluated by the app's context service once it exists. */
export function setWhenEvaluator(fn: (expression: string) => boolean): void {
  whenEvaluator = fn;
}

export const featureModules = createFeatureModuleHost({
  platform: 'web',
  points: [appRegistry, verseActions, ...standardPointList(modulePoints)],
  isFlagEnabled: (flag) => isEnabled(flag),
  overrides: devOverrides,
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

/** Add a built-in module (data now, code later). Call before `reconcileModules()`. */
export function addBuiltinModule(manifest: FeatureModuleManifest, binding?: FeatureModuleBinding): void {
  featureModules.add(manifest, binding);
}

/** Register the contributions of every enabled module (loads no module code). */
export function reconcileModules(): void {
  featureModules.reconcile();
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
    featureModules.reconcile();
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
