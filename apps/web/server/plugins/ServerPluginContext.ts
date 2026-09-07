/**
 * Concrete server-side plugin context.
 *
 * Wraps DatabaseManager, Express, and the server hook registry to provide
 * a curated API surface to server plugins.
 */

import type { Router, RequestHandler } from 'express';
import type { ISql } from '@bible/core';
import type { IServerPluginContext, PluginLogger, PluginManifest } from '@bible/core';
import type { DatabaseManager } from '../DatabaseManager.js';
import { SqliteProvider } from '../providers/SqliteProvider.js';
import type { ServerHookRegistry } from './ServerHooks.js';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export interface ServerPluginContextOptions {
  manifest: PluginManifest;
  db: DatabaseManager;
  hooks: ServerHookRegistry;
  pluginsDataDir: string;
}

/**
 * Pending route/middleware registrations collected during plugin activation.
 * Applied to Express after all plugins have activated.
 */
export interface PendingRoute {
  pluginId: string;
  path: string;
  router: Router;
}

export interface PendingMiddleware {
  pluginId: string;
  path: string;
  handler: RequestHandler;
}

export class ServerPluginContext implements IServerPluginContext {
  readonly pluginId: string;
  readonly log: PluginLogger;
  readonly hooks: ServerHookRegistry;
  readonly dataDir: string;

  private readonly db: DatabaseManager;
  private readonly openDbs: ISql[] = [];

  /** Collected during activation, applied by pluginManager */
  readonly pendingRoutes: PendingRoute[] = [];
  readonly pendingMiddleware: PendingMiddleware[] = [];

  constructor(options: ServerPluginContextOptions) {
    this.pluginId = options.manifest.id;
    this.db = options.db;
    this.hooks = options.hooks;

    // Create plugin data directory
    this.dataDir = resolve(options.pluginsDataDir, options.manifest.id);
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // Scoped logger
    const prefix = `[plugin:${this.pluginId}]`;
    this.log = {
      info: (msg, ...args) => console.log(prefix, msg, ...args),
      warn: (msg, ...args) => console.warn(prefix, msg, ...args),
      error: (msg, ...args) => console.error(prefix, msg, ...args),
    };
  }

  registerRoutes(path: string, router: Router): void {
    const fullPath = `/api/plugins/${this.pluginId}${path === '/' ? '' : path}`;
    this.pendingRoutes.push({
      pluginId: this.pluginId,
      path: fullPath,
      router,
    });
  }

  registerMiddleware(path: string, handler: RequestHandler): void {
    this.pendingMiddleware.push({
      pluginId: this.pluginId,
      path,
      handler,
    });
  }

  openDatabase(filename: string): ISql {
    const dbPath = resolve(this.dataDir, filename);
    const provider = new SqliteProvider(dbPath);
    this.openDbs.push(provider);
    return provider;
  }

  /**
   * Close all databases opened by this plugin.
   * Called during deactivation.
   */
  cleanup(): void {
    for (const db of this.openDbs) {
      try {
        db.close();
      } catch (err) {
        this.log.error('Error closing database:', err);
      }
    }
    this.openDbs.length = 0;
  }
}
