/**
 * Route registry for self-registering Express routes.
 *
 * Core routes and plugin routes both register through this system.
 * The server entry point iterates registered routes to mount them.
 */

import type { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { SiteSettings } from '../siteSettings.js';

// ---------------------------------------------------------------------------
// Dependency bag passed to route factories
// ---------------------------------------------------------------------------

export interface RouteDependencies {
  db: DatabaseManager;
  siteSettings: SiteSettings | null;
  /** Extensible bag for route-specific options (search pipeline, feature flags, etc.) */
  extra: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface RouteRegistration {
  /** Base path for mounting, e.g., '/api/bible' */
  path: string;
  /** Factory that creates the Express Router */
  createRoutes: (deps: RouteDependencies) => Router;
  /** Sort order — lower mounts first (default: 100) */
  order?: number;
  /** Feature module that owns this route (task 0113); tagged by the module loader. Lets a module's routes be listed and removed. */
  moduleId?: string;
}

const registrations: RouteRegistration[] = [];

/**
 * Register a route. Call at module scope (side-effect import triggers registration).
 */
export function registerRoute(reg: RouteRegistration): void {
  registrations.push(!reg.moduleId && currentModuleId ? { ...reg, moduleId: currentModuleId } : reg);
}

let currentModuleId: string | undefined;

/**
 * Run `fn` with every untagged `registerRoute` call made inside it (including
 * by a dynamically imported route file's top level) tagged with `moduleId`.
 * Calls must not overlap: the module loader serialises them.
 */
export async function withRouteModuleId<T>(moduleId: string, fn: () => Promise<T>): Promise<T> {
  const previous = currentModuleId;
  currentModuleId = moduleId;
  try {
    return await fn();
  } finally {
    currentModuleId = previous;
  }
}

/** Routes registered by one feature module (all routes when omitted), in registration order. */
export function listRoutes(moduleId?: string): RouteRegistration[] {
  return registrations.filter((r) => moduleId === undefined || r.moduleId === moduleId);
}

/** Remove every route a module registered. Returns how many were removed. Does not unmount routes already mounted on an app. */
export function unregisterRoutesByModule(moduleId: string): number {
  let removed = 0;
  for (let i = registrations.length - 1; i >= 0; i--) {
    if (registrations[i].moduleId === moduleId) {
      registrations.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * Get all registered routes, sorted by order.
 */
export function getRegisteredRoutes(): RouteRegistration[] {
  return [...registrations].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Clear all registrations (useful for testing).
 */
export function clearRouteRegistry(): void {
  registrations.length = 0;
}
