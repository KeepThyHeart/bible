/**
 * Minimal fixture acceptance test.
 *
 * Copies `e2e/fixtures/minimal-extension/` into a temp extensions root,
 * boots the host with a fake worker that simulates the runtime calling
 * `api.bible.getVerse(43003016)` and `api.storage.set('lastVerse', ...)`
 * via reverse-RPC, then asserts the storage row landed in the (fake) DB.
 *
 * This is the "unit-or-light-e2e" half of the acceptance criterion. The full
 * Playwright fixture e2e requires building the desktop app and rebuilding
 * native modules, both of which are gated on
 * `npm run build` + `npx electron-rebuild` per
 * `apps/desktop/e2e/README.md`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Extensions } from '@bible/core';

import { ExtensionHost } from '../ExtensionHost';
import {
  type IUtilityProcessFactory,
  type IUtilityProcessHandle,
  type WorkerEventListener,
  type WorkerEventName,
} from '../ExtensionWorkerProcess';
import { FakeSql } from './fakeSql';

const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'minimal-extension');

function copyFixture(destRoot: string): string {
  const dest = join(destRoot, 'ext.test.minimal');
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(FIXTURE_ROOT)) {
    copyFileSync(join(FIXTURE_ROOT, entry), join(dest, entry));
  }
  return dest;
}

/**
 * Fake worker that mimics what a real `extension-runtime/index.js` would do
 * for the minimal fixture: on `runtime.init`, fire reverse RPCs to call
 * `bible.getVerse(43003016)` and `storage.set('lastVerse', 43003016)`,
 * then ack the init.
 */
/**
 * Fake worker that:
 *   1. On `runtime.init` arrival, kicks off an activate() body that calls
 *      `bible.getVerse(43003016)` and `storage.set('lastVerse', ...)` via
 *      forward-from-worker RPC into the host.
 *   2. Acks the init once activate() finishes.
 *
 * Two channels matter here:
 *   - host->worker traffic arrives at `postMessage()` (the wrapper calls
 *     `handle.postMessage(envelope)`).
 *   - worker->host traffic is delivered by invoking every listener registered
 *     via `handle.on('message', listener)`. The wrapper installs its own
 *     listener that forwards to `ExtensionRpcRouter.onMessage`.
 */
class MinimalFakeChild implements IUtilityProcessHandle {
  pid = 9999;
  killed = false;
  private readonly toWorkerListeners: ((msg: unknown) => void)[] = [];
  private readonly fromWorkerListeners: WorkerEventListener[] = [];
  private readonly exitListeners: WorkerEventListener[] = [];
  private readonly spawnListeners: WorkerEventListener[] = [];
  private nextRpcId = 0;
  private readonly pendingFromWorkerRpc = new Map<string, (env: Extensions.RpcResponse) => void>();

  constructor() {
    // Listen to host->worker traffic so we can fan out the runtime.init
    // request to our own activate routine and reply to host responses.
    this.toWorkerListeners.push((msg) => {
      const env = msg as Extensions.RpcEnvelope;
      if (!env || typeof env !== 'object') return;
      if (env.kind === 'request' && env.method === 'runtime.init') {
        void this.runActivate(env.id);
        return;
      }
      if (env.kind === 'response') {
        const handler = this.pendingFromWorkerRpc.get(env.id);
        if (handler) {
          this.pendingFromWorkerRpc.delete(env.id);
          handler(env);
        }
      }
    });
    setImmediate(() => {
      for (const h of this.spawnListeners) h(undefined);
    });
  }

