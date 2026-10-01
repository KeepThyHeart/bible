/**
 * The desktop host's binding to the extension API declaration layer.
 *
 * Two things live here:
 *
 *   - `createDeclaredMethodGuard`: the router-level permission check. Every
 *     RPC an extension sends is looked up in `EXTENSION_API_REGISTRY` and
 *     refused with `PermissionDeniedError` unless the extension's grant
 *     satisfies the method's declared gate. This is the authoritative check;
 *     the `requirePermission(...)` calls still inside each api-impl are now
 *     defence in depth, and `DeclaredApiGuard.test.ts` holds the two to the
 *     same answer. A method the host serves but no declaration mentions is
 *     refused outright (fail closed): an undeclared method has no declared
 *     permission, so it cannot be judged.
 *
 *   - `DESKTOP_API_NAMESPACES`: which declared namespaces the desktop host
 *     implements. Keyed by `ApiNamespaceName`, so declaring a namespace
 *     without saying whether desktop serves it is a type error. The list is
 *     sent to the worker as `ExtensionInitPayload.apiNamespaces`; a namespace
 *     marked `false` is simply absent from `api` and extensions
 *     feature-detect it.
 */

import { Extensions } from '@bible/core';

import type { RpcMethodGuard } from './ExtensionRpcRouter';
import {
  requireAnyPermission,
  requirePermission,
  type ExtensionPermissionGrant,
} from './ExtensionPermissionGuard';

type ExtensionPermission = Extensions.ExtensionPermission;

/**
 * Build the guard for one extension's grant. `registry` is injectable for
 * tests; production uses the shared registry.
 */
export function createDeclaredMethodGuard(
  grant: ExtensionPermissionGrant,
  registry: Extensions.ApiRegistry = Extensions.EXTENSION_API_REGISTRY,
): RpcMethodGuard {
  return (method: string) => {
    const declared = registry.methodGate(method);
    if (!declared) {
      throw new Extensions.RpcProtocolError(
        `${method} is served by this host but not declared by any extension API namespace`,
        { method },
      );
    }
    const gate = declared.gate;
    if (gate === null) return;
    if (typeof gate === 'string') {
      requirePermission(grant, gate as ExtensionPermission);
      return;
    }
    if ('anyOf' in gate) {
      requireAnyPermission(grant, gate.anyOf as readonly ExtensionPermission[]);
    }
    // `checkedBy: 'impl'` - the implementation decides from the arguments.
  };
}

/**
 * Whether the desktop host serves each declared namespace. `true` covers
 * worker-local namespaces too (`runtime` is implemented by the worker's own
 * proxy, which ships with this host).
 */
export const DESKTOP_API_NAMESPACES: Readonly<Record<Extensions.ApiNamespaceName, boolean>> = {
  bible: true,
  commentary: true,
  dictionary: true,
  book: true,
  notes: true,
  highlights: true,
  bookmarks: true,
  collections: true,
  storage: true,
  ui: true,
  commands: true,
  tasks: true,
  network: true,
  auth: true,
  extensions: true,
  workspace: true,
  context: true,
  l10n: true,
  events: true,
  runtime: true,
  panels: true,
  ai: true,
};

/** `ExtensionInitPayload.apiNamespaces` for the desktop host, in registry order. */
export function desktopApiNamespaces(): string[] {
  const served = DESKTOP_API_NAMESPACES as Readonly<Record<string, boolean>>;
  return Extensions.EXTENSION_API_REGISTRY.namespaceNames.filter((n) => served[n] === true);
}
