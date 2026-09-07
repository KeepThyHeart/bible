/**
 * Concrete client-side plugin context.
 *
 * Wraps stores, event bus, and UI registries to provide a curated API
 * surface to client-side plugins.
 */

import type { IClientPluginContext, PluginLogger, PluginManifest, PluginStorage } from '@bible/core';
import type { ClientHookRegistry } from './ClientHooks';
import type { EventMap } from '../events/eventBus';
import { eventBus } from '../events/eventBus';
import { paneRegistry } from '../panes/paneRegistry';
import type { PaneRegistration } from '../panes/paneRegistry';
import { contextMenuRegistry } from './registries/ContextMenuRegistry';
import type { ContextMenuItem } from './registries/ContextMenuRegistry';
import { verseDecoratorRegistry } from './registries/VerseDecoratorRegistry';
import type { VerseDecorator } from './registries/VerseDecoratorRegistry';
import { settingsRegistry } from './registries/SettingsRegistry';
import type { SettingsSection } from './registries/SettingsRegistry';
import { keybindingRegistry } from './registries/KeybindingRegistry';
import type { KeyBinding } from './registries/KeybindingRegistry';

export interface ClientPluginContextOptions {
  manifest: PluginManifest;
  hooks: ClientHookRegistry;
}

type Handler<T> = (payload: T) => void;

export class ClientPluginContext implements IClientPluginContext {
  readonly pluginId: string;
  readonly log: PluginLogger;
  readonly hooks: ClientHookRegistry;
  readonly storage: PluginStorage;

  /** Track unsubscribe functions for cleanup on deactivation */
  private cleanupFns: Array<() => void> = [];

  constructor(options: ClientPluginContextOptions) {
    this.pluginId = options.manifest.id;
    this.hooks = options.hooks;

    // Scoped logger
    const prefix = `[plugin:${this.pluginId}]`;
    this.log = {
      info: (msg, ...args) => console.log(prefix, msg, ...args),
      warn: (msg, ...args) => console.warn(prefix, msg, ...args),
      error: (msg, ...args) => console.error(prefix, msg, ...args),
    };

    // Scoped localStorage storage
    const storagePrefix = `bible-plugin:${this.pluginId}:`;
    this.storage = {
      get<T>(key: string): T | undefined {
        try {
          const raw = localStorage.getItem(storagePrefix + key);
          return raw ? JSON.parse(raw) as T : undefined;
        } catch {
          return undefined;
        }
      },
      set<T>(key: string, value: T): void {
        localStorage.setItem(storagePrefix + key, JSON.stringify(value));
      },
      delete(key: string): void {
        localStorage.removeItem(storagePrefix + key);
      },
    };
  }

  /**
   * Scoped fetch — requests go to /api/plugins/<pluginId>/...
   */
  async fetch(path: string, options?: RequestInit): Promise<Response> {
    const url = `/api/plugins/${this.pluginId}${path.startsWith('/') ? path : '/' + path}`;
    return globalThis.fetch(url, options);
  }

  // ---------- Event Bus ----------

  /** Access the shared event bus */
  readonly eventBus = {
    on: <K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): (() => void) => {
      const unsub = eventBus.on(event, handler);
      this.cleanupFns.push(unsub);
      return unsub;
    },
    emit: eventBus.emit.bind(eventBus) as typeof eventBus.emit,
  };

  // ---------- UI Registries ----------

  registerPane(registration: PaneRegistration): void {
    const unsub = paneRegistry.register(registration);
    this.cleanupFns.push(unsub);
  }

  registerContextMenuItem(item: ContextMenuItem): void {
    const unsub = contextMenuRegistry.register(item);
    this.cleanupFns.push(unsub);
  }

  registerVerseDecorator(decorator: VerseDecorator): void {
    const unsub = verseDecoratorRegistry.register(decorator);
    this.cleanupFns.push(unsub);
  }

  registerSettings(section: SettingsSection): void {
    const unsub = settingsRegistry.register(section);
    this.cleanupFns.push(unsub);
  }

  registerKeybinding(binding: KeyBinding): void {
    const unsub = keybindingRegistry.register(binding);
    this.cleanupFns.push(unsub);
  }

  // ---------- Lifecycle ----------

  /**
   * Clean up all registrations made by this plugin.
   * Called during deactivation.
   */
  cleanup(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch (err) {
        this.log.error('Error during cleanup:', err);
      }
    }
    this.cleanupFns.length = 0;
  }
}
