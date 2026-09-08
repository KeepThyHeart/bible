/**
 * Permission guard.
 *
 * Every host-side API implementation calls
 * `requirePermission(grant, perm)` at the start of each method; on failure it
 * throws `PermissionDeniedError`, which the RPC router serializes back to the
 * extension worker and the runtime re-raises inside the extension's promise
 * rejection.
 *
 * The guard is intentionally tiny and stateless - the registry owns the
 * grant; the guard just checks it. This keeps API impls free of imperative
 * "if (!grant.has(...)) throw" boilerplate while remaining trivially testable.
 */

import { Extensions } from '@bible/core';

type ExtensionPermission = Extensions.ExtensionPermission;

/**
 * Snapshot of an extension's currently-granted permissions, plus enough
 * identity info for permission errors to point at the offending extension.
 */
export interface ExtensionPermissionGrant {
  readonly extensionId: string;
  readonly permissions: ReadonlySet<ExtensionPermission>;
}

/**
 * Build a grant from a string array (the shape stored in the `extensions`
 * table). Unknown strings are kept as-is so a permission added in a future
 * version is still recognizable.
 */
export function buildGrant(
  extensionId: string,
  permissions: readonly string[],
): ExtensionPermissionGrant {
  return {
    extensionId,
    permissions: new Set(permissions as ExtensionPermission[]),
  };
}

/**
 * Throw `PermissionDeniedError` if the grant is missing the required
 * permission. Returns void on success so call sites stay one-liners.
 */
export function requirePermission(
  grant: ExtensionPermissionGrant,
  permission: ExtensionPermission,
): void {
  if (!grant.permissions.has(permission)) {
    throw new Extensions.PermissionDeniedError(
      `Extension '${grant.extensionId}' is missing required permission '${permission}'.`,
      { extensionId: grant.extensionId, permission },
    );
  }
}

/**
 * Throw `PermissionDeniedError` if the grant is missing ALL of a set of
 * permissions. Useful for "any of" gates (e.g. an API method that accepts
 * either `notes:read` or `notes:write`).
 */
export function requireAnyPermission(
  grant: ExtensionPermissionGrant,
  permissions: readonly ExtensionPermission[],
): void {
  for (const p of permissions) {
    if (grant.permissions.has(p)) return;
  }
  throw new Extensions.PermissionDeniedError(
    `Extension '${grant.extensionId}' is missing one of: ${permissions.join(', ')}`,
    { extensionId: grant.extensionId, permissions },
  );
}

/** True if the grant carries the permission. Cheap predicate, no throw. */
export function hasPermission(
  grant: ExtensionPermissionGrant,
  permission: ExtensionPermission,
): boolean {
  return grant.permissions.has(permission);
}
