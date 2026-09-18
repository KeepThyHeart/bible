/**
 * Panel discovery (`PlatformPlan.md` P3b).
 *
 * `workspace.openPanel` worked, but only the extension itself could call it.
 * Nothing in `NewTabPage`, the application menu or Preferences opened an
 * extension panel, so a panel an extension contributed was reachable only by
 * the extension's own code - a feature the user could not find by looking.
 *
 * The fix is to auto-register one command per contributed panel type.
 * `ICommandRegistry` is the single registry that already serves the palette,
 * the keyboard and the menu bar, and `RendererCommandBridge` already puts
 * extension commands into it, so one registration makes a panel reachable
 * three ways at once and eligible for the Tools menu without the extension
 * author doing anything.
 *
 * The registration is *derived* state, rebuilt from the store on every change
 * rather than maintained incrementally - a divergent shadow copy is the exact
 * bug class this workstream exists to fix - so what these tests pin is that
 * the derivation converges: added, removed, and re-registered panel types all
 * leave the registry matching the store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { attachExtensionRendererBridge } from './extensionRendererBridge';
import { useExtensionUiStore } from './extensionUiStore';

/** A registry stand-in that records what the bridge registers and disposes. */
function makeRegistry() {
  const registered = new Map<string, { id: string; title: unknown; ownerExtensionId?: string }>();
  return {
    registry: {
      register: (reg: { id: string; title: unknown; ownerExtensionId?: string }) => {
        if (registered.has(reg.id)) throw new Error(`duplicate command id: ${reg.id}`);
        registered.set(reg.id, reg);
        return {
          dispose: () => {
            registered.delete(reg.id);
          },
        };
      },
      get: (id: string) => registered.get(id),
      list: () => [...registered.values()],
      execute: vi.fn(),
    },
    ids: () => [...registered.keys()],
    registered,
  };
}

/** The bridge needs a transport; nothing here exercises the IPC half. */
function makeBridgeApi() {
  return {
    on: () => () => undefined,
    send: () => undefined,
    invoke: async () => undefined,
  };
}

function attach() {
  const { registry, ids, registered } = makeRegistry();
  const services = {
    registry: registry as never,
    whenContext: { snapshot: () => ({ toJSON: () => ({}) }) } as never,
    i18n: {
      currentLocale: 'en',
      onDidChangeLocale: () => ({ dispose: () => undefined }),
      resolve: (v: unknown) =>
        typeof v === 'object' && v !== null && 'key' in v
          ? String((v as { key: string }).key)
          : String(v),
      t: (k: string) => k,
    } as never,
  };
  const detach = attachExtensionRendererBridge(services, makeBridgeApi() as never);
  return { detach, ids, registered };
}

beforeEach(() => {
  useExtensionUiStore.setState({ panelTypes: [] });
});

afterEach(() => {
  useExtensionUiStore.setState({ panelTypes: [] });
});

describe('auto-registered panel commands', () => {
  it('registers a command when a panel type appears', () => {
    const { detach, ids } = attach();

    useExtensionUiStore.getState().addPanelType('ext.bible-app.memory', {
      id: 'session',
      title: 'Scripture Memory',
      uiEntry: 'ui/index.html',
    });

    // Namespaced under the owning extension so it satisfies the registry's
    // `ext.<extensionId>.` prefix rule and cannot collide with a command the
    // extension registered itself.
    expect(ids()).toEqual(['ext.bible-app.memory.openPanel.session']);
    detach();
  });

  it('picks up panel types that were already registered before it attached', () => {
    // Activation order is not guaranteed: an extension can register its panel
    // during `onStartupFinished`, before the renderer bridge attaches.
    useExtensionUiStore.getState().addPanelType('ext.a', {
      id: 'p',
      title: 'A panel',
      uiEntry: 'a.html',
    });

    const { detach, ids } = attach();

    expect(ids()).toEqual(['ext.a.openPanel.p']);
    detach();
  });

  it('carries the owning extension so the Tools menu can group by it', () => {
    const { detach, registered } = attach();

    useExtensionUiStore.getState().addPanelType('ext.a', {
      id: 'p',
      title: 'A panel',
      uiEntry: 'a.html',
    });

    expect(registered.get('ext.a.openPanel.p')?.ownerExtensionId).toBe('ext.a');
    detach();
  });

  it('disposes the command when the panel type goes away', () => {
    const { detach, ids } = attach();
    const store = useExtensionUiStore.getState();

    store.addPanelType('ext.a', { id: 'p', title: 'A panel', uiEntry: 'a.html' });
    expect(ids()).toHaveLength(1);

    store.removePanelType('ext.a', 'p');

    expect(ids()).toEqual([]);
    detach();
  });

  it('does not double-register when a panel type re-registers', () => {
    // The registry throws on a duplicate id. Re-registration happens whenever
    // an extension reloads in Developer Mode, so this is the common path, not
    // an edge case.
    const { detach, ids } = attach();
    const store = useExtensionUiStore.getState();

    store.addPanelType('ext.a', { id: 'p', title: 'Old', uiEntry: 'a.html' });
    store.addPanelType('ext.a', { id: 'p', title: 'New', uiEntry: 'a.html' });

    expect(ids()).toEqual(['ext.a.openPanel.p']);
    detach();
  });

  it('drops every command an extension owned when it deactivates', () => {
    const { detach, ids } = attach();
    const store = useExtensionUiStore.getState();

    store.addPanelType('ext.a', { id: 'one', title: 'One', uiEntry: 'a.html' });
    store.addPanelType('ext.a', { id: 'two', title: 'Two', uiEntry: 'b.html' });
    store.addPanelType('ext.b', { id: 'three', title: 'Three', uiEntry: 'c.html' });
    expect(ids()).toHaveLength(3);

    store.removeContributionsByOwner('ext.a');

    expect(ids()).toEqual(['ext.b.openPanel.three']);
    detach();
  });

  it('unregisters everything when the bridge detaches', () => {
    const { detach, ids } = attach();

    useExtensionUiStore.getState().addPanelType('ext.a', {
      id: 'p',
      title: 'A panel',
      uiEntry: 'a.html',
    });
    expect(ids()).toHaveLength(1);

    detach();

    // Otherwise a hot reload of the renderer leaves the previous attachment's
    // commands behind, and the next attach throws on every duplicate id.
    expect(ids()).toEqual([]);
  });

  it('stops reacting to the store once detached', () => {
    const { detach, ids } = attach();
    detach();

    useExtensionUiStore.getState().addPanelType('ext.a', {
      id: 'p',
      title: 'A panel',
      uiEntry: 'a.html',
    });

    expect(ids()).toEqual([]);
  });
});
