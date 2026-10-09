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
import type { Disposable, FeatureModuleBinding, FeatureModuleManifest, VerseActionHandler } from '@bible/core/browser';
import { addAppBinding, appHost, appRegistry, verseActions } from '../apps/appHost';
import type { DesktopAppBinding } from '../apps/appHost';
import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';
import { isEnabled } from '../settings/featureFlags';
import { declareSessionKeys } from '../stores/helpers/sessionRegistry';
import { preferencesSectionGlyphs, setViewActivator } from './host/slots';
import type { ReactNode } from 'react';

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

let whenEvaluator: (expression: string) => boolean = () => true;

/** Hook `when` clauses are evaluated by the app's context service once it exists. */
export function setWhenEvaluator(fn: (expression: string) => boolean): void {
  whenEvaluator = fn;
}

export const featureModules = createFeatureModuleHost({
  platform: 'desktop',
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

/**
 * A desktop feature module: the core manifest and binding plus the desktop host's
 * own pieces, all registered only while the module is enabled (mirrors the web
 * host's `WebFeatureModule`).
 *
 * - `apps`: app bindings for `contributes.apps`. Activating one first activates the
 *   module (`onApp:<id>`); a failed module activation fails the app's.
 * - `verseActionHandlers`: lazy handlers for `contributes.verseActions`; running one first
 *   activates the module (`onVerseAction:<id>`). Registered only while the module is on.
 * - `commands`: the module's command-palette commands. They are registered while
 *   the module is on (palette titles are `ui.json` labels, so they need no module
 *   code); handlers should stay small and import heavy code lazily.
 * - `sessionKeys`: `sessionData.ui` keys the module owns. Declared whether or not the module is on,
 *   so a saved value survives the module being switched off (see `sessionRegistry.ts`).
 */
export interface DesktopFeatureModule {
  readonly manifest: FeatureModuleManifest;
  readonly binding?: FeatureModuleBinding;
  readonly apps?: readonly DesktopAppBinding[];
  readonly verseActionHandlers?: readonly { readonly id: string; load(): Promise<VerseActionHandler> }[];
  readonly commands?: (registry: ICommandRegistry) => IDisposable[];
  /** Sidebar glyphs of the module's preferences sections (by section id); shown while the module is on. */
  readonly preferencesGlyphs?: Readonly<Record<string, ReactNode>>;
  readonly sessionKeys?: readonly string[];
}

interface DesktopRecord {
  readonly entry: DesktopFeatureModule;
  handles: Disposable[] | null;
}

const desktopRecords = new Map<string, DesktopRecord>();
let commandRegistry: ICommandRegistry | null = null;

/** Add a built-in module (data now, code later). Call before `reconcile()`. */
export function addBuiltinModule(manifest: FeatureModuleManifest, binding?: FeatureModuleBinding): void {
  addDesktopModule({ manifest, binding });
}

let namespaceLoader: (ns: string) => Promise<void> = async () => {};

/** Give the host the catalog loader: a module's code waits for its i18n namespace, so its strings are there when it renders. */
export function bindNamespaceLoader(loader: (ns: string) => Promise<void>): void {
  namespaceLoader = loader;
}

export function addDesktopModule(entry: DesktopFeatureModule): void {
  if (entry.sessionKeys) declareSessionKeys(entry.sessionKeys);
  const ns = entry.manifest.contributes.i18nNamespace;
  const binding = entry.binding;
  const load = binding?.load;
  featureModules.add(
    entry.manifest,
    binding && ns && load ? { ...binding, load: async () => (await Promise.all([load(), namespaceLoader(ns)]))[0] } : binding,
  );
  desktopRecords.set(entry.manifest.id, { entry, handles: null });
}

function syncDesktopPieces(): void {
  for (const [id, rec] of desktopRecords) {
    const on = featureModules.isEnabled(id);
    if (on && !rec.handles) {
      if (startupFinished && rec.entry.manifest.activationEvents?.includes('onStartupFinished')) {
        void featureModules.activateNow(id, 'onStartupFinished');
      }
      const { apps = [], verseActionHandlers = [], commands, preferencesGlyphs = {} } = rec.entry;
      rec.handles = [
        ...apps.map((b) =>
          addAppBinding({
            ...b,
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
        ...(commands && commandRegistry ? commands(commandRegistry) : []),
        ...Object.entries(preferencesGlyphs).map(([sectionId, glyph]) => preferencesSectionGlyphs.register({ id: sectionId, glyph })),
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
  syncDesktopPieces();
}

/**
 * Give the host the command registry; the commands of enabled modules register now and
 * follow the module on and off from here. Called once by `registerBuiltinCommands`.
 */
export function bindModuleCommands(registry: ICommandRegistry): IDisposable {
  commandRegistry = registry;
  const mine: Disposable[] = [];
  for (const rec of desktopRecords.values()) {
    if (rec.handles && rec.entry.commands) {
      const ds = rec.entry.commands(registry);
      rec.handles.push(...ds);
      mine.push(...ds);
    }
  }
  return {
    dispose() {
      for (const d of mine.splice(0)) d.dispose();
      if (commandRegistry === registry) commandRegistry = null;
    },
  };
}

let startupFinished = false;

/** Fire the bare `onStartupFinished` event once the renderer is idle (modules that opt in activate here). */
export function fireStartupFinished(): void {
  const run = () => {
    startupFinished = true;
    void featureModules.fire('onStartupFinished');
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 2000 });
  else setTimeout(run, 0);
}

/** Fire an activation event and ignore the result (callers that must wait use `featureModules.fire`). */
export function fireActivation(event: string): void {
  void featureModules.fire(event);
}

// Host views with module slots (the Bible pane, the Study pane) fire `onView:<name>` through this.
setViewActivator(fireActivation);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const setOverride = (id: string, on: boolean) => {
    const current = devOverrides();
    current[id] = on;
    try {
      window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(current));
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
