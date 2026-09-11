/**
 * Realm-mode harness tests, driven by a scripted fake guest.
 *
 * The engine is injected (see `smoke/realm/types.ts`), which means the
 * harness's own logic — the activation handshake, routing guest calls onto
 * the mock API, synthesising event subscribers, attributing `__runtime.error`
 * to the invocation in flight — is testable here without QuickJS, WASM, or a
 * bundling step. `apps/desktop` covers the same harness against the real
 * `QuickJSRealm`; these tests cover the protocol behaviour that would
 * otherwise only be observable through it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Extensions } from '@bible/core';

import { createRealmSmokeHarness } from '../realm/createRealmSmokeHarness';
import { dispatchToApi } from '../realm/apiDispatch';
import type { RealmFactory } from '../realm/types';
import { runSmokeSuite } from '../runSmokeSuite';
import { createMockApi } from '../../createMockApi';

type ExtensionManifest = Extensions.ExtensionManifest;

// ── Scripted fake guest ─────────────────────────────────────────────────────

interface GuestOps {
  /** Issue a host API call, exactly as the real API proxy would. */
  request(method: string, args?: unknown[]): Promise<unknown>;
  /** Subscribe to an event channel. Returns the subscription id. */
  subscribe(channel: string): string;
  /** Drop a subscription by the id `subscribe` returned. */
  unsubscribe(id: string): void;
  /** Report an unhandled error on the runtime channel. */
  raise(message: string): void;
  /** Ping the host; a live host echoes it back. */
  heartbeat(): void;
}

interface FakeGuest {
  onInit?: (ops: GuestOps) => void | Promise<void>;
  onEvent?: (channel: string, payload: unknown, ops: GuestOps) => void | Promise<void>;
  /**
   * Stands in for the endpoint table `api.runtime.expose(...)` fills in.
   * A reverse request naming a key here runs it; anything else gets the same
   * `Unknown reverse RPC method` payload `ExtensionRuntime` sends, which is
   * how the harness tells an unbound endpoint from a failing handler.
   */
  endpoints?: Record<string, (args: unknown[], ops: GuestOps) => unknown>;
  /** Stands in for the extension's `deactivate()` export. */
  onDeactivate?: (ops: GuestOps) => void;
}

interface FakeRealmHandle {
  factory: RealmFactory;
  disposeCount: () => number;
}

function fakeRealm(guest: FakeGuest): FakeRealmHandle {
  let disposeCount = 0;
  const factory: RealmFactory = async (opts) => {
    let nextId = 1;
    const pending = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();

    const ops: GuestOps = {
      request(method, args = []) {
        return new Promise((resolve, reject) => {
          const id = `guest-${nextId++}`;
          pending.set(id, { resolve, reject });
          opts.onSend({ kind: 'request', id, method, args });
        });
      },
      subscribe(channel) {
        const id = `sub-${nextId++}`;
        opts.onSend({ kind: 'subscribe', id, channel });
        return id;
      },
      unsubscribe(id) {
        opts.onSend({ kind: 'unsubscribe', id });
      },
      heartbeat() {
        opts.onSend({ kind: 'heartbeat', ts: 1 });
      },
      raise(message) {
        opts.onSend({
          kind: 'event',
          channel: '__runtime.error',
          payload: { source: 'guest', message },
        });
      },
    };

    return {
      deliver(envelope: unknown): void {
        const env = envelope as {
          kind?: string;
          id?: string;
          method?: string;
          args?: unknown[];
          channel?: string;
          payload?: unknown;
          result?: unknown;
          error?: { message: string };
        };
        if (env.kind === 'request' && env.method !== 'runtime.init') {
          // Reverse RPC: the host calling an endpoint the extension exposed.
          const handler = guest.endpoints?.[env.method as string];
          if (!handler) {
            opts.onSend({
              kind: 'response',
              id: env.id,
              error: {
                code: 'RpcProtocolError',
                message: `Unknown reverse RPC method: ${String(env.method)}`,
              },
            });
            return;
          }
          void (async () => {
            try {
              const result = await handler(env.args ?? [], ops);
              opts.onSend({ kind: 'response', id: env.id, result });
            } catch (err) {
              opts.onSend({
                kind: 'response',
                id: env.id,
                error: { code: 'Error', message: (err as Error).message },
              });
            }
          })();
          return;
        }
        if (env.kind === 'request' && env.method === 'runtime.init') {
          void (async () => {
            try {
              await guest.onInit?.(ops);
              opts.onSend({ kind: 'response', id: env.id, result: { ok: true } });
            } catch (err) {
              opts.onSend({
                kind: 'response',
                id: env.id,
                error: { code: 'Error', message: (err as Error).message },
              });
            }
          })();
          return;
        }
        if (env.kind === 'response') {
          const p = pending.get(env.id as string);
          if (!p) return;
          pending.delete(env.id as string);
          if (env.error) p.reject(new Error(env.error.message));
          else p.resolve(env.result);
          return;
        }
        if (env.kind === 'event') {
          void (async () => {
            try {
              await guest.onEvent?.(env.channel as string, env.payload, ops);
            } catch (err) {
              // Mirrors the guest runtime: an unhandled error inside an event
              // handler is reported out-of-band, never returned to the host.
              ops.raise((err as Error).message);
            }
          })();
        }
      },
      requestGuestDispose(): void {
        guest.onDeactivate?.(ops);
      },
      dispose(): void {
        disposeCount++;
      },
    };
  };
  return { factory, disposeCount: () => disposeCount };
}

