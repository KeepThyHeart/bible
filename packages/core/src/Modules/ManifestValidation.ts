/**
 * Validation of built-in feature module manifests (task 0113).
 *
 * Built-ins use the extension manifest's `contributes` vocabulary, so the same
 * validators serve both:
 *
 * - `validateBuiltinManifest` is pure and checks the shapes of every key
 *   (ids, label refs, unique ids, stable id syntax) without any registry;
 * - `toExtensionManifest` re-expresses the keys that exist in the extension
 *   vocabulary (`commands`, `panelTypes`) as a synthetic extension manifest,
 *   so a test can run the #44 `validateManifest` on a built-in's declarations.
 */

import type { ExtensionManifest } from '../Extensions/ExtensionManifest';
import { checkFeatureModuleManifest } from './FeatureModule';
import type { FeatureModuleManifest } from './FeatureModule';
import type { LabelRef } from './types';

const ID_RE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

function isLabelRef(v: unknown): v is Extract<LabelRef, { key: string }> {
  return !!v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string' && typeof (v as { fallback?: unknown }).fallback === 'string';
}

/** Every problem found in one manifest (empty: valid). Includes the host's own `checkFeatureModuleManifest` errors. */
export function validateBuiltinManifest(m: FeatureModuleManifest): string[] {
  const errors = [...checkFeatureModuleManifest(m).errors];
  const c = m.contributes ?? {};
  const seen = new Set<string>();
  const checkItems = (key: string, items: readonly unknown[] | undefined, needsTitle: boolean) => {
    for (const raw of items ?? []) {
      const item = raw as { id?: unknown; title?: unknown };
      const where = `${m.id}: contributes.${key}`;
      if (typeof item.id !== 'string' || !ID_RE.test(item.id)) {
        errors.push(`${where}: bad id ${JSON.stringify(item.id)}`);
        continue;
      }
      const tag = `${key}:${item.id}`;
      if (seen.has(tag)) errors.push(`${where}: duplicate id "${item.id}"`);
      seen.add(tag);
      if (needsTitle && !isLabelRef(item.title)) errors.push(`${where} "${item.id}": title must be { key, fallback }`);
    }
  };
  checkItems('apps', c.apps, true);
  checkItems('verseActions', c.verseActions, true);
  checkItems('panelTypes', c.panelTypes, true);
  checkItems('paneModes', c.paneModes, true);
  checkItems('newTabTiles', c.newTabTiles, true);
  checkItems('preferencesSections', c.preferencesSections, true);
  checkItems('statusBarItems', c.statusBarItems, true);
  checkItems('serverRoutes', c.serverRoutes, false);
  checkItems('settings', c.settings, false);
  for (const group of c.settings ?? []) {
    const keys = new Set<string>();
    for (const def of group.defs) {
      if (keys.has(def.key)) errors.push(`${m.id}: contributes.settings "${group.id}": duplicate setting key "${def.key}"`);
      keys.add(def.key);
    }
  }
  for (const t of c.newTabTiles ?? []) {
    const target = t.target as Record<string, unknown> | undefined;
    if (!target || (!('panelType' in target) && !('appId' in target) && !('commandId' in target))) {
      errors.push(`${m.id}: contributes.newTabTiles "${t.id}": target needs panelType, appId or commandId`);
    }
  }
  for (const s of c.statusBarItems ?? []) {
    if (s.alignment !== 'left' && s.alignment !== 'right') {
      errors.push(`${m.id}: contributes.statusBarItems "${s.id}": alignment must be left or right`);
    }
  }
  if (c.i18nNamespace !== undefined && (typeof c.i18nNamespace !== 'string' || !/^[a-z][A-Za-z0-9-]*$/.test(c.i18nNamespace))) {
    errors.push(`${m.id}: contributes.i18nNamespace must be a simple name`);
  }
  return errors;
}

/**
 * A synthetic extension manifest carrying the built-in's `commands` and
 * `panelTypes` (the keys with an extension counterpart), for running the #44
 * manifest validator over a built-in's declarations.
 */
export function toExtensionManifest(m: FeatureModuleManifest): ExtensionManifest {
  const contributes: Record<string, unknown> = {};
  if (m.contributes.commands?.length) contributes.commands = m.contributes.commands;
  if (m.contributes.panelTypes?.length) {
    contributes.panelTypes = m.contributes.panelTypes.map((p) => ({
      id: p.id,
      title: 'key' in p.title ? p.title.fallback : p.title.text,
      uiEntry: `builtin/${m.id}/${p.id}.html`,
    }));
  }
  return {
    id: `ext.kth.${m.id}`,
    name: m.id,
    publisher: 'kth',
    version: '0.0.0',
    displayName: m.id,
    description: `Built-in feature module ${m.id}`,
    engines: { bibleApp: '*' },
    contributes,
  } as unknown as ExtensionManifest;
}
