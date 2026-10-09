/**
 * Main-process half of a feature module (task 0113).
 *
 * A feature module's main-process code lives in `electron/modules/<id>/` and
 * default-exports a `FeatureMainModule`. It is loaded only when the module is
 * enabled (see `mainModules.ts`), and talks to the renderer through channels
 * namespaced by its id:
 *
 *   - `module:<id>:<method>`        request/response (`ModuleIpc.handle`)
 *   - `module:<id>:event:<name>`    main -> renderer events (`ModuleIpc.send`)
 *
 * Convention (shared types): each module keeps a `types.ts` next to its main
 * code that exports its `TApi` interface (method name -> function) and an
 * optional `TEvents` map (event name -> payload). Main implements `TApi`
 * through `ipc.handle`; the renderer calls
 * `createModuleClient<TApi, TEvents>('<id>')` (src/ui/services/moduleClient.ts).
 * Both import the one file, so they cannot disagree.
 *
 * Handlers reply with the `Result<T>` envelope of `ipc/result.ts`; a thrown
 * `IpcKnownError` becomes a classified failure, anything else `internal`. The
 * renderer client unwraps the envelope, so failures arrive as rejections.
 */

import type { Disposable, ItemSource, ReminderCapabilities, ReminderItem, ReminderPermission } from '@bible/core/browser';

/** Minimal window shape `ModuleIpc.send` needs (a `BrowserWindow` satisfies it). */
export interface ModuleWindow {
  isDestroyed(): boolean;
  readonly webContents: { send(channel: string, ...args: unknown[]): void };
}

export interface ModuleLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** The notification scheduler, for modules that schedule reminders (task 0114: memory push cards). */
export interface ModuleReminderHost {
  registerSource(source: ItemSource): () => void;
  readonly scheduler: {
    replaceItems(sourceId: string, items: unknown, label?: string): Promise<{ accepted: number }>;
    listItems(sourceId: string): ReminderItem[];
  };
  capabilities(): ReminderCapabilities;
  requestPermission(): Promise<ReminderPermission>;
}

/** The slice of the extension host a module may use (task 0114: retiring the memory extension). */
export interface ModuleExtensionsPort {
  /** The installed extensions are loaded (before that, `isEnabled` cannot tell "not installed" from "not loaded yet"). */
  ready(): boolean;
  /** Installed and enabled. */
  isEnabled(extensionId: string): boolean;
  disable(extensionId: string): Promise<void>;
}

/** What main.ts hands every module. Keep it small; add a member only when a module needs it. */
export interface MainModuleDeps {
  /** Electron `app.getPath('userData')`. */
  readonly userDataPath: string;
  /** Windows that should receive module events (usually just the main window). */
  readonly getWindows: () => readonly ModuleWindow[];
  readonly log: ModuleLogger;
  /** The notification scheduler, once it exists. */
  readonly getReminderHost?: () => ModuleReminderHost | null;
  /** The extension host, once it has started (it starts in the background). */
  readonly getExtensions?: () => ModuleExtensionsPort | null;
}

/** Namespaced wrapper over ipcMain for one module. Everything registered is removed on dispose. */
export interface ModuleIpc {
  readonly id: string;
  /** Register `module:<id>:<method>`. A duplicate method throws. The reply is a `Result<T>`. */
  handle<Args extends unknown[], T>(method: string, fn: (...args: Args) => T | Promise<T>): void;
  /** Send `module:<id>:event:<name>` to every window from `deps.getWindows()`. */
  send(name: string, ...args: unknown[]): void;
  /** Channels registered so far (for diagnostics and tests). */
  channels(): readonly string[];
  /** Remove everything registered through this wrapper. Idempotent. */
  dispose(): void;
}

export interface FeatureMainModule {
  readonly id: string;
  registerIpc(ipc: ModuleIpc, deps: MainModuleDeps): void | Disposable;
  close?(): void | Promise<void>;
}
