/**
 * Client-side plugin manager.
 *
 * Fetches active plugin manifests from the server, dynamically imports
 * client entry modules, and manages plugin lifecycle.
 */

import type { PluginManifest, PluginModule } from '@bible/core';
import type { ClientFilterMap, ClientActionMap, ClientHookRegistry } from './ClientHooks';
import { HookRegistry } from '@bible/core/browser';
import { PluginLoaderClient } from './PluginLoaderClient';
import { ClientPluginContext } from './ClientPluginContext';

/** Client plugin module must export activate/deactivate */
type ClientPluginModule = PluginModule<ClientPluginContext>;

export class ClientPluginManager {
  private loader = new PluginLoaderClient<ClientPluginContext>();
  private contexts = new Map<string, ClientPluginContext>();
  readonly hooks: ClientHookRegistry = new HookRegistry<ClientFilterMap, ClientActionMap>();
  private manifests: PluginManifest[] = [];

  /**
   * Fetch active plugin manifests from the server.
   */
  async discover(): Promise<PluginManifest[]> {
    try {
      const response = await fetch('/api/plugins');
      if (!response.ok) {
        console.warn('[ClientPluginManager] Failed to fetch plugins:', response.status);
        return [];
      }
      const data = await response.json();
      this.manifests = (data.plugins || []) as PluginManifest[];

      // Register only plugins that target the client
      for (const manifest of this.manifests) {
        if (manifest.activationTarget === 'client' || manifest.activationTarget === 'both') {
          if (manifest.clientEntry) {
            this.loader.register(manifest);
          }
        }
      }

      if (this.manifests.length > 0) {
        console.log(
          `[ClientPluginManager] Discovered ${this.manifests.length} plugin(s): ${this.manifests.map(p => p.id).join(', ')}`,
        );
      }

      return this.manifests;
    } catch (err) {
      console.warn('[ClientPluginManager] Plugin discovery failed:', err);
      return [];
    }
  }

  /**
   * Activate all discovered client plugins.
   */
  async activate(): Promise<void> {
    await this.loader.activateAll(
      // Context factory
      (manifest) => {
        const ctx = new ClientPluginContext({
          manifest,
          hooks: this.hooks,
        });
        this.contexts.set(manifest.id, ctx);
        return ctx;
      },
      // Module loader — dynamic import of the client entry URL
      async (manifest) => {
        if (!manifest.clientEntry) {
          throw new Error(`Plugin "${manifest.id}" has no clientEntry`);
        }
        // Client entries are served as static files or through a plugin route
        const entryUrl = `/api/plugins/${manifest.id}/client.js`;
        const mod = await import(/* @vite-ignore */ entryUrl) as ClientPluginModule;
        return mod;
      },
    );
  }

  /**
   * Deactivate all plugins and clean up.
   */
  async shutdown(): Promise<void> {
    await this.loader.deactivateAll();
    for (const ctx of this.contexts.values()) {
      ctx.cleanup();
    }
    this.contexts.clear();
  }

  /**
   * Get all active plugin manifests.
   */
  getActivePlugins(): PluginManifest[] {
    return this.loader.getActive();
  }
}

/** Singleton client plugin manager */
export const clientPluginManager = new ClientPluginManager();
