/**
 * The desktop feature-module host (task 0113): one per renderer. It owns the
 * contribution points (panel types, new-tab tiles, preferences sections, ...),
 * decides which built-in modules are enabled, and activates them on events.
 *
 * Boot adds manifests (data) and calls `reconcile()`; no module code loads
 * until one of its activation events fires (`onPanel:`, `onApp:`, ...).
 *
 * Dev override: `localStorage['kth.modules'] = '-quiz,timeline'` (or
 * `window.kthModules.disable('quiz')`) in a development build turns modules off
 * or on regardless of their flags; `window.kthModules.table()` prints each
 * module's activation time.
 */
import {
  createFeatureModuleHost,
  createModuleTimingLog,
  createStandardPoints,
  parseFeatureModuleOverrides,
  standardPointList,
} from '@bible/core/browser';
import type { FeatureModuleBinding, FeatureModuleManifest } from '@bible/core/browser';
import { appRegistry, verseActions } from '../apps/appHost';
import { isEnabled } from '../settings/featureFlags';

/** Every contribution point except `apps` and `verseActions` (those live in the app host). */
export const modulePoints = createStandardPoints();
export const moduleTimings = createModuleTimingLog();

const OVERRIDE_KEY = 'kth.modules';

function devOverrides(): Record<string, boolean> {
  if (!import.meta.env.DEV) return {};
  try {
    return parseFeatureModuleOverrides(window.localStorage.getItem(OVERRIDE_KEY));
  } catch {
    return {};
  }
}

export const featureModules = createFeatureModuleHost({
  platform: 'desktop',
  points: [appRegistry, verseActions, ...standardPointList(modulePoints)],
  isFlagEnabled: (flag) => isEnabled(flag),
  overrides: devOverrides,
  onActivationTiming: (t) => moduleTimings.record(t),
  onWarning: (message, error) => console.warn(`[modules] ${message}`, error ?? ''),
});

/** Add a built-in module (data now, code later). Call before `reconcile()`. */
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
      window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(current));
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
