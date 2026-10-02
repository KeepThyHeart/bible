/**
 * Offline pack presets for the web app (task 0075).
 *
 * Presets come from the site configuration only (`/api/config`, key `offlinePackPresets`), never from
 * browser storage: the web app must not persist pack content. The expected shape is the catalog
 * starter-pack shape: `{ pack_id, name, description?, version?, module_ids: string[] }[]`.
 *
 * HOOK: the server does not send `offlinePackPresets` yet, so the list is empty until an operator
 * (or a later task) adds it to the client config; no code change is needed here when it does.
 *
 * Licence: GPL-3.0-or-later.
 */

import { presetFromStarterPack } from '@bible/core/browser';
import type { PackPreset } from '@bible/core/browser';
import { getClientConfig } from '../utils/clientConfig';

/** Validates untrusted config input; malformed entries are dropped. */
export function parseWebPresets(raw: unknown): PackPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: PackPreset[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (typeof o.pack_id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.module_ids)) continue;
    const ids = o.module_ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (ids.length === 0) continue;
    out.push(
      presetFromStarterPack({
        pack_id: o.pack_id,
        name: o.name,
        ...(typeof o.description === 'string' ? { description: o.description } : {}),
        ...(typeof o.version === 'string' ? { version: o.version } : {}),
        module_ids: ids,
      }),
    );
  }
  return out;
}

export function getWebPresets(): PackPreset[] {
  return parseWebPresets(getClientConfig().offlinePackPresets);
}
