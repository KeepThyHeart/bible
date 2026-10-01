/**
 * The desktop host's binding to the extension API declarations.
 *
 *   1-2. `createDeclaredMethodGuard` against the real and a custom registry.
 *   3.   The guard installed on a real `ExtensionRpcRouter`.
 *   4.   Drift: what `attachApiImpls` registers vs what the declarations say.
 *   5.   Gate/impl agreement: the router-level guard refuses every
 *        permission-gated typed method for a grant without that permission.
 *   6.   Every declared consent string is in the shipped English catalog.
 *   7.   `desktopApiNamespaces()` mirrors the registry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Extensions } from '@bible/core';

import { createDeclaredMethodGuard, desktopApiNamespaces } from '../DeclaredApiGuard';
import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { attachApiImpls } from '../ExtensionHostRpc';
import { ContributionRegistry } from '../ContributionRegistry';
import type { ActiveWorker, ExtensionHostContext } from '../ExtensionHostTypes';
import {
  InMemoryBibleBridge,
  InMemoryBookBridge,
  InMemoryBookmarksBridge,
  InMemoryCollectionsBridge,
  InMemoryCommandBridge,
  InMemoryCommentaryBridge,
  InMemoryContextBridge,
  InMemoryDictionaryBridge,
  InMemoryFolderBridge,
  InMemoryHighlightsBridge,
  InMemoryL10nBridge,
  InMemoryNotesBridge,
  InMemoryTaskStatusBridge,
  InMemoryUiBridge,
  InMemoryWorkspaceBridge,
} from '../api-impl';
import { CommandRegistry } from '../../../src/ui/services/CommandRegistry';
import { WhenContextService } from '../../../src/ui/services/WhenContextService';
import { I18nService } from '../../../src/ui/services/I18nService';
import { FakeSql } from './fakeSql';

const { PermissionDeniedError, RpcProtocolError } = Extensions;
const REGISTRY = Extensions.EXTENSION_API_REGISTRY;

// --- helpers ---------------------------------------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  return {
    hostSent,
    hostSide: {
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
    },
    workerSide: {
      send(env) {
        hostHandler?.(env);
      },
      onMessage(h) {
        workerHandler = h;
      },
      close() {
        workerHandler = null;
      },
    },
  };
}

let nextId = 1;
async function workerCall(
  pair: ReturnType<typeof pairedTransports>,
  method: string,
  args: unknown[] = [],
): Promise<Extensions.RpcResponse> {
  const startLen = pair.hostSent.length;
  const id = `w-${nextId++}`;
  pair.workerSide.send({ kind: 'request', id, method, args } as Extensions.RpcRequest);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setImmediate(r));
    for (let j = startLen; j < pair.hostSent.length; j++) {
      const env = pair.hostSent[j] as Extensions.RpcResponse;
      if (env && env.kind === 'response' && env.id === id) return env;
    }
  }
  throw new Error(`no response for ${method}`);
}

function catchOf(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

// --- 1. the guard against the real registry --------------------------------

describe('createDeclaredMethodGuard', () => {
  it('refuses notes.list without notes:read and passes with it', () => {
    const denied = createDeclaredMethodGuard(buildGrant('ext.a', []));
    const err = catchOf(() => denied('notes.list'));
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as Extensions.PermissionDeniedError).code).toBe('PermissionDeniedError');

    const allowed = createDeclaredMethodGuard(buildGrant('ext.a', ['notes:read']));
    expect(() => allowed('notes.list')).not.toThrow();
  });

  it('collections.list needs bookmarks:read', () => {
    expect(() => createDeclaredMethodGuard(buildGrant('ext.a', ['notes:read']))('collections.list')).toThrow(
      PermissionDeniedError,
    );
    expect(() =>
      createDeclaredMethodGuard(buildGrant('ext.a', ['bookmarks:read']))('collections.list'),
    ).not.toThrow();
  });

  it('commands.execute (checked by the impl) passes with no permissions', () => {
    const gate = REGISTRY.methodGate('commands.execute')!.gate;
    expect(gate).toMatchObject({ checkedBy: 'impl' });
    expect(() => createDeclaredMethodGuard(buildGrant('ext.a', []))('commands.execute')).not.toThrow();
  });

  it('refuses an undeclared method with RpcProtocolError', () => {
    const err = catchOf(() => createDeclaredMethodGuard(buildGrant('ext.a', ['notes:read']))('notes.bogus'));
    expect(err).toBeInstanceOf(RpcProtocolError);
    expect((err as Error).message).toContain('notes.bogus');
  });

  it('passes an open method (storage.getSetting) with no permissions', () => {
    expect(REGISTRY.methodGate('storage.getSetting')!.gate).toBeNull();
    expect(() => createDeclaredMethodGuard(buildGrant('ext.a', []))('storage.getSetting')).not.toThrow();
  });
});

// --- 2. a custom registry --------------------------------------------------

describe('createDeclaredMethodGuard with a custom registry', () => {
  const sample = Extensions.defineApiNamespace<{
    shout(t: string): Promise<string>;
    whisper(t: string): Promise<string>;
  }>()({
    name: 'echo',
    description: 'Sample.',
    since: '0.1.0',
    optional: true,
    permissions: [
      {
        id: 'echo:shout',
        grant: 'prompt',
        consent: { key: 'extensionConsent.permission.echoShout', text: 'Shout back at you.' },
        since: '0.1.0',
      },
    ],
    methods: {
      shout: { permission: 'echo:shout' },
      whisper: { permission: null },
    },
  });
  const registry = Extensions.createApiRegistry([...Extensions.API_NAMESPACES, sample]);

  it('applies the sample namespace gates', () => {
    const none = createDeclaredMethodGuard(buildGrant('ext.a', []), registry);
    expect(() => none('echo.shout')).toThrow(PermissionDeniedError);
    expect(() => none('echo.whisper')).not.toThrow();
    const granted = createDeclaredMethodGuard(buildGrant('ext.a', ['echo:shout']), registry);
    expect(() => granted('echo.shout')).not.toThrow();
  });

  it('the default registry does not know the sample namespace', () => {
    expect(() => createDeclaredMethodGuard(buildGrant('ext.a', []))('echo.whisper')).toThrow(RpcProtocolError);
  });
});

// --- 3. router integration -------------------------------------------------

describe('guard installed on an ExtensionRpcRouter', () => {
  function setup(perms: string[]) {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    router.setMethodGuard(createDeclaredMethodGuard(buildGrant('ext.a', perms)));
    let calls = 0;
    router.registerMethod('notes.list', () => {
      calls++;
      return ['n1'];
    });
    return { pair, router, calls: () => calls };
  }

  it('answers PermissionDeniedError and never runs the handler when ungranted', async () => {
    const { pair, calls } = setup([]);
    const res = await workerCall(pair, 'notes.list', []);
    expect(res.error?.code).toBe('PermissionDeniedError');
    expect(res.result).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it('returns the handler result when granted', async () => {
    const { pair, calls } = setup(['notes:read']);
    const res = await workerCall(pair, 'notes.list', []);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual(['n1']);
    expect(calls()).toBe(1);
  });

  it('an unregistered method still answers Unknown RPC method (guard does not run first)', async () => {
    const { pair } = setup([]);
    const res = await workerCall(pair, 'notes.write', []);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('Unknown RPC method');
  });

  it('refuses a registered but undeclared method with RpcProtocolError', async () => {
    const { pair, router } = setup(['notes:read']);
    router.registerMethod('notes.bogus', () => 1);
    const res = await workerCall(pair, 'notes.bogus', []);
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('not declared');
  });
});

// --- 4/5. drift between declarations and attachApiImpls --------------------

/** A context wiring every bridge/factory the in-memory fakes can supply. */
function fullContext(): ExtensionHostContext {
  const i18n = new I18nService();
  const whenContext = new WhenContextService();
  const commandRegistry = new CommandRegistry({ i18n, whenContext });
  return {
    db: new FakeSql(),
    contributionRegistry: new ContributionRegistry(),
    activeWorkers: new Map(),
    commandBridge: new InMemoryCommandBridge(commandRegistry),
    contextBridge: new InMemoryContextBridge(whenContext),
    bibleBridge: new InMemoryBibleBridge(),
    commentaryBridge: new InMemoryCommentaryBridge(),
    dictionaryBridge: new InMemoryDictionaryBridge(),
    bookBridge: new InMemoryBookBridge(),
    uiBridge: new InMemoryUiBridge(),
    workspaceBridge: new InMemoryWorkspaceBridge(),
    l10nBridge: new InMemoryL10nBridge(),
    notesBridge: new InMemoryNotesBridge(),
    highlightsBridge: new InMemoryHighlightsBridge(),
    bookmarksBridge: new InMemoryBookmarksBridge(),
    collectionsBridge: new InMemoryCollectionsBridge(),
    folderBridge: new InMemoryFolderBridge(),
    taskStatusBridge: new InMemoryTaskStatusBridge(),
    networkGatewayFactory: () => ({ fetch: async () => ({ ok: false, error: 'stub' }) }),
    authBrokerFactory: () => ({ runAuthCodeFlow: async () => ({ ok: false, error: 'stub' }) }),
    externalUrlOpener: async () => undefined,
    registry: { getEntry: () => undefined, listEntries: () => [] },
  } as unknown as ExtensionHostContext;
}

