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
 *   - the storage api enforces its quota and reserved key prefixes.
 *
 * The bridge-sourced forward events (active verse, panel open/close/focus,
 * locale change, ...) used to be tested here too, but task 0024 round 3
 * (P0.3) moved that subscription out of the api-impls entirely and into
 * `ExtensionPointWiring.ts` - see `ExtensionPointWiring.test.ts`.
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
    // Real KJV extents for the first three chapters of John.
    bridge.chapters.set(43, [
      { bookNumber: 43, chapter: 1, verseCount: 51, firstVerseId: 43001001, lastVerseId: 43001051 },
      { bookNumber: 43, chapter: 2, verseCount: 25, firstVerseId: 43002001, lastVerseId: 43002025 },
      { bookNumber: 43, chapter: 3, verseCount: 36, firstVerseId: 43003001, lastVerseId: 43003036 },
    ]);
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

  it('resolves a chapter to its inclusive verse-id bounds over RPC', async () => {
    const c = await workerCall(pair.workerSide, pair.hostSent, 'bible.listChapters', [43]);
    expect(c.error).toBeUndefined();
    const chapters = c.result as { chapter: number; lastVerseId: number }[];
    // The whole point of the method: `addPassage(43003001, 43003036)` is John 3
    // without first paging the chapter to find out where it stops.
    expect(chapters.find((x) => x.chapter === 3)).toMatchObject({
      verseCount: 36,
      firstVerseId: 43003001,
      lastVerseId: 43003036,
    });
  });

  it('rejects a book number outside the 66-book canon', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.listChapters', [67]);
    expect(res.error?.code).toBe('RpcProtocolError');
    const notANumber = await workerCall(pair.workerSide, pair.hostSent, 'bible.listChapters', [
      'John',
    ]);
    expect(notANumber.error?.code).toBe('RpcProtocolError');
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

  it('navigateToVerse forwards to the bridge, which activates the Bible pane', async () => {
    // The renderer side of this call - `navigateToVerseInPrimary` - resolves
    // or creates the primary Bible pane AND calls the target dockview
    // panel's `api.setActive()` to bring its tab to front (see
    // `sharedSlice.navigateToVerseInPrimary.test.ts`, which covers that part
    // of the path in full). This test covers the extension-facing half: that
    // `api.bible.navigateToVerse(verseId)` actually reaches the bridge with
    // the right verseId and the right permission gate - the task 0032 "Show
    // in Bible" acceptance case (0024's task folded it in).
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.navigateToVerse', [
      43003016,
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.lastNavigatedVerse).toBe(43003016);
  });

  it('navigateToVerse rejects a non-numeric verseId', async () => {
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.navigateToVerse', [
      'not-a-number',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('navigateToVerse rejects without bible:read', async () => {
    const router2 = new ExtensionRpcRouter(pair.hostSide);
    const api = new BibleApiImpl({
      extensionId: 'ext.test.bible',
      router: router2,
      bridge,
      grant: buildGrant('ext.test.bible', []),
    });
    api.attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'bible.navigateToVerse', [
      43003016,
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  // The active-verse forward event (`verse.activeChanged`) used to be tested
  // here, constructing a bare `BibleApiImpl` and firing the bridge directly.
  // Task 0024 round 3 (P0.3) moved that subscription out of `BibleApiImpl`
  // entirely and into `ExtensionPointWiring.ts`, which needs a full
  // `ExtensionHostContext` (not just a bridge + router) to fan out to every
  // active worker - see `ExtensionPointWiring.test.ts` for the equivalent
  // coverage against the new module.
});

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
      grant: buildGrant('ext.test.storage', ['storage']),
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
      grant: buildGrant('ext.other', ['storage']),
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

  it('resolves showNotification with whatever the bridge resolves (the clicked action id)', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    bridge.notificationActionResponse = 'retry';
    new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge,
      grant: buildGrant('ext.test.ui', ['ui:notification']),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.showNotification', [
      'Failed',
      { actions: [{ id: 'retry', label: 'Retry' }] },
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe('retry');
  });

  it('resolves showNotification with undefined when dismissed with no action clicked', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryUiBridge();
    new UiApiImpl({
      extensionId: 'ext.test.ui',
      router,
      bridge,
      grant: buildGrant('ext.test.ui', ['ui:notification']),
    }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'ui.showNotification', ['Hi']);
    expect(res.error).toBeUndefined();
    expect(res.result).toBeUndefined();
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

  // The panel.opened/closed/focused forward events used to be tested here,
  // constructing a bare `WorkspaceApiImpl` and firing the bridge directly.
  // Task 0024 round 3 (P0.3) moved that subscription out of
  // `WorkspaceApiImpl` entirely and into `ExtensionPointWiring.ts` - see
  // `ExtensionPointWiring.test.ts`.

  it('revealPanel focuses an already-open panel and resolves true, with no ownership check', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('bible'); // a built-in panel this extension does not own

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.revealPanel', [panelId]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(true);
    expect(bridge.revealedPanelIds).toEqual([panelId]);
  });

  it('revealPanel resolves false for a panel that is not open', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.revealPanel', [
      'nope',
    ]);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(false);
  });

  it('setPanelTitle succeeds on the extension\'s own panel', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('ext:ext.test.viewer');

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelTitle', [
      panelId,
      '5 due',
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.lastSetTitle).toEqual({ panelId, title: '5 due' });
  });

  it('setPanelTitle rejects a panel the extension does not own', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('bible'); // built-in

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelTitle', [
      panelId,
      'Not the Bible anymore',
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
    expect(bridge.lastSetTitle).toBeUndefined();
  });

  it('setPanelTitle rejects another extension\'s panel', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('ext:ext.other.viewer');

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelTitle', [
      panelId,
      'Hijacked',
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('setPanelTitle rejects a panelId that is not open', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelTitle', [
      'nope',
      'X',
    ]);
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('setPanelBadge succeeds on the extension\'s own panel and can be cleared', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('ext:ext.test.viewer');

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelBadge', [
      panelId,
      5,
    ]);
    expect(res.error).toBeUndefined();
    expect(bridge.lastSetBadge).toEqual({ panelId, badge: 5 });

    await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelBadge', [
      panelId,
      null,
    ]);
    expect(bridge.lastSetBadge).toEqual({ panelId, badge: undefined });
  });

  it('setPanelBadge rejects a panel the extension does not own', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const bridge = new InMemoryWorkspaceBridge();
    new WorkspaceApiImpl({ extensionId: 'ext.test', router, bridge }).attach();
    const panelId = bridge.openPanel('commentary');

    const res = await workerCall(pair.workerSide, pair.hostSent, 'workspace.setPanelBadge', [
      panelId,
      1,
    ]);
    expect(res.error?.code).toBe('PermissionDeniedError');
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

  // The locale-change forward event used to be tested here, constructing a
  // bare `L10nApiImpl` and firing the bridge directly. Task 0024 round 3
  // (P0.3) moved that subscription out of `L10nApiImpl` entirely and into
  // `ExtensionPointWiring.ts` (which also wraps the bridge's bare locale
  // string as `{ locale }`) - see `ExtensionPointWiring.test.ts`.
});
