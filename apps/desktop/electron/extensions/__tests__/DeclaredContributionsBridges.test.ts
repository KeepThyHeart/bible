/**
 * Unit tests for the declared-command/panel-type bookkeeping added to the
 * production `RendererCommandBridge` / `RendererUiBridge` (task 0024 round 3,
 * P1.5 - lazy activation). These two classes own raw `ipcMain` calls (no
 * existing test in this repo unit-tests a production `Renderer*Bridge`
 * directly - they are otherwise only exercised via the `InMemory*Bridge`
 * fakes or e2e), so `electron` is mocked here the same way
 * `electron/ipc/__tests__/handler-helper.test.ts` mocks it: capture
 * `ipcMain.handle`/`ipcMain.on` registrations and invoke them directly,
 * with a fake window whose `webContents.send` just records what was sent
 * rather than roundtripping through a real renderer.
 *
 * This is deliberately the one place that unit-tests the bridges' own
 * declared/placeholder state machine (registerDeclaredCommand, supersede,
 * restore, `disposeByOwner`'s `registrationIdByCommandId` cleanup, the
 * panel-id prefix strip) - `LazyActivation.test.ts` covers the same
 * scenarios end-to-end through `ExtensionHostLifecycle.activate`'s
 * coalescing, but does not exercise the bridges' internals this directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Extensions } from '@bible/core';

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const onListeners = new Map<string, ((event: unknown, ...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
    on: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => void) => {
      const arr = onListeners.get(channel) ?? [];
      arr.push(fn);
      onListeners.set(channel, arr);
    }),
  },
}));

import { RendererCommandBridge, type RendererCommandBridgeDeps } from '../bridges/RendererCommandBridge';
import { RendererUiBridge } from '../bridges/RendererUiBridge';
import type { ExtensionCommandSpec } from '../api-impl/IExtensionRegistryBridges';

type ContributedCommand = Extensions.ContributedCommand;

// --- Fake window / IPC harness --------------------------------------------

interface SentMessage {
  requestId: number;
  op: string;
  args: unknown[];
}

function makeFakeWindow(): { window: { isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void } }; sent: SentMessage[] } {
  const sent: SentMessage[] = [];
  return {
    window: {
      isDestroyed: () => false,
      webContents: {
        send: (_channel: string, payload: unknown) => {
          sent.push(payload as SentMessage);
        },
      },
    },
    sent,
  };
}

function registerOpsFor(sent: SentMessage[], commandId: string): SentMessage[] {
  return sent.filter(
    (m) => m.op === 'register' && (m.args[0] as { spec: ExtensionCommandSpec }).spec.id === commandId,
  );
}

function disposeOpsFor(sent: SentMessage[], registrationId: string): SentMessage[] {
  return sent.filter((m) => m.op === 'dispose' && m.args[0] === registrationId);
}

async function callCommandInvoke(registrationId: string, args: unknown = {}): Promise<unknown> {
  const fn = handlers.get('ext-bridge:command:invoke');
  if (!fn) throw new Error('ext-bridge:command:invoke handler was never registered');
  return fn({}, { registrationId, args });
}

function makeDeps(): {
  deps: RendererCommandBridgeDeps;
  activateCalls: [string, string][];
  logCalls: [string, string, string][];
  callWorkerEndpointCalls: [string, string, unknown[]][];
} {
  const activateCalls: [string, string][] = [];
  const logCalls: [string, string, string][] = [];
  const callWorkerEndpointCalls: [string, string, unknown[]][] = [];
  const deps: RendererCommandBridgeDeps = {
    activate: vi.fn(async (extensionId: string, activationEvent: string) => {
      activateCalls.push([extensionId, activationEvent]);
    }),
    callWorkerEndpoint: vi.fn(async (extensionId: string, endpoint: string, args: unknown[]) => {
      callWorkerEndpointCalls.push([extensionId, endpoint, args]);
      return 'endpoint-result';
    }),
    log: vi.fn((extensionId: string, level: 'warn' | 'error', message: string) => {
      logCalls.push([extensionId, level, message]);
    }),
  };
  return { deps, activateCalls, logCalls, callWorkerEndpointCalls };
}

function decl(overrides: Partial<ContributedCommand> = {}): ContributedCommand {
  return {
    id: 'ext.test.foo.go',
    title: { key: 'cmd.go' },
    handlerEndpoint: 'go',
    ...overrides,
  };
}

beforeEach(() => {
  handlers.clear();
  onListeners.clear();
});

describe('RendererCommandBridge - declared commands', () => {
  it('pre-registers a placeholder row for a declared command', () => {
    const { window, sent } = makeFakeWindow();
    const { deps } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());

    const ops = registerOpsFor(sent, 'ext.test.foo.go');
    expect(ops).toHaveLength(1);
    const spec = ops[0]!.args[0] as { spec: ExtensionCommandSpec };
    expect(spec.spec.ownerExtensionId).toBe('ext.test.foo');
    expect(spec.spec.title).toEqual({ key: 'cmd.go' });
  });

  it('is idempotent - re-registering the same declared command sends no second row', () => {
    const { window, sent } = makeFakeWindow();
    const { deps } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    bridge.registerDeclaredCommand('ext.test.foo', decl());

    expect(registerOpsFor(sent, 'ext.test.foo.go')).toHaveLength(1);
  });

  it('warns and ignores a second extension declaring an id another extension already declared', () => {
    const { window, sent } = makeFakeWindow();
    const { deps, logCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    bridge.registerDeclaredCommand('ext.test.bar', decl({ id: 'ext.test.foo.go' }));

    expect(registerOpsFor(sent, 'ext.test.foo.go')).toHaveLength(1);
    expect(logCalls.some(([id, level]) => id === 'ext.test.bar' && level === 'warn')).toBe(true);
  });

  it('invoking the placeholder activates the extension then calls the handlerEndpoint', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps, activateCalls, callWorkerEndpointCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const registrationId = (registerOpsFor(sent, 'ext.test.foo.go')[0]!.args[0] as {
      registrationId: string;
    }).registrationId;

    const result = await callCommandInvoke(registrationId, { x: 1 });

    expect(activateCalls).toEqual([['ext.test.foo', 'onCommand:ext.test.foo.go']]);
    expect(callWorkerEndpointCalls).toEqual([['ext.test.foo', 'go', [{ x: 1 }]]]);
    expect(result).toBe('endpoint-result');
  });

  it('rejects with an unresolved error when the worker never registers a handlerEndpoint-less declared command, warning once', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps, logCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl({ handlerEndpoint: undefined }));
    const registrationId = (registerOpsFor(sent, 'ext.test.foo.go')[0]!.args[0] as {
      registrationId: string;
    }).registrationId;

    await expect(callCommandInvoke(registrationId)).rejects.toThrow(/unresolved|neither registered/i);
    await expect(callCommandInvoke(registrationId)).rejects.toThrow();

    expect(logCalls.filter(([, level]) => level === 'warn')).toHaveLength(1);
  });

  it('supersede: the worker calling register() for the same id disposes the placeholder and takes over', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps, activateCalls, callWorkerEndpointCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const placeholderId = (registerOpsFor(sent, 'ext.test.foo.go')[0]!.args[0] as {
      registrationId: string;
    }).registrationId;

    const realInvoke = vi.fn(async () => 'real-result');
    const realSpec: ExtensionCommandSpec = {
      id: 'ext.test.foo.go',
      ownerExtensionId: 'ext.test.foo',
      title: { key: 'cmd.go' },
    };
    const disposeReal = bridge.register(realSpec, realInvoke);

    // The placeholder was disposed before the real registration went out -
    // required so the renderer's real `CommandRegistry.register` does not
    // reject the real spec as a duplicate id.
    expect(disposeOpsFor(sent, placeholderId)).toHaveLength(1);

    // Dispatching to the placeholder's old registrationId is no longer
    // possible - it is gone, exactly as it should be.
    await expect(callCommandInvoke(placeholderId)).rejects.toThrow(/no registered/i);

    // The real registration is a second, independent row with its own id.
    const realOps = registerOpsFor(sent, 'ext.test.foo.go');
    expect(realOps).toHaveLength(2); // placeholder + real
    const realRegistrationId = (realOps[1]!.args[0] as { registrationId: string }).registrationId;
    expect(realRegistrationId).not.toBe(placeholderId);

    const result = await callCommandInvoke(realRegistrationId, { y: 2 });
    expect(result).toBe('real-result');
    expect(realInvoke).toHaveBeenCalledWith({ y: 2 });
    // Dispatching to the real row never goes through activate/handlerEndpoint -
    // it is an ordinary registration once it has superseded the placeholder.
    expect(activateCalls).toHaveLength(0);
    expect(callWorkerEndpointCalls).toHaveLength(0);

    disposeReal();
  });

  it('restore: disposing the real registration re-places the declared placeholder', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps, activateCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const realSpec: ExtensionCommandSpec = {
      id: 'ext.test.foo.go',
      ownerExtensionId: 'ext.test.foo',
      title: { key: 'cmd.go' },
    };
    const disposeReal = bridge.register(realSpec, vi.fn(async () => 'real-result'));

    const beforeRestore = registerOpsFor(sent, 'ext.test.foo.go').length;
    disposeReal();
    const afterRestore = registerOpsFor(sent, 'ext.test.foo.go');
    expect(afterRestore.length).toBe(beforeRestore + 1); // placeholder came back

    const newPlaceholderId = (afterRestore[afterRestore.length - 1]!.args[0] as {
      registrationId: string;
    }).registrationId;
    await callCommandInvoke(newPlaceholderId);
    expect(activateCalls).toEqual([['ext.test.foo', 'onCommand:ext.test.foo.go']]);
  });

  it('disposeByOwner (bulk teardown) clears the stale real registration so a later resync can re-place the placeholder', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps, activateCalls } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const realSpec: ExtensionCommandSpec = {
      id: 'ext.test.foo.go',
      ownerExtensionId: 'ext.test.foo',
      title: { key: 'cmd.go' },
    };
    bridge.register(realSpec, vi.fn(async () => 'real-result'));

    // Simulate a worker crash / deactivate: the whole extension is torn down
    // in bulk, NOT via the per-registration disposer `register()` returned.
    const removed = bridge.disposeByOwner('ext.test.foo');
    expect(removed).toBeGreaterThan(0);

    // A resync (DeclaredContributions.syncDeclared, via onDeclaredResync)
    // re-registers the declared command. Before the disposeByOwner fix, this
    // was wrongly treated as still-superseded and never placed a placeholder.
    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const ops = registerOpsFor(sent, 'ext.test.foo.go');
    const newest = ops[ops.length - 1]!;
    const newestId = (newest.args[0] as { registrationId: string }).registrationId;

    await callCommandInvoke(newestId);
    expect(activateCalls).toEqual([['ext.test.foo', 'onCommand:ext.test.foo.go']]);
  });

  it('unregisterDeclaredCommands drops the placeholder entirely', async () => {
    const { window, sent } = makeFakeWindow();
    const { deps } = makeDeps();
    const bridge = new RendererCommandBridge(() => window as never, deps);

    bridge.registerDeclaredCommand('ext.test.foo', decl());
    const registrationId = (registerOpsFor(sent, 'ext.test.foo.go')[0]!.args[0] as {
      registrationId: string;
    }).registrationId;

    bridge.unregisterDeclaredCommands('ext.test.foo');

    expect(disposeOpsFor(sent, registrationId)).toHaveLength(1);
    await expect(callCommandInvoke(registrationId)).rejects.toThrow(/no registered/i);
  });

  it('pings onRendererReady when the renderer bridge attaches', () => {
    const { window } = makeFakeWindow();
    const onRendererReady = vi.fn();
    const { deps } = makeDeps();
    new RendererCommandBridge(() => window as never, { ...deps, onRendererReady });

    const readyListeners = onListeners.get('ext-bridge:command:ready') ?? [];
    expect(readyListeners.length).toBeGreaterThan(0);
    for (const l of readyListeners) l({});

    expect(onRendererReady).toHaveBeenCalledTimes(1);
  });
});

describe('RendererUiBridge - declared panel types', () => {
  it('strips the extension-id prefix before registering (the panel-id prefix trap)', () => {
    const { window, sent } = makeFakeWindow();
    const bridge = new RendererUiBridge(() => window as never);

    // The manifest validator normalizes `{ id: 'panel' }` to the long form.
    bridge.registerDeclaredPanelType('ext.test.foo', {
      id: 'ext.test.foo.panel',
      title: { key: 'panel.title' },
      uiEntry: 'ui/index.html',
    });

    const op = sent.find((m) => m.op === 'panelTypeRegistered');
    expect(op).toBeDefined();
    const payload = op!.args[0] as { extensionId: string; def: { id: string } };
    expect(payload.extensionId).toBe('ext.test.foo');
    expect(payload.def.id).toBe('panel');
  });

  it('leaves an already-short id unchanged', () => {
    const { window, sent } = makeFakeWindow();
    const bridge = new RendererUiBridge(() => window as never);

    bridge.registerDeclaredPanelType('ext.test.foo', {
      id: 'panel',
      title: { key: 'panel.title' },
      uiEntry: 'ui/index.html',
    });

    const payload = sent.find((m) => m.op === 'panelTypeRegistered')!.args[0] as {
      def: { id: string };
    };
    expect(payload.def.id).toBe('panel');
  });

  it('a later imperative registerPanelType for the same short id replaces the declared row, not a second one', () => {
    const { window, sent } = makeFakeWindow();
    const bridge = new RendererUiBridge(() => window as never);

    bridge.registerDeclaredPanelType('ext.test.foo', {
      id: 'ext.test.foo.panel',
      title: { key: 'panel.title' },
      uiEntry: 'ui/index.html',
    });
    bridge.registerPanelType('ext.test.foo', {
      id: 'panel',
      title: { key: 'panel.title.updated' },
      uiEntry: 'ui/index.html',
    });

    const registered = sent.filter((m) => m.op === 'panelTypeRegistered');
    expect(registered).toHaveLength(2);
    // Both notifications target the SAME renderer-side key
    // (`${extensionId}::${id}`) - `extensionUiStore.addPanelType` replaces by
    // key, so this is one row after two writes, not two rows.
    expect(bridge.getPanelType('ext.test.foo', 'panel')?.title).toEqual({
      key: 'panel.title.updated',
    });
  });

  it('unregisterDeclaredPanelTypes drops every panel type owned by the extension', () => {
    const { window, sent } = makeFakeWindow();
    const bridge = new RendererUiBridge(() => window as never);

    bridge.registerDeclaredPanelType('ext.test.foo', {
      id: 'panel',
      title: { key: 'panel.title' },
      uiEntry: 'ui/index.html',
    });
    bridge.unregisterDeclaredPanelTypes('ext.test.foo');

    expect(sent.some((m) => m.op === 'panelTypeUnregistered')).toBe(true);
    expect(bridge.getPanelType('ext.test.foo', 'panel')).toBeUndefined();
  });
});
