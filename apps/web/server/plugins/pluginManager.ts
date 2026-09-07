/**
 * Server-side plugin manager.
 *
 * Handles plugin discovery from the filesystem, activation via PluginLoader,
 * and wiring plugin routes/middleware into Express.
 * 
 * Note that the plugins system has not been very well tested, and probably won't be until
 * a few real plugins are built against it to identify the practical gaps and bugs.  Plugins
 * aren't as big a deal here as in the desktop app, but they would allow additional functionality
 * to be available to hosters of this website without having to modify the core code.
 */

import type { Express } from 'express';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { HookRegistry, PluginLoader } from '../core.js';
import type { PluginManifest, PluginModule } from '@bible/core';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { ServerFilterMap, ServerActionMap, ServerHookRegistry } from './ServerHooks.js';
import { ServerPluginContext } from './ServerPluginContext.js';

/** Server plugin module must export activate/deactivate */
type ServerPluginModule = PluginModule<ServerPluginContext>;

export class ServerPluginManager {
  private loader = new PluginLoader<ServerPluginContext>();
  private contexts = new Map<string, ServerPluginContext>();
  readonly hooks: ServerHookRegistry = new HookRegistry<ServerFilterMap, ServerActionMap>();

  constructor(
    private readonly db: DatabaseManager,
    private readonly pluginsDir: string,
    private readonly pluginsDataDir: string,
  ) {}

  /**
   * Discover plugins from the plugins directory.
   * Each subdirectory with a package.json containing "bible-plugin" is a plugin.
   */
  discover(): PluginManifest[] {
    if (!existsSync(this.pluginsDir)) {
      return [];
    }

    const discovered: PluginManifest[] = [];
    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pkgPath = join(this.pluginsDir, entry.name, 'package.json');
      if (!existsSync(pkgPath)) continue;

      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const manifest = pkg['bible-plugin'] as PluginManifest | undefined;
        if (!manifest?.id) continue;

        // Resolve entry paths relative to plugin directory
        if (manifest.serverEntry) {
          manifest.serverEntry = resolve(this.pluginsDir, entry.name, manifest.serverEntry);
        }
        if (manifest.clientEntry) {
          manifest.clientEntry = resolve(this.pluginsDir, entry.name, manifest.clientEntry);
        }

        this.loader.register(manifest);
        discovered.push(manifest);
      } catch (err) {
        console.error(`[PluginManager] Failed to read plugin at ${entry.name}:`, err);
      }
    }

    if (discovered.length > 0) {
      console.log(`[PluginManager] Discovered ${discovered.length} plugin(s): ${discovered.map(p => p.id).join(', ')}`);
    }

    return discovered;
  }

  /**
   * Activate all discovered plugins that target the server.
   */
  async activate(): Promise<void> {
    await this.loader.activateAll(
      // Context factory
      (manifest) => {
        const ctx = new ServerPluginContext({
          manifest,
          db: this.db,
          hooks: this.hooks,
          pluginsDataDir: this.pluginsDataDir,
        });
        this.contexts.set(manifest.id, ctx);
        return ctx;
      },
      // Module loader
      async (manifest) => {
        if (!manifest.serverEntry) {
          throw new Error(`Plugin "${manifest.id}" has no serverEntry`);
        }
        // Dynamic import of the plugin's server module
        const mod = await import(manifest.serverEntry) as ServerPluginModule;
        return mod;
      },
    );
  }

  /**
   * Mount all plugin routes and middleware on the Express app.
   * Call this AFTER activate() and BEFORE the catch-all static file handler.
   */
  mountRoutes(app: Express): void {
    // Mount middleware first (runs before core routes)
    for (const ctx of this.contexts.values()) {
      for (const mw of ctx.pendingMiddleware) {
        app.use(mw.path, mw.handler);
      }
    }

    // Mount plugin routes
    for (const ctx of this.contexts.values()) {
      for (const route of ctx.pendingRoutes) {
        app.use(route.path, route.router);
        console.log(`[PluginManager] Mounted route: ${route.path} (plugin: ${route.pluginId})`);
      }
    }
  }

  /**
   * Deactivate all plugins and clean up resources.
   */
  async shutdown(): Promise<void> {
    // Fire shutdown action
    await this.hooks.runActions('server:shutdown', undefined as unknown as void);

    // Deactivate plugins
    await this.loader.deactivateAll();

    // Clean up plugin databases
    for (const ctx of this.contexts.values()) {
      ctx.cleanup();
    }
    this.contexts.clear();
  }

  /**
   * Get active plugin manifests (for the /api/plugins endpoint).
   */
  getActivePlugins(): PluginManifest[] {
    return this.loader.getActive();
  }

  /**
   * Get all plugins with their states (for diagnostics).
   */
  getAllPlugins(): Array<{ manifest: PluginManifest; state: string; error?: string }> {
    return this.loader.getAll();
  }
}
