/**
 * Loads server feature modules (task 0113): builds a feature-module host for
 * platform 'web', adds the modules from the table, reconciles (flags and the
 * dev-only `BIBLE_MODULES` override decide) and fires `onStartupFinished`, so
 * enabled modules' route files import and self-register before routes mount.
 */

import {
  createFeatureModuleHost,
  createStandardPoints,
  parseFeatureModuleOverrides,
  standardPointList,
  validateBuiltinManifest,
} from '../core.js';
import type { FeatureFlags, FeatureModuleHost, FeatureModuleManifest } from '../core.js';
import { listRoutes, unregisterRoutesByModule, withRouteModuleId } from '../routes/routeRegistry.js';
import { logger } from '../utils/logger.js';
import { serverModules } from './serverModules.js';
import type { ServerModuleEntry } from './serverModules.js';

export interface LoadServerModulesOptions {
  readonly flags: Pick<FeatureFlags, 'isEnabled'>;
  /** Dev override. Default: `BIBLE_MODULES`, ignored when NODE_ENV is production. */
  readonly overrides?: () => Readonly<Record<string, boolean>>;
  /**
   * Site config `featureModules`, honoured in every NODE_ENV. Only `false`
   * entries count: `true` would beat the module's flag and skip its own
   * requirement check in the host, so it is dropped (a module that is on by
   * default stays on, one behind a flag stays behind it). The dev override
   * still wins over these.
   */
  readonly featureModules?: Readonly<Record<string, boolean>>;
  /** Module table. Default: the production table. */
  readonly modules?: readonly ServerModuleEntry[];
}

export interface ServerModuleHandle {
  readonly host: FeatureModuleHost;
  /** Re-resolve flags/overrides; removes the registered routes of newly disabled modules. Does not unmount routes already mounted. */
  reconcile(): void;
}

export const BOOT_EVENT = 'onStartupFinished';

/** The `false` entries of a site config `featureModules` object. */
export function siteDisabledModules(featureModules: Readonly<Record<string, boolean>> | undefined): string[] {
  return Object.entries(featureModules ?? {}).filter(([, on]) => on === false).map(([id]) => id);
}

/** The dev-only `BIBLE_MODULES` override (empty in production). */
export function envOverrides(): Record<string, boolean> {
  return process.env.NODE_ENV === 'production' ? {} : parseFeatureModuleOverrides(process.env.BIBLE_MODULES);
}

/**
 * `/api/config` `modules.disabled`: the server modules that are off, plus every id
 * the site config sets to `false` (so client-only modules go off in the browser too),
 * except those the dev `BIBLE_MODULES` override turns back on.
 */
export function disabledModuleIds(featureModules?: Readonly<Record<string, boolean>>): string[] {
  const envOn = envOverrides();
  return [...new Set([
    ...listServerModules().filter((m) => !m.enabled).map((m) => m.id),
    ...siteDisabledModules(featureModules).filter((id) => envOn[id] !== true),
  ])];
}

let current: { entries: readonly ServerModuleEntry[]; handle: ServerModuleHandle } | undefined;

export async function loadServerModules(options: LoadServerModulesOptions): Promise<ServerModuleHandle> {
  const entries = options.modules ?? serverModules;
  const points = createStandardPoints();
  const host = createFeatureModuleHost({
    platform: 'web',
    points: standardPointList(points),
    isFlagEnabled: (f) => options.flags.isEnabled(f),
    overrides: () => ({
      ...Object.fromEntries(siteDisabledModules(options.featureModules).map((id) => [id, false])),
      ...(options.overrides ?? envOverrides)(),
    }),
    onWarning: (message, error) => logger.warn(error ? `${message}: ${String(error)}` : message),
  });

  // Loads are serialised so each route file's registrations are tagged with the right module.
  let queue: Promise<unknown> = Promise.resolve();
  for (const entry of entries) {
    const errors = validateBuiltinManifest(entry.manifest);
    if (errors.length) throw new Error(`Invalid server module manifest: ${errors.join('; ')}`);
    const id = entry.manifest.id;
    host.add(
      { ...entry.manifest, activationEvents: [...new Set([...(entry.manifest.activationEvents ?? []), 'onStartupFinished' as const])] },
      {
      id,
      load: () => {
        const run = queue.then(() => withRouteModuleId(id, entry.load));
        queue = run.catch(() => undefined);
        return run.then(() => ({}));
      },
      },
    );
  }

  const handle: ServerModuleHandle = {
    host,
    reconcile() {
      host.reconcile();
      for (const entry of entries) {
        if (!host.isEnabled(entry.manifest.id)) unregisterRoutesByModule(entry.manifest.id);
      }
    },
  };
  host.reconcile();
  await host.fire(BOOT_EVENT);
  current = { entries, handle };
  return handle;
}

/** Diagnostics: every server module with its state and the routes it registered. */
export function listServerModules(): Array<{
  id: string;
  manifest: FeatureModuleManifest;
  enabled: boolean;
  active: boolean;
  offReason?: string;
  routes: string[];
}> {
  if (!current) return [];
  const info = new Map(current.handle.host.list().map((i) => [i.id, i]));
  return current.entries.map(({ manifest }) => {
    const i = info.get(manifest.id);
    return {
      id: manifest.id,
      manifest,
      enabled: i?.enabled ?? false,
      active: i?.active ?? false,
      offReason: i?.offReason,
      routes: listRoutes(manifest.id).map((r) => r.path),
    };
  });
}
