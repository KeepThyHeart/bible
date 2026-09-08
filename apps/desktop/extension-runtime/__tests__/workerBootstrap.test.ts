/**
 * Regression tests for BUG A (entry-point resolution) and BUG B (host API
 * calls awaited inside `activate()` deadlock), driven through the real
 * protocol bootstrap and the real `ExtensionRuntime`.
 *
 * BUG A: `init()` imported `manifest.main` verbatim. `"./main.js"` resolved
 * against the runtime bundle in `out/main/extension-runtime/`, never against
 * the extension's install directory, so no on-disk extension could load.
 *
 * Resolution lives outside the runtime entirely - the runtime has no
 * filesystem inside the QuickJS realm - so the fix lives in the
 * supervisor's `readEntryBundle`, and that is what these cases exercise. The
 * containment property is unchanged and still the point: it is checked on the
 * *resolved* path at the point of use, whether that use is `import()` (before)
 * or `readFileSync` (now).
 *
 * BUG B: the entry script queued EVERY envelope until `isInitialized`, which
 * is only set after `await runtime.init(payload)` - and `init()` awaits
 * `activate()`. So the response to any RPC an extension awaited inside
 * `activate()` sat in the queue until the 5 s activate timeout fired and the
 * worker was killed with exit 1. Calling a host API during activation is the
 * normal thing an extension does.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Extensions } from '@bible/core';

import { bootstrap } from '../bootstrap';
import { ExtensionRuntime } from '../runtime';
import { readEntryBundle } from '../index';
import type { IRpcChannel } from '../apiProxy';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

const INSTALL = resolve('/ext-root/ext.test.sample');

function payload(over: Partial<Extensions.ExtensionInitPayload> = {}): Extensions.ExtensionInitPayload {
  return {
    manifest: {
      id: 'ext.test.sample',
      name: { key: 'ext.test.sample' },
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: './main.js',
    },
    installPath: INSTALL,
    grantedPermissions: ['bible:read', 'storage'],
    hostApiVersion: '1.0.0',
    hostMinSupportedApiVersion: '1.0.0',
    locale: 'en',
    hostFeatures: [],
    ...over,
  };
}

function makeChannel(): { channel: IRpcChannel; sent: RpcEnvelope[] } {
  const sent: RpcEnvelope[] = [];
  return {
    sent,
    channel: {
      send(env) {
        sent.push(env);
      },
      onMessage() {
        /* runtime drives dispatch directly */
      },
    },
  };
}

// --- Bug A ------------------------------------------------------------------

