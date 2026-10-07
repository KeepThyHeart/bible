/**
 * Runs feature modules on one platform: decides which are enabled (the off
 * switch), registers their contributions, activates them on their events and
 * routes core hook events to the active ones. See `FeatureModule.ts` for the
 * rules. Pure TypeScript; each app creates one at boot:
 *
 * ```ts
 * const modules = createFeatureModuleHost({
 *   platform: 'web',
 *   points: [appRegistry, verseActionRegistry],
 *   isFlagEnabled: (f) => featureFlags.isEnabled(f),
 *   overrides: () => parseFeatureModuleOverrides(devOnly(localStorage.getItem('kth.modules'))),
 * });
 * modules.add(presentManifest, presentModuleBinding);
 * modules.reconcile();                 // registers contributions of enabled modules; loads no code
 * appHost.onWillActivate((e) => modules.fire(`onApp:${e.id}`));   // or via the binding controller
 * ```
 */

import type { ContributionItem, ContributionPoint } from './ContributionRegistry';
import {
  checkFeatureModuleManifest,
  implicitActivationEvents,
} from './FeatureModule';
import type {
  FeatureModuleBinding,
  FeatureModuleContext,
  FeatureModuleExports,
  FeatureModuleManifest,
  HookEventName,
  HookEventPayloads,
} from './FeatureModule';
import type { FeatureFlagName } from '../Settings/FeatureFlags';
import { disposeAll } from './types';
import type { ContributionSource, Disposable, HostPlatform } from './types';

export interface ActivationTiming {
  readonly moduleId: string;
  readonly event: string;
  /** Time spent in `binding.load()` (fetching and evaluating the chunk). */
  readonly loadMs: number;
  /** Time spent in the module's `activate()`. */
  readonly activateMs: number;
}

export interface FeatureModuleHostOptions {
  readonly platform: HostPlatform;
  /** The wired contribution points, by their `key`. */
  readonly points: readonly ContributionPoint<ContributionItem>[];
  /** Flag resolver. Web: site config + dev override. Desktop: defaults + dev override only. */
  readonly isFlagEnabled: (flag: FeatureFlagName) => boolean;
  /**
   * Dev override: `{ present: false }` forces a module off (or on). Beats the
   * flag. Hosts pass it only in development builds.
   */
  readonly overrides?: () => Readonly<Record<string, boolean>>;
  /** Evaluates hook `when` clauses. Must be cheap and side-effect free. Default: always true. */
  readonly evaluateWhen?: (expression: string) => boolean;
  /** Dev-only timing hook, called after each activation. */
  readonly onActivationTiming?: (timing: ActivationTiming) => void;
  readonly onWarning?: (message: string, error?: unknown) => void;
  /** Clock for timings. Default `performance.now()` when available, else `Date.now()`. */
  readonly now?: () => number;
}

export interface FeatureModuleInfo {
  readonly id: string;
  readonly enabled: boolean;
  readonly active: boolean;
  /** Why it is off: `flag`, `override`, `platform`, `requires`. */
  readonly offReason?: 'flag' | 'override' | 'platform' | 'requires';
  readonly lastTiming?: ActivationTiming;
}

export interface FeatureModuleHost {
  /** Add a module (manifest at boot; binding optional when it only contributes data). Throws on a bad manifest. */
  add(manifest: FeatureModuleManifest, binding?: FeatureModuleBinding): void;
  /**
   * Bring contributions and activations in line with the current flags and
   * overrides: newly disabled modules are deactivated and their contributions
   * removed; newly enabled ones register theirs. Loads no code. Call after
   * adding modules and whenever flags or overrides change.
   */
  reconcile(): void;
  /**
   * An activation event happened. Activates every enabled, inactive module
   * that listens for it (required modules first). Resolves when they are
   * active; a module whose activation fails is reported and left inactive.
   */
  fire(event: string): Promise<void>;
  /** Deliver a core event to active modules that declared it and whose `when` holds. */
  dispatch<E extends HookEventName>(event: E, payload: HookEventPayloads[E]): void;
  /** Number of active subscribers to an event (dispatch sites may skip building a payload when 0). */
  hasSubscribers(event: HookEventName): boolean;
  isEnabled(id: string): boolean;
  isActive(id: string): boolean;
  /** Deactivate one module (its contributions stay). */
  deactivate(id: string): void;
  list(): readonly FeatureModuleInfo[];
  dispose(): void;
}