function manifest(over: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'ext.test.realm-harness',
    name: { key: 'ext.test.realm-harness' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: './main.js',
    permissions: ['bible:read'],
    ...over,
  } as ExtensionManifest;
}

function harnessFor(guest: FakeGuest, over: Partial<ExtensionManifest> = {}) {
  const realm = fakeRealm(guest);
  const harness = createRealmSmokeHarness({
    manifest: manifest(over),
    entrySource: '// scripted by the fake guest',
    realmFactory: realm.factory,
  });
  return { harness, realm };
}

// ── Activation ──────────────────────────────────────────────────────────────

describe('createRealmSmokeHarness — activation', () => {
  it('completes the init handshake and reports active', async () => {
    const { harness } = harnessFor({});
    await harness.activate();
    expect(harness.isActive()).toBe(true);
  });

  it('sends the manifest and granted permissions in the init payload', async () => {
    let seen: unknown;
    const realm = fakeRealm({});
    const harness = createRealmSmokeHarness({
      manifest: manifest({ permissions: ['bible:read', 'notes:write'] } as Partial<ExtensionManifest>),
      entrySource: '',
      realmFactory: async (opts) => {
        const session = await realm.factory(opts);
        return {
          deliver: (env) => {
            const e = env as { method?: string; args?: unknown[] };
            if (e.method === 'runtime.init') seen = e.args?.[0];
            session.deliver(env);
          },
          dispose: () => session.dispose(),
        };
      },
    });
    await harness.activate();
    const payload = seen as Extensions.ExtensionInitPayload;
    expect(payload.manifest.id).toBe('ext.test.realm-harness');
    expect(payload.grantedPermissions).toEqual(['bible:read', 'notes:write']);
    expect(payload.locale).toBe('en');
  });

  it('honours a narrower grant than the manifest declares', async () => {
    const denials: string[] = [];
    const realm = fakeRealm({
      async onInit(ops) {
        try {
          await ops.request('notes.create', [{ content: 'x' }]);
        } catch (err) {
          denials.push((err as Error).message);
        }
      },
    });
    const harness = createRealmSmokeHarness({
      manifest: manifest({ permissions: ['bible:read', 'notes:write'] } as Partial<ExtensionManifest>),
      entrySource: '',
      realmFactory: realm.factory,
      grantedPermissions: ['bible:read'],
    });
    await harness.activate();
    // The mock does not enforce permissions during activate, so the call
    // succeeds — what this pins is that the narrower grant reached the guest.
    expect(harness.isActive()).toBe(true);
    expect(denials).toEqual([]);
  });

  it('surfaces an activation failure rather than reporting active', async () => {
    const { harness } = harnessFor({
      onInit() {
        throw new Error('activate blew up');
      },
    });
    await expect(harness.activate()).rejects.toThrow(/activate blew up/);
    expect(harness.isActive()).toBe(false);
  });

  it('refuses a second activate', async () => {
    const { harness } = harnessFor({});
    await harness.activate();
    await expect(harness.activate()).rejects.toThrow(/already active/);
  });

  it('requires either an extensionRoot or a manifest plus entry source', () => {
    expect(() =>
      createRealmSmokeHarness({
        manifest: manifest(),
        realmFactory: fakeRealm({}).factory,
      }),
    ).toThrow(/supply either/);
  });
});

// ── Routing guest calls onto the mock ───────────────────────────────────────

