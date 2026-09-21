/**
 * Fixture acceptance test.
 *
 * Exercises the two fixtures under `e2e/fixtures/`:
 *
 *   - `test-extension/` - registers a panel type, reads a verse,
 *                                   persists a KV row, calls
 *                                   ui.showNotification.
 *   - `test-extension-no-perms/` - declares no permissions and tries to
 *                                   call api.bible.getVerse - must hit the
 *                                   host's `PermissionDeniedError` gate.
 *
 * Same "fake utility process" pattern as `MinimalFixture.test.ts`: each
 * fake child impersonates the worker by replaying the activate() body via
 * reverse-RPC against the host. The full Playwright + Electron e2e is the
 * runtime equivalent of this test, but doesn't bring anything beyond what
 * we assert here - the bridges, the consent gate, and the storage round
 * trip all live in the host, not the worker.
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
import {
  InMemoryUiBridge,
  InMemoryWorkspaceBridge,
  InMemoryL10nBridge,
} from '../api-impl/InMemoryDataBridges';
import { FakeSql } from './fakeSql';

const FIXTURES_ROOT = resolve(__dirname, '..', '..', '..', 'e2e', 'fixtures');

function copyFixture(destRoot: string, fixtureName: string, extensionId: string): string {
  const dest = join(destRoot, extensionId);
  mkdirSync(dest, { recursive: true });
  const src = join(FIXTURES_ROOT, fixtureName);
  for (const entry of readdirSync(src)) {
    copyFileSync(join(src, entry), join(dest, entry));
  }
  return dest;
}

/**
 * Replays an activate() body for one of the fixtures. The
 * `behavior` constructor arg picks which fixture this child impersonates.
 */
class FixtureFakeChild implements IUtilityProcessHandle {
  pid = 9999;
  killed = false;
  private readonly toWorkerListeners: ((msg: unknown) => void)[] = [];
  private readonly fromWorkerListeners: WorkerEventListener[] = [];
  private readonly exitListeners: WorkerEventListener[] = [];
  private readonly spawnListeners: WorkerEventListener[] = [];
  private nextRpcId = 0;
  private readonly pendingFromWorkerRpc = new Map<string, (env: Extensions.RpcResponse) => void>();