function attach(perms: readonly string[]): ExtensionRpcRouter & { pair: ReturnType<typeof pairedTransports> } {
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.hostSide);
  const entry = {
    grantedPermissions: [...perms],
    installPath: '/tmp/ext',
    manifest: { network: { allowedHosts: [{ host: 'api.example.com', purpose: 'test' }] } },
  } as unknown as Parameters<typeof attachApiImpls>[2];
  attachApiImpls(fullContext(), 'ext.drift', entry, router, {} as unknown as ActiveWorker);
  return Object.assign(router, { pair });
}

/**
 * Declared non-local methods the desktop host legitimately does not register
 * with every bridge wired and every permission granted. Each entry needs a
 * reason; an empty list means (b) holds exactly.
 */
const NOT_REGISTERED_ALLOW_LIST: Readonly<Record<string, string>> = {};

describe('declaration drift (real attachApiImpls, every bridge wired, all permissions)', () => {
  const router = attach(REGISTRY.permissionIds);
  const registered = new Set(router.listMethods());

  it('(a) every registered method is declared', () => {
    const undeclared = [...registered].filter((m) => REGISTRY.methodGate(m) === undefined);
    expect(undeclared, `registered but undeclared: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('(b) every declared non-local method is registered', () => {
    const missing = REGISTRY.methods
      .filter((m) => !m.local)
      .map((m) => `${m.namespace}.${m.method}`)
      .filter((m) => !registered.has(m) && !(m in NOT_REGISTERED_ALLOW_LIST));
    expect(missing, `declared but not registered: ${missing.join(', ')}`).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    for (const m of Object.keys(NOT_REGISTERED_ALLOW_LIST)) {
      expect(registered.has(m), `${m} is registered, drop it from the allow-list`).toBe(false);
    }
  });
});

describe('gate/impl agreement', () => {
  // Permissions that decide whether a namespace/tier is attached at all, so
  // the denied-call probe needs them granted to reach the guard.
  const availabilityPerms = REGISTRY.namespaces
    .map((n) => n.availability?.whenGranted)
    .filter((p): p is string => typeof p === 'string');
  const baseline = [
    ...new Set([...Extensions.DEFAULT_GRANTED_PERMISSIONS, ...availabilityPerms, 'fs:managed-folder']),
  ];
  const router = attach(baseline);
  const registered = new Set(router.listMethods());

  const probes = REGISTRY.methods.filter(
    (m) =>
      m.typed &&
      !m.local &&
      typeof m.gate === 'string' &&
      !baseline.includes(m.gate) &&
      registered.has(`${m.namespace}.${m.method}`),
  );

  it('has methods to probe', () => {
    expect(probes.length).toBeGreaterThan(10);
  });

  it('refuses every permission-gated typed method for a grant lacking the permission', async () => {
    const wrong: string[] = [];
    for (const m of probes) {
      const res = await workerCall(router.pair, `${m.namespace}.${m.method}`, []);
      if (res.error?.code !== 'PermissionDeniedError') {
        wrong.push(`${m.namespace}.${m.method} -> ${res.error?.code ?? 'no error'}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// --- 6. consent catalog ----------------------------------------------------

describe('consent catalog', () => {
  const catalogPath = resolve(__dirname, '../../../locales/en/ui.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Record<string, unknown>;

  it('every declared permission has its consent text in locales/en/ui.json', () => {
    const problems: string[] = [];
    for (const p of REGISTRY.permissions) {
      const value = catalog[p.consent.key];
      if (value === undefined) problems.push(`${p.id}: missing key ${p.consent.key}`);
      else if (value !== p.consent.text) {
        problems.push(`${p.id}: ${p.consent.key} = ${JSON.stringify(value)} != ${JSON.stringify(p.consent.text)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

// --- 7. served namespaces --------------------------------------------------

describe('desktopApiNamespaces', () => {
  it('equals the registry namespace list', () => {
    expect(desktopApiNamespaces()).toEqual([...REGISTRY.namespaceNames]);
  });
});
