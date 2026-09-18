/**
 * The Tools menu (`PlatformPlan.md` P3a).
 *
 * Nothing in `NewTabPage`, the application menu, or Preferences opened an
 * extension panel, and the command palette was an extension's only entry
 * point. That is fine for power users and invisible to everyone else - a
 * feature an extension contributed could not be *found*, only recalled.
 *
 * The application menu is unusually well suited to fixing that: it is built in
 * the renderer by `buildMenuSpec`, every clickable entry names a command in
 * `ICommandRegistry`, and `RendererCommandBridge` already puts extension
 * commands into that same registry. So the work is a selection rule, and this
 * file pins it.
 *
 * The rule that matters most is the empty case. `buildMenuSpec` already leaves
 * out entries whose command is unregistered rather than showing them dead; a
 * Tools menu that appeared empty on every fresh install would be the same
 * mistake one level up.
 */

import { describe, it, expect, vi } from 'vitest';

import { buildExtensionToolsSubmenu, type BuildMenuSpecDeps } from './buildMenuSpec';
import type { CommandRegistration } from '../types/Command';

function makeDeps(commands: Partial<CommandRegistration>[]): BuildMenuSpecDeps {
  const full = commands.map(
    (c) =>
      ({
        id: 'x',
        title: 'X',
        handler: vi.fn(),
        ...c,
      }) as CommandRegistration,
  );
  return {
    registry: {
      list: () => full,
      get: (id: string) => full.find((c) => c.id === id),
    } as unknown as BuildMenuSpecDeps['registry'],
    i18n: {
      t: (key: string) => key,
      resolve: (v: unknown) =>
        typeof v === 'object' && v !== null && 'key' in v
          ? String((v as { key: string }).key)
          : String(v),
    } as unknown as BuildMenuSpecDeps['i18n'],
    keybindings: {
      // No bindings: accelerators are orthogonal to the selection rule.
      getBindingsForCommand: () => [],
      getPrimaryBinding: () => undefined,
    } as unknown as BuildMenuSpecDeps['keybindings'],
    isMac: false,
  };
}

/** Labels of the command entries, ignoring separators. */
function labels(items: ReturnType<typeof buildExtensionToolsSubmenu>): string[] {
  return items.filter((i) => i.type === 'command').map((i) => (i as { label: string }).label);
}

describe('extension Tools submenu', () => {
  it('is empty when no extension has registered a command', () => {
    // The caller omits the whole submenu on an empty array, so a fresh install
    // with no extensions has no Tools menu at all rather than an empty one.
    expect(buildExtensionToolsSubmenu(makeDeps([]))).toEqual([]);
  });

  it('ignores the app’s own commands', () => {
    const deps = makeDeps([
      { id: 'view.zoomIn', title: 'Zoom In' },
      { id: 'app.about', title: 'About' },
    ]);
    // No `ownerExtensionId` means it is ours, and ours already have homes in
    // File / Edit / View / Help.
    expect(buildExtensionToolsSubmenu(deps)).toEqual([]);
  });

  it('includes an extension command', () => {
    const deps = makeDeps([
      {
        id: 'ext.bible-app.memory.start',
        title: 'Scripture Memory',
        ownerExtensionId: 'ext.bible-app.memory',
      },
    ]);
    expect(labels(buildExtensionToolsSubmenu(deps))).toEqual(['Scripture Memory']);
  });

  it('resolves a catalog reference from the extension’s own title', () => {
    const deps = makeDeps([
      {
        id: 'ext.a.run',
        title: { key: 'ext.a.commands.run' },
        ownerExtensionId: 'ext.a',
      },
    ]);
    expect(labels(buildExtensionToolsSubmenu(deps))).toEqual(['ext.a.commands.run']);
  });

  it('omits hidden commands', () => {
    // `hidden` is how an extension says "reachable, but not by browsing".
    // A menu is browsing.
    const deps = makeDeps([
      { id: 'ext.a.visible', title: 'Visible', ownerExtensionId: 'ext.a' },
      { id: 'ext.a.secret', title: 'Secret', ownerExtensionId: 'ext.a', hidden: true },
    ]);
    expect(labels(buildExtensionToolsSubmenu(deps))).toEqual(['Visible']);
  });

  it('orders within one extension by the command’s order', () => {
    const deps = makeDeps([
      { id: 'ext.a.second', title: 'Second', ownerExtensionId: 'ext.a', order: 20 },
      { id: 'ext.a.first', title: 'First', ownerExtensionId: 'ext.a', order: 10 },
    ]);
    expect(labels(buildExtensionToolsSubmenu(deps))).toEqual(['First', 'Second']);
  });

  it('falls back to label order when two commands share an order', () => {
    // Otherwise the menu's order depends on which extension activated first,
    // which is not stable across restarts.
    const deps = makeDeps([
      { id: 'ext.a.b', title: 'Beta', ownerExtensionId: 'ext.a' },
      { id: 'ext.a.a', title: 'Alpha', ownerExtensionId: 'ext.a' },
    ]);
    expect(labels(buildExtensionToolsSubmenu(deps))).toEqual(['Alpha', 'Beta']);
  });

  it('groups by extension, separated, in extension-id order', () => {
    const deps = makeDeps([
      { id: 'ext.zebra.run', title: 'Zebra thing', ownerExtensionId: 'ext.zebra' },
      { id: 'ext.alpha.run', title: 'Alpha thing', ownerExtensionId: 'ext.alpha' },
    ]);
    const items = buildExtensionToolsSubmenu(deps);

    expect(labels(items)).toEqual(['Alpha thing', 'Zebra thing']);
    expect(items.map((i) => i.type)).toEqual(['command', 'separator', 'command']);
  });

  it('does not start or end with a separator', () => {
    const deps = makeDeps([
      { id: 'ext.a.one', title: 'One', ownerExtensionId: 'ext.a' },
      { id: 'ext.b.two', title: 'Two', ownerExtensionId: 'ext.b' },
    ]);
    const items = buildExtensionToolsSubmenu(deps);

    expect(items[0]?.type).toBe('command');
    expect(items[items.length - 1]?.type).toBe('command');
  });
});
