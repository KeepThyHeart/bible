/**
 * Api-impl unit tests.
 *
 * Drives each api-impl through the RPC router using a paired in-memory
 * transport, asserting:
 *
 *   - the right method handler is invoked when a worker-side `RpcRequest`
 *     arrives;
 *   - permission gates throw `PermissionDeniedError` over the wire when the
 *     grant is missing the required permission;
 *   - the storage api enforces its quota and reserved key prefixes;
 *   - the bridge `subscribe*` channels emit `RpcEvent` envelopes only when
 *     the worker has actually subscribed.
 *
 * The aim is confidence that the contract is glued end-to-end, without
 * standing up a real worker process or Electron window. The full e2e test
 * that drives a fixture extension's `activate()` lives elsewhere - it
 * requires the renderer-side bridge wiring and a packaged extension-runtime
 * bundle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  BibleApiImpl,
  BookApiImpl,
  CommentaryApiImpl,
  DictionaryApiImpl,
  InMemoryBibleBridge,
  InMemoryBookBridge,
  InMemoryCommentaryBridge,
  InMemoryDictionaryBridge,
  InMemoryL10nBridge,
  InMemoryUiBridge,
  InMemoryWorkspaceBridge,
  L10nApiImpl,
  StorageApiImpl,
  UiApiImpl,
  WorkspaceApiImpl,
} from '../api-impl';
import { FakeSql } from './fakeSql';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type RpcEvent = Extensions.RpcEvent;
type RpcSubscribe = Extensions.RpcSubscribe;

// --- Paired transports - same shape as in ExtensionRpcRouter.test.ts -------

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

/** Send a worker-side request and resolve with the matching response. */
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
  // Yield until the host posts a response with our id. Up to 50 ticks.
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

// --- BibleApiImpl ---------------------------------------------------------

describe('BibleApiImpl', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let bridge: InMemoryBibleBridge;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    bridge = new InMemoryBibleBridge();
    bridge.verses.set(43003016, {
      verseId: 43003016,
      text: 'For God so loved the world',
    });
    bridge.verses.set(43003017, { verseId: 43003017, text: 'For God sent not his Son' });
    bridge.modules.push({ id: 'kjv', abbreviation: 'kjv', name: 'King James' });
    bridge.books.push({
      bookNumber: 43,
      shortName: 'Jhn',
      name: 'John',
      testament: 'new',
      chapterCount: 21,
    });
    bridge.parser = (input) =>
      input === 'John 3:16'
        ? {
            input,
            bookNumber: 43,
            chapter: 3,
            startVerse: 16,
            startVerseId: 43003016,
          }
        : null;
    const api = new BibleApiImpl({
      extensionId: 'ext.test.bible',
      router,
      bridge,
      grant: buildGrant('ext.test.bible', ['bible:read']),
    });
    api.attach();
  });

  it('returns a verse for getVerse', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerse', [43003016]);
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ verseId: 43003016, text: 'For God so loved the world' });
  });

  it('rejects malformed verseId with RpcProtocolError', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerse', ['oops']);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('returns a range and enforces the 500-verse cap', async () => {
    const ok = await workerCall(pair.workerSide, pair.hostSent, 'bible.getRange', [
      43003016,
      43003017,
    ]);
    expect(Array.isArray(ok.result)).toBe(true);
    expect((ok.result as unknown[]).length).toBe(2);

    const tooBig = await workerCall(pair.workerSide, pair.hostSent, 'bible.getRange', [
      1,
      1000,
    ]);
    expect(tooBig.error?.code).toBe('RpcProtocolError');
    expect(tooBig.error?.message).toContain('500');
  });

  it('lists modules and books', async () => {
    const m = await workerCall(pair.workerSide, pair.hostSent, 'bible.listModules', []);
    expect((m.result as unknown[])[0]).toMatchObject({ id: 'kjv' });
    const b = await workerCall(pair.workerSide, pair.hostSent, 'bible.listBooks', []);
    expect((b.result as unknown[])[0]).toMatchObject({ bookNumber: 43 });
  });

  it('parses references', async () => {
    const r = await workerCall(pair.workerSide, pair.hostSent, 'bible.parseReference', [
      'John 3:16',
    ]);
    expect(r.result).toMatchObject({ bookNumber: 43, startVerseId: 43003016 });
  });

  it('rejects calls without bible:read', async () => {
    // Re-attach with an empty grant.
    const router2 = new ExtensionRpcRouter(pair.hostSide);
    const api = new BibleApiImpl({
      extensionId: 'ext.test.bible',
      router: router2,
      bridge,
      grant: buildGrant('ext.test.bible', []),
    });
    api.attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.getVerse', [43003016]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('emits onDidChangeActiveVerse only when the worker subscribed', async () => {
    // No subscription yet - fire should be a no-op.
    bridge.fireActiveVerse({ verseId: 43003016, module: 'kjv' });
    expect(pair.hostSent.filter((e) => isEventOn(e, 'bible.onDidChangeActiveVerse'))).toHaveLength(
      0,
    );

    // Subscribe and fire - should emit.
    const sub: RpcSubscribe = {
      kind: 'subscribe',
      id: 'sub-1',
      channel: 'bible.onDidChangeActiveVerse',
    };
    pair.workerSide.send(sub);
    await new Promise((r) => setImmediate(r));
    bridge.fireActiveVerse({ verseId: 43003017, module: 'kjv' });
    const events = pair.hostSent.filter((e) =>
      isEventOn(e, 'bible.onDidChangeActiveVerse'),
    );
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ verseId: 43003017, module: 'kjv' });
  });
});

