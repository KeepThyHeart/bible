/**
 * Regression test for a menu bar full of `[menu.file.title]`.
 *
 * ## The invariant
 *
 * `main.tsx` bundles a handful of `en` catalogs into the renderer JS as static
 * imports so the first paint has real strings before any IPC round-trip. Every
 * other catalog arrives later, asynchronously, via `LocaleCatalogLoader`.
 *
 * For a React component that distinction is cosmetic: it renders once with
 * `[key]` placeholders and is re-rendered with real text by the next state
 * change. The application menu has no such second chance. `pushMenuSpec()`
 * builds it ONCE at boot and ships it to main, and rebuilds only when the
 * locale or a keybinding changes - neither of which a reader already on `en`
 * ever triggers. A `menu.*` key missing at that instant is therefore not a
 * flash of placeholder text; it is the menu bar for the rest of the session.
 *
 * `menu.json` was not in the static list, so that is exactly what shipped.
 *
 * These tests pin the invariant rather than the symptom: whatever namespaces
 * `buildMenuSpec` comes to depend on must be resolvable from the catalogs
 * available synchronously at boot.
 */

import { describe, it, expect } from 'vitest';
import { I18nService } from '../services/I18nService';
import { buildMenuSpec } from './buildMenuSpec';
import type { MenuSpec, MenuSpecItem } from '../../../electron/menu/menuSpec';
import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IKeybindingService } from '../services/IKeybindingService';

// The catalogs main.tsx loads synchronously, imported the same way it does.
import enUi from '../../../locales/en/ui.json';
import enCommands from '../../../locales/en/commands.json';
import enLayout from '../../../locales/en/layout.json';
import enSearchBar from '../../../locales/en/searchBar.json';
import enMenu from '../../../locales/en/menu.json';

const STATIC_CATALOGS: Record<string, Record<string, string>> = {
  ui: enUi as Record<string, string>,
  commands: enCommands as Record<string, string>,
  layout: enLayout as Record<string, string>,
  searchBar: enSearchBar as Record<string, string>,
  menu: enMenu as Record<string, string>,
};

/**
 * An i18n service holding only what is available at the moment
 * `pushMenuSpec()` first runs - no catalogs from disk.
 */
function bootI18n(): I18nService {
  const i18n = new I18nService();
  for (const [namespace, strings] of Object.entries(STATIC_CATALOGS)) {
    i18n.loadCatalog('en', namespace, strings);
  }
  return i18n;
}

/**
 * `buildMenuSpec` touches exactly two things on these services, so a stub
 * beats dragging the real registry in. Every command id resolves, since an
 * unregistered one is a separate failure mode (it warns and still labels).
 */
function stubDeps(i18n: I18nService) {
  const registry = {
    get: (commandId: string) => ({ id: commandId, title: commandId, handler: () => {} }),
  } as unknown as ICommandRegistry;
  const keybindings = {
    getBindingsForCommand: () => [],
  } as unknown as IKeybindingService;
  return { registry, i18n, keybindings, isMac: false, allowWebRequests: false };
}

/** Every human-readable label in the spec, depth-first. */
function labelsOf(spec: MenuSpec): string[] {
  const out: string[] = [];
  const visit = (items: MenuSpecItem[]): void => {
    for (const item of items) {
      if (item.type === 'separator') continue;
      if (item.label !== undefined) out.push(item.label);
      if (item.type === 'submenu') visit(item.submenu);
    }
  };
  visit(spec);
  return out;
}

describe('buildMenuSpec at boot', () => {
  it('resolves every label from the statically bundled catalogs', () => {
    const spec = buildMenuSpec(stubDeps(bootI18n()));
    const labels = labelsOf(spec);

    expect(labels.length).toBeGreaterThan(0);

    // I18nService.t() returns `[key]` for a miss. One of those in the menu bar
    // is the bug this file exists for.
    const unresolved = labels.filter((label) => /^\[.+\]$/.test(label));
    expect(unresolved).toEqual([]);
  });

  it('produces the expected top-level menu titles', () => {
    const spec = buildMenuSpec(stubDeps(bootI18n()));

    // Real English, not keys and not brackets.
    expect(spec.map((menu) => menu.label)).toEqual(
      expect.arrayContaining(['File', 'Edit', 'View', 'Privacy', 'Help'])
    );
  });

  it('would fail loudly if the menu catalog were not bundled at boot', () => {
    // The pre-fix state, reproduced: every namespace except `menu`.
    const withoutMenu = new I18nService();
    for (const [namespace, strings] of Object.entries(STATIC_CATALOGS)) {
      if (namespace === 'menu') continue;
      withoutMenu.loadCatalog('en', namespace, strings);
    }

    const labels = labelsOf(buildMenuSpec(stubDeps(withoutMenu)));
    const unresolved = labels.filter((label) => /^\[.+\]$/.test(label));

    // Guards the guard: if this ever comes back empty, the first test above
    // has stopped being able to detect the regression.
    expect(unresolved).not.toEqual([]);
    expect(unresolved).toContain('[menu.file.title]');
  });
});
