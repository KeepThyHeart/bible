/**
 * Renderer globals reachable from inside `page.evaluate` callbacks.
 *
 * Two things make this file necessary.
 *
 * First, the Electron fixture is itself named `window`, so inside a spec the
 * identifier `window` is the Playwright `Page` - not the renderer's DOM window.
 * A callback written as `window.evaluate(() => window.innerWidth)` runs
 * correctly (the arrow function is serialized and evaluated in the renderer),
 * but TypeScript resolves that inner `window` to the `Page` and would reject
 * every such property. The specs therefore reach the renderer through
 * `globalThis`, which is unambiguous, and this file declares what lives there.
 *
 * Second, `command-registry.spec.ts` and `module-manager.spec.ts` each carried
 * their own `declare global { interface Window { __services } }` with different
 * shapes, which collided (TS2717) the moment the e2e directory was actually
 * typechecked. One declaration, shared.
 */

/** Command/i18n/context services the renderer attaches for automation. */
interface E2EServices {
  registry: {
    execute: (id: string, args?: unknown) => Promise<unknown>;
    get: (id: string) => unknown;
    list: () => ReadonlyArray<{ id: string }>;
  };
  i18n: {
    t: (key: string, params?: Record<string, unknown>) => string;
    currentLocale: string;
  };
  whenContext: {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
}

/** The slice of the preload bridge the e2e suite drives directly. */
interface E2EElectronBridge {
  diagnostics?: {
    getQueue: () => Promise<unknown>;
    submitManualReport: (args: {
      description: string;
      includeDiagnostics: boolean;
    }) => Promise<unknown>;
    submitFeedback: (args: { description: string }) => Promise<unknown>;
    deleteAll: () => Promise<unknown>;
    getConfig: () => Promise<unknown>;
  };
  search?: {
    semanticAvailable?: () => Promise<unknown>;
  };
}

declare global {
  interface Window {
    __services?: E2EServices;
    electron?: E2EElectronBridge;
  }

  // eslint-disable-next-line no-var
  var __services: E2EServices | undefined;
  // eslint-disable-next-line no-var
  var electron: E2EElectronBridge | undefined;
}

export {};
