/**
 * Sandbox escape test suite - verify that isolation boundaries hold.
 *
 * Each test simulates a scenario where a malicious or buggy extension
 * attempts to breach its sandbox. The host must block every attempt
 * cleanly without crashing.
 *
 * Uses the same paired-transport / FakeSql / InMemorySecretsKeychain
 * patterns established in the other api-impl test files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { StorageApiImpl } from '../api-impl/storageApiImpl';
import { NetworkApiImpl, type DnsResolver } from '../api-impl/networkApiImpl';
import { InMemorySecretsKeychain } from '../SecretsKeychain';
import { FakeSql } from './fakeSql';
import type {
  GatewayRequest,
  GatewayResponse,
  GatewayError,
  IExtensionNetworkGateway,
} from '../gateways/ExtensionNetworkGateway';
import {
  ExtensionWorkerProcess,
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';

type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

// --- Test infrastructure -----------------------------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
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
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { hostSide, workerSide, hostSent };
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

let nextReqId = 1;
async function workerCall(
  workerSide: IRpcTransport,
  hostSent: unknown[],
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = hostSent.length;
  const id = `esc-${nextReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  workerSide.send(req);
  for (let i = 0; i < 100; i++) {
    await flush();
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
  throw new Error(`workerCall: no response for ${method}`);
}

/** Fake network gateway that records calls and returns a canned response. */
class FakeGateway implements IExtensionNetworkGateway {
  readonly calls: GatewayRequest[] = [];
  async fetch(req: GatewayRequest): Promise<GatewayResponse | GatewayError> {
    this.calls.push(req);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      url: req.url,
      body: new Uint8Array(),
    };
  }
}

// --- 1. Storage cross-read ---------------------------------------------------

describe('Sandbox Escape: storage cross-read', () => {
  let db: FakeSql;
  let pairA: ReturnType<typeof pairedTransports>;
  let pairB: ReturnType<typeof pairedTransports>;
  let routerA: ExtensionRpcRouter;
  let routerB: ExtensionRpcRouter;

  beforeEach(() => {
    db = new FakeSql();

    // Extension A
    pairA = pairedTransports();
    routerA = new ExtensionRpcRouter(pairA.hostSide);
    const grantA = buildGrant('ext.alpha', ['storage', 'bible:read']);
    const storageA = new StorageApiImpl({
      extensionId: 'ext.alpha',
      router: routerA,
      db,
      grant: grantA,
    });
    storageA.attach();

    // Extension B
    pairB = pairedTransports();
    routerB = new ExtensionRpcRouter(pairB.hostSide);
    const grantB = buildGrant('ext.beta', ['storage', 'bible:read']);
    const storageB = new StorageApiImpl({
      extensionId: 'ext.beta',
      router: routerB,
      db,
      grant: grantB,
    });
    storageB.attach();
  });

  it('extension A cannot read extension B KV data', async () => {
    // Extension B writes a secret value.
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.set', ['secret-key', 'secret-value']);

    // Extension A tries to read the same key.
    const res = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.get', ['secret-key']);
    // Should get undefined, not extension B's value.
    expect(res.result).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  it('extension A keys() does not include extension B keys', async () => {
    // Extension B writes a key.
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.set', ['b-only-key', 42]);
    // Extension A writes a key.
    await workerCall(pairA.workerSide, pairA.hostSent, 'storage.set', ['a-key', 'hello']);

    const resA = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.keys', []);
    const keysA = resA.result as string[];
    expect(keysA).toContain('a-key');
    expect(keysA).not.toContain('b-only-key');
  });

  it('extension A cannot delete extension B keys', async () => {
    // Extension B writes a key.
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.set', ['protected', 'mine']);

    // Extension A tries to delete it.
    await workerCall(pairA.workerSide, pairA.hostSent, 'storage.delete', ['protected']);

    // Extension B can still read its key.
    const res = await workerCall(pairB.workerSide, pairB.hostSent, 'storage.get', ['protected']);
    expect(res.result).toBe('mine');
  });

  it('shared FakeSql holds both extensions data in separate namespaces', async () => {
    // Both extensions write the same key name.
    await workerCall(pairA.workerSide, pairA.hostSent, 'storage.set', ['common-key', 'alpha']);
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.set', ['common-key', 'beta']);

    // Each reads their own.
    const resA = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.get', ['common-key']);
    const resB = await workerCall(pairB.workerSide, pairB.hostSent, 'storage.get', ['common-key']);
    expect(resA.result).toBe('alpha');
    expect(resB.result).toBe('beta');
  });
});

// --- 2. Network spoofing -----------------------------------------------------

describe('Sandbox Escape: network spoofing', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;
  let gateway: FakeGateway;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.hostSide);
    gateway = new FakeGateway();

    const publicDns: DnsResolver = async () => [{ address: '93.184.216.34', family: 4 }];
    const grant = buildGrant('ext.nettest', ['network', 'bible:read']);
    const net = new NetworkApiImpl({
      extensionId: 'ext.nettest',
      router,
      grant,
      allowedHosts: [{ host: 'api.example.com', purpose: 'test' }],
      gateway,
      dnsResolver: publicDns,
    });
    net.attach();
  });

  it('rejects fetch to a non-allowlisted host', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://evil.com/steal'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects fetch to localhost', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['http://localhost:3000/api'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects fetch to a private IP literal', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['http://192.168.1.1/admin'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects fetch to file:// URL', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['file:///etc/passwd'],
    );
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(gateway.calls).toHaveLength(0);
  });

  it('rejects fetch to javascript: URL', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['javascript:alert(1)'],
    );
    // URL constructor will reject this or the scheme check will catch it.
    expect(res.error).toBeDefined();
    expect(gateway.calls).toHaveLength(0);
  });

  it('allows fetch to an allowlisted host', async () => {
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://api.example.com/data'],
    );
    expect(res.error).toBeUndefined();
    expect(gateway.calls).toHaveLength(1);
  });
});

