/**
 * Main-process feature-module registry (task 0113). Production list is empty
 * until Phase 2 migrates features; each entry is the module's data-only
 * manifest plus a lazy `load()` of its main-process code. The code is imported
 * only when the module is enabled AND its activation event fires; the main
 * registry opts every entry into `onStartupFinished` (IPC handlers must exist
 * before the renderer asks), so a manifest listing it in `activationEvents`
 * activates at registration.
 */

import {
  createFeatureModuleHost,
  createFeatureFlags,
  parseFeatureModuleOverrides,
  disposeAll,
  type Disposable,
  type FeatureModuleHost,
  type FeatureModuleManifest,
} from '@bible/core/browser';
import type { FeatureMainModule, MainModuleDeps } from './FeatureMainModule';
import { createModuleIpc, type IpcMainLike } from './moduleIpc';

export interface MainModuleEntry {
  readonly manifest: FeatureModuleManifest;
  readonly load: () => Promise<{ default: FeatureMainModule }>;
}

/** Production table. Empty until Phase 2. */
export const MAIN_MODULES: readonly MainModuleEntry[] = [];

export interface RegisterMainModulesOptions {
  /** Table to use; default `MAIN_MODULES`. */
  readonly modules?: readonly MainModuleEntry[];
  /** True in packaged builds: `KTH_MODULES` is ignored. */
  readonly packaged: boolean;
  /** Raw `KTH_MODULES` value; default `process.env.KTH_MODULES`. */
  readonly overrideText?: string;
}

interface Running {
  host: FeatureModuleHost;
  disposables: Disposable[];
  closers: Array<() => void | Promise<void>>;
}

let running: Running | null = null;

/** Add every table entry to a host and fire `onStartupFinished`. Resolves when enabled modules are active. */
export async function registerMainModules(
  ipcMain: IpcMainLike,
  deps: MainModuleDeps,
  options: RegisterMainModulesOptions,
): Promise<void> {
  if (running) throw new Error('registerMainModules called twice');
  const table = options.modules ?? MAIN_MODULES;
  const flags = createFeatureFlags();
  const overrides = options.packaged
    ? {}
    : parseFeatureModuleOverrides(options.overrideText ?? process.env.KTH_MODULES);
  const state: Running = { host: undefined as unknown as FeatureModuleHost, disposables: [], closers: [] };
  state.host = createFeatureModuleHost({
    platform: 'desktop',
    points: [],
    isFlagEnabled: (flag) => flags.isEnabled(flag),
    overrides: () => overrides,
    onWarning: (m, e) => deps.log.warn(`[modules] ${m}`, e ?? ''),
  });
  running = state;
  for (const entry of table) {
    state.host.add(
      { ...entry.manifest, activationEvents: [...new Set([...(entry.manifest.activationEvents ?? []), 'onStartupFinished' as const])] },
      {
      id: entry.manifest.id,
      load: async () => {
        const mod = (await entry.load()).default;
        return {
          activate: () => {
            const ipc = createModuleIpc(mod.id, ipcMain, deps);
            let returned: void | Disposable;
            try {
              returned = mod.registerIpc(ipc, deps);
            } catch (err) {
              ipc.dispose();
              throw err;
            }
            state.disposables.push({
              dispose() {
                ipc.dispose();
                if (returned) returned.dispose();
              },
            });
            if (mod.close) state.closers.push(() => mod.close!());
          },
        };
      },
      },
    );
  }
  state.host.reconcile();
  await state.host.fire('onStartupFinished');
}

/** Remove every module's channels and call `close()` on each (errors are collected, then the first rethrown). */
export async function closeMainModules(): Promise<void> {
  const state = running;
  if (!state) return;
  running = null;
  state.host.dispose();
  let first: unknown;
  let failed = false;
  try {
    disposeAll(state.disposables.reverse());
  } catch (err) {
    first = err;
    failed = true;
  }
  for (const close of state.closers.reverse()) {
    try {
      await close();
    } catch (err) {
      if (!failed) first = err;
      failed = true;
    }
  }
  if (failed) throw first;
}
