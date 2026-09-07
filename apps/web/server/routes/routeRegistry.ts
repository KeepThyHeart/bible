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
}

const registrations: RouteRegistration[] = [];

/**
 * Register a route. Call at module scope (side-effect import triggers registration).
 */
export function registerRoute(reg: RouteRegistration): void {
  registrations.push(reg);
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