describe('Sandbox Escape: DNS rebinding', () => {
  it('blocks a host that resolves to a private IP', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new FakeGateway();

    // DNS resolves the allowlisted domain to a private address.
    const evilDns: DnsResolver = async () => [{ address: '127.0.0.1', family: 4 }];
    const grant = buildGrant('ext.dnstrick', ['network', 'bible:read']);
    const net = new NetworkApiImpl({
      extensionId: 'ext.dnstrick',
      router,
      grant,
      allowedHosts: [{ host: 'attacker.com', purpose: 'test' }],
      gateway,
      dnsResolver: evilDns,
    });
    net.attach();

    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://attacker.com/callback'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(res.error!.message).toContain('private address');
    expect(gateway.calls).toHaveLength(0);
  });

  it('blocks DNS resolution to IPv6 loopback', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new FakeGateway();
    const evilDns: DnsResolver = async () => [{ address: '::1', family: 6 }];
    const grant = buildGrant('ext.ipv6trick', ['network', 'bible:read']);
    const net = new NetworkApiImpl({
      extensionId: 'ext.ipv6trick',
      router,
      grant,
      allowedHosts: [{ host: 'tricky.io', purpose: 'test' }],
      gateway,
      dnsResolver: evilDns,
    });
    net.attach();

    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://tricky.io/evil'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(gateway.calls).toHaveLength(0);
  });

  it('blocks DNS resolution to RFC1918 range', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new FakeGateway();
    const evilDns: DnsResolver = async () => [{ address: '10.0.0.1', family: 4 }];
    const grant = buildGrant('ext.rfc1918', ['network', 'bible:read']);
    const net = new NetworkApiImpl({
      extensionId: 'ext.rfc1918',
      router,
      grant,
      allowedHosts: [{ host: 'sneaky.org', purpose: 'test' }],
      gateway,
      dnsResolver: evilDns,
    });
    net.attach();

    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://sneaky.org/internal'],
    );
    expect(res.error?.code).toBe('NetworkHostNotAllowedError');
    expect(gateway.calls).toHaveLength(0);
  });
});

// --- 3. Keychain leakage -----------------------------------------------------