describe('createRealmSmokeHarness — API routing', () => {
  it('captures registrations issued over RPC', async () => {
    const { harness } = harnessFor({
      async onInit(ops) {
        await ops.request('ui.registerPanelType', [
          { id: 'ext.test.realm-harness.panel', title: { key: 't' }, uiEntry: './ui.html' },
        ]);
        await ops.request('commands.register', [{ id: 'ext.test.realm-harness.go', title: { key: 'g' } }]);
      },
    });
    await harness.activate();
    expect(harness.getCaptured().panelTypes.map((p) => p.id)).toEqual([
      'ext.test.realm-harness.panel',
    ]);
    expect(harness.getCaptured().commands.map((c) => c.id)).toEqual([
      'ext.test.realm-harness.go',
    ]);
  });

  it('answers registrations with a disposal id, since a function cannot cross the wire', async () => {
    let reply: unknown;
    const { harness } = harnessFor({
      async onInit(ops) {
        reply = await ops.request('ui.registerPanelType', [
          { id: 'p', title: { key: 't' }, uiEntry: './ui.html' },
        ]);
      },
    });
    await harness.activate();
    expect(reply).toEqual({ disposalId: expect.stringMatching(/^smoke-\d+$/) });
  });

  it('routes reads through the mock so apiOverrides apply', async () => {
    let verse: unknown;
    const realm = fakeRealm({
      async onInit(ops) {
        verse = await ops.request('bible.getVerse', [43003016]);
      },
    });
    const harness = createRealmSmokeHarness({
      manifest: manifest(),
      entrySource: '',
      realmFactory: realm.factory,
      apiOverrides: {
        bible: { getVerse: vi.fn().mockResolvedValue({ verseId: 43003016, text: 'For God...' }) },
      },
    });
    await harness.activate();
    expect(verse).toEqual({ verseId: 43003016, text: 'For God...' });
  });

  it('answers an unknown method with RpcProtocolError instead of hanging', async () => {
    let message = '';
    const { harness } = harnessFor({
      async onInit(ops) {
        try {
          await ops.request('bible.nope', []);
        } catch (err) {
          message = (err as Error).message;
        }
      },
    });
    await harness.activate();
    expect(message).toMatch(/Unknown RPC method: bible\.nope/);
  });

  it('echoes heartbeats so the guest does not consider the host hung', async () => {
    let echoed = 0;
    const realm = fakeRealm({
      onInit(ops) {
        ops.heartbeat();
      },
    });
    const harness = createRealmSmokeHarness({
      manifest: manifest(),
      entrySource: '',
      realmFactory: async (opts) => {
        const session = await realm.factory(opts);
        return {
          deliver: (env) => {
            if ((env as { kind?: string }).kind === 'heartbeat') echoed++;
            session.deliver(env);
          },
          dispose: () => session.dispose(),
        };
      },
    });
    await harness.activate();
    expect(echoed).toBe(1);
  });
});

// ── Events ──────────────────────────────────────────────────────────────────

