/**
 * Main-process feature-module registry (task 0113). Production list: one entry per
 * migrated feature (Phase 2); each entry is the module's data-only
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
  parseFlagOverrides,
  disposeAll,
  type Disposable,
  type FeatureModuleHost,
  type FeatureModuleManifest,
} from '@bible/core/browser';
import type { FeatureMainModule, MainModuleDeps } from './FeatureMainModule';
import { createModuleIpc, type IpcMainLike } from './moduleIpc';
import { timelineMainManifest } from './timeline/manifest';
import { quizMainManifest } from './quiz/manifest';
import { readingPlansMainManifest } from './reading-plans/manifest';
import { xrefGraphMainManifest } from './xref-graph/manifest';
import { similarMainManifest } from './similar/manifest';
import { wordStudyMainManifest } from './word-study/manifest';

export interface MainModuleEntry {
  readonly manifest: FeatureModuleManifest;
  readonly load: () => Promise<{ default: FeatureMainModule }>;
}

/** Production table: one line per migrated module. */
export const MAIN_MODULES: readonly MainModuleEntry[] = [
  { manifest: timelineMainManifest, load: () => import('./timeline/module') },
  { manifest: quizMainManifest, load: () => import('./quiz') },
  { manifest: readingPlansMainManifest, load: () => import('./reading-plans') },
  { manifest: xrefGraphMainManifest, load: () => import('./xref-graph') },
  { manifest: similarMainManifest, load: () => import('./similar') },
  { manifest: wordStudyMainManifest, load: () => import('./word-study') },
];

export interface RegisterMainModulesOptions {
  /** Table to use; default `MAIN_MODULES`. */
  readonly modules?: readonly MainModuleEntry[];
  /** True in packaged builds: `KTH_MODULES` is ignored. */
  readonly packaged: boolean;
  /** Raw `KTH_MODULES` value; default `process.env.KTH_MODULES`. */
  readonly overrideText?: string;
  /**
   * Raw flag override (`'audio,-pwa'` or JSON); default `process.env.KTH_FLAGS`.
   * The main-process twin of the renderer's dev `localStorage['kth.flags']`, so a
   * flagged module can be switched on in both processes in a dev build. Ignored when packaged.
   */
  readonly flagOverrideText?: string;
  /** Per-module activation timeout in ms (default 10 s): a hung module is reported and skipped, never blocks startup. */
  readonly activationTimeoutMs?: number;
}

export const DEFAULT_MAIN_MODULE_TIMEOUT_MS = 10_000;

/** Resolve `promise`, or reject after `ms` with a timeout error naming `what`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
  const flags = createFeatureFlags({
    overrides: options.packaged ? {} : parseFlagOverrides(options.flagOverrideText ?? process.env.KTH_FLAGS),
  });
  const timeoutMs = options.activationTimeoutMs ?? DEFAULT_MAIN_MODULE_TIMEOUT_MS;
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
        const mod = (await withTimeout(entry.load(), timeoutMs, `main module "${entry.manifest.id}" load`)).default;
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
