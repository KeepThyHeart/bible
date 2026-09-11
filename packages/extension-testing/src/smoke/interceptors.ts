/**
 * Permission + network interceptors for the smoke assertion engine.
 *
 * The recording mock API (`recordingApi.ts`) intentionally does not enforce
 * permissions — it's a fixture, not the real host. The smoke assertion engine
 * needs enforcement so it can flag extensions that touch namespaces they did
 * not declare. This module overlays a thin guard on the harness's api object
 * that mirrors `ExtensionPermissionGuard` (desktop) for the handful of
 * namespaces extensions use at runtime.
 *
 * The guard is intentionally conservative — only methods where a real
 * PermissionDeniedError would clearly surface are wrapped. Read methods on
 * DEFAULT_GRANTED_PERMISSIONS namespaces (e.g. `bible.getVerse`) are left
 * alone because they cannot fail a permission check by construction.
 */

import { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type ExtensionManifest = Extensions.ExtensionManifest;
type ExtensionPermission = Extensions.ExtensionPermission;

export interface InterceptorState {
  /** Every `PermissionDeniedError` message the interceptor emitted, in order. */
  readonly permissionDenials: readonly string[];
  /**
   * Every `network.fetch` URL the extension attempted that was NOT covered by
   * `manifest.network.allowedHosts` (or was attempted without the `network`
   * permission declared at all).
   */
  readonly unexpectedFetches: readonly string[];
}

export interface InstalledInterceptor {
  snapshot(): InterceptorState;
  delta(before: InterceptorState, after: InterceptorState): {
    permissionDenials: string[];
    unexpectedFetches: string[];
  };
  restore(): void;
}

interface GuardedMethod {
  namespace: keyof BibleExtensionAPI;
  method: string;
  permission: ExtensionPermission;
}

/**
 * Namespace methods that should surface `PermissionDeniedError` when the
 * manifest hasn't declared the matching permission. Mirrors call sites in
 * `apps/desktop/electron/extensions/api-impl/*`.
 */
const GUARDED_METHODS: readonly GuardedMethod[] = [
  { namespace: 'notes', method: 'list', permission: 'notes:read' },
  { namespace: 'notes', method: 'get', permission: 'notes:read' },
  { namespace: 'notes', method: 'create', permission: 'notes:write' },
  { namespace: 'notes', method: 'update', permission: 'notes:write' },
  { namespace: 'notes', method: 'delete', permission: 'notes:write' },
  { namespace: 'highlights', method: 'list', permission: 'highlights:read' },
  { namespace: 'highlights', method: 'create', permission: 'highlights:write' },
  { namespace: 'highlights', method: 'update', permission: 'highlights:write' },
  { namespace: 'highlights', method: 'delete', permission: 'highlights:write' },
  { namespace: 'bookmarks', method: 'list', permission: 'bookmarks:read' },
  { namespace: 'bookmarks', method: 'add', permission: 'bookmarks:write' },
  { namespace: 'bookmarks', method: 'remove', permission: 'bookmarks:write' },
  // Ordered passage collections reuse the bookmark grants - same rows, so a
  // separate permission would be a second door into the same table.
  { namespace: 'collections', method: 'list', permission: 'bookmarks:read' },
  { namespace: 'collections', method: 'listPassages', permission: 'bookmarks:read' },
  { namespace: 'collections', method: 'create', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'rename', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'delete', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'addPassage', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'removePassage', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'move', permission: 'bookmarks:write' },
  { namespace: 'collections', method: 'reorder', permission: 'bookmarks:write' },
  { namespace: 'storage', method: 'get', permission: 'storage' },
  { namespace: 'storage', method: 'set', permission: 'storage' },
  { namespace: 'storage', method: 'delete', permission: 'storage' },
  { namespace: 'storage', method: 'keys', permission: 'storage' },
  { namespace: 'storage', method: 'getSecret', permission: 'storage:secrets' },
  { namespace: 'storage', method: 'setSecret', permission: 'storage:secrets' },
  { namespace: 'storage', method: 'deleteSecret', permission: 'storage:secrets' },
  { namespace: 'storage', method: 'openDatabase', permission: 'storage:database' },
  { namespace: 'commentary', method: 'getEntry', permission: 'commentary:read' },
  { namespace: 'commentary', method: 'getEntriesForRange', permission: 'commentary:read' },
  { namespace: 'dictionary', method: 'lookup', permission: 'dictionary:read' },
  { namespace: 'dictionary', method: 'search', permission: 'dictionary:read' },
  { namespace: 'book', method: 'getSection', permission: 'book:read' },
  { namespace: 'book', method: 'listSections', permission: 'book:read' },
  { namespace: 'tasks', method: 'run', permission: 'tasks' },
  { namespace: 'extensions', method: 'call', permission: 'extensions:call' },
];

export function installPermissionAndNetworkInterceptors(
  api: BibleExtensionAPI,
  manifest: ExtensionManifest,
): InstalledInterceptor {
  const declared = new Set<ExtensionPermission>(
    (manifest.permissions ?? []) as ExtensionPermission[],
  );
  const allowedHosts = (manifest.network?.allowedHosts ?? []).map((h) => h.host);

  const permissionDenials: string[] = [];
  const unexpectedFetches: string[] = [];
  const restorers: Array<() => void> = [];

  for (const g of GUARDED_METHODS) {
    const ns = api[g.namespace] as unknown as Record<string, unknown>;
    const original = ns[g.method];
    if (typeof original !== 'function') continue;
    if (declared.has(g.permission)) continue;
    const wrapped = (..._args: unknown[]): Promise<unknown> => {
      const msg = `PermissionDeniedError: extension '${manifest.id}' is missing '${g.permission}' (called ${String(g.namespace)}.${g.method})`;
      permissionDenials.push(msg);
      return Promise.reject(
        new Extensions.PermissionDeniedError(msg, {
          extensionId: manifest.id,
          permission: g.permission,
        }),
      );
    };
    ns[g.method] = wrapped;
    restorers.push(() => {
      ns[g.method] = original;
    });
  }

  // network.fetch gets a richer wrapper — it runs the original mock if the
  // call is permitted, but tallies any disallowed attempt.
  const netNs = api.network as unknown as Record<string, unknown>;
  const originalFetch = netNs.fetch;
  if (typeof originalFetch === 'function') {
    const hasNetwork = declared.has('network');
    const fetchWrapped = (...args: unknown[]): Promise<unknown> => {
      const url = typeof args[0] === 'string' ? (args[0] as string) : '';
      const host = safeHost(url);
      const allowed = hasNetwork && host !== null && isHostAllowed(host, allowedHosts);
      if (!allowed) {
        unexpectedFetches.push(url || '<invalid-url>');
        const reason = !hasNetwork
          ? `PermissionDeniedError: extension '${manifest.id}' is missing 'network' (called network.fetch ${url})`
          : `NetworkHostNotAllowedError: host '${host ?? '<invalid>'}' not in manifest.network.allowedHosts`;
        if (!hasNetwork) permissionDenials.push(reason);
        return Promise.reject(
          !hasNetwork
            ? new Extensions.PermissionDeniedError(reason, {
                extensionId: manifest.id,
                permission: 'network',
              })
            : new Extensions.NetworkHostNotAllowedError(reason, { host, url }),
        );
      }
      return (originalFetch as (...a: unknown[]) => Promise<unknown>).apply(api.network, args);
    };
    netNs.fetch = fetchWrapped;
    restorers.push(() => {
      netNs.fetch = originalFetch;
    });
  }

  return {
    snapshot(): InterceptorState {
      return {
        permissionDenials: [...permissionDenials],
        unexpectedFetches: [...unexpectedFetches],
      };
    },
    delta(before, after) {
      return {
        permissionDenials: after.permissionDenials.slice(before.permissionDenials.length),
        unexpectedFetches: after.unexpectedFetches.slice(before.unexpectedFetches.length),
      };
    },
    restore(): void {
      for (const r of restorers) r();
    },
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  for (const pattern of allowed) {
    if (pattern === host) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      if (host.endsWith(suffix)) return true;
    }
  }
  return false;
}
