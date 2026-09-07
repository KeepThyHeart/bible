/**
 * Core type definitions for the plugin system.
 *
 * These types are platform-agnostic - they define the contracts that both
 * server and client plugin contexts implement. Platform-specific context
 * implementations live in @bible/web (or @bible/desktop in the future).
 */

import type { ISql } from '../Data/Core/ISql';
import type { HookRegistry } from './HookRegistry';

// ---------------------------------------------------------------------------
// Plugin Manifest (from package.json "bible-plugin" field)
// ---------------------------------------------------------------------------

export interface PluginManifest {
  /** Unique plugin identifier (kebab-case, e.g., "reading-tracker") */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Short description of what the plugin does */
  description: string;

  /** Plugin version (semver) */
  version: string;

  /** Which contexts to activate in */
  activationTarget: 'server' | 'client' | 'both';

  /** Path to server entry module (relative to plugin root) */
  serverEntry?: string;

  /** Path to client entry module (relative to plugin root) */
  clientEntry?: string;

  /** IDs of other plugins this one depends on */
  dependencies?: string[];

  /** Declarative metadata about what the plugin contributes.
   *  Used by the host for UI hints and lazy loading decisions. */
  contributes?: {
    panes?: boolean;
    routes?: boolean;
    settings?: boolean;
    contextMenuItems?: boolean;
    verseDecorators?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Plugin Lifecycle
// ---------------------------------------------------------------------------

export type PluginState =
  | 'discovered'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'error';

/** What every plugin entry module must export */
export interface PluginModule<TContext> {
  activate(context: TContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Base Plugin Context (shared shape - extended per platform)
// ---------------------------------------------------------------------------

/** Minimal logging interface provided to plugins */
export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Base context properties shared across server and client contexts.
 * Platform-specific contexts extend this with additional capabilities.
 */
export interface BasePluginContext {
  /** The plugin's unique ID */
  pluginId: string;

  /** Scoped logger that prefixes output with the plugin ID */
  log: PluginLogger;
}

// ---------------------------------------------------------------------------
// Server Plugin Context Interface
// ---------------------------------------------------------------------------

/**
 * Capabilities available to server-side plugins.
 * The concrete implementation lives in @bible/web (or @bible/desktop).
 *
 * The generic parameters for hooks are intentionally `any` here -
 * concrete filter/action maps are defined in the platform packages
 * where the actual hook points are known.
 */
export interface IServerPluginContext extends BasePluginContext {
  /** Register Express routes under /api/plugins/<pluginId>/... */
  registerRoutes(path: string, router: unknown): void;

  /** Register middleware on existing routes (runs before core handlers) */
  registerMiddleware(path: string, handler: unknown): void;

  /** Open a plugin-owned SQLite database in the plugin's data directory */
  openDatabase(filename: string): ISql;

  /** Hook registry for server-side filter and action hooks */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: HookRegistry<any, any>;

  /** Plugin's persistent data directory path */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Client Plugin Context Interface
// ---------------------------------------------------------------------------

/**
 * Capabilities available to client-side plugins.
 * The concrete implementation lives in @bible/web (or @bible/desktop).
 */
export interface IClientPluginContext extends BasePluginContext {
  /** Hook registry for client-side filter and action hooks */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: HookRegistry<any, any>;

  /** Scoped fetch: requests go to /api/plugins/<pluginId>/... */
  fetch(path: string, options?: RequestInit): Promise<Response>;

  /** Scoped persistent key-value storage (localStorage under plugin namespace) */
  storage: PluginStorage;
}

export interface PluginStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}