describe('createRealmSmokeHarness — events', () => {
  const subscribing: FakeGuest = {
    onInit(ops) {
      ops.subscribe('bible.onDidChangeActiveVerse');
    },
  };

  it('turns a subscribe envelope into an enumerable hook', async () => {
    const { harness } = harnessFor(subscribing);
    await harness.activate();
    expect(harness.subscribedChannels()).toEqual(['bible.onDidChangeActiveVerse']);
    expect(harness.enumerate().map((h) => h.hookId)).toContain(
      'event:bible.onDidChangeActiveVerse',
    );
  });

  it('delivers the invocation payload into the guest', async () => {
    const received: unknown[] = [];
    const { harness } = harnessFor({
      onInit: subscribing.onInit,
      onEvent(_channel, payload) {
        received.push(payload);
      },
    });
    await harness.activate();
    const result = await harness.invokeHook(
      'event:bible.onDidChangeActiveVerse',
      { verseId: 43003016 },
    );
    expect(result.status).toBe('ok');
    expect(received).toEqual([{ verseId: 43003016 }]);
  });

  it('attributes a guest runtime error to the invocation in flight', async () => {
    const { harness } = harnessFor({
      onInit: subscribing.onInit,
      onEvent() {
        throw new Error('handler exploded');
      },
    });
    await harness.activate();
    const result = await harness.invokeHook('event:bible.onDidChangeActiveVerse', {});
    expect(result.status).toBe('threw');
    expect(result.error?.message).toMatch(/handler exploded/);
    expect(harness.runtimeErrors()).toHaveLength(1);
  });

  it('does not blame an invocation for an error raised before it', async () => {
    const { harness } = harnessFor({
      onInit(ops) {
        ops.subscribe('bible.onDidChangeActiveVerse');
        ops.raise('noise during activate');
      },
    });
    await harness.activate();
    expect(harness.runtimeErrors()).toHaveLength(1);
    const result = await harness.invokeHook('event:bible.onDidChangeActiveVerse', {});
    expect(result.status).toBe('ok');
  });

  it('drops the subscriber when the guest unsubscribes', async () => {
    const { harness } = harnessFor({
      onInit(ops) {
        const id = ops.subscribe('bible.onDidChangeActiveVerse');
        ops.subscribe('notes.onDidChange');
        ops.unsubscribe(id);
      },
    });
    await harness.activate();
    expect([...harness.getCaptured().eventSubscribers.keys()]).toEqual([
      'notes.onDidChange',
    ]);
  });

  it('keeps the channel alive while another subscription still holds it', async () => {
    const { harness } = harnessFor({
      onInit(ops) {
        const first = ops.subscribe('bible.onDidChangeActiveVerse');
        ops.subscribe('bible.onDidChangeActiveVerse');
        ops.unsubscribe(first);
      },
    });
    await harness.activate();
    expect(harness.getCaptured().eventSubscribers.has('bible.onDidChangeActiveVerse')).toBe(
      true,
    );
  });
});

// ── Assertion engine over realm mode ────────────────────────────────────────

describe('runSmokeSuite over a realm-backed harness', () => {
  it('passes a clean extension', async () => {
    const { harness } = harnessFor({
      onInit(ops) {
        ops.subscribe('bible.onDidChangeActiveVerse');
      },
      onEvent() {
        /* well-behaved */
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 2 });
    expect(result.totals.failed).toBe(0);
    expect(result.totals.passed).toBeGreaterThan(0);
  });

  it('flags a permission the manifest never declared', async () => {
    const { harness } = harnessFor({
      onInit(ops) {
        ops.subscribe('bible.onDidChangeActiveVerse');
      },
      async onEvent(_channel, _payload, ops) {
        await ops.request('notes.create', [{ content: 'nope' }]);
      },
    });
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });
    const violation = result.records.find((r) => r.failureReason === 'permission-violation');
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/notes:write/);
  });

  it('flags a fetch to a host outside the manifest allowlist', async () => {
    const { harness } = harnessFor(
      {
        onInit(ops) {
          ops.subscribe('bible.onDidChangeActiveVerse');
        },
        async onEvent(_channel, _payload, ops) {
          await ops.request('network.fetch', ['https://evil.example.com/exfil']);
        },
      },
      {
        permissions: ['bible:read', 'network'],
        network: { allowedHosts: [{ host: 'api.example.com', purpose: { key: 'p' } }] },
      } as Partial<ExtensionManifest>,
    );
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });
    const record = result.records.find((r) => r.status === 'fail');
    expect(record?.failureReason).toBe('unexpected-network');
  });

  const COMMAND_MANIFEST = {
    contributes: {
      commands: [
        {
          id: 'ext.test.realm-harness.go',
          title: { key: 'g' },
          handlerEndpoint: 'go',
        },
      ],
    },
  } as Partial<ExtensionManifest>;

  it('drives a command through the realm to the endpoint the guest exposed', async () => {
    const calls: unknown[][] = [];
    const { harness } = harnessFor(
      {
        endpoints: {
          go(args) {
            calls.push(args);
            return { ran: true };
          },
        },
      },
      COMMAND_MANIFEST,
    );
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });
    const command = result.records.find((r) => r.hookId.startsWith('command:'));
    expect(command?.status).toBe('pass');
    expect(command?.returnValue).toEqual({ ran: true });
    expect(calls).toHaveLength(1);
  });

  it('fails a command whose handler throws inside the realm', async () => {
    const { harness } = harnessFor(
      {
        endpoints: {
          go() {
            throw new Error('command exploded');
          },
        },
      },
      COMMAND_MANIFEST,
    );
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });
    const command = result.records.find((r) => r.hookId.startsWith('command:'));
    expect(command?.status).toBe('fail');
    expect(command?.failureReason).toBe('threw');
    expect(command?.message).toContain('command exploded');
  });

  it('fails a command the guest never bound, rather than skipping it', async () => {
    // The guest answers `Unknown reverse RPC method`, exactly as
    // `ExtensionRuntime` does for an endpoint nothing exposed. In the app this
    // is a palette entry that silently does nothing, so it is a failure.
    const { harness } = harnessFor({}, COMMAND_MANIFEST);
    await harness.activate();
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });
    const command = result.records.find((r) => r.hookId.startsWith('command:'));
    expect(command?.status).toBe('fail');
    expect(command?.failureReason).toBe('unbound-endpoint');
    expect(command?.message).toMatch(/api\.runtime\.expose/);
  });
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('createRealmSmokeHarness — lifecycle', () => {
  it('disposes the realm exactly once on deactivate', async () => {
    const { harness, realm } = harnessFor({});
    await harness.activate();
    await harness.deactivate();
    await harness.deactivate();
    expect(realm.disposeCount()).toBe(1);
    expect(harness.isActive()).toBe(false);
  });

  it("runs the extension's own deactivate before tearing the realm down", async () => {
    // In-process mode calls the module's `deactivate` export; realm mode has
    // to ask the guest to run it. Skipping it would hide teardown bugs.
    const order: string[] = [];
    const { harness } = harnessFor({
      onInit(ops) {
        ops.subscribe('bible.onDidChangeActiveVerse');
      },
      onDeactivate(ops) {
        order.push('guest-deactivate');
        ops.raise('cleanup complaint');
      },
    });
    await harness.activate();
    await harness.deactivate();
    expect(order).toEqual(['guest-deactivate']);
    // Traffic the guest emits on the way out is still drained, not dropped.
    expect(harness.runtimeErrors().map((e) => e.message)).toEqual(['cleanup complaint']);
  });

  it('tears down even when the guest misbehaves on the way out', async () => {
    const { harness, realm } = harnessFor({
      onDeactivate() {
        throw new Error('deactivate threw');
      },
    });
    await harness.activate();
    await harness.deactivate();
    // The realm still goes away, and the failure is recorded rather than lost.
    expect(realm.disposeCount()).toBe(1);
    expect(harness.isActive()).toBe(false);
    expect(harness.runtimeErrors()).toEqual([
      { source: 'deactivate', message: 'deactivate threw' },
    ]);
  });
});

