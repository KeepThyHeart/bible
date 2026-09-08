/**
 * Unit tests for inter-extension calls, provider registration,
 * ContributionRegistry, and SingleActiveProviderRegistry.
 *
 * Drives the new api-impls through the RPC router using paired in-memory
 * transports, asserting:
 *
 *   - `extensions.call` dispatches to the callee worker via the host delegate
 *   - `extensions.call` rejects undeclared apiExports with `ApiExportNotFoundError`
 *   - `extensions.call` rejects without `extensions:call` permission
 *   - `extensions.isActive` reports active status
 *   - `extensions.listProviders` lists extensions with apiExports
 *   - `commentary.registerProvider` registers in the ContributionRegistry
 *   - `dictionary.registerProvider` registers in the ContributionRegistry
 *   - `book.registerProvider` registers in the ContributionRegistry
 *   - Provider registrations are cleaned up on dispose
 *   - ContributionRegistry CRUD operations work
 *   - SingleActiveProviderRegistry role management works
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import {
  ExtensionsApiImpl,
  type IExtensionsHostDelegate,
} from '../api-impl/extensionsApiImpl';
import {
  CommentaryApiImpl,
  DictionaryApiImpl,
  BookApiImpl,
  InMemoryCommentaryBridge,
  InMemoryDictionaryBridge,
  InMemoryBookBridge,
} from '../api-impl';
import { ContributionRegistry } from '../ContributionRegistry';
import {
  SingleActiveProviderRegistry,
  InMemoryProviderPreferences,
  type ProviderRoleId,
} from '../SingleActiveProviderRegistry';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;
type ExtensionManifest = Extensions.ExtensionManifest;

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

// --- Fake manifests -------------------------------------------------------

function fakeManifest(id: string, overrides?: Partial<ExtensionManifest>): ExtensionManifest {
  return {
    id,
    name: id,
    publisher: 'test-publisher',
    version: '1.0.0',
    main: 'main.js',
    engines: { bibleApp: '^1.0.0' },
    ...overrides,
  };
}

// --- Fake host delegate --------------------------------------------------

function buildFakeDelegate(
  opts: {
    active?: Map<string, ExtensionRpcRouter>;
    manifests?: Map<string, ExtensionManifest>;
    onActivate?: (id: string) => Promise<void>;
  } = {},
): IExtensionsHostDelegate {
  const active = opts.active ?? new Map();
  const manifests = opts.manifests ?? new Map();
  return {
    isActive: (id) => active.has(id),
    activate: opts.onActivate ?? (async () => {}),
    getRouter: (id) => active.get(id),
    getManifest: (id) => manifests.get(id),
    listInstalled: () =>
      Array.from(manifests.entries()).map(([id, manifest]) => ({ id, manifest })),
  };
}

// --- ExtensionsApiImpl ---------------------------------------------------

describe('ExtensionsApiImpl', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
  });

  describe('extensions.isActive', () => {
    it('returns true for an active extension', async () => {
      const delegate = buildFakeDelegate({
        active: new Map([['ext.other', {} as ExtensionRpcRouter]]),
      });
      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.isActive', [
        'ext.other',
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(true);
    });

    it('returns false for an inactive extension', async () => {
      const delegate = buildFakeDelegate();
      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.isActive', [
        'ext.other',
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe(false);
    });
  });

  describe('extensions.call', () => {
    it('dispatches to the callee worker and returns the result', async () => {
      // Set up a second transport pair for the callee extension.
      const calleePair = pairedTransports();
      const calleeRouter = new ExtensionRpcRouter(calleePair.hostSide);

      // The callee's "worker side" handles reverse-RPC requests from the host.
      // When the host sends a request to `exports.getData`, the worker side
      // receives it and responds.
      calleePair.workerSide.onMessage((raw) => {
        const env = raw as RpcRequest;
        if (env.kind === 'request' && env.method === 'exports.getData') {
          calleePair.workerSide.send({
            kind: 'response',
            id: env.id,
            result: { value: 42 },
          });
        }
      });

      const calleeManifest = fakeManifest('ext.callee', {
        contributes: {
          apiExports: [
            {
              method: 'getData',
              handlerEndpoint: 'exports.getData',
            },
          ],
        },
      });

      const delegate = buildFakeDelegate({
        active: new Map([['ext.callee', calleeRouter]]),
        manifests: new Map([['ext.callee', calleeManifest]]),
      });

      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.call', [
        'ext.callee',
        'getData',
      ]);
      expect(res.error).toBeUndefined();
      expect(res.result).toEqual({ value: 42 });
    });

    it('rejects with ApiExportNotFoundError for undeclared methods', async () => {
      const calleeManifest = fakeManifest('ext.callee', {
        contributes: {
          apiExports: [
            { method: 'knownMethod', handlerEndpoint: 'exports.knownMethod' },
          ],
        },
      });

      const delegate = buildFakeDelegate({
        active: new Map([['ext.callee', {} as ExtensionRpcRouter]]),
        manifests: new Map([['ext.callee', calleeManifest]]),
      });

      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.call', [
        'ext.callee',
        'unknownMethod',
      ]);
      expect(res.error?.code).toBe('ApiExportNotFoundError');
    });

    it('rejects without extensions:call permission', async () => {
      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', []), // no permission
        host: buildFakeDelegate(),
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.call', [
        'ext.callee',
        'getData',
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects calling your own extension', async () => {
      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: buildFakeDelegate({
          manifests: new Map([
            ['ext.caller', fakeManifest('ext.caller', {
              contributes: { apiExports: [{ method: 'foo', handlerEndpoint: 'exports.foo' }] },
            })],
          ]),
        }),
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.call', [
        'ext.caller',
        'foo',
      ]);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('activates callee on demand if not active', async () => {
      const calleePair = pairedTransports();
      const calleeRouter = new ExtensionRpcRouter(calleePair.hostSide);

      // Wire the callee's worker side to respond to reverse-RPC.
      calleePair.workerSide.onMessage((raw) => {
        const env = raw as RpcRequest;
        if (env.kind === 'request' && env.method === 'exports.hello') {
          calleePair.workerSide.send({
            kind: 'response',
            id: env.id,
            result: 'world',
          });
        }
      });

      const active = new Map<string, ExtensionRpcRouter>();
      const calleeManifest = fakeManifest('ext.callee', {
        contributes: {
          apiExports: [{ method: 'hello', handlerEndpoint: 'exports.hello' }],
        },
      });

      let activateCalled = false;
      const delegate = buildFakeDelegate({
        active,
        manifests: new Map([['ext.callee', calleeManifest]]),
        onActivate: async (id) => {
          activateCalled = true;
          active.set(id, calleeRouter);
        },
      });

      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.call', [
        'ext.callee',
        'hello',
      ]);
      expect(activateCalled).toBe(true);
      expect(res.error).toBeUndefined();
      expect(res.result).toBe('world');
    });
  });

  describe('extensions.listProviders', () => {
    it('lists extensions with apiExports', async () => {
      const manifests = new Map<string, ExtensionManifest>([
        [
          'ext.a',
          fakeManifest('ext.a', {
            displayName: 'Extension A',
            contributes: {
              apiExports: [
                { method: 'getStuff', handlerEndpoint: 'exports.getStuff' },
              ],
            },
          }),
        ],
        [
          'ext.b',
          fakeManifest('ext.b', {
            displayName: 'Extension B',
            // No apiExports - should be excluded
          }),
        ],
      ]);

      const delegate = buildFakeDelegate({ manifests });
      const api = new ExtensionsApiImpl({
        extensionId: 'ext.caller',
        router,
        grant: buildGrant('ext.caller', ['extensions:call']),
        host: delegate,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'extensions.listProviders', []);
      expect(res.error).toBeUndefined();
      const providers = res.result as Extensions.ExtensionProviderInfo[];
      expect(providers).toHaveLength(1);
      expect(providers[0].extensionId).toBe('ext.a');
      expect(providers[0].exports).toHaveLength(1);
      expect(providers[0].exports[0].method).toBe('getStuff');
    });
  });
});

// --- Provider registration (commentary / dictionary / book) --------------

describe('Provider registration', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let registry: ContributionRegistry;

  const validCommentaryDescriptor = {
    id: 'my-commentary',
    name: 'My Commentary',
    abbreviation: 'MC',
    capabilities: ['lookup'],
    fetchEndpoint: 'providers.commentary.fetch',
  };

  const validDictionaryDescriptor = {
    id: 'my-dict',
    name: 'My Dictionary',
    abbreviation: 'MD',
    capabilities: ['lookup', 'search'],
    fetchEndpoint: 'providers.dictionary.fetch',
  };

  const validBookDescriptor = {
    id: 'my-book',
    name: 'My Book',
    abbreviation: 'MB',
    capabilities: ['lookup'],
    fetchEndpoint: 'providers.book.fetch',
  };

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    registry = new ContributionRegistry();
  });

  describe('commentary.registerProvider', () => {
    it('registers a provider in the ContributionRegistry', async () => {
      const api = new CommentaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryCommentaryBridge(),
        grant: buildGrant('ext.test', ['commentary:read', 'commentary:provide']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.registerProvider', [
        validCommentaryDescriptor,
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { providerId: string }).providerId).toBe('ext.ext.test.my-commentary');

      const providers = registry.listCommentaryProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].extensionId).toBe('ext.test');
      expect(providers[0].descriptor.abbreviation).toBe('MC');
    });

    it('rejects without commentary:provide permission', async () => {
      const api = new CommentaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryCommentaryBridge(),
        grant: buildGrant('ext.test', ['commentary:read']), // no :provide
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.registerProvider', [
        validCommentaryDescriptor,
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });

    it('rejects invalid descriptor', async () => {
      const api = new CommentaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryCommentaryBridge(),
        grant: buildGrant('ext.test', ['commentary:read', 'commentary:provide']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'commentary.registerProvider', [
        { id: '', name: 'Bad' },
      ]);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('cleans up registrations on dispose', async () => {
      const api = new CommentaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryCommentaryBridge(),
        grant: buildGrant('ext.test', ['commentary:read', 'commentary:provide']),
        contributionRegistry: registry,
      });
      api.attach();

      await workerCall(pair.workerSide, pair.hostSent, 'commentary.registerProvider', [
        validCommentaryDescriptor,
      ]);
      expect(registry.listCommentaryProviders()).toHaveLength(1);

      api.dispose();
      expect(registry.listCommentaryProviders()).toHaveLength(0);
    });
  });

  describe('dictionary.registerProvider', () => {
    it('registers a provider in the ContributionRegistry', async () => {
      const api = new DictionaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryDictionaryBridge(),
        grant: buildGrant('ext.test', ['dictionary:read', 'dictionary:provide']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.registerProvider', [
        validDictionaryDescriptor,
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { providerId: string }).providerId).toBe('ext.ext.test.my-dict');

      const providers = registry.listDictionaryProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].descriptor.abbreviation).toBe('MD');
    });

    it('rejects without dictionary:provide permission', async () => {
      const api = new DictionaryApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryDictionaryBridge(),
        grant: buildGrant('ext.test', ['dictionary:read']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'dictionary.registerProvider', [
        validDictionaryDescriptor,
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });
  });

  describe('book.registerProvider', () => {
    it('registers a provider in the ContributionRegistry', async () => {
      const api = new BookApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryBookBridge(),
        grant: buildGrant('ext.test', ['book:read', 'book:provide']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'book.registerProvider', [
        validBookDescriptor,
      ]);
      expect(res.error).toBeUndefined();
      expect((res.result as { providerId: string }).providerId).toBe('ext.ext.test.my-book');

      const providers = registry.listBookProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].descriptor.abbreviation).toBe('MB');
    });

    it('rejects without book:provide permission', async () => {
      const api = new BookApiImpl({
        extensionId: 'ext.test',
        router,
        bridge: new InMemoryBookBridge(),
        grant: buildGrant('ext.test', ['book:read']),
        contributionRegistry: registry,
      });
      api.attach();

      const res = await workerCall(pair.workerSide, pair.hostSent, 'book.registerProvider', [
        validBookDescriptor,
      ]);
      expect(res.error?.code).toBe('PermissionDeniedError');
    });
  });
});

// --- ContributionRegistry ------------------------------------------------

describe('ContributionRegistry', () => {
  it('registers and queries contributions by kind', () => {
    const reg = new ContributionRegistry();
    reg.register('ext.a', 'commentaryProvider', 'ext.a.comm1', { name: 'Comm 1' });
    reg.register('ext.a', 'dictionaryProvider', 'ext.a.dict1', { name: 'Dict 1' });
    reg.register('ext.b', 'commentaryProvider', 'ext.b.comm1', { name: 'Comm 2' });

    expect(reg.listByKind('commentaryProvider')).toHaveLength(2);
    expect(reg.listByKind('dictionaryProvider')).toHaveLength(1);
    expect(reg.listByKind('bookProvider')).toHaveLength(0);
  });

  it('queries by extension', () => {
    const reg = new ContributionRegistry();
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c', { name: 'C' });
    reg.register('ext.a', 'dictionaryProvider', 'ext.a.d', { name: 'D' });
    reg.register('ext.b', 'commentaryProvider', 'ext.b.c', { name: 'C2' });

    expect(reg.listByExtension('ext.a')).toHaveLength(2);
    expect(reg.listByExtension('ext.b')).toHaveLength(1);
  });

  it('removes all by extension', () => {
    const reg = new ContributionRegistry();
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c1', { name: 'C1' });
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c2', { name: 'C2' });
    reg.register('ext.b', 'commentaryProvider', 'ext.b.c1', { name: 'C3' });

    const removed = reg.removeAllByExtension('ext.a');
    expect(removed).toBe(2);
    expect(reg.size).toBe(1);
    expect(reg.listByKind('commentaryProvider')).toHaveLength(1);
  });

  it('disposer removes specific entry', () => {
    const reg = new ContributionRegistry();
    const dispose = reg.register('ext.a', 'commentaryProvider', 'ext.a.c1', { name: 'C1' });
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c2', { name: 'C2' });

    expect(reg.size).toBe(2);
    dispose();
    expect(reg.size).toBe(1);
    // Idempotent
    dispose();
    expect(reg.size).toBe(1);
  });

  it('has() checks existence', () => {
    const reg = new ContributionRegistry();
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c1', { name: 'C1' });
    expect(reg.has('ext.a', 'commentaryProvider', 'ext.a.c1')).toBe(true);
    expect(reg.has('ext.a', 'commentaryProvider', 'ext.a.c2')).toBe(false);
  });

  it('get() retrieves specific entry', () => {
    const reg = new ContributionRegistry();
    reg.register('ext.a', 'commentaryProvider', 'ext.a.c1', { name: 'C1' });
    const entry = reg.get('ext.a', 'commentaryProvider', 'ext.a.c1');
    expect(entry).toBeDefined();
    expect(entry!.descriptor).toEqual({ name: 'C1' });
  });
});

// --- SingleActiveProviderRegistry ----------------------------------------

describe('SingleActiveProviderRegistry', () => {
  let reg: SingleActiveProviderRegistry;
  let prefs: InMemoryProviderPreferences;

  beforeEach(() => {
    prefs = new InMemoryProviderPreferences();
    reg = new SingleActiveProviderRegistry(prefs);
  });

  it('register + listForRole', () => {
    reg.register({
      roleId: 'searchBackend',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'Search A',
    });
    reg.register({
      roleId: 'searchBackend',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'Search B',
    });

    const list = reg.listForRole('searchBackend');
    expect(list).toHaveLength(2);
  });

  it('getActive returns first registered by default', () => {
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'B',
    });

    const active = reg.getActive('scriptureTooltip');
    expect(active?.extensionId).toBe('ext.a');
  });

  it('getActive respects user preference', () => {
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'B',
    });

    reg.setActive('scriptureTooltip', 'ext.b/default');
    const active = reg.getActive('scriptureTooltip');
    expect(active?.extensionId).toBe('ext.b');
  });

  it('getActive falls back when preferred provider is removed', () => {
    reg.register({
      roleId: 'searchBackend',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });
    const disposeB = reg.register({
      roleId: 'searchBackend',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'B',
    });

    reg.setActive('searchBackend', 'ext.b/default');
    expect(reg.getActive('searchBackend')?.extensionId).toBe('ext.b');

    disposeB();
    expect(reg.getActive('searchBackend')?.extensionId).toBe('ext.a');
  });

  it('getActive returns null for empty role', () => {
    expect(reg.getActive('aiAssistant')).toBeNull();
  });

  it('removeAllByExtension cleans up all roles', () => {
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A1',
    });
    reg.register({
      roleId: 'searchBackend',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A2',
    });
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'B1',
    });

    const removed = reg.removeAllByExtension('ext.a');
    expect(removed).toBe(2);
    expect(reg.listForRole('scriptureTooltip')).toHaveLength(1);
    expect(reg.listForRole('searchBackend')).toHaveLength(0);
  });

  it('onDidChangeActive fires on registration changes', () => {
    const events: ProviderRoleId[] = [];
    reg.onDidChangeActive(({ roleId }) => events.push(roleId));

    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });

    expect(events).toContain('scriptureTooltip');
  });

  it('onDidChangeActive fires on setActive', () => {
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });

    const events: ProviderRoleId[] = [];
    reg.onDidChangeActive(({ roleId }) => events.push(roleId));
    reg.setActive('scriptureTooltip', 'ext.a/default');

    expect(events).toContain('scriptureTooltip');
  });

  it('disposer from onDidChangeActive stops notifications', () => {
    const events: ProviderRoleId[] = [];
    const dispose = reg.onDidChangeActive(({ roleId }) => events.push(roleId));

    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });
    expect(events).toHaveLength(1);

    dispose();
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.b',
      providerId: 'default',
      displayName: 'B',
    });
    expect(events).toHaveLength(1); // no new event
  });

  it('persists preferences via the persistence adapter', () => {
    reg.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });

    reg.setActive('scriptureTooltip', 'ext.a/default');
    expect(prefs.load()).toEqual({ scriptureTooltip: 'ext.a/default' });

    // A new registry instance reading the same persistence should see it.
    const reg2 = new SingleActiveProviderRegistry(prefs);
    reg2.register({
      roleId: 'scriptureTooltip',
      extensionId: 'ext.a',
      providerId: 'default',
      displayName: 'A',
    });
    expect(reg2.getActive('scriptureTooltip')?.extensionId).toBe('ext.a');
  });
});