function isEventOn(env: unknown, channel: string): boolean {
  return (
    typeof env === 'object' &&
    env !== null &&
    (env as RpcEvent).kind === 'event' &&
    (env as RpcEvent).channel === channel
  );
}

// --- Commentary / Dictionary / Book api-impls -----------------------------

describe('CommentaryApiImpl', () => {
  it('routes getEntry through the bridge', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryCommentaryBridge();
    bridge.modules.push({ id: 'mhc', abbreviation: 'mhc', name: 'Henry' });
    const inner = new Map();
    inner.set(43003016, {
      id: 'mhc-1',
      moduleId: 'mhc',
      startVerseId: 43003016,
      endVerseId: 43003016,
      content: 'Comment.',
    });
    bridge.entries.set('mhc', inner);
    new CommentaryApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['commentary:read']),
    }).attach();

    const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.getEntry', [
      'mhc',
      43003016,
    ]);
    expect(res.result).toMatchObject({ id: 'mhc-1', content: 'Comment.' });
  });

  it('rejects without commentary:read', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    new CommentaryApiImpl({
      extensionId: 'ext.test',
      router,
      bridge: new InMemoryCommentaryBridge(),
      grant: buildGrant('ext.test', []),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.listModules', []);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });
});

describe('DictionaryApiImpl', () => {
  it('lookup + search behave', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryDictionaryBridge();
    const inner = new Map();
    inner.set('agape', {
      key: 'agape',
      moduleId: 'thayers',
      headword: 'agape',
      content: 'love',
    });
    bridge.entries.set('thayers', inner);
    new DictionaryApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['dictionary:read']),
    }).attach();

    const lookup = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.lookup', [
      'thayers',
      'agape',
    ]);
    expect(lookup.result).toMatchObject({ headword: 'agape' });

    const search = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.search', [
      'thayers',
      'love',
    ]);
    expect((search.result as unknown[]).length).toBe(1);
  });
});

describe('BookApiImpl', () => {
  it('lists sections and resolves single ones', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryBookBridge();
    const inner = new Map();
    inner.set('s1', {
      id: 's1',
      moduleId: 'westminster',
      title: 'Chapter 1',
      depth: 0,
      hasChildren: false,
      order: 1,
      content: 'Body',
    });
    bridge.sections.set('westminster', inner);
    new BookApiImpl({
      extensionId: 'ext.test',
      router,
      bridge,
      grant: buildGrant('ext.test', ['book:read']),
    }).attach();
    const list = await workerCall(pair.workerSide, pair.hostSent, 'book.listSections', [
      'westminster',
    ]);
    expect((list.result as unknown[]).length).toBe(1);
    const one = await workerCall(pair.workerSide, pair.hostSent, 'book.getSection', [
      'westminster',
      's1',
    ]);
    expect(one.result).toMatchObject({ id: 's1', content: 'Body' });
  });
});

// --- StorageApiImpl --------------------------------------------------------

describe('StorageApiImpl', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let db: FakeSql;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    db = new FakeSql();
    new StorageApiImpl({
      extensionId: 'ext.test.storage',
      router,
      db,
      grant: buildGrant('ext.test.storage', []),
      quotaBytes: 256, // tiny budget for the quota test
    }).attach();
  });

  it('round-trips set / get / delete', async () => {
    const set = await workerCall(pair.workerSide, pair.hostSent, 'storage.set', [
      'greeting',
      { msg: 'hi' },
    ]);
    expect(set.error).toBeUndefined();
    const get = await workerCall(pair.workerSide, pair.hostSent, 'storage.get', ['greeting']);
    expect(get.result).toEqual({ msg: 'hi' });
    const del = await workerCall(pair.workerSide, pair.hostSent, 'storage.delete', ['greeting']);
    expect(del.error).toBeUndefined();
    const after = await workerCall(pair.workerSide, pair.hostSent, 'storage.get', ['greeting']);
    expect(after.result).toBeUndefined();
  });

  it('returns the list of own keys via storage.keys', async () => {
    await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['a', 1]);
    await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['b', 2]);
    const keys = await workerCall(pair.workerSide, pair.hostSent, 'storage.keys', []);
    expect((keys.result as string[]).sort()).toEqual(['a', 'b']);
  });

  it('isolates one extension from another at the table level', async () => {
    // Write a row directly under ext.test.storage's namespace via the
    // existing impl, then spin up a fresh impl + transport pair for a
    // different extension and verify it cannot read or list that row.
    await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['secret', 'A']);

    const pair2 = pairedTransports();
    const router2 = new ExtensionRpcRouter(pair2.hostSide);
    new StorageApiImpl({
      extensionId: 'ext.other',
      router: router2,
      db,
      grant: buildGrant('ext.other', []),
    }).attach();

    const get = await workerCall(pair2.workerSide, pair2.hostSent, 'storage.get', ['secret']);
    expect(get.result).toBeUndefined();

    const keys = await workerCall(pair2.workerSide, pair2.hostSent, 'storage.keys', []);
    expect(keys.result).toEqual([]);
  });

  it('rejects reserved __settings.* keys', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.set', [
      '__settings.theme',
      'dark',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('reserved');
  });

  it('throws QuotaExceededError when the budget overflows', async () => {
    const big = 'x'.repeat(500); // 500 bytes - well over our 256-byte budget
    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.set', ['big', big]);
    expect(res.error?.code).toBe('QuotaExceededError');
  });
});

