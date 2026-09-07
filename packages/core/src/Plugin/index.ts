/**
 * Plugin system exports.
 *
 * Provides the generic plugin infrastructure: hook registry, plugin loader,
 * and type contracts. Platform-specific context implementations live in
 * @bible/web or @bible/desktop.
 */

// Types and interfaces (export types first per project convention)
export type {
  PluginManifest,
  PluginState,
  PluginModule,
  PluginLogger,
  BasePluginContext,
  IServerPluginContext,
  IClientPluginContext,
  PluginStorage,
} from './PluginTypes';

export type {
  FilterHandler,
  ActionHandler,
} from './HookRegistry';

// Implementations
export { HookRegistry } from './HookRegistry';
export { PluginLoader } from './PluginLoader';
