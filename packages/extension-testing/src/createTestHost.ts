/**
 * Test host that simulates the extension lifecycle (activate/deactivate)
 * for unit testing extensions in isolation.
 *
 * Usage:
 * ```ts
 * import { createTestHost } from '@bible/extension-testing';
 * import { activate, deactivate } from '../src/index';
 *
 * const host = createTestHost({
 *   activate,
 *   deactivate,
 *   apiOverrides: {
 *     bible: { getVerse: vi.fn().mockResolvedValue({ verseId: 1001001, text: 'In the beginning...' }) }
 *   },
 * });
 *
 * await host.activate();       // Calls your activate(api)
 * const api = host.getApi();   // Access the mock API for assertions
 * await host.deactivate();     // Calls your deactivate()
 * ```
 */

import type { Extensions } from '@bible/core';
import { createMockApi, type MockApiOverrides } from './createMockApi';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;

export interface TestHostOptions {
  /** The extension's activate function. */
  activate: (api: BibleExtensionAPI) => void | Promise<void>;
  /** The extension's deactivate function (optional, like in a real extension). */
  deactivate?: () => void | Promise<void>;
  /** Override specific API methods. */
  apiOverrides?: MockApiOverrides;
  /** Timeout in ms for activate(). Default 5000. */
  activateTimeoutMs?: number;
}

export interface TestHost {
  /** Call the extension's activate(api) with the mock API. */
  activate(): Promise<void>;
  /** Call the extension's deactivate() if it exists. */
  deactivate(): Promise<void>;
  /** Get the mock API object (for assertions or further configuration). */
  getApi(): BibleExtensionAPI;
  /** True after activate() has resolved and before deactivate() completes. */
  isActive(): boolean;
}

const DEFAULT_ACTIVATE_TIMEOUT_MS = 5_000;

/**
 * Create a test host that manages the extension lifecycle.
 *
 * The host creates a mock API from `createMockApi()` with the given overrides,
 * then calls your extension's `activate(api)` and `deactivate()` on demand.
 * This mirrors the real host lifecycle without needing Electron, workers, or RPC.
 */
export function createTestHost(opts: TestHostOptions): TestHost {
  const api = createMockApi(opts.apiOverrides);
  const timeoutMs = opts.activateTimeoutMs ?? DEFAULT_ACTIVATE_TIMEOUT_MS;
  let active = false;

  return {
    async activate(): Promise<void> {
      if (active) {
        throw new Error('TestHost: activate() called while already active');
      }
      const result = Promise.resolve(opts.activate(api));
      await raceTimeout(result, timeoutMs, `activate() timed out after ${timeoutMs}ms`);
      active = true;
    },

    async deactivate(): Promise<void> {
      if (!active) {
        throw new Error('TestHost: deactivate() called while not active');
      }
      if (opts.deactivate) {
        await Promise.resolve(opts.deactivate());
      }
      active = false;
    },

    getApi(): BibleExtensionAPI {
      return api;
    },

    isActive(): boolean {
      return active;
    },
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
