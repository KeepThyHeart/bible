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
 *   - registerDisplayMode
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
});

// --- registerDisplayMode -------------------------------------------------

describe('ui.registerDisplayMode', () => {
  it('registers and disposes a display mode', async () => {
    const { pair, bridge } = makeUi(['display-mode:provide']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'interlinear', label: 'Interlinear', kind: 'overlay', renderEndpoint: 'onRender' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.displayModes).toHaveLength(1);
    expect(bridge.displayModes[0].descriptor.kind).toBe('overlay');

    const disposalId = (res.result as { disposalId: string }).disposalId;
    await workerCall(pair.workerSide, pair.hostSent, 'ui.dispose', [disposalId]);
    expect(bridge.displayModes).toHaveLength(0);
  });

  it('accepts replace kind', async () => {
    const { pair, bridge } = makeUi(['display-mode:provide']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'custom', label: 'Custom', kind: 'replace', renderEndpoint: 'ep' },
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.displayModes[0].descriptor.kind).toBe('replace');
  });

  it('rejects without display-mode:provide', async () => {
    const { pair } = makeUi([]);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'x', label: 'X', kind: 'overlay', renderEndpoint: 'ep' },
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('rejects invalid kind', async () => {
    const { pair } = makeUi(['display-mode:provide']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'x', label: 'X', kind: 'invalid', renderEndpoint: 'ep' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('rejects missing renderEndpoint', async () => {
    const { pair } = makeUi(['display-mode:provide']);
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'x', label: 'X', kind: 'overlay' },
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
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

// --- dispose cleanup -----------------------------------------------------

describe('UiApiImpl.dispose() cleanup', () => {
  it('cleans up all T2 contributions on dispose', async () => {
    const { pair, bridge, api } = makeUi([
      'ui:verse-decorator',
      'ui:verse-hover',
      'ui:context-menu',
      'ui:status-bar',
      'display-mode:provide',
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
    await workerCall(pair.workerSide, pair.hostSent, 'ui.registerDisplayMode', [
      { id: 'm1', label: 'M', kind: 'overlay', renderEndpoint: 'ep' },
    ]);

    expect(bridge.decorators).toHaveLength(1);
    expect(bridge.hoverProviders).toHaveLength(1);
    expect(bridge.contextMenuItems).toHaveLength(1);
    expect(bridge.statusBarItems).toHaveLength(1);
    expect(bridge.displayModes).toHaveLength(1);

    api.dispose();

    expect(bridge.decorators).toHaveLength(0);
    expect(bridge.hoverProviders).toHaveLength(0);
    expect(bridge.contextMenuItems).toHaveLength(0);
    expect(bridge.statusBarItems).toHaveLength(0);
    expect(bridge.displayModes).toHaveLength(0);
  });
});
