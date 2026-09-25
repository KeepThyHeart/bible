/**
 * `handleWorkspaceRequest`'s new ops (P1.6): `setPanelTitle`, `setPanelBadge`,
 * `revealPanel`. The host-side ownership enforcement is covered in
 * `apps/desktop/electron/extensions/__tests__/ApiImpls.test.ts`
 * (`WorkspaceApiImpl`) - these tests cover the renderer half: that a
 * well-formed, already-permitted request actually reaches dockview / the
 * extension UI store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { attachExtensionRendererBridge } from './extensionRendererBridge';
import { useExtensionUiStore } from './extensionUiStore';
import { useLayoutStore } from '../stores/useLayoutStore';

interface CapturedWorkspaceHandler {
  (payload: { requestId: number; op: string; args: unknown[] }): void;
}

function makeBridgeApi(): { api: { on: unknown; send: unknown; invoke: unknown }; sent: unknown[]; fire: CapturedWorkspaceHandler } {
  const sent: unknown[] = [];
  let handler: CapturedWorkspaceHandler = () => undefined;
  const api = {
    on: (channel: string, h: (payload: unknown) => void) => {
      if (channel === 'ext-bridge:workspace') handler = h as CapturedWorkspaceHandler;
      return () => undefined;
    },
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
    invoke: async () => undefined,
  };
  return { api, sent, fire: (payload) => handler(payload) };
}

function makeServices() {
  return {
    registry: { register: vi.fn(() => ({ dispose: vi.fn() })) } as never,
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
}

/** A dockview stand-in exposing just what `getPanel(id)?.api.*` needs. */
function makeFakeDockview(panelApis: Record<string, { setTitle: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn> }>) {
  return {
    getPanel: (id: string) => (panelApis[id] ? { api: panelApis[id] } : undefined),
  };
}

beforeEach(() => {
  useExtensionUiStore.setState({ panelBadges: {} });
  useLayoutStore.setState({ dockviewApi: null });
});

afterEach(() => {
  useExtensionUiStore.setState({ panelBadges: {} });
  useLayoutStore.setState({ dockviewApi: null });
});

describe('workspace.setPanelTitle reaches dockview', () => {
  it('resolves the LocalizedString and calls setTitle on the live dockview panel', () => {
    const setTitle = vi.fn();
    const setActive = vi.fn();
    useLayoutStore.setState({
      dockviewApi: makeFakeDockview({ p1: { setTitle, setActive } }) as never,
    });
    const { api, sent, fire } = makeBridgeApi();
    const detach = attachExtensionRendererBridge(makeServices(), api as never);

    fire({ requestId: 1, op: 'setPanelTitle', args: ['p1', { key: 'memory.dueCount', params: { n: 5 } }] });

    expect(setTitle).toHaveBeenCalledWith('memory.dueCount');
    expect(sent).toContainEqual({
      channel: 'ext-bridge:workspace:response',
      payload: { requestId: 1, ok: true, result: undefined },
    });
    detach();
  });

  it('is a silent no-op when the panel is no longer open (already closed)', () => {
    useLayoutStore.setState({ dockviewApi: makeFakeDockview({}) as never });
    const { api, sent, fire } = makeBridgeApi();
    const detach = attachExtensionRendererBridge(makeServices(), api as never);

    fire({ requestId: 1, op: 'setPanelTitle', args: ['gone', 'X'] });

    expect(sent).toContainEqual({
      channel: 'ext-bridge:workspace:response',
      payload: { requestId: 1, ok: true, result: undefined },
    });
    detach();
  });
});

describe('workspace.setPanelBadge reaches the extension UI store', () => {
  it('sets a badge that DockviewTabRenderer reads by panel id', () => {
    const { api, fire } = makeBridgeApi();
    const detach = attachExtensionRendererBridge(makeServices(), api as never);

    fire({ requestId: 1, op: 'setPanelBadge', args: ['p1', 5] });
    expect(useExtensionUiStore.getState().panelBadges.p1).toBe(5);

    fire({ requestId: 2, op: 'setPanelBadge', args: ['p1', null] });
    expect(useExtensionUiStore.getState().panelBadges.p1).toBeUndefined();
    detach();
  });
});

describe('workspace.revealPanel reaches dockview', () => {
  it("calls the target panel's api.setActive()", () => {
    const setTitle = vi.fn();
    const setActive = vi.fn();
    useLayoutStore.setState({
      dockviewApi: makeFakeDockview({ p1: { setTitle, setActive } }) as never,
    });
    const { api, fire } = makeBridgeApi();
    const detach = attachExtensionRendererBridge(makeServices(), api as never);

    fire({ requestId: 1, op: 'revealPanel', args: ['p1'] });

    expect(setActive).toHaveBeenCalledTimes(1);
    detach();
  });
});