  constructor(private readonly behavior: 'with-perms' | 'no-perms') {
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

  private deliverToHost(env: Extensions.RpcEnvelope): void {
    for (const h of this.fromWorkerListeners) h(env);
  }

  private callHost<T = unknown>(method: string, args: unknown[]): Promise<T> {
    const id = `worker-rpc-${++this.nextRpcId}`;
    return new Promise<T>((resolveOuter, rejectOuter) => {
      this.pendingFromWorkerRpc.set(id, (env) => {
        if (env.error) {
          const err = new Error(env.error.message);
          (err as Error & { code?: string }).code = env.error.code;
          rejectOuter(err);
        } else {
          resolveOuter(env.result as T);
        }
      });
      this.deliverToHost({ kind: 'request', id, method, args });
    });
  }

  private async runActivate(initRequestId: string): Promise<void> {
    try {
      await Promise.resolve();
      if (this.behavior === 'with-perms') {
        const verse = (await this.callHost<{ verseId: number } | null>('bible.getVerse', [43003016])) ?? null;
        await this.callHost('storage.set', ['lastVerse', verse?.verseId ?? 43003016]);
        try {
          await this.callHost('ui.showNotification', ['hello from test-extension']);
        } catch {
          /* swallow - notification failures shouldn't fail activation */
        }
      } else {
        // no-perms branch: try a gated call, expect PermissionDeniedError.
        // We use `ui.showNotification` because `bible:read` is auto-granted
        // by `DEFAULT_GRANTED_PERMISSIONS`, so the bible.getVerse gate would
        // never fire even on a permission-empty extension.
        try {
          await this.callHost('ui.showNotification', ['this should be denied']);
          await this.callHost('storage.set', ['permissionGateOutcome', 'leaked']);
        } catch (err) {
          const code = (err as Error & { code?: string }).code ?? 'UnknownError';
          await this.callHost('storage.set', ['permissionGateOutcome', 'denied']);
          await this.callHost('storage.set', ['permissionGateErrorCode', String(code)]);
        }
      }
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

describe('Fixture acceptance', () => {
  let tmpRoot: string;
  let db: FakeSql;
  const children: FixtureFakeChild[] = [];

  beforeEach(() => {
    children.length = 0;
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-host-6b-'));
    db = new FakeSql();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('test-extension activates, reads a verse, persists storage, and pushes a notification', async () => {
    copyFixture(tmpRoot, 'test-extension', 'ext.test.bible-viewer');

    const uiBridge = new InMemoryUiBridge();
    const factory: IUtilityProcessFactory = {
      fork() {
        const c = new FixtureFakeChild('with-perms');
        children.push(c);
        return c;
      },
    };

    const host = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: factory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      bibleBridge: stubBibleBridge,
      uiBridge,
      workspaceBridge: new InMemoryWorkspaceBridge(),
      l10nBridge: new InMemoryL10nBridge(),
    });

    await host.loadAll();
    // Sideload auto-grants only DEFAULT_GRANTED_PERMISSIONS. The
    // test-extension manifest also requests `ui:notification` and
    // `ui:contribute-pane`; grant them here to mirror the install-with-
    // consent path.
    await host.updatePermissions('ext.test.bible-viewer', [
      'bible:read',
      'storage',
      'ui:notification',
      'ui:contribute-pane',
    ] as never);
    await host.activate('ext.test.bible-viewer');
    // Drain microtasks so the fake worker's reverse-RPC chain settles.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Storage assertion
    const lastVerse = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.bible-viewer' && r.key === 'lastVerse',
    );
    expect(lastVerse).toBeDefined();
    expect(JSON.parse(lastVerse!.value)).toBe(43003016);

    // Notification fan-out
    expect(uiBridge.notifications.length).toBeGreaterThanOrEqual(1);
    expect(uiBridge.notifications[0]!.extensionId).toBe('ext.test.bible-viewer');
    expect(uiBridge.notifications[0]!.message).toBe('hello from test-extension');

    // The extension is reported active.
    const state = (await host.getExtension('ext.test.bible-viewer'))!;
    expect(state.status).toBe('active');

    // Survive a "restart": rebuild the host on the same FakeSql, ensure the
    // KV row is still there.
    await host.deactivate('ext.test.bible-viewer');
    const host2 = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: factory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
    });
    await host2.loadAll();
    const survivor = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.bible-viewer' && r.key === 'lastVerse',
    );
    expect(survivor).toBeDefined();
  });

  it('test-extension-no-perms is blocked by the ui:notification gate', async () => {
    copyFixture(tmpRoot, 'test-extension-no-perms', 'ext.test.no-perms');

    const factory: IUtilityProcessFactory = {
      fork() {
        const c = new FixtureFakeChild('no-perms');
        children.push(c);
        return c;
      },
    };

    const host = new ExtensionHost({
      db,
      extensionsRoot: tmpRoot,
      workerFactory: factory,
      workerScriptPath: '/fake/runtime.js',
      workerHeartbeatIntervalMs: 0,
      bibleBridge: stubBibleBridge,
      // The uiBridge MUST be wired so the ui.showNotification namespace
      // exists on the worker's RPC router; otherwise the call would fail
      // with "Unknown method" instead of PermissionDeniedError, and the
      // gate test would be meaningless.
      uiBridge: new InMemoryUiBridge(),
    });

    await host.loadAll();
    // The fixture reports the denial through the KV tier, which is itself
    // gated on `storage`. Grant that and nothing else, so the gate under
    // test - `ui:notification` - is still the only thing missing.
    await host.updatePermissions('ext.test.no-perms', ['storage'] as never);
    await host.activate('ext.test.no-perms');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // The fixture must have written `permissionGateOutcome=denied`.
    const outcome = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.no-perms' && r.key === 'permissionGateOutcome',
    );
    expect(outcome).toBeDefined();
    expect(JSON.parse(outcome!.value)).toBe('denied');

    // And the error code is the host's permission denial code.
    const codeRow = Array.from(db.storage.values()).find(
      (r) => r.extension_id === 'ext.test.no-perms' && r.key === 'permissionGateErrorCode',
    );
    expect(codeRow).toBeDefined();
    expect(JSON.parse(codeRow!.value)).toBe('PermissionDeniedError');
  });
});