describe('Sandbox Escape: keychain leakage', () => {
  let db: FakeSql;
  let keychain: InMemorySecretsKeychain;
  let pairA: ReturnType<typeof pairedTransports>;
  let pairB: ReturnType<typeof pairedTransports>;

  beforeEach(() => {
    db = new FakeSql();
    keychain = new InMemorySecretsKeychain();

    // Extension A (has secrets permission)
    pairA = pairedTransports();
    const routerA = new ExtensionRpcRouter(pairA.hostSide);
    const grantA = buildGrant('ext.alpha', ['storage', 'storage:secrets', 'bible:read']);
    const storageA = new StorageApiImpl({
      extensionId: 'ext.alpha',
      router: routerA,
      db,
      grant: grantA,
      keychain,
    });
    storageA.attach();

    // Extension B (has secrets permission)
    pairB = pairedTransports();
    const routerB = new ExtensionRpcRouter(pairB.hostSide);
    const grantB = buildGrant('ext.beta', ['storage', 'storage:secrets', 'bible:read']);
    const storageB = new StorageApiImpl({
      extensionId: 'ext.beta',
      router: routerB,
      db,
      grant: grantB,
      keychain,
    });
    storageB.attach();
  });

  it('extension A cannot read extension B secrets', async () => {
    // Extension B stores a secret.
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.setSecret', ['api-token', 's3cr3t']);

    // Extension A tries to read the same key name.
    const res = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.getSecret', ['api-token']);
    expect(res.result).toBeUndefined();
    expect(res.error).toBeUndefined();
  });

  it('extension A cannot delete extension B secrets', async () => {
    // Extension B stores a secret.
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.setSecret', ['token', 'value']);

    // Extension A tries to delete it.
    const delRes = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.deleteSecret', ['token']);
    // Should return false (nothing to delete in A's namespace).
    expect(delRes.result).toBe(false);

    // Extension B can still read its secret.
    const readRes = await workerCall(pairB.workerSide, pairB.hostSent, 'storage.getSecret', ['token']);
    expect(readRes.result).toBe('value');
  });

  it('both extensions can use the same key name independently', async () => {
    await workerCall(pairA.workerSide, pairA.hostSent, 'storage.setSecret', ['shared-name', 'alpha-val']);
    await workerCall(pairB.workerSide, pairB.hostSent, 'storage.setSecret', ['shared-name', 'beta-val']);

    const resA = await workerCall(pairA.workerSide, pairA.hostSent, 'storage.getSecret', ['shared-name']);
    const resB = await workerCall(pairB.workerSide, pairB.hostSent, 'storage.getSecret', ['shared-name']);
    expect(resA.result).toBe('alpha-val');
    expect(resB.result).toBe('beta-val');
  });
});

// --- 4. Permission boundary: secrets without permission ----------------------