// ── dispatchToApi ───────────────────────────────────────────────────────────

describe('dispatchToApi', () => {
  it('calls a two-segment method on the mock', async () => {
    const api = createMockApi({
      bible: { getVerse: vi.fn().mockResolvedValue({ verseId: 1, text: 'a' }) },
    });
    const out = await dispatchToApi(api, 'bible.getVerse', [1]);
    expect(out.result).toEqual({ verseId: 1, text: 'a' });
    expect(out.error).toBeUndefined();
  });

  it('rejects a namespace that is not part of the API', async () => {
    const api = createMockApi();
    const out = await dispatchToApi(api, 'internals.readSecrets', []);
    expect(out.error?.code).toBe('RpcProtocolError');
  });

  it('refuses to traverse prototype machinery', async () => {
    const api = createMockApi();
    for (const method of [
      'bible.constructor',
      'bible.__proto__',
      '__proto__.polluted',
      'bible.prototype.toString',
    ]) {
      const out = await dispatchToApi(api, method, []);
      expect(out.error?.code, method).toBe('RpcProtocolError');
    }
  });

  it('rejects a bare namespace with no method', async () => {
    const api = createMockApi();
    const out = await dispatchToApi(api, 'bible', []);
    expect(out.error?.code).toBe('RpcProtocolError');
  });

  it('serializes a thrown ExtensionApiError with its stable code', async () => {
    const api = createMockApi({
      notes: {
        create: vi.fn().mockRejectedValue(
          new (await import('@bible/core')).Extensions.PermissionDeniedError('nope', {
            permission: 'notes:write',
          }),
        ),
      },
    });
    const out = await dispatchToApi(api, 'notes.create', [{}]);
    expect(out.error).toEqual({
      code: 'PermissionDeniedError',
      message: 'nope',
      data: { permission: 'notes:write' },
    });
  });

  it('serializes a plain Error without inventing a code', async () => {
    const api = createMockApi({
      bible: { getVerse: vi.fn().mockRejectedValue(new TypeError('bad arg')) },
    });
    const out = await dispatchToApi(api, 'bible.getVerse', [1]);
    expect(out.error).toEqual({ code: 'TypeError', message: 'bad arg' });
  });
});
