/**
 * Permission + settings helpers for `ExtensionHost`.
 */

import { Extensions } from '@bible/core';

import type { ExtensionHostContext } from './ExtensionHostTypes';

type ExtensionPermission = Extensions.ExtensionPermission;

export function mergeWithDefaults(
  permissions: ExtensionPermission[],
): ExtensionPermission[] {
  const set = new Set<ExtensionPermission>(permissions);
  for (const p of Extensions.DEFAULT_GRANTED_PERMISSIONS) set.add(p);
  return Array.from(set);
}

export async function updatePermissions(
  ctx: ExtensionHostContext,
  extensionId: string,
  grantedPermissions: ExtensionPermission[],
): Promise<void> {
  if (!ctx.registry.has(extensionId)) return;
  ctx.registry.setPermissions(extensionId, mergeWithDefaults(grantedPermissions));
  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: 'Permissions updated',
    fields: { granted: grantedPermissions },
  });
}

export async function getSettings(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<Record<string, unknown>> {
  const rows = ctx.db.queryAll<{ key: string; value: string }>(
    "SELECT key, value FROM extension_storage WHERE extension_id = ? AND key LIKE '__settings.%'",
    [extensionId],
  );
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const settingKey = r.key.substring('__settings.'.length);
    try {
      out[settingKey] = JSON.parse(r.value);
    } catch {
      out[settingKey] = r.value;
    }
  }
  return out;
}

export async function setSettings(
  ctx: ExtensionHostContext,
  extensionId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  ctx.db.transaction(() => {
    ctx.db.execute(
      "DELETE FROM extension_storage WHERE extension_id = ? AND key LIKE '__settings.%'",
      [extensionId],
    );
    for (const [k, v] of Object.entries(values)) {
      ctx.db.execute(
        'INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        [extensionId, `__settings.${k}`, JSON.stringify(v), now],
      );
    }
    return undefined;
  });
  ctx.logger.appendLog(extensionId, {
    ts: now,
    level: 'info',
    message: 'Settings updated',
    fields: { keys: Object.keys(values) },
  });

  // Push `storage.onDidChangeSettings` to the running worker (if any). The api-impl drops the emit if the worker is not
  // subscribed, so this is safe to call unconditionally.
  const active = ctx.activeWorkers.get(extensionId);
  if (active?.storageApi) {
    active.storageApi.notifySettingsChanged(Object.keys(values));
  }
}