describe('Sandbox Escape: permission boundary', () => {
  it('extension without storage:secrets cannot call setSecret', async () => {
    const db = new FakeSql();
    const keychain = new InMemorySecretsKeychain();
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    // Grant does NOT include 'storage:secrets'.
    const grant = buildGrant('ext.noperm', ['storage', 'bible:read']);
    const storage = new StorageApiImpl({
      extensionId: 'ext.noperm',
      router,
      db,
      grant,
      keychain,
    });
    storage.attach();

    const res = await workerCall(pair.workerSide, pair.hostSent, 'storage.setSecret', ['key', 'val']);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('extension without network permission cannot call fetch', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new FakeGateway();
    // Grant does NOT include 'network'.
    const grant = buildGrant('ext.nonet', ['bible:read']);
    const net = new NetworkApiImpl({
      extensionId: 'ext.nonet',
      router,
      grant,
      allowedHosts: [{ host: 'api.example.com', purpose: 'test' }],
      gateway,
    });
    net.attach();

    const res = await workerCall(pair.workerSide, pair.hostSent, 'network.fetch', ['https://api.example.com/']);
    expect(res.error?.code).toBe('PermissionDeniedError');
    expect(gateway.calls).toHaveLength(0);
  });
});

// --- 5. Memory exhaustion - worker heap cap ----------------------------------

/**
 * These two suites cover the OUTER ring - the OS process watchdog - and they
 * still hold: the per-extension `utilityProcess` remains hard-killable and the
 * host still survives losing one.
 *
 * They are not the first line of defence. The extension runs inside a QuickJS
 * realm that interrupts a runaway turn and caps heap growth at a
 * `WebAssembly.Memory` maximum, so a memory bomb or an infinite loop is
 * stopped *without* the process dying at all. That inner ring is
 * covered by `extension-runtime/__tests__/QuickJSRealm.test.ts`; what follows
 * is the backstop for when it fails.
 */
describe('Sandbox Escape: memory exhaustion', () => {
  /**
   * Fake child process that simulates a worker crash when it receives a
   * trigger message. This models the real scenario where V8's
   * --max-old-space-size causes the process to OOM and exit.
   */
  class OomChild implements IUtilityProcessHandle {
    pid = 99999;
    killed = false;
    private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
      message: [],
      exit: [],
      spawn: [],
    };

    constructor() {
      setImmediate(() => {
        for (const h of this.listeners.spawn) h(undefined);
      });
    }

    postMessage(_msg: unknown): void {
      // Simulate OOM: any message after spawn causes exit with code 134
      // (typical SIGABRT from V8 OOM).
      setImmediate(() => {
        for (const h of this.listeners.exit) h(134);
      });
    }

    kill(): boolean {
      this.killed = true;
      setImmediate(() => {
        for (const h of this.listeners.exit) h(null);
      });
      return true;
    }

    on(event: WorkerEventName, handler: WorkerEventListener): void {
      this.listeners[event].push(handler);
    }
  }

  it('host survives when a worker crashes from OOM', async () => {
    const onExit = vi.fn();
    const factory: IUtilityProcessFactory = {
      fork() {
        return new OomChild();
      },
    };
    const worker = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.oom',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 0,
      onExit,
    });
    await worker.spawn();

    // Send a message that triggers the simulated OOM crash.
    const transport = worker.getTransport();
    transport.send({ kind: 'request', id: 'trigger', method: 'allocate', args: [] });

    // Wait for the exit to propagate.
    await new Promise((r) => setTimeout(r, 50));
    await flush();

    expect(worker.isExited()).toBe(true);
    expect(onExit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 134 }),
    );
    // The host (this test process) is still running.
  });
});

// --- 6. Infinite loop - heartbeat kills worker ------------------------------

describe('Sandbox Escape: infinite loop', () => {
  /**
   * Fake child that never responds to heartbeats, simulating an extension
   * stuck in an infinite synchronous loop.
   */
  class HungChild implements IUtilityProcessHandle {
    pid = 88888;
    killed = false;
    receivedMessages: unknown[] = [];
    private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
      message: [],
      exit: [],
      spawn: [],
    };

    constructor() {
      setImmediate(() => {
        for (const h of this.listeners.spawn) h(undefined);
      });
    }

    postMessage(msg: unknown): void {
      this.receivedMessages.push(msg);
      // Deliberately do NOT reply to heartbeats. This simulates a worker
      // whose event loop is blocked.
    }

    kill(): boolean {
      this.killed = true;
      setImmediate(() => {
        for (const h of this.listeners.exit) h(null);
      });
      return true;
    }

    on(event: WorkerEventName, handler: WorkerEventListener): void {
      this.listeners[event].push(handler);
    }
  }

  it('heartbeat watchdog kills a hung worker', async () => {
    const onExit = vi.fn();
    let child: HungChild | undefined;
    const factory: IUtilityProcessFactory = {
      fork() {
        child = new HungChild();
        return child;
      },
    };
    const worker = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.hung',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 5,   // 5 ms intervals for fast test
      heartbeatMaxMissed: 2,    // kill after 2 missed
      onExit,
    });
    await worker.spawn();

    // Wait enough for the heartbeat to fire > 2 times with no reply.
    // 200 ms gives 40x headroom over the 5 ms interval even under heavy test load.
    await new Promise((r) => setTimeout(r, 200));
    await flush();

    expect(worker.wasHung()).toBe(true);
    expect(child!.killed).toBe(true);
    expect(onExit).toHaveBeenCalled();
    const exitInfo = onExit.mock.calls[0]![0] as { hung: boolean; killed: boolean };
    expect(exitInfo.hung).toBe(true);
    expect(exitInfo.killed).toBe(true);
  });

  it('worker that replies to heartbeats stays alive', async () => {
    /**
     * A child that echoes heartbeats back, simulating a healthy worker.
     */
    class HealthyChild implements IUtilityProcessHandle {
      pid = 77777;
      killed = false;
      private listeners: Record<WorkerEventName, WorkerEventListener[]> = {
        message: [],
        exit: [],
        spawn: [],
      };

      constructor() {
        setImmediate(() => {
          for (const h of this.listeners.spawn) h(undefined);
        });
      }

      postMessage(msg: unknown): void {
        // Echo heartbeats back.
        if (msg && typeof msg === 'object' && (msg as { kind?: string }).kind === 'heartbeat') {
          setImmediate(() => {
            for (const h of this.listeners.message) h(msg);
          });
        }
      }

      kill(): boolean {
        this.killed = true;
        setImmediate(() => {
          for (const h of this.listeners.exit) h(null);
        });
        return true;
      }

      on(event: WorkerEventName, handler: WorkerEventListener): void {
        this.listeners[event].push(handler);
      }
    }

    const onExit = vi.fn();
    const factory: IUtilityProcessFactory = {
      fork() {
        return new HealthyChild();
      },
    };
    const worker = new ExtensionWorkerProcess(factory, {
      extensionId: 'ext.healthy',
      scriptPath: '/fake/script.js',
      heartbeatIntervalMs: 5,
      heartbeatMaxMissed: 2,
      onExit,
    });
    await worker.spawn();

    // Wait long enough that a hung worker would be killed.
    await new Promise((r) => setTimeout(r, 50));

    // Worker should still be alive.
    expect(worker.wasHung()).toBe(false);
    expect(worker.isExited()).toBe(false);

    // Clean up.
    await worker.terminate();
  });
});