interface ModuleRecord {
  readonly manifest: FeatureModuleManifest;
  readonly binding?: FeatureModuleBinding;
  readonly events: ReadonlySet<string>;
  readonly source: ContributionSource;
  enabled: boolean;
  offReason?: FeatureModuleInfo['offReason'];
  /** Contributions registered (true between enable and disable). */
  contributed: boolean;
  activating?: Promise<void>;
  exports?: FeatureModuleExports;
  active: boolean;
  disposables: Disposable[];
  lastTiming?: ActivationTiming;
  /** Bumped on deactivation, so a late activation knows it was cancelled. */
  generation: number;
}

/**
 * Parse a dev override string, like `parseFlagOverrides`: `"-present,quiz"`
 * gives `{ present: false, quiz: true }`. JSON objects are accepted too.
 */
export function parseFeatureModuleOverrides(input: string | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const text = (input ?? '').trim();
  if (!text) return out;
  if (text.startsWith('{')) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v;
      }
    } catch {
      // ignore malformed JSON
    }
    return out;
  }
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    const off = token.startsWith('-') || token.startsWith('!');
    const name = off ? token.slice(1) : token;
    if (name) out[name] = !off;
  }
  return out;
}

export function createFeatureModuleHost(options: FeatureModuleHostOptions): FeatureModuleHost {
  const modules = new Map<string, ModuleRecord>();
  /** Insertion order, for deterministic registration. */
  const order: string[] = [];
  const points = new Map<string, ContributionPoint<ContributionItem>>();
  for (const p of options.points) points.set(p.key, p);
  /** event -> ids of ACTIVE modules subscribed to it. Inactive modules are never in here. */
  const hookIndex = new Map<HookEventName, Set<string>>();
  const warn = options.onWarning ?? (() => undefined);
  const now =
    options.now ??
    (() => {
      const perf = (globalThis as { performance?: { now(): number } }).performance;
      return perf ? perf.now() : Date.now();
    });
  let disposed = false;

  // --- Enablement --------------------------------------------------------------

  const computeEnabled = (): Map<string, { on: boolean; reason?: FeatureModuleInfo['offReason'] }> => {
    const overrides = safeCall(options.overrides) ?? {};
    const result = new Map<string, { on: boolean; reason?: FeatureModuleInfo['offReason'] }>();
    const visit = (id: string, stack: readonly string[]): boolean => {
      const done = result.get(id);
      if (done) return done.on;
      const rec = modules.get(id);
      if (!rec || stack.includes(id)) return false; // missing or a requires cycle: off
      const m = rec.manifest;
      let on = true;
      let reason: FeatureModuleInfo['offReason'];
      if (m.platforms && !m.platforms.includes(options.platform)) {
        on = false;
        reason = 'platform';
      } else if (typeof overrides[m.id] === 'boolean') {
        on = overrides[m.id];
        if (!on) reason = 'override';
      } else if (m.flag) {
        on = safeFlag(m.flag);
        if (!on) reason = 'flag';
      }
      if (on && !(m.requires ?? []).every((r) => visit(r, [...stack, id]))) {
        on = false;
        reason = 'requires';
      }
      result.set(id, { on, reason });
      return on;
    };
    for (const id of order) visit(id, []);
    return result;
  };

  const safeFlag = (flag: FeatureFlagName): boolean => {
    try {
      return options.isFlagEnabled(flag);
    } catch (err) {
      warn(`feature flag "${flag}" could not be resolved; treating it as off`, err);
      return false;
    }
  };

  /** Modules sorted so that required modules come first (stable otherwise). */
  const topoOrder = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string, stack: readonly string[]) => {
      if (seen.has(id) || stack.includes(id)) return;
      const rec = modules.get(id);
      if (!rec) return;
      for (const r of rec.manifest.requires ?? []) visit(r, [...stack, id]);
      seen.add(id);
      out.push(id);
    };
    for (const id of order) visit(id, []);
    return out;
  };

  const registerContributions = (rec: ModuleRecord): void => {
    const c = rec.manifest.contributes ?? {};
    for (const [key, raw] of Object.entries(c)) {
      const point = points.get(key);
      if (!point) continue;
      // `i18nNamespace` is a single string: one item whose id is the namespace.
      const items = typeof raw === 'string' ? [{ id: raw }] : raw;
      if (!Array.isArray(items)) continue;
      for (const item of items as ContributionItem[]) {
        const platforms = (item as { platforms?: readonly HostPlatform[] }).platforms;
        if (platforms && !platforms.includes(options.platform)) continue;
        try {
          point.register(item, rec.source);
        } catch (err) {
          warn(`${rec.manifest.id}: could not register contributes.${key} "${item.id}"`, err);
        }
      }
    }
    // Views: lazy component loaders from the binding, only while enabled.
    const viewsPoint = points.get('views');
    if (viewsPoint && rec.binding?.views) {
      for (const [id, load] of Object.entries(rec.binding.views)) {
        try {
          viewsPoint.register({ id, load } as ContributionItem, rec.source);
        } catch (err) {
          warn(`${rec.manifest.id}: could not register view "${id}"`, err);
        }
      }
    }
    rec.contributed = true;
  };

  const removeContributions = (rec: ModuleRecord): void => {
    for (const point of points.values()) {
      try {
        point.disposeBySource(rec.source);
      } catch (err) {
        warn(`${rec.manifest.id}: removing contributions from ${point.key} failed`, err);
      }
    }
    rec.contributed = false;
  };

  // --- Activation ------------------------------------------------------------

  const activate = (rec: ModuleRecord, event: string): Promise<void> => {
    if (rec.active) return Promise.resolve();
    if (rec.activating) return rec.activating;
    const binding = rec.binding;
    if (!binding?.load) return Promise.resolve();
    const generation = rec.generation;
    const run = (async () => {
      // Required modules first (they may provide services this one uses).
      for (const req of rec.manifest.requires ?? []) {
        const r = modules.get(req);
        if (r && r.enabled) await activate(r, event);
      }
      const t0 = now();
      const exports = await binding.load!();
      const t1 = now();
      if (!rec.enabled || rec.generation !== generation || disposed) return; // switched off meanwhile
      const ctx: FeatureModuleContext = {
        moduleId: rec.manifest.id,
        platform: options.platform,
        activationEvent: event,
        subscriptions: rec.disposables,
      };
      const returned = await exports.activate?.(ctx);
      const t2 = now();
      if (returned && typeof (returned as Disposable).dispose === 'function') rec.disposables.push(returned as Disposable);
      rec.exports = exports;
      rec.active = true;
      if (!rec.enabled || rec.generation !== generation || disposed) {
        deactivateRecord(rec);
        return;
      }
      for (const h of rec.manifest.hooks ?? []) {
        if (!exports.hooks?.[h.event]) {
          warn(`${rec.manifest.id}: declares hook "${h.event}" but exports no handler for it`);
          continue;
        }
        let set = hookIndex.get(h.event);
        if (!set) hookIndex.set(h.event, (set = new Set()));
        set.add(rec.manifest.id);
      }
      const timing: ActivationTiming = { moduleId: rec.manifest.id, event, loadMs: t1 - t0, activateMs: t2 - t1 };
      rec.lastTiming = timing;
      options.onActivationTiming?.(timing);
    })();
    rec.activating = run;
    const clear = () => {
      if (rec.activating === run) rec.activating = undefined;
    };
    run.then(clear, (err: unknown) => {
      clear();
      // A failed activation leaves nothing half-registered.
      if (rec.disposables.length) deactivateRecord(rec);
      warn(`${rec.manifest.id}: activation on ${event} failed`, err);
    });
    return run.catch(() => undefined);
  };

  const deactivateRecord = (rec: ModuleRecord): void => {
    rec.generation++;
    // An in-flight activation sees the new generation and stops; a later fire starts afresh.
    rec.activating = undefined;
    for (const set of hookIndex.values()) set.delete(rec.manifest.id);
    const items = rec.disposables.splice(0);
    try {
      disposeAll(items.reverse());
    } catch (err) {
      warn(`${rec.manifest.id}: error while deactivating`, err);
    }
    rec.active = false;
    rec.exports = undefined;
  };

  // --- Public API ------------------------------------------------------------

  const host: FeatureModuleHost = {
    add(manifest, binding) {
      const check = checkFeatureModuleManifest(manifest);
      if (check.errors.length) throw new Error(`Invalid feature module manifest: ${check.errors.join('; ')}`);
      for (const w of check.warnings) warn(w);
      if (modules.has(manifest.id)) throw new Error(`Feature module "${manifest.id}" is already added`);
      if (binding && binding.id !== manifest.id) {
        throw new Error(`Binding "${binding.id}" does not match feature module "${manifest.id}"`);
      }
      const events = new Set<string>([
        ...(manifest.activationEvents ?? []),
        ...implicitActivationEvents(manifest.contributes ?? {}),
      ]);
      modules.set(manifest.id, {
        manifest,
        binding,
        events,
        source: { kind: 'builtin', moduleId: manifest.id },
        enabled: false,
        contributed: false,
        active: false,
        disposables: [],
        generation: 0,
      });
      order.push(manifest.id);
    },

    reconcile() {
      if (disposed) return;
      const enabled = computeEnabled();
      const ids = topoOrder();
      // Switch off first (dependents before what they require), then on.
      for (const id of [...ids].reverse()) {
        const rec = modules.get(id)!;
        const state = enabled.get(id) ?? { on: false };
        rec.offReason = state.on ? undefined : state.reason;
        if (state.on || !rec.enabled) continue;
        rec.enabled = false;
        if (rec.active || rec.activating) deactivateRecord(rec);
        if (rec.contributed) removeContributions(rec);
      }
      for (const id of ids) {
        const rec = modules.get(id)!;
        if (!(enabled.get(id)?.on ?? false) || rec.enabled) continue;
        rec.enabled = true;
        registerContributions(rec);
      }
    },

    async fire(event) {
      if (disposed) return;
      const targets: ModuleRecord[] = [];
      for (const id of topoOrder()) {
        const rec = modules.get(id)!;
        if (rec.enabled && !rec.active && rec.binding?.load && rec.events.has(event)) targets.push(rec);
      }
      await Promise.all(targets.map((rec) => activate(rec, event)));
    },

    dispatch(event, payload) {
      const subscribers = hookIndex.get(event);
      if (!subscribers || subscribers.size === 0) return;
      for (const id of [...subscribers]) {
        const rec = modules.get(id);
        if (!rec?.active || !rec.exports) continue;
        const interest = rec.manifest.hooks?.find((h) => h.event === event);
        if (interest?.when && options.evaluateWhen && !safeWhen(interest.when)) continue;
        const handler = rec.exports.hooks?.[event] as ((p: HookEventPayloads[typeof event]) => void) | undefined;
        try {
          handler?.(payload);
        } catch (err) {
          warn(`${id}: hook ${event} threw`, err);
        }
      }
    },

    hasSubscribers: (event) => (hookIndex.get(event)?.size ?? 0) > 0,
    isEnabled: (id) => modules.get(id)?.enabled ?? false,
    isActive: (id) => modules.get(id)?.active ?? false,

    deactivate(id) {
      const rec = modules.get(id);
      if (rec && (rec.active || rec.activating)) deactivateRecord(rec);
    },

    list: () =>
      order.map((id) => {
        const r = modules.get(id)!;
        return { id, enabled: r.enabled, active: r.active, offReason: r.offReason, lastTiming: r.lastTiming };
      }),

    dispose() {
      if (disposed) return;
      for (const id of [...topoOrder()].reverse()) {
        const rec = modules.get(id)!;
        if (rec.active || rec.activating) deactivateRecord(rec);
        if (rec.contributed) removeContributions(rec);
        rec.enabled = false;
      }
      disposed = true;
      hookIndex.clear();
    },
  };

  const safeWhen = (expr: string): boolean => {
    try {
      return options.evaluateWhen!(expr);
    } catch (err) {
      warn(`when clause "${expr}" failed; treating it as false`, err);
      return false;
    }
  };

  return host;
}

function safeCall<T>(fn: (() => T) | undefined): T | undefined {
  if (!fn) return undefined;
  try {
    return fn();
  } catch {
    return undefined;
  }
}
