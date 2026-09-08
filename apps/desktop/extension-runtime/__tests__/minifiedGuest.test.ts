/**
 * @vitest-environment node
 *
 * The guest bundle as production actually ships it - minified.
 *
 * Every other realm test builds the bundle unminified, on purpose: a failing
 * assertion is far easier to read against source than against `a=>b(c,d)`. But
 * `electron.vite.config.ts` sets `minify: true`, so the artifact that runs in
 * a packaged app is one esbuild pass further along than the one under test,
 * and nothing was checking that pass.
 *
 * That matters most for `binaryCodec.ts`, which is the newest code in the
 * bundle and the part that leans on details a minifier rewrites - property
 * shorthand, computed keys built from constants, and `constructor` identity
 * comparisons against the typed-array globals. The packaged e2e
 * (`extension-host-asar.spec.ts`) is the only other place the minified bundle
 * runs, and it cannot see binary payloads.
 *
 * These are deliberately a thin slice, not a duplicate of the whole realm
 * suite: enough to prove the minified artifact boots, marshals binary both
 * ways, and keeps the realm sealed.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { resolve } from 'path';

import type { Extensions } from '@bible/core';
import { QuickJSRealm } from '../host/QuickJSRealm';
import { buildGuestBundle } from './guestBundle';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;

let minifiedBundle: string;

beforeAll(async () => {
  minifiedBundle = await buildGuestBundle({ minify: true });
}, 60_000);

const realms: QuickJSRealm[] = [];
afterEach(() => {
  while (realms.length) realms.pop()!.dispose();
});

interface Driver {
  sent: RpcEnvelope[];
  requests(): RpcRequest[];
  settle(handlers: Record<string, (args: unknown[]) => unknown>): void;
}

async function drive(entrySource: string): Promise<Driver> {
  const sent: RpcEnvelope[] = [];
  const realm = await QuickJSRealm.create({
    extensionId: 'ext.test.minified',
    guestBundleSource: minifiedBundle,
    loadEntryBundle: () => ({ source: entrySource, filename: 'ext.test.minified/main.js' }),
    onSend: (env) => sent.push(env as RpcEnvelope),
    onLog: () => {},
    onFatal: () => {},
  });
  realms.push(realm);

  realm.deliver({
    kind: 'request',
    id: 'host-init',
    method: 'runtime.init',
    args: [
      {
        manifest: {
          id: 'ext.test.minified',
          name: { key: 'ext.test.minified' },
          version: '1.0.0',
          publisher: 'test',
          engines: { bibleApp: '^1.0.0' },
          main: './main.js',
        },
        installPath: resolve('/ext-root/ext.test.minified'),
        grantedPermissions: ['bible:read'],
        hostApiVersion: '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: 'en',
        hostFeatures: [],
      },
    ],
  });

  const answered = new Set<string>();
  return {
    sent,
    requests: () => sent.filter((e): e is RpcRequest => e.kind === 'request'),
    settle(handlers) {
      for (let round = 0; round < 50; round++) {
        const outstanding = sent.filter(
          (e): e is RpcRequest => e.kind === 'request' && !answered.has(e.id),
        );
        if (outstanding.length === 0) return;
        for (const req of outstanding) {
          answered.add(req.id);
          const handler = handlers[req.method];
          realm.deliver(
            handler
              ? { kind: 'response', id: req.id, result: handler(req.args) }
              : {
                  kind: 'response',
                  id: req.id,
                  error: { code: 'RpcProtocolError', message: `Unknown: ${req.method}` },
                },
          );
        }
      }
      throw new Error('guest did not settle after 50 rounds');
    },
  };
}

describe('the minified guest bundle behaves like the readable one', () => {
  it('boots and activates an extension', async () => {
    const d = await drive(`
      exports.activate = function (api) { return api.bible.__probe('activated'); };
    `);
    d.settle({ 'bible.__probe': (args) => args[0] });

    expect(d.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toBe('activated');
    const ack = d.sent.find((e) => e.kind === 'response' && e.id === 'host-init');
    expect((ack as Extensions.RpcResponse | undefined)?.error).toBeUndefined();
  });

  it('round-trips binary through the minified codec, byte for byte', async () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 41 + 3) & 0xff;

    const d = await drive(`
      exports.activate = function (api) {
        return api.storage.readFile('in.bin').then(function (bytes) {
          return api.storage.writeFile('out.bin', bytes);
        });
      };
    `);
    d.settle({
      'storage.readFile': () => original,
      'storage.writeFile': () => undefined,
    });

    const echoed = d.requests().find((r) => r.method === 'storage.writeFile')?.args[1];
    expect(echoed).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(echoed as Uint8Array).equals(Buffer.from(original))).toBe(true);
  });

  it('still keeps ArrayBuffer distinct from Uint8Array after minification', async () => {
    // The codec picks a tag by comparing `constructor` against the typed-array
    // globals. Minification renames locals freely, so this is the assertion
    // that would catch a rename that broke that comparison.
    const d = await drive(`
      exports.activate = function (api) {
        return api.storage.readFile('x').then(function (buf) {
          return api.bible.__probe(Object.prototype.toString.call(buf));
        });
      };
    `);
    d.settle({
      'storage.readFile': () => new Uint8Array([1, 2, 3]).buffer,
      'bible.__probe': (args) => args[0],
    });

    expect(d.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toBe(
      '[object ArrayBuffer]',
    );
  });

  it('leaves the realm sealed', async () => {
    const d = await drive(`
      exports.activate = function (api) {
        var escaped;
        try { escaped = Function('return this')(); } catch (e) { escaped = {}; }
        return api.bible.__probe({
          process: typeof process,
          fetch: typeof fetch,
          escapedProcess: typeof escaped.process,
        });
      };
    `);
    d.settle({ 'bible.__probe': (args) => args[0] });

    expect(d.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toEqual({
      process: 'undefined',
      fetch: 'undefined',
      escapedProcess: 'undefined',
    });
  });
});
