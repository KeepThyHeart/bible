/**
 * Offline pack presets (task 0075) -> packages/core/src/offline/presets.ts
 *
 * Turns catalog starter packs into presets and presets into editable specs.
 * Structural input type on purpose: no catalog types are imported here.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { OfflinePackSpec, PackPreset } from './PackTypes';

export function presetFromStarterPack(p: {
  pack_id: string;
  name: string;
  description?: string;
  version?: string;
  module_ids: string[];
}): PackPreset {
  const preset: PackPreset = {
    id: p.pack_id,
    name: p.name,
    items: p.module_ids.map((id) => ({ kind: 'module' as const, id })),
  };
  if (p.description !== undefined) preset.description = p.description;
  if (p.version !== undefined) preset.version = p.version;
  return preset;
}

export function specFromPreset(preset: PackPreset, now: () => string, newId: () => string): OfflinePackSpec {
  const fromPreset: { id: string; version?: string } = { id: preset.id };
  if (preset.version !== undefined) fromPreset.version = preset.version;
  return {
    packId: newId(),
    name: preset.name,
    items: preset.items.map((i) => ({ ...i })),
    fromPreset,
    updatedAt: now(),
  };
}