// --- UiApiImpl -------------------------------------------------------------

describe('UiApiImpl', () => {
  it('shows a notification when ui:notification is granted', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge,
      grant: buildGrant('ext.test.ui', ['ui:notification']),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.showNotification', [
      'Hello',
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.notifications).toHaveLength(1);
    expect(bridge.notifications[0]?.message).toBe('Hello');
  });

  it('rejects showNotification without ui:notification', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge: new InMemoryUiBridge(),
      grant: buildGrant('ext.test.ui', []),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.showNotification', ['Hi']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('registers a panel type with ui:contribute-pane and disposes it', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    const api = new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge,
      grant: buildGrant('ext.test.ui', ['ui:contribute-pane']),
    });
    api.attach();
    const reg = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerPanelType', [
      { id: 'mypanel', title: 'My Panel', uiEntry: 'index.html' },
    ]);
    expect(reg.error).toBeUndefined();
    expect(bridge.getPanelType('ext.test.ui', 'mypanel')).toBeDefined();

    api.dispose();
    expect(bridge.getPanelType('ext.test.ui', 'mypanel')).toBeUndefined();
  });

  it('rejects panel-type registration without ui:contribute-pane', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge: new InMemoryUiBridge(),
      grant: buildGrant('ext.test.ui', []),
    }).attach();
    const reg = await workerCall(pair.workerSide, pair.hostSent, 'ui.registerPanelType', [
      { id: 'mypanel', title: 'X', uiEntry: 'i.html' },
    ]);
    expect(reg.error?.code).toBe('PermissionDeniedError');
  });
});

// --- WorkspaceApiImpl ------------------------------------------------------

describe('WorkspaceApiImpl', () => {
  it('opens / lists / closes panels', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const open = await workerCall(pair.workerSide, pair.hostSent, 'workspace.openPanel', [
      'ext:ext.test.viewer',
    ]);
    expect(typeof open.result).toBe('string');
    const list = await workerCall(pair.workerSide, pair.hostSent, 'workspace.getOpenPanels', []);
    expect((list.result as unknown[]).length).toBe(1);
    await workerCall(pair.workerSide, pair.hostSent, 'workspace.closePanel', [open.result]);
    const after = await workerCall(pair.workerSide, pair.hostSent, 'workspace.getOpenPanels', []);
    expect((after.result as unknown[]).length).toBe(0);
  });

  it('forwards onDidOpenPanel only when the worker subscribed', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();

    bridge.openPanel('bible'); // no subscription yet
    expect(pair.hostSent.filter((e) => isEventOn(e, 'workspace.onDidOpenPanel'))).toHaveLength(0);

    pair.workerSide.send({ kind: 'subscribe', id: 's1', channel: 'workspace.onDidOpenPanel' });
    await new Promise((r) => setImmediate(r));
    bridge.openPanel('commentary');
    const events = pair.hostSent.filter((e) => isEventOn(e, 'workspace.onDidOpenPanel'));
    expect(events).toHaveLength(1);
  });
});

// --- L10nApiImpl -----------------------------------------------------------

describe('L10nApiImpl', () => {
  it('resolves catalog keys under the extension namespace', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryL10nBridge();
    bridge.catalog.set('ext.test.greeting', 'Hello, {name}');
    new L10nApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'l10n.t', [
      'greeting',
      { name: 'World' },
    ]);
    expect(res.result).toBe('Hello, World');
  });

  it('emits l10n.onDidChangeLocale only when subscribed', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryL10nBridge();
    new L10nApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    bridge.setLocale('fr');
    expect(pair.hostSent.filter((e) => isEventOn(e, 'l10n.onDidChangeLocale'))).toHaveLength(0);
    pair.workerSide.send({ kind: 'subscribe', id: 's1', channel: 'l10n.onDidChangeLocale' });
    await new Promise((r) => setImmediate(r));
    bridge.setLocale('es');
    const events = pair.hostSent.filter((e) => isEventOn(e, 'l10n.onDidChangeLocale'));
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toBe('es');
  });
});
