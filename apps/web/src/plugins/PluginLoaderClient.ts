/**
 * Client-side PluginLoader — browser-compatible version of @bible/core PluginLoader.
 *
 * Simplified for client use: no filesystem discovery, just manifest registration
 * and activation with dynamic imports.
 */

import type { PluginManifest, PluginModule, PluginState } from '@bible/core';

interface PluginEntry<TContext> {
  manifest: PluginManifest;
  module: PluginModule<TContext> | null;
  state: PluginState;
  error?: string;
}

export class PluginLoaderClient<TContext> {
  private plugins = new Map<string, PluginEntry<TContext>>();
  private activationOrder: string[] = [];

  register(manifest: PluginManifest): void {
    if (this.plugins.has(manifest.id)) return;
    this.plugins.set(manifest.id, {
      manifest,
      module: null,
      state: 'discovered',
    });
  }

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

  private async activateOne(
    id: string,
    contextFactory: (manifest: PluginManifest) => TContext,
    moduleLoader: (manifest: PluginManifest) => Promise<PluginModule<TContext>>,
  ): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry || entry.state === 'active') return;

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

  async deactivateAll(): Promise<void> {
    for (const id of [...this.activationOrder].reverse()) {
      const entry = this.plugins.get(id);
      if (!entry || entry.state !== 'active') continue;
      try {
        if (entry.module?.deactivate) await entry.module.deactivate();
        entry.state = 'inactive';
      } catch (err) {
        entry.state = 'error';
        console.error(`[PluginLoader] Error deactivating "${id}":`, err);
      }
    }
  }

  getActive(): PluginManifest[] {
    return Array.from(this.plugins.values())
      .filter(e => e.state === 'active')
      .map(e => e.manifest);
  }

  getAll(): Array<{ manifest: PluginManifest; state: PluginState; error?: string }> {
    return Array.from(this.plugins.values()).map(e => ({
      manifest: e.manifest,
      state: e.state,
      error: e.error,
    }));
  }

  private resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency involving "${id}"`);
      const entry = this.plugins.get(id);
      if (!entry) return;
      visiting.add(id);
      for (const depId of entry.manifest.dependencies ?? []) {
        if (this.plugins.has(depId)) visit(depId);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.plugins.keys()) visit(id);
    return order;
  }
}