// --- 7. Reserved key prefix bypass attempt -----------------------------------

describe('Sandbox Escape: reserved key bypass', () => {
  it('extension cannot write to __settings. prefix via storage.set', async () => {
    const db = new FakeSql();
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const grant = buildGrant('ext.sneaky', ['storage', 'bible:read']);
    const storage = new StorageApiImpl({
      extensionId: 'ext.sneaky',
      router,
      db,
      grant,
    });
    storage.attach();

    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'storage.set',
      ['__settings.theme', 'dark'],
    );
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error!.message).toContain('reserved prefix');
  });

  it('extension cannot read __settings. prefix via storage.get', async () => {
    const db = new FakeSql();
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const grant = buildGrant('ext.sneaky', ['storage', 'bible:read']);
    const storage = new StorageApiImpl({
      extensionId: 'ext.sneaky',
      router,
      db,
      grant,
    });
    storage.attach();

    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'storage.get',
      ['__settings.apiKey'],
    );
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error!.message).toContain('reserved prefix');
  });
});

// --- 8. Network throttle enforcement -----------------------------------------

describe('Sandbox Escape: throttle enforcement', () => {
  it('extension is throttled after exceeding request budget', async () => {
    const pair = pairedTransports();
    const router = new ExtensionRpcRouter(pair.hostSide);
    const gateway = new FakeGateway();
    const publicDns: DnsResolver = async () => [{ address: '93.184.216.34', family: 4 }];
    const grant = buildGrant('ext.spammer', ['network', 'bible:read']);

    // Set an extremely low throttle limit for testing.
    const net = new NetworkApiImpl({
      extensionId: 'ext.spammer',
      router,
      grant,
      allowedHosts: [{ host: 'api.example.com', purpose: 'test' }],
      gateway,
      dnsResolver: publicDns,
      throttleRequestsPerMinute: 3,
    });
    net.attach();

    // First 3 requests should succeed.
    for (let i = 0; i < 3; i++) {
      const res = await workerCall(
        pair.workerSide,
        pair.hostSent,
        'network.fetch',
        [`https://api.example.com/req${i}`],
      );
      expect(res.error).toBeUndefined();
    }

    // 4th request should be throttled.
    const res = await workerCall(
      pair.workerSide,
      pair.hostSent,
      'network.fetch',
      ['https://api.example.com/req3'],
    );
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error!.message).toContain('throttle exceeded');
  });
});
