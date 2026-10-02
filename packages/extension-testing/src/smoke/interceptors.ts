/**
 * Permission + network interceptors for the smoke assertion engine.
 *
 * The recording mock API (`recordingApi.ts`) intentionally does not enforce
 * permissions — it's a fixture, not the real host. The smoke assertion engine
 * needs enforcement so it can flag extensions that touch namespaces they did
 * not declare. This module overlays a thin guard on the harness's api object
 * that mirrors the host's declared guard exactly: the guarded-method table is
 * derived from `Extensions.EXTENSION_API_REGISTRY`, and the check is the same
 * `Extensions.checkMethodGate` the desktop RPC guard calls. Every non-local
 * method whose declaration names a permission (a string or `{ anyOf }`) is
 * wrapped when the manifest (plus the default-granted permissions the real
 * host merges in, e.g. `bible:read`) does not satisfy it. Impl-checked gates
 * (`commands.execute`) pass through, as they do in the host's generic guard.
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
  namespace: string;
  method: string;
  gate: Extensions.MethodGate;
}

/**
 * Every typed, non-local method whose declared gate names a permission
 * (a string or `{ anyOf }`), derived from the declaration registry so it
 * cannot drift from the host's guard. `network.fetch` is excluded: it has its
 * own richer wrapper below. Impl-checked and open gates are left alone.
 */
const GUARDED_METHODS: readonly GuardedMethod[] = Extensions.EXTENSION_API_REGISTRY.methods
  .filter(
    (m) =>
      m.typed &&
      !m.local &&
      Extensions.gatePermissions(m.gate).length > 0 &&
      !(m.namespace === 'network' && m.method === 'fetch'),
  )
  .map((m) => ({ namespace: m.namespace, method: m.method, gate: m.gate }));

export function installPermissionAndNetworkInterceptors(
  api: BibleExtensionAPI,
  manifest: ExtensionManifest,
): InstalledInterceptor {
  // The real host merges DEFAULT_GRANTED_PERMISSIONS into every extension's
  // grant, so the harness does too.
  const declared = new Set<string>([
    ...((manifest.permissions ?? []) as string[]),
    ...Extensions.DEFAULT_GRANTED_PERMISSIONS,
  ]);
  const allowedHosts = (manifest.network?.allowedHosts ?? []).map((h) => h.host);

  const permissionDenials: string[] = [];
  const unexpectedFetches: string[] = [];
  const restorers: Array<() => void> = [];

  for (const g of GUARDED_METHODS) {
    const ns = (api as unknown as Record<string, Record<string, unknown> | undefined>)[g.namespace];
    if (!ns) continue;
    const original = ns[g.method];
    if (typeof original !== 'function') continue;
    const check = Extensions.checkMethodGate(g.gate, declared);
    if (check.ok) continue;
    const missing = check.anyOf
      ? `one of ${check.required.map((p) => `'${p}'`).join(', ')}`
      : `'${check.required[0]}'`;
    const wrapped = (..._args: unknown[]): Promise<unknown> => {
      const msg = `PermissionDeniedError: extension '${manifest.id}' is missing ${missing} (called ${g.namespace}.${g.method})`;
      permissionDenials.push(msg);
      return Promise.reject(
        new Extensions.PermissionDeniedError(msg, {
          extensionId: manifest.id,
          permission: check.required[0] as ExtensionPermission,
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
