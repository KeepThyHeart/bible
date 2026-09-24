/**
 * UI tier 2 unit tests.
 *
 * Tests permission gating, parameter validation, bridge delegation, and
 * disposal for all T2 UI methods:
 *
 *   - registerVerseDecorator / updateVerseDecorations
 *   - registerVerseHover
 *   - registerContextMenu
 *   - registerStatusBarItem
 *   - pickFile / saveFile
 */

import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { UiApiImpl, InMemoryUiBridge } from '../api-impl';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

// --- Paired transports ---------------------------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
  workerSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const workerSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      workerSent.push(env);
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent, workerSent };
}

let nextWorkerReqId = 1;

async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `w-${nextWorkerReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < hostSent.length; j++) {
      const env = hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

// --- Helpers -------------------------------------------------------------

function makeUi(
  permissions: string[],
): { pair: ReturnType<typeof pairedTransports>; bridge: InMemoryUiBridge; api: UiApiImpl } {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const bridge = new InMemoryUiBridge();
  const api = new UiApiImpl({
    extensionId: 'ext.test.ui',
    router,
    bridge,
    grant: buildGrant('ext.test.ui', permissions),
  });
  api.attach();
  return { pair, bridge, api };
}

// --- registerVerseDecorator ----------------------------------------------

describe('ui.registerVerseDecorator', () => {
  it('registers and disposes a decorator with ui:verse-decorator', async () => {
    const { pair, bridge } = makeUi(['ui:verse-decorator']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseDecorator', [
      { id: 'morphHighlight', decorateEndpoint: 'onDecorate' },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toHaveProperty('disposalId');
    expect(bridge.decorators).toHaveLength(1);
    expect(bridge.decorators[0].descriptor.id).toBe('morphHighlight');

    // Dispose via the handle
    const disposalId = (res.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    expect(bridge.decorators).toHaveLength(0);
  });

  it('rejects without ui:verse-decorator', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseDecorator', [
      { id: 'x', decorateEndpoint: 'onDecorate' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('rejects invalid descriptor', async () => {
    const { pair } = makeUi(['ui:verse-decorator']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseDecorator', [
      { id: '' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('cleans up on api.dispose()', async () => {
    const { pair, bridge, api: uiApi } = makeUi(['ui:verse-decorator']);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseDecorator', [
      { id: 'a', decorateEndpoint: 'ep' },
    ]);
    expect(bridge.decorators).toHaveLength(1);
    uiApi.dispose();
    expect(bridge.decorators).toHaveLength(0);
  });
});

// --- updateVerseDecorations ----------------------------------------------

describe('ui.updateVerseDecorations', () => {
  it('forwards group updates to the bridge', async () => {
    const { pair, bridge } = makeUi(['ui:verse-decorator']);
    const decos = [{ range: { verseId: 43003016 }, style: { background: { hex: '#ff0' } } }];
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateVerseDecorations', [
      'group1',
      decos,
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.decorationUpdates).toHaveLength(1);
    expect(bridge.decorationUpdates[0].groupId).toBe('group1');
  });

  it('rejects empty groupId', async () => {
    const { pair } = makeUi(['ui:verse-decorator']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateVerseDecorations', [
      '',
      [],
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects without ui:verse-decorator', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateVerseDecorations', [
      'g',
      [],
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

// --- registerVerseHover --------------------------------------------------

describe('ui.registerVerseHover', () => {
  it('registers and disposes a hover provider', async () => {
    const { pair, bridge } = makeUi(['ui:verse-hover']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseHover', [
      { id: 'lexicon', hoverEndpoint: 'onHover' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.hoverProviders).toHaveLength(1);

    const disposalId = (res.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    expect(bridge.hoverProviders).toHaveLength(0);
  });

  it('rejects without ui:verse-hover', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseHover', [
      { id: 'x', hoverEndpoint: 'ep' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('rejects invalid descriptor', async () => {
    const { pair } = makeUi(['ui:verse-hover']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseHover', [
      { id: 'x' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});

// --- registerContextMenu -------------------------------------------------

describe('ui.registerContextMenu', () => {
  it('registers a context menu item and disposes it', async () => {
    const { pair, bridge } = makeUi(['ui:context-menu']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
      'verse',
      { id: 'lookup', label: 'Look up word', command: 'ext.test.lookupWord' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.contextMenuItems).toHaveLength(1);
    expect(bridge.contextMenuItems[0].target).toBe('verse');
    expect(bridge.contextMenuItems[0].item.command).toBe('ext.test.lookupWord');

    const disposalId = (res.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    expect(bridge.contextMenuItems).toHaveLength(0);
  });

  it('rejects invalid target', async () => {
    const { pair } = makeUi(['ui:context-menu']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
      'invalid_target',
      { id: 'x', label: 'X', command: 'cmd' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects invalid item descriptor', async () => {
    const { pair } = makeUi(['ui:context-menu']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
      'verse',
      { id: 'x', label: 'X' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects without ui:context-menu', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
      'verse',
      { id: 'x', label: 'X', command: 'cmd' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('accepts all valid context menu targets', async () => {
    const targets = [
      'verse', 'verse.word', 'commentary.entry', 'dictionary.entry',
      'book.section', 'note', 'highlight', 'reference', 'search.result', 'panel.tab',
    ];
    for (const target of targets) {
      const { pair } = makeUi(['ui:context-menu']);
      const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
        target,
        { id: `item-${target}`, label: 'Label', command: 'ext.test.cmd' },
      ]);
      expect(res.error).toBeUndefined();
    }
  });
});

// --- registerStatusBarItem -----------------------------------------------

describe('ui.registerStatusBarItem', () => {
  it('registers and disposes a status bar item', async () => {
    const { pair, bridge } = makeUi(['ui:status-bar']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '42 indexed' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.statusBarItems).toHaveLength(1);

    const disposalId = (res.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    expect(bridge.statusBarItems).toHaveLength(0);
  });

  it('rejects without ui:status-bar', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'x', text: 'X' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('rejects invalid descriptor', async () => {
    const { pair } = makeUi(['ui:status-bar']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: '' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('re-registering the same id replaces the entry instead of stacking a duplicate', async () => {
    const { pair, bridge } = makeUi(['ui:status-bar']);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '1 indexed' },
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '2 indexed' },
    ]);
    // One live entry, carrying the latest data - not two.
    expect(bridge.statusBarItems).toHaveLength(1);
    expect(bridge.statusBarItems[0].item.text).toBe('2 indexed');
  });

  it('a disposalId from a superseded registration becomes a no-op, not a delete of the current one', async () => {
    const { pair, bridge } = makeUi(['ui:status-bar']);
    const first = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '1 indexed' },
    ]);
    const firstDisposalId = (first.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '2 indexed' },
    ]);

    // The bridge's own disposer for `firstDisposalId` would, if invoked,
    // delete whatever currently occupies the `indexCount` key (see
    // InMemoryUiBridge.registerStatusBarItem) - i.e. the *second*
    // registration. UiApiImpl must not let that happen.
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [firstDisposalId]);
    expect(bridge.statusBarItems).toHaveLength(1);
    expect(bridge.statusBarItems[0].item.text).toBe('2 indexed');
  });
});

// --- updateStatusBarItem ---------------------------------------------------

describe('ui.updateStatusBarItem', () => {
  it('patches only the given fields, keeping the rest', async () => {
    const { pair, bridge } = makeUi(['ui:status-bar']);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '1 indexed', tooltip: 'Index status', alignment: 'left', priority: 5 },
    ]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateStatusBarItem', [
      'indexCount',
      { text: '2 indexed' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.statusBarItems).toHaveLength(1);
    const updated = bridge.statusBarItems[0].item;
    expect(updated.text).toBe('2 indexed');
    expect(updated.tooltip).toBe('Index status');
    expect(updated.alignment).toBe('left');
    expect(updated.priority).toBe(5);
  });

  it('does not mint a new disposer per update', async () => {
    const { pair, bridge } = makeUi(['ui:status-bar']);
    const first = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '1 indexed' },
    ]);
    const firstDisposalId = (first.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.updateStatusBarItem', [
      'indexCount',
      { text: '2 indexed' },
    ]);
    // The pre-update handle is superseded, exactly like re-registration -
    // disposing it must not remove the item that the update produced.
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [firstDisposalId]);
    expect(bridge.statusBarItems).toHaveLength(1);
  });

  it('rejects updating an id this extension never registered', async () => {
    const { pair } = makeUi(['ui:status-bar']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateStatusBarItem', [
      'neverRegistered',
      { text: 'x' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects updating an id that was already disposed', async () => {
    const { pair } = makeUi(['ui:status-bar']);
    const reg = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 'indexCount', text: '1 indexed' },
    ]);
    const disposalId = (reg.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateStatusBarItem', [
      'indexCount',
      { text: '2 indexed' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects without ui:status-bar', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.updateStatusBarItem', [
      'x',
      { text: 'y' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

// --- pickFile ------------------------------------------------------------

describe('ui.pickFile', () => {
  it('delegates to the bridge with fs:read-user', async () => {
    const { pair, bridge } = makeUi(['fs:read-user']);
    bridge.pickFileResponse = {
      name: 'test.txt',
      size: 5,
      contents: 'hello',
      handle: 'h1',
    };
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.pickFile', []);
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ name: 'test.txt', size: 5 });
    expect(bridge.filePickRequests).toHaveLength(1);
  });

  it('returns undefined when user cancels', async () => {
    const { pair, bridge } = makeUi(['fs:read-user']);
    bridge.pickFileResponse = undefined;
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.pickFile', []);
    expect(res.error).toBeUndefined();
    expect(res.result).toBeUndefined();
  });

  it('passes opts through', async () => {
    const { pair, bridge } = makeUi(['fs:read-user']);
    const opts = { title: 'Pick', filters: [{ name: 'Text', extensions: ['txt'] }] };
    await workerCall(pair.workerSide, pair.hostSent, 'ui.pickFile', [opts]);
    expect(bridge.filePickRequests[0].opts).toMatchObject(opts);
  });

  it('rejects without fs:read-user', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.pickFile', []);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

// --- saveFile ------------------------------------------------------------

describe('ui.saveFile', () => {
  it('delegates to the bridge with fs:write-user', async () => {
    const { pair, bridge } = makeUi(['fs:write-user']);
    bridge.saveFileResponse = true;
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.saveFile', ['content']);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(true);
    expect(bridge.fileSaveRequests).toHaveLength(1);
    expect(bridge.fileSaveRequests[0].content).toBe('content');
  });

  it('rejects without fs:write-user', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.saveFile', ['x']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

// --- openSettings (task 0024 round 3, P1.7) -------------------------------

describe('ui.openSettings', () => {
  it('forwards to the bridge with no section, ungated (no permission required)', async () => {
    const { pair, bridge } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.openSettings', []);
    expect(res.error).toBeUndefined();
    expect(bridge.openSettingsRequests).toEqual([{ extensionId: 'ext.test.ui' }]);
  });

  it('forwards the section argument through', async () => {
    const { pair, bridge } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.openSettings', [
      'advanced.endpoint',
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.openSettingsRequests).toEqual([
      { extensionId: 'ext.test.ui', section: 'advanced.endpoint' },
    ]);
  });

  it('rejects a non-string section', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.openSettings', [42]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});

// --- dispose cleanup -----------------------------------------------------

describe('UiApiImpl.dispose() cleanup', () => {
  it('cleans up all T2 contributions on dispose', async () => {
    const { pair, bridge, api } = makeUi([
      'ui:verse-decorator',
      'ui:verse-hover',
      'ui:context-menu',
      'ui:status-bar',
    ]);

    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseDecorator', [
      { id: 'd1', decorateEndpoint: 'ep' },
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerVerseHover', [
      { id: 'h1', hoverEndpoint: 'ep' },
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerContextMenu', [
      'verse',
      { id: 'c1', label: 'L', command: 'cmd' },
    ]);
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerStatusBarItem', [
      { id: 's1', text: 'T' },
    ]);

    expect(bridge.decorators).toHaveLength(1);
    expect(bridge.hoverProviders).toHaveLength(1);
    expect(bridge.contextMenuItems).toHaveLength(1);
    expect(bridge.statusBarItems).toHaveLength(1);

    api.dispose();

    expect(bridge.decorators).toHaveLength(0);
    expect(bridge.hoverProviders).toHaveLength(0);
    expect(bridge.contextMenuItems).toHaveLength(0);
    expect(bridge.statusBarItems).toHaveLength(0);
  });
});
