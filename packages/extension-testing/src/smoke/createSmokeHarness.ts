/**
 * Smoke-test harness entry point (Work Item 1).
 *
 * Loads an extension's manifest, spins up a recording mock API, runs the
 * extension's `activate(api)`, and exposes:
 *
 *   - `enumerate()` — every hook contributed statically or registered at
 *     activation time.
 *   - `invokeHook(hookId, input, opts?)` — fire a single hook against an
 *     input. Later work items layer the corpus + assertion engine on top
 *     of this primitive.
 *   - `deactivate()` / `getApi()` / `getCaptured()` — escape hatches for
 *     tests and future items.
 *
 * The harness defaults to in-process execution (per the design doc's
 * recommendation). The `invoker` option accepts any `HookInvoker`, which
 * is where a future `--full` mode would plug in a real `utilityProcess`-
 * backed runtime.
 */

import type { Extensions } from '@bible/core';
import { getMockRuntimeEndpoints, type MockApiOverrides } from '../createMockApi';
import { loadManifest, type LoadedManifest } from './loadManifest';
import { createRecordingApi } from './recordingApi';
import { enumerateHooks } from './enumerateHooks';
import {
  InProcessHookInvoker,
  type HookInvoker,
  type InvokeOptions,
} from './hookInvoker';
import type {
  CapturedRegistrations,
  HookDescriptor,
  HookInvocationResult,
} from './types';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;

export interface SmokeHarnessOptions {
  /**
   * Absolute path to the extension package root (folder containing
   * `extension.json`). Mutually exclusive with `manifest` + `activate`.
   */
  extensionRoot?: string;
  /**
   * Pre-loaded manifest. Useful for tests that don't want disk I/O.
   * Required when `extensionRoot` is not supplied.
   */
  manifest?: Extensions.ExtensionManifest;
  /**
   * The extension's `activate(api)` function. When `extensionRoot` is
   * supplied the harness `require()`s the manifest's `main`; pass this
   * explicitly to bypass module loading (tests, bundlers, etc).
   */
  activate?: (api: BibleExtensionAPI) => void | Promise<void>;
  /** Optional deactivate. Falls back to the loaded module's export. */
  deactivate?: () => void | Promise<void>;
  /** Override specific API methods on top of the recording mock. */
  apiOverrides?: MockApiOverrides;
  /** Activate timeout. Default 5000 ms. */
  activateTimeoutMs?: number;
  /** Swap the invoker — e.g. for a future `--full` utilityProcess mode. */
  invoker?: HookInvoker;
}

export interface SmokeHarness {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  enumerate(): HookDescriptor[];
  invokeHook(
    hookId: string,
    input: unknown,
    opts?: InvokeOptions,
  ): Promise<HookInvocationResult>;
  getApi(): BibleExtensionAPI;
  getCaptured(): CapturedRegistrations;
  getManifest(): Extensions.ExtensionManifest;
  isActive(): boolean;
}

const DEFAULT_ACTIVATE_TIMEOUT_MS = 5_000;

export function createSmokeHarness(opts: SmokeHarnessOptions): SmokeHarness {
  const loaded = resolveManifestAndEntry(opts);
  const { api, captured } = createRecordingApi(opts.apiOverrides);
  // The endpoint table is what turns the endpoint-based hooks (commands and
  // everything routed through one) from skips into real assertions — see the
  // header of `hookInvoker.ts`. It is the mock's own table, so it is filled by
  // the extension's `api.runtime.expose(...)` calls during activate().
  const invoker =
    opts.invoker ?? new InProcessHookInvoker(captured, getMockRuntimeEndpoints(api));
  const activateTimeoutMs = opts.activateTimeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS;
  let active = false;
  let hooks: HookDescriptor[] | null = null;

  return {
    async activate(): Promise<void> {
      if (active) {
        throw new Error('SmokeHarness: activate() called while already active');
      }
      const result = Promise.resolve(loaded.activate(api));
      await raceTimeout(
        result,
        activateTimeoutMs,
        `activate() timed out after ${activateTimeoutMs}ms`,
      );
      active = true;
      hooks = enumerateHooks({ manifest: loaded.manifest, captured });
    },

    async deactivate(): Promise<void> {
      if (!active) return;
      if (loaded.deactivate) {
        await Promise.resolve(loaded.deactivate());
      }
      active = false;
    },

    enumerate(): HookDescriptor[] {
      return hooks ?? enumerateHooks({ manifest: loaded.manifest });
    },

    async invokeHook(
      hookId: string,
      input: unknown,
      invokeOpts?: InvokeOptions,
    ): Promise<HookInvocationResult> {
      const list = hooks ?? enumerateHooks({ manifest: loaded.manifest, captured });
      const hook = list.find((h) => h.hookId === hookId);
      if (!hook) {
        throw new Error(`SmokeHarness: no hook with id "${hookId}"`);
      }
      return invoker.invoke(hook, input, invokeOpts);
    },

    getApi(): BibleExtensionAPI {
      return api;
    },

    getCaptured(): CapturedRegistrations {
      return captured;
    },

    getManifest(): Extensions.ExtensionManifest {
      return loaded.manifest;
    },

    isActive(): boolean {
      return active;
    },
  };
}

interface ResolvedEntry {
  manifest: Extensions.ExtensionManifest;
  activate: (api: BibleExtensionAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

function resolveManifestAndEntry(opts: SmokeHarnessOptions): ResolvedEntry {
  if (opts.extensionRoot !== undefined) {
    const loaded: LoadedManifest = loadManifest(opts.extensionRoot);
    const manifest = loaded.manifest;
    if (opts.activate) {
      return {
        manifest,
        activate: opts.activate,
        ...(opts.deactivate !== undefined ? { deactivate: opts.deactivate } : {}),
      };
    }
    if (!manifest.main) {
      throw new Error(
        `Extension "${manifest.id}" has no manifest.main; supply opts.activate to run it.`,
      );
    }
    const entryPath = require('node:path').resolve(loaded.extensionRoot, manifest.main) as string;
    const mod = require(entryPath) as Extensions.ExtensionEntryPointModule;
    if (typeof mod.activate !== 'function') {
      throw new Error(`Entry module ${entryPath} does not export activate(api).`);
    }
    return {
      manifest,
      activate: mod.activate,
      ...(typeof mod.deactivate === 'function'
        ? { deactivate: mod.deactivate }
        : opts.deactivate !== undefined
          ? { deactivate: opts.deactivate }
          : {}),
    };
  }
  if (!opts.manifest || !opts.activate) {
    throw new Error(
      'createSmokeHarness: supply either `extensionRoot` or both `manifest` and `activate`.',
    );
  }
  return {
    manifest: opts.manifest,
    activate: opts.activate,
    ...(opts.deactivate !== undefined ? { deactivate: opts.deactivate } : {}),
  };
}

function raceTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
