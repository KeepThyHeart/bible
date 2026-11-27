/**
 * Loads `electron-updater` lazily, and finds its `autoUpdater` however the
 * module shape arrives.
 *
 * ## Why this file exists (1.0.0-beta.1/beta.2 bug)
 *
 * The main bundle is CommonJS. A dynamic `import('electron-updater')` there is a
 * real Node ESM import of a CJS module, and Node can only expose the named
 * exports it can find by scanning the source (cjs-module-lexer).
 * electron-updater publishes `autoUpdater` through an arrow-function getter
 * (`Object.defineProperty(exports, 'autoUpdater', { get: () => ... })`), which
 * the lexer does not see: the namespace has no `autoUpdater`, only
 * `default.autoUpdater`. `namespace.autoUpdater` was `undefined`, and
 * "Download & Update" died with "Cannot set properties of undefined (setting
 * 'autoDownload')". Vitest mocks hid it, because a mock has the named export.
 *
 * Rules that follow (enforced by `electron/__tests__/lazyImportGuard.test.ts`
 * and `scripts/check-lazy-imports.mjs`):
 *   - load CommonJS packages lazily with `require()` (what {@link loadAutoUpdater}
 *     does), never `await import()`, unless the package is on the guard's list of
 *     verified-safe ones;
 *   - read members through {@link pickExport}, which also accepts `default`.
 */

import type { AppUpdater } from 'electron-updater';

/**
 * Read `name` from a module however it was loaded: directly (CommonJS
 * `require`, or an ESM namespace that has the named export) or from `default`
 * (an ESM namespace over a CJS module whose exports the lexer could not see).
 */
export function pickExport<T>(mod: unknown, name: string): T | undefined {
  if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) return undefined;
  const direct = (mod as Record<string, unknown>)[name];
  if (direct !== undefined) return direct as T;
  const fallback = (mod as { default?: unknown }).default;
  if (fallback !== null && (typeof fallback === 'object' || typeof fallback === 'function')) {
    return (fallback as Record<string, unknown>)[name] as T | undefined;
  }
  return undefined;
}

/** The `autoUpdater` singleton of a loaded `electron-updater`, or a clear error. */
export function pickAutoUpdater(mod: unknown): AppUpdater {
  const updater = pickExport<AppUpdater>(mod, 'autoUpdater');
  if (!updater) {
    throw new Error('electron-updater loaded but exposes no autoUpdater');
  }
  return updater;
}

/** Lazily `require` electron-updater (heavy CJS tree; nothing needs it until the user asks). */
export function loadAutoUpdater(): AppUpdater {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return pickAutoUpdater(require('electron-updater'));
}