describe('extension entry-point resolution (bug A)', () => {
  it('hands the loader the init payload, not a bare relative specifier', async () => {
    const { channel } = makeChannel();
    const moduleLoader = vi.fn(async (_payload: Extensions.ExtensionInitPayload) => ({
      activate: () => {},
    }));
    const runtime = new ExtensionRuntime({ channel, moduleLoader });

    await runtime.init(payload());

    expect(moduleLoader).toHaveBeenCalledTimes(1);
    // Resolving against the runtime bundle's own directory is the failure mode.
    // The runtime resolves nothing itself - it passes the payload, which
    // carries the install directory, to whoever can.
    expect(moduleLoader.mock.calls[0]![0].installPath).toBe(INSTALL);
    expect(moduleLoader.mock.calls[0]![0].manifest.main).toBe('./main.js');
  });

  it('reports a loader failure to the host as module-load', async () => {
    const { channel, sent } = makeChannel();
    const moduleLoader = vi.fn(async () => {
      throw new Error('manifest.main "../../evil.js" resolves outside the extension directory');
    });
    const runtime = new ExtensionRuntime({ channel, moduleLoader });

    await expect(runtime.init(payload())).rejects.toThrow(/resolves outside/);

    const errEvent = sent.find(
      (e) => e.kind === 'event' && e.channel === '__runtime.error',
    ) as Extensions.RpcEvent | undefined;
    expect(errEvent).toBeDefined();
    expect((errEvent!.payload as { source: string }).source).toBe('module-load');
  });

  it('refuses to read a manifest.main that escapes the install directory', () => {
    // The containment check is the security-relevant half of bug A and now
    // lives where the filesystem does. `../../../../evil.js` resolves cleanly
    // on every OS, so validating the *authored* string is not sufficient.
    expect(() =>
      readEntryBundle(
        payload({ manifest: { ...payload().manifest, main: '../../../../evil.js' } }),
      ),
    ).toThrow(/resolves outside the extension directory/);
  });

  it('reads the real entry file from disk, resolved against installPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ext-entry-'));
    try {
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'lib', 'main.js'),
        'exports.activate = function () { return "activated"; };\n',
        'utf8',
      );

      const bundle = readEntryBundle(
        payload({
          installPath: resolve(dir),
          manifest: { ...payload().manifest, main: './lib/main.js' },
        }),
      );
      expect(bundle.source).toContain('exports.activate');
      // The filename is what shows up in guest stack traces, so it must name
      // the extension rather than a host path.
      expect(bundle.filename).toBe('ext.test.sample/main.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a data: URL entry without touching the filesystem', () => {
    const source = 'exports.activate = function () {};';
    const bundle = readEntryBundle(
      payload({
        manifest: {
          ...payload().manifest,
          main: `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
        },
      }),
    );
    expect(bundle.source).toBe(source);
  });
});

// --- Bug B ------------------------------------------------------------------

/** In-memory parentPort that records what the worker posts back to the host. */
function makeParentPort(): {
  port: { postMessage(msg: unknown): void; on(e: 'message', h: (m: unknown) => void): void };
  posted: RpcEnvelope[];
  deliver: (env: RpcEnvelope) => void;
} {
  const posted: RpcEnvelope[] = [];
  let handler: ((m: unknown) => void) | null = null;
  return {
    posted,
    port: {
      postMessage(msg: unknown) {
        posted.push(msg as RpcEnvelope);
      },
      on(_e, h) {
        handler = h;
      },
    },
    deliver(env) {
      handler?.(env);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('worker entry pre-init envelope handling (bug B)', () => {
  it('dispatches RPC responses during activate() so an awaited host call resolves', async () => {
    const pp = makeParentPort();
    let verse: unknown;

    bootstrap(pp.port, {
      // The normal thing an extension does: await a host API in activate().
      moduleLoader: async () => ({
        activate: async (api) => {
          verse = await api.bible.getVerse(43003016);
        },
      }),
      activateTimeoutMs: 2000,
    });

    pp.deliver({ kind: 'request', id: 'host-init', method: 'runtime.init', args: [payload()] });
    await tick();

    // The worker issued the getVerse request while still inside activate().
    const req = pp.posted.find(
      (e) => e.kind === 'request' && (e as RpcRequest).method === 'bible.getVerse',
    ) as RpcRequest | undefined;
    expect(req, 'activate() should have issued bible.getVerse').toBeDefined();

    // Before the fix this response was queued behind `isInitialized` and never
    // dispatched, so activate() hung until the timeout killed the worker.
    pp.deliver({ kind: 'response', id: req!.id, result: { verseId: 43003016, text: 'For God...' } });
    await tick();
    await tick();

    expect(verse).toMatchObject({ verseId: 43003016 });

    const ack = pp.posted.find(
      (e) => e.kind === 'response' && (e as RpcResponse).id === 'host-init',
    ) as RpcResponse | undefined;
    expect(ack, 'init should have acked successfully').toBeDefined();
    expect(ack!.error).toBeUndefined();
    expect(ack!.result).toEqual({ ok: true });
  });

  it('echoes heartbeats received while activate() is still running', async () => {
    const pp = makeParentPort();
    let release = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });

    bootstrap(pp.port, {
      moduleLoader: async () => ({ activate: () => blocked }),
      activateTimeoutMs: 5000,
    });

    pp.deliver({ kind: 'request', id: 'host-init', method: 'runtime.init', args: [payload()] });
    await tick();

    pp.deliver({ kind: 'heartbeat', ts: 123 });
    await tick();

    // A queued heartbeat would make the host's worker wrapper declare the
    // worker hung mid-activation and SIGKILL it.
    expect(pp.posted.some((e) => e.kind === 'heartbeat')).toBe(true);

    release();
    await tick();
  });

  it('still queues events and reverse requests until activate() has registered handlers', async () => {
    const pp = makeParentPort();
    const eventHandler = vi.fn();
    let release = () => {};
    const blocked = new Promise<void>((r) => {
      release = r;
    });

    const runtime = bootstrap(pp.port, {
      moduleLoader: async () => ({
        activate: async (api) => {
          await api.bible.onDidChangeActiveVerse.subscribe(eventHandler);
          await blocked;
        },
      }),
      activateTimeoutMs: 5000,
    });
    runtime.registerReverseHandler('commands.execute', (args) => `ran:${String(args[0])}`);

    pp.deliver({ kind: 'request', id: 'host-init', method: 'runtime.init', args: [payload()] });
    await tick();

    // Both arrive mid-activation.
    pp.deliver({ kind: 'event', channel: 'bible.onDidChangeActiveVerse', payload: { verseId: 1 } });
    pp.deliver({ kind: 'request', id: 'host-cmd', method: 'commands.execute', args: ['greet'] });
    await tick();

    expect(eventHandler).not.toHaveBeenCalled();
    expect(pp.posted.some((e) => e.kind === 'response' && (e as RpcResponse).id === 'host-cmd')).toBe(
      false,
    );

    release();
    await tick();
    await tick();

    // Replayed once the extension is ready for them.
    expect(eventHandler).toHaveBeenCalledWith({ verseId: 1 });
    const cmdRes = pp.posted.find(
      (e) => e.kind === 'response' && (e as RpcResponse).id === 'host-cmd',
    ) as RpcResponse | undefined;
    expect(cmdRes?.result).toBe('ran:greet');
  });
});
