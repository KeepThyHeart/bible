/**
 * @vitest-environment node
 *
 * Node, not the suite-wide jsdom - see the note in `QuickJSRealm.test.ts`.
 */

/**
 * Supervisor integration - the whole worker side, end to end.
 *
 * `QuickJSRealm.test.ts` drives the realm directly with a synthetic entry
 * bundle. This drives `startSupervisor` instead: a real extension directory on
 * disk, the real entry resolution and file read, the real realm, and the real
 * protocol over an in-memory `parentPort`. Everything between the host's
 * `postMessage` and the extension's `activate()` is under test, which is
 * exactly the seam the engine swap moved.
 *
 * The one thing it cannot cover is `utilityProcess.fork()` from inside
 * `app.asar` - that is what `e2e/tests/extension-host-asar.spec.ts` is for.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Extensions } from '@bible/core';
import { startSupervisor } from '../index';
import { buildGuestBundle } from './guestBundle';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

let guestBundle: string;
beforeAll(async () => {
  guestBundle = await buildGuestBundle();
}, 60_000);

const tmpDirs: string[] = [];
const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length) teardowns.pop()!();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** Write a one-file extension to disk and return its install directory. */
function writeExtension(source: string, main = './main.js'): string {
  const root = mkdtempSync(join(tmpdir(), 'ext-supervisor-'));
  tmpDirs.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  const target = main.replace(/^\.\//, '');
  writeFileSync(join(root, target), source, 'utf8');
  return root;
}

interface Driver {
  posted: RpcEnvelope[];
  deliver(env: RpcEnvelope): void;
  ready: Promise<unknown>;
  /** Answer outbound requests until the extension goes quiet. */
  settle(handlers: Record<string, (args: unknown[]) => unknown>): void;
  fatals: string[];
}

function startDriver(): Driver {
  const posted: RpcEnvelope[] = [];
  const fatals: string[] = [];
  let onMessage: ((msg: unknown) => void) | undefined;

  const port = {
    postMessage(msg: unknown) {
      posted.push(msg as RpcEnvelope);
    },
    on(_event: 'message', handler: (msg: unknown) => void) {
      onMessage = handler;
    },
  };

  const supervisor = startSupervisor(port, {
    guestBundleSource: guestBundle,
    onFatal: (message) => fatals.push(message),
  });
  teardowns.push(() => supervisor.dispose());

  const answered = new Set<string>();
  const deliver = (env: RpcEnvelope): void => onMessage?.(env);

  return {
    posted,
    fatals,
    deliver,
    ready: supervisor.ready,
    settle(handlers) {
      for (let round = 0; round < 50; round++) {
        const outstanding = posted.filter(
          (e): e is RpcRequest => e.kind === 'request' && !answered.has(e.id),
        );
        if (outstanding.length === 0) return;
        for (const req of outstanding) {
          answered.add(req.id);
          const handler = handlers[req.method];
          deliver(
            handler
              ? { kind: 'response', id: req.id, result: handler(req.args) }
              : {
                  kind: 'response',
                  id: req.id,
                  error: { code: 'RpcProtocolError', message: `Unknown RPC method: ${req.method}` },
                },
          );
        }
      }
      throw new Error('extension did not settle after 50 rounds');
    },
  };
}

function initFor(installPath: string, main = './main.js'): RpcEnvelope {
  return {
    kind: 'request',
    id: 'host-init',
    method: 'runtime.init',
    args: [
      {
        manifest: {
          id: 'ext.test.supervised',
          name: { key: 'ext.test.supervised' },
          version: '1.0.0',
          publisher: 'test',
          engines: { bibleApp: '^1.0.0' },
          main,
        },
        installPath,
        grantedPermissions: ['bible:read'],
        hostApiVersion: '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: 'en',
        hostFeatures: [],
      },
    ],
  };
}

function ack(posted: RpcEnvelope[]): RpcResponse | undefined {
  return posted.find((e) => e.kind === 'response' && e.id === 'host-init') as
    | RpcResponse
    | undefined;
}

describe('supervisor loads a real on-disk extension into a realm', () => {
  it('reads the entry from disk, activates it, and round-trips an RPC', async () => {
    const install = writeExtension(`
      module.exports = {
        async activate(api) {
          const verse = await api.bible.getVerse(43003016);
          await api.storage.set('lastVerse', verse.verseId);
        },
      };
    `);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install));
    d.settle({
      'bible.getVerse': () => ({ verseId: 43003016, text: 'For God so loved the world' }),
      'storage.set': () => undefined,
    });

    expect(ack(d.posted)?.error).toBeUndefined();
    const stored = d.posted.find(
      (e): e is RpcRequest => e.kind === 'request' && e.method === 'storage.set',
    );
    expect(stored?.args).toEqual(['lastVerse', 43003016]);
  });

  it('honours a nested manifest.main', async () => {
    const install = writeExtension(
      `module.exports = { activate(api) { return api.bible.__probe('nested-ok'); } };`,
      './src/main.js',
    );
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install, './src/main.js'));
    d.settle({ 'bible.__probe': (args) => args[0] });

    expect(ack(d.posted)?.error).toBeUndefined();
  });

  it('echoes heartbeats, so the host does not declare the worker hung', async () => {
    const install = writeExtension(`module.exports = { activate() {} };`);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install));
    d.settle({});
    d.deliver({ kind: 'heartbeat', ts: 1234 });

    // Liveness still measures the *guest*, not the supervisor: the heartbeat is
    // forwarded into the realm and echoed from there. A wedged guest is caught
    // by the interrupt deadline first, but this keeps the outer watchdog honest.
    expect(d.posted.some((e) => e.kind === 'heartbeat')).toBe(true);
  });

  it("forwards the extension's console output to the host as __runtime.log", async () => {
    const install = writeExtension(`
      module.exports = { activate() { console.log('hello from', { inside: 'the realm' }); } };
    `);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install));
    d.settle({});

    // The realm has no stdio, and the worker's stdout was never captured, so
    // without this channel an extension author's `console.log` goes nowhere.
    const logEvent = d.posted.find(
      (e) => e.kind === 'event' && e.channel === '__runtime.log',
    ) as Extensions.RpcEvent | undefined;
    expect(logEvent).toBeDefined();
    const payload = logEvent!.payload as { level: string; message: string };
    expect(payload.level).toBe('log');
    expect(payload.message).toContain('hello from');
    expect(payload.message).toContain('the realm');
  });

  it('truncates a log flood rather than passing it to the host verbatim', async () => {
    const install = writeExtension(`
      module.exports = { activate() { console.log('x'.repeat(200000)); } };
    `);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install));
    d.settle({});

    const logEvent = d.posted.find(
      (e) => e.kind === 'event' && e.channel === '__runtime.log',
    ) as Extensions.RpcEvent | undefined;
    const message = (logEvent!.payload as { message: string }).message;
    // The payload is attacker-controlled and ends up on disk in extension.log.
    expect(message.length).toBeLessThanOrEqual(4_000);
  });

  // -- The property the whole track exists for -----------------------------

  it('denies an extension that reaches for a Node built-in', async () => {
    // Pre-sandbox this is precisely what `asar-probe-extension` did, and it
    // worked: extensions ran in the supervisor's own Node process, so `fs` was
    // one call away and a hostile extension could write anywhere the user could.
    const install = writeExtension(`
      const fs = require('fs');
      module.exports = { activate() { fs.writeFileSync('pwned.txt', 'x'); } };
    `);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install));
    d.settle({});

    const failure = ack(d.posted);
    expect(failure?.error).toBeDefined();
    expect(failure!.error!.message).toMatch(/Cannot require\('fs'\)/);
    expect(d.fatals.length).toBeGreaterThan(0);
  });

  it('refuses a manifest.main that escapes the install directory', async () => {
    const install = writeExtension(`module.exports = { activate() {} };`);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install, '../../../../evil.js'));
    d.settle({});

    const failure = ack(d.posted);
    expect(failure?.error).toBeDefined();
    expect(failure!.error!.message).toMatch(/resolves outside the extension directory/);
  });

  it('reports a missing entry file as a module-load failure, not a crash', async () => {
    const install = writeExtension(`module.exports = { activate() {} };`);
    const d = startDriver();
    await d.ready;

    d.deliver(initFor(install, './does-not-exist.js'));
    d.settle({});

    const failure = ack(d.posted);
    expect(failure?.error).toBeDefined();
    const runtimeErrors = d.posted.filter(
      (e) => e.kind === 'event' && e.channel === '__runtime.error',
    );
    expect(
      runtimeErrors.some(
        (e) => ((e as Extensions.RpcEvent).payload as { source: string }).source === 'module-load',
      ),
    ).toBe(true);
  });

  it('queues envelopes that arrive before the realm has finished loading', async () => {
    const install = writeExtension(`
      module.exports = { activate(api) { return api.bible.__probe('late-init'); } };
    `);
    const d = startDriver();

    // Deliberately do NOT await `ready` - the host posts init as soon as it has
    // forked, which in practice beats the WASM module's ~13 ms load.
    d.deliver(initFor(install));
    await d.ready;
    d.settle({ 'bible.__probe': (args) => args[0] });

    expect(ack(d.posted)?.error).toBeUndefined();
  });
});
