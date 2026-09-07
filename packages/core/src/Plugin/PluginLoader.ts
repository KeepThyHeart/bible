/**
 * Generic plugin loader - handles discovery, dependency resolution,
 * and lifecycle management.
 *
 * Parameterized by the context type so both server and client can
 * reuse the same loader with their own context implementations.
 */

import type { PluginManifest, PluginModule, PluginState } from './PluginTypes';

interface PluginEntry<TContext> {
  manifest: PluginManifest;
  module: PluginModule<TContext> | null;
  state: PluginState;
  error?: string;
}

export class PluginLoader<TContext> {
  private plugins = new Map<string, PluginEntry<TContext>>();
  private activationOrder: string[] = [];

  /**
   * Register a discovered plugin manifest.
   * Call this for each plugin found during discovery, before activation.
   */
  register(manifest: PluginManifest): void {
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginLoader] Plugin "${manifest.id}" already registered, skipping duplicate`);
      return;
    }
    this.plugins.set(manifest.id, {
      manifest,
      module: null,
      state: 'discovered',
    });
  }

  /**
   * Activate all registered plugins in dependency order.
   *
   * @param contextFactory Creates a context for a specific plugin
   * @param moduleLoader Loads the plugin module (import/require) given its manifest
   */
  async activateAll(
    contextFactory: (manifest: PluginManifest) => TContext,
    moduleLoader: (manifest: PluginManifest) => Promise<PluginModule<TContext>>,
  ): Promise<void> {
    const order = this.resolveDependencyOrder();
    this.activationOrder = order;

    for (const id of order) {
      await this.activateOne(id, contextFactory, moduleLoader);
    }
  }

  /**
   * Activate a single plugin by ID.
   */
  private async activateOne(
    id: string,
    contextFactory: (manifest: PluginManifest) => TContext,
    moduleLoader: (manifest: PluginManifest) => Promise<PluginModule<TContext>>,
  ): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) return;
    if (entry.state === 'active') return;

    // Check dependencies are active
    for (const depId of entry.manifest.dependencies ?? []) {
      const dep = this.plugins.get(depId);
      if (!dep || dep.state !== 'active') {
        entry.state = 'error';
        entry.error = `Dependency "${depId}" is not active`;
        console.error(`[PluginLoader] Cannot activate "${id}": dependency "${depId}" not active`);
        return;
      }
    }

    entry.state = 'activating';
    try {
      const mod = await moduleLoader(entry.manifest);
      entry.module = mod;

      const context = contextFactory(entry.manifest);
      await mod.activate(context);

      entry.state = 'active';
      console.log(`[PluginLoader] Activated plugin "${id}" v${entry.manifest.version}`);
    } catch (err) {
      entry.state = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`[PluginLoader] Failed to activate "${id}":`, err);
    }
  }

  /**
   * Deactivate all plugins in reverse activation order.
   */
  async deactivateAll(): Promise<void> {
    const reversed = [...this.activationOrder].reverse();
    for (const id of reversed) {
      await this.deactivateOne(id);
    }
  }

  /**
   * Deactivate a single plugin by ID.
   */
  async deactivateOne(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry || entry.state !== 'active') return;

    entry.state = 'deactivating';
    try {
      if (entry.module?.deactivate) {
        await entry.module.deactivate();
      }
      entry.state = 'inactive';
      console.log(`[PluginLoader] Deactivated plugin "${id}"`);
    } catch (err) {
      entry.state = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`[PluginLoader] Error deactivating "${id}":`, err);
    }
  }

  // ---------- Query ----------

  getState(id: string): PluginState | undefined {
    return this.plugins.get(id)?.state;
  }

  getManifest(id: string): PluginManifest | undefined {
    return this.plugins.get(id)?.manifest;
  }

  getAll(): Array<{ manifest: PluginManifest; state: PluginState; error?: string }> {
    return Array.from(this.plugins.values()).map(e => ({
      manifest: e.manifest,
      state: e.state,
      error: e.error,
    }));
  }

  getActive(): PluginManifest[] {
    return Array.from(this.plugins.values())
      .filter(e => e.state === 'active')
      .map(e => e.manifest);
  }

  // ---------- Dependency Resolution ----------

  /**
   * Topological sort of plugins by dependencies.
   * Throws on circular dependencies.
   */
  private resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(
          `[PluginLoader] Circular dependency detected involving plugin "${id}"`,
        );
      }

      const entry = this.plugins.get(id);
      if (!entry) return;

      visiting.add(id);
      for (const depId of entry.manifest.dependencies ?? []) {
        if (!this.plugins.has(depId)) {
          console.warn(
            `[PluginLoader] Plugin "${id}" depends on unknown plugin "${depId}" - skipping dependency`,
          );
          continue;
        }
        visit(depId);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.plugins.keys()) {
      visit(id);
    }

    return order;
  }
}