  postMessage(msg: unknown): void {
    for (const l of this.toWorkerListeners) l(msg);
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      for (const h of this.exitListeners) h(0);
    });
    return true;
  }

  on(event: WorkerEventName, handler: WorkerEventListener): void {
    if (event === 'message') this.fromWorkerListeners.push(handler);
    else if (event === 'exit') this.exitListeners.push(handler);
    else if (event === 'spawn') this.spawnListeners.push(handler);
  }

  /** Worker-side helper: post a message *into* the host. */
  private deliverToHost(env: Extensions.RpcEnvelope): void {
    for (const h of this.fromWorkerListeners) h(env);
  }

  /** Worker-side reverse-RPC: send a request to the host and await its response. */
  private callHost<T = unknown>(method: string, args: unknown[]): Promise<T> {
    const id = `worker-rpc-${++this.nextRpcId}`;
    return new Promise<T>((resolveOuter, rejectOuter) => {
      this.pendingFromWorkerRpc.set(id, (env) => {
        if (env.error) rejectOuter(new Error(env.error.message));
        else resolveOuter(env.result as T);
      });
      this.deliverToHost({ kind: 'request', id, method, args });
    });
  }

  private async runActivate(initRequestId: string): Promise<void> {
    try {
      // Yield once so the host has finished wiring its api-impls before we
      // start firing reverse RPCs.
      await Promise.resolve();
      const verse = (await this.callHost<{ verseId: number } | null>('bible.getVerse', [
        43003016,
      ])) ?? null;
      const lastVerseValue = verse?.verseId ?? 43003016;
      await this.callHost('storage.set', ['lastVerse', lastVerseValue]);

      this.deliverToHost({ kind: 'response', id: initRequestId, result: { ok: true } });
    } catch (err) {
      this.deliverToHost({
        kind: 'response',
        id: initRequestId,
        error: {
          code: 'Error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

const children: MinimalFakeChild[] = [];
const fakeFactory: IUtilityProcessFactory = {
  fork() {
    const c = new MinimalFakeChild();
    children.push(c);
    return c;
  },
};

describe('Minimal fixture acceptance', () => {
  let tmpRoot: string;
  let host: ExtensionHost;
  let db: FakeSql;

  beforeEach(() => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-fixture-'));
    copyFixture(tmpRoot);
    db = new FakeSql();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('the minimal fixture extension manifest validates', async () => {
    host = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host.loadAll();
    const list = await host.listExtensions();
    expect(list).toHaveLength(1);
    expect(list[0]!.manifest.id).toBe('ext.test.minimal');
    expect(list[0]!.manifest.engines.bibleApp).toBe('^1.0.0');
  });

  it('activating the fixture writes lastVerse=43003016 into extension_storage', async () => {
    // The fixture is activated through a stub BibleBridge that returns the
    // expected verse - we don't need the full production bridge here.
    const stubBibleBridge = {
      getVerse: (id: number) => ({ verseId: id, text: 'For God so loved the world' }),
      getRange: () => [],
      listModules: () => [],
      listBooks: () => [],
      listChapters: () => [],
      parseReference: () => null,
      subscribeActiveVerse: () => () => {},
      iterateVerses: () => ({ verses: [], hasMore: false }),
      getVerseTokens: () => null,
      subscribeWordSelection: () => () => {},
      navigateToVerse: async () => {},
    };
    host = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      bibleBridge: stubBibleBridge,
    });
    await host.loadAll();
    // Sideloading auto-grants only DEFAULT_GRANTED_PERMISSIONS; the fixture's
    // `storage.set` needs `storage`, which the user would grant from the
    // Extensions UI (or the install consent dialog).
    await host.updatePermissions('ext.test.minimal', ['bible:read', 'storage'] as never);

    await host.activate('ext.test.minimal');

    // Drain microtasks so the fake worker's reverse-RPC chain settles.
    await new Promise((r) => setImmediate(r));

    // The fake worker called storage.set('lastVerse', 43003016) on init.
    const row = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.minimal' && r.key === 'lastVerse',
    );
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toBe(43003016);

    const state = (await host.getExtension('ext.test.minimal'))!;
    expect(state.status).toBe('active');

    // Acceptance: after restart, the storage row still exists.
    // Restart simulation: rebuild the host against the same FakeSql, ensure
    // the persisted row survives a fresh `loadAll`.
    await host.deactivate('ext.test.minimal');
    const host2 = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: fakeFactory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host2.loadAll();
    const survivor = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.minimal' && r.key === 'lastVerse',
    );
    expect(survivor).toBeDefined();
  });
});
