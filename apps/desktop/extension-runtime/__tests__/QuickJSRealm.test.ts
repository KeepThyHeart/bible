/**
 * @vitest-environment node
 *
 * Node, not the suite-wide jsdom: esbuild (which builds the guest bundle here)
 * asserts `new TextEncoder().encode('') instanceof Uint8Array`, and jsdom's
 * cross-realm typed arrays make that false. Nothing here touches the DOM.
 */

/**
 * Acceptance - an extension runs end-to-end inside the QuickJS realm.
 *
 * The de-risking question was whether the existing runtime (apiProxy,
 * eventEmitter, bootstrap, the promise-over-RPC-id correlation and the
 * subscription model) survives being moved inside a WASM interpreter without
 * changing the `api.*` contract. These cases answer it against the real
 * `packages/word-count-example`, unmodified: it awaits a host API during
 * `activate()`, subscribes to an event, and does async work in the handler.
 *
 * The security cases are the other half. They are written against what an
 * attacker would actually try rather than against the implementation, so they
 * keep their meaning if the internals change.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { Extensions } from '@bible/core';
import { QuickJSRealm, type QuickJSRealmOpts } from '../host/QuickJSRealm';
import { buildGuestBundle } from './guestBundle';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;

const WORD_COUNT_MAIN = resolve(__dirname, '../../../../packages/word-count-example/src/main.js');

let guestBundle: string;

beforeAll(async () => {
  guestBundle = await buildGuestBundle();
}, 60_000);

// --- Harness -----------------------------------------------------------------

interface Harness {
  realm: QuickJSRealm;
  sent: RpcEnvelope[];
  logs: { level: string; args: unknown[] }[];
  violations: { kind: string; detail: string }[];
  fatals: string[];
  /** Answer outbound requests with `handlers` until the guest goes quiet. */
  settle(handlers: Record<string, (args: unknown[]) => unknown>): void;
  requests(): RpcRequest[];
  runtimeErrors(): { source: string; message: string }[];
}

async function makeHarness(
  entrySource: string,
  over: Partial<QuickJSRealmOpts> = {},
): Promise<Harness> {
  const sent: RpcEnvelope[] = [];
  const logs: { level: string; args: unknown[] }[] = [];
  const violations: { kind: string; detail: string }[] = [];
  const fatals: string[] = [];

  const realm = await QuickJSRealm.create({
    extensionId: 'ext.test.realm',
    guestBundleSource: guestBundle,
    loadEntryBundle: () => ({ source: entrySource, filename: 'ext.test.realm/main.js' }),
    onSend: (env) => sent.push(env as RpcEnvelope),
    onLog: (level, args) => logs.push({ level, args }),
    onFatal: (message) => fatals.push(message),
    onResourceViolation: (kind, detail) => violations.push({ kind, detail }),
    ...over,
  });

  const answered = new Set<string>();

  return {
    realm,
    sent,
    logs,
    violations,
    fatals,
    requests: () => sent.filter((e): e is RpcRequest => e.kind === 'request'),
    runtimeErrors: () =>
      sent
        .filter((e) => e.kind === 'event' && e.channel === '__runtime.error')
        .map((e) => (e as Extensions.RpcEvent).payload as { source: string; message: string }),
    settle(handlers) {
      // The guest issues requests, awaits them, and issues more from the
      // continuation, so answering is a fixpoint loop rather than one pass.
      for (let round = 0; round < 50; round++) {
        const outstanding = sent.filter(
          (e): e is RpcRequest => e.kind === 'request' && !answered.has(e.id),
        );
        if (outstanding.length === 0) return;
        for (const req of outstanding) {
          answered.add(req.id);
          const handler = handlers[req.method];
          if (!handler) {
            realm.deliver({
              kind: 'response',
              id: req.id,
              error: { code: 'RpcProtocolError', message: `Unknown RPC method: ${req.method}` },
            });
            continue;
          }
          try {
            realm.deliver({ kind: 'response', id: req.id, result: handler(req.args) });
          } catch (err) {
            realm.deliver({
              kind: 'response',
              id: req.id,
              error: { code: 'Error', message: String(err) },
            });
          }
        }
      }
      throw new Error('guest did not settle after 50 rounds');
    },
  };
}

function initEnvelope(over: Partial<Extensions.ExtensionInitPayload> = {}): RpcEnvelope {
  return {
    kind: 'request',
    id: 'host-init',
    method: 'runtime.init',
    args: [
      {
        manifest: {
          id: 'ext.test.realm',
          name: { key: 'ext.test.realm' },
          version: '1.0.0',
          publisher: 'test',
          engines: { bibleApp: '^1.0.0' },
          main: './main.js',
        },
        installPath: resolve('/ext-root/ext.test.realm'),
        grantedPermissions: ['bible:read'],
        hostApiVersion: '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: 'en',
        hostFeatures: [],
        ...over,
      },
    ],
  };
}

const realms: QuickJSRealm[] = [];
afterEach(() => {
  while (realms.length) realms.pop()!.dispose();
});
function track(h: Harness): Harness {
  realms.push(h.realm);
  return h;
}

// --- 1. The real reference extension, unmodified -----------------------------

describe('word-count runs end-to-end inside the realm', () => {
  it('activates, awaits a host API during activate(), and subscribes to an event', async () => {
    const h = track(await makeHarness(readFileSync(WORD_COUNT_MAIN, 'utf8')));

    h.realm.deliver(initEnvelope());
    h.settle({
      'ui.registerStatusBarItem': () => ({ id: 'ext.bible-app.word-count.display' }),
    });

    // activate() awaited a host call, which is the case prone to deadlock.
    const statusBar = h.requests().filter((r) => r.method === 'ui.registerStatusBarItem');
    expect(statusBar.length).toBe(1);
    expect((statusBar[0]!.args[0] as { text: string }).text).toBe('Words: --');

    // ...and it subscribed to the verse-change channel.
    const subscribe = h.sent.find((e) => e.kind === 'subscribe');
    expect(subscribe).toBeDefined();
    expect((subscribe as Extensions.RpcSubscribe).channel).toBe('bible.onDidChangeActiveVerse');

    // ...and told the host it activated cleanly.
    const ack = h.sent.find((e) => e.kind === 'response' && e.id === 'host-init');
    expect(ack).toBeDefined();
    expect((ack as Extensions.RpcResponse).error).toBeUndefined();
    expect(h.runtimeErrors()).toEqual([]);
  });

  it('counts the words in a chapter when the active verse changes', async () => {
    const h = track(await makeHarness(readFileSync(WORD_COUNT_MAIN, 'utf8')));

    h.realm.deliver(initEnvelope());
    let lastStatusText = '';
    const handlers = {
      'ui.registerStatusBarItem': (args: unknown[]) => {
        lastStatusText = (args[0] as { text: string }).text;
        return { id: 'ext.bible-app.word-count.display' };
      },
      'bible.getRange': () => [
        { verseId: 43003016, text: 'For God so loved the world', textPlain: 'For God so loved the world' },
        { verseId: 43003017, text: 'that he gave his only Son', textPlain: 'that he gave his only Son' },
      ],
    };
    h.settle(handlers);

    // Fire the event the extension subscribed to. Its handler is async and
    // awaits two more host calls, so this exercises the full round trip:
    // event in -> RPC out -> response in -> continuation -> RPC out.
    h.realm.deliver({
      kind: 'event',
      channel: 'bible.onDidChangeActiveVerse',
      payload: { verseId: 43003016 },
    });
    h.settle(handlers);

    // 6 words + 6 words.
    expect(lastStatusText).toBe('Words: 12');
    expect(h.runtimeErrors()).toEqual([]);
  });
});

// --- 2. Ambient authority is gone --------------------------------------------

describe('the realm denies the authority the Node worker granted', () => {
  /**
   * This is the `asar-probe-extension` scenario in miniature: the fixture used
   * to obtain `fs` and write a file, and it worked, because extensions ran in
   * the supervisor's own Node process. In the realm the same code cannot even
   * name the module.
   */
  it('denies require() with an error that says what to do instead', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function () {
          const fs = require('fs');
          fs.writeFileSync('/tmp/pwned', 'x');
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({});

    const ack = h.sent.find(
      (e) => e.kind === 'response' && e.id === 'host-init',
    ) as Extensions.RpcResponse | undefined;
    expect(ack?.error).toBeDefined();
    expect(ack!.error!.message).toMatch(/Cannot require\('fs'\)/);
    expect(ack!.error!.message).toMatch(/single file/);
  });

  it.each([
    ['process', `typeof process`],
    ['fetch', `typeof fetch`],
    ['XMLHttpRequest', `typeof XMLHttpRequest`],
    ['Buffer', `typeof Buffer`],
    ['__dirname', `typeof __dirname`],
    ['WebAssembly', `typeof WebAssembly`],
  ])('leaves %s undefined in the realm', async (_name, expr) => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.bible.__probe(${expr});
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    const probe = h.requests().find((r) => r.method === 'bible.__probe');
    expect(probe?.args[0]).toBe('undefined');
  });

  it('cannot reach the host through Function("return this")', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          var g = Function('return this')();
          return api.bible.__probe(typeof g.process + '/' + typeof g.require + '/' + typeof g.__host_send);
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    const probe = h.requests().find((r) => r.method === 'bible.__probe');
    // `__host_send` IS reachable - it is the realm's own transport, and the
    // worst an extension can do with it is forge envelopes attributed to
    // itself, which it can already send legitimately. `process`/`require`
    // are what must not be there.
    expect(probe?.args[0]).toBe('undefined/undefined/function');
  });

  it('keeps prototype pollution inside the realm', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          Object.prototype.polluted = 'yes';
          Array.prototype.push = function () { throw new Error('hijacked'); };
          return api.bible.__probe('done');
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    const arr: number[] = [];
    arr.push(1);
    expect(arr).toEqual([1]);
  });

  it('isolates one realm from another', async () => {
    const a = track(
      await makeHarness(`
        exports.activate = function (api) {
          globalThis.stolenSecret = 'ext-a-oauth-token';
          return api.bible.__probe('a-ok');
        };
      `),
    );
    a.realm.deliver(initEnvelope());
    a.settle({ 'bible.__probe': (args) => args[0] });

    const b = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.bible.__probe(String(globalThis.stolenSecret));
        };
      `),
    );
    b.realm.deliver(initEnvelope());
    b.settle({ 'bible.__probe': (args) => args[0] });

    expect(b.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toBe('undefined');
  });
});

// --- 3. Resource limits ------------------------------------------------------

describe('a misbehaving extension cannot wedge or exhaust the host', () => {
  it('interrupts an infinite loop instead of hanging', async () => {
    const h = track(
      await makeHarness(`exports.activate = function () { while (true) {} };`, {
        turnTimeoutMs: 200,
      }),
    );

    const started = Date.now();
    h.realm.deliver(initEnvelope());
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(3_000);
    expect(h.violations.map((v) => v.kind)).toContain('timeout');
    // The host is still alive and the realm is still usable enough to report.
    expect(h.violations[0]!.detail).toMatch(/execution budget/);
  });

  /**
   * The regression this guards is specific and was found the hard way.
   * QuickJS's own `setMemoryLimit` does not work in the WASM builds - it
   * accounts via `malloc_usable_size`, which emscripten does not provide - and
   * it fails *open*: an 8 MB limit let this exact loop reach 1.66 GB, and a
   * 1 MB limit made no difference. So this asserts the ceiling by measuring
   * what the process actually allocated, not merely that the extension stopped.
   */
  it('stops a memory bomb near the configured ceiling, not gigabytes past it', async () => {
    const CEILING = 16 * 1024 * 1024;
    const h = track(
      await makeHarness(
        `exports.activate = function () {
           var a = [];
           for (;;) { a.push(new Array(10000).fill('x')); }
         };`,
        // A long turn timeout on purpose: if the memory ceiling is broken, this
        // test must fail rather than quietly pass because the *timeout* stopped
        // the bomb instead.
        { memoryLimitBytes: CEILING, turnTimeoutMs: 30_000 },
      ),
    );

    h.realm.deliver(initEnvelope());

    // Either wording is a pass: the hard WASM cap ("out of memory") and the
    // early pressure interrupt ("memory ceiling") are both correct stops, and
    // which one wins depends on how coarse the interrupt polling happened to
    // be for this allocation shape. What must hold is that it is reported as a
    // resource violation rather than looking like an ordinary extension bug.
    expect(h.violations.map((v) => v.kind)).toContain('memory');
    expect(h.violations.find((v) => v.kind === 'memory')!.detail).toMatch(
      /memory ceiling|out of memory/,
    );

    // The ceiling is exact because it is the WASM memory maximum, not a poll:
    // the heap physically cannot grow past it. QuickJS's own limit permitted
    // 1.6 GB here, and interrupt-based sampling permitted 240 MB.
    expect(h.realm.heapGrowthBytes()).toBeLessThanOrEqual(CEILING);
  }, 60_000);

  /**
   * The case sampling structurally cannot catch: one bytecode op that allocates
   * hundreds of megabytes. QuickJS polls interrupts per op, so no amount of
   * polling sees this coming - only a hard cap stops it.
   */
  it('stops a single allocation larger than the whole ceiling', async () => {
    const CEILING = 16 * 1024 * 1024;
    const h = track(
      await makeHarness(
        `exports.activate = function (api) {
           try {
             var big = new Array(100000000).fill(0);
             return api.bible.__probe('allocated ' + big.length);
           } catch (e) {
             return api.bible.__probe('refused: ' + e.message);
           }
         };`,
        { memoryLimitBytes: CEILING, turnTimeoutMs: 30_000 },
      ),
    );

    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toMatch(
      /^refused: .*out of memory/,
    );
    expect(h.realm.heapGrowthBytes()).toBeLessThanOrEqual(CEILING);
  }, 60_000);

  it('gives each realm its own heap, so one extension cannot spend the other budget', async () => {
    // Two realms in one process must not share a memory ceiling. They only
    // don't because each gets its own WASM module instance.
    const a = track(await makeHarness(`exports.activate = function () {};`));
    const b = track(await makeHarness(`exports.activate = function () {};`));
    expect(a.realm).not.toBe(b.realm);

    a.realm.deliver(initEnvelope());
    a.settle({});
    b.realm.deliver(initEnvelope());
    b.settle({});
    expect(a.violations).toEqual([]);
    expect(b.violations).toEqual([]);
  });

  it('refuses a timer flood past the cap', async () => {
    const h = track(
      await makeHarness(
        `exports.activate = function (api) {
           var made = 0;
           try {
             for (var i = 0; i < 100; i++) { setTimeout(function () {}, 60000); made++; }
           } catch (e) {
             return api.bible.__probe('capped after ' + made);
           }
           return api.bible.__probe('no cap: ' + made);
         };`,
        { maxPendingTimers: 8 },
      ),
    );
    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    // The activate() timeout timer counts toward the cap, hence <= not ===.
    const probe = h.requests().find((r) => r.method === 'bible.__probe');
    expect(probe?.args[0]).toMatch(/^capped after \d+$/);
    expect(h.violations.map((v) => v.kind)).toContain('timer-flood');
  });

  it('reports a throw from an event handler instead of losing it', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = async function (api) {
          await api.events.subscribe('test.channel', function () {
            throw new Error('handler exploded');
          });
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({});

    h.realm.deliver({ kind: 'event', channel: 'test.channel', payload: {} });
    h.settle({});

    // Under Node this reached `process.on('unhandledRejection')`. The realm has
    // no such hook, so the emitter reports it explicitly - without that wiring
    // the error would vanish silently.
    const errors = h.runtimeErrors();
    expect(errors.some((e) => e.message.includes('handler exploded'))).toBe(true);
    expect(errors.some((e) => e.source.startsWith('event-handler:'))).toBe(true);
  });
});

// --- 4. Guest globals --------------------------------------------------------

describe('guest globals', () => {
  it('routes console.* to the host', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function () {
          console.log('hello', { a: 1 });
          console.error(new Error('boom'));
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({});

    expect(h.logs[0]).toMatchObject({ level: 'log', args: ['hello', { a: 1 }] });
    expect(h.logs[1]!.level).toBe('error');
    expect(h.logs[1]!.args[0]).toMatchObject({ __error: true, message: 'boom' });
  });

  it('provides working setTimeout driven by the host clock', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          setTimeout(function () { api.bible.__probe('fired'); }, 5);
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({});

    await new Promise((r) => setTimeout(r, 60));
    h.settle({ 'bible.__probe': (args) => args[0] });
    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toBe('fired');
  });

  it('gives Date, Math, JSON and RegExp natively', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.bible.__probe([
            typeof Date.now(), typeof Math.max(1,2),
            JSON.stringify({a:1}), /a(b)c/.exec('abc')[1],
          ].join('|'));
        };
      `),
    );
    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });
    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toBe(
      'number|number|{"a":1}|b',
    );
  });
});

// --- 6. Binary marshalling across the realm boundary -------------------------

/**
 * The realm's transport is a JSON string in both directions, so binary needs
 * an explicit encoding to survive it - see `binaryCodec.ts`. That codec is
 * covered exhaustively in `binaryCodec.test.ts`; these cases prove the wiring,
 * by pushing real bytes through a real QuickJS realm and checking what the two
 * sides actually observe.
 *
 * Without the codec every one of these fails the same quiet way: a
 * `Uint8Array` arrives as `{"0":72,"1":73,...}` and an `ArrayBuffer` as `{}`.
 */
describe('binary payloads survive the realm boundary', () => {
  it('delivers host bytes to the guest as a real Uint8Array', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.storage.readFile('notes.bin').then(function (bytes) {
            return api.bible.__probe({
              ctor: Object.prototype.toString.call(bytes),
              length: bytes.length,
              first: bytes[0],
              last: bytes[bytes.length - 1],
              sum: Array.prototype.reduce.call(bytes, function (a, b) { return a + b; }, 0),
            });
          });
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({
      'storage.readFile': () => new Uint8Array([0, 1, 127, 128, 255]),
      'bible.__probe': (args) => args[0],
    });

    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toEqual({
      ctor: '[object Uint8Array]',
      length: 5,
      first: 0,
      last: 255,
      sum: 511,
    });
  });

  it('delivers a host ArrayBuffer to the guest as a real ArrayBuffer', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.storage.readFile('notes.bin').then(function (buf) {
            var view = new Uint8Array(buf);
            return api.bible.__probe({
              ctor: Object.prototype.toString.call(buf),
              byteLength: buf.byteLength,
              bytes: Array.prototype.slice.call(view),
            });
          });
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({
      'storage.readFile': () => new Uint8Array([9, 8, 7]).buffer,
      'bible.__probe': (args) => args[0],
    });

    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toEqual({
      ctor: '[object ArrayBuffer]',
      byteLength: 3,
      bytes: [9, 8, 7],
    });
  });

  it('delivers guest bytes to the host as a real Uint8Array', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          var bytes = new Uint8Array(4);
          bytes[0] = 222; bytes[1] = 173; bytes[2] = 190; bytes[3] = 239;
          return api.storage.writeFile('out.bin', bytes);
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({ 'storage.writeFile': () => undefined });

    const write = h.requests().find((r) => r.method === 'storage.writeFile');
    const received = write?.args[1];
    // The host's `requireBinaryData` accepts nothing else, so this assertion
    // is what decides whether `writeFile` works at all.
    expect(received).toBeInstanceOf(Uint8Array);
    expect(Array.from(received as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('delivers a guest ArrayBuffer to the host as a real ArrayBuffer', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          var bytes = new Uint8Array([1, 2, 3]);
          return api.ui.saveFile(bytes.buffer, { defaultName: 'x.bin' });
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({ 'ui.saveFile': () => true });

    const save = h.requests().find((r) => r.method === 'ui.saveFile');
    expect(save?.args[0]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(save!.args[0] as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('round-trips bytes through the realm unchanged', async () => {
    // Host -> guest -> host, with the guest never inspecting the payload. The
    // strongest form of the acceptance criterion: byte-exact both ways.
    const original = new Uint8Array(3 * 1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 37 + 5) & 0xff;

    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.storage.readFile('in.bin').then(function (bytes) {
            return api.storage.writeFile('out.bin', bytes);
          });
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({
      'storage.readFile': () => original,
      'storage.writeFile': () => undefined,
    });

    const echoed = h.requests().find((r) => r.method === 'storage.writeFile')?.args[1];
    expect(echoed).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(echoed as Uint8Array).equals(Buffer.from(original))).toBe(true);
  });

  it('does not mistake extension data that looks like an encoded payload', async () => {
    // An extension is free to send `{ $bin$: ... }` as ordinary data. The codec
    // escapes it; without that it would reach the host as a Uint8Array - a
    // type confusion the transport invented on the extension's behalf.
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.storage.set('k', { $bin$: { t: 'u8', d: 'AAEC' }, note: 'plain data' });
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({ 'storage.set': () => undefined });

    const set = h.requests().find((r) => r.method === 'storage.set');
    expect(set?.args[1]).toEqual({ $bin$: { t: 'u8', d: 'AAEC' }, note: 'plain data' });
    expect(set?.args[1]).not.toBeInstanceOf(Uint8Array);
  });

  it('rejects the guest promise when an argument cannot be marshalled', async () => {
    // The failure has to be observable. Dropping the envelope would leave the
    // extension's `await` pending forever, which is worse than an error - it
    // presents as a hang in the host.
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          var deep = 'leaf';
          for (var i = 0; i < 200; i++) { deep = { deep: deep }; }
          return api.storage.set('k', deep).then(
            function () { return api.bible.__probe('resolved'); },
            function (err) { return api.bible.__probe('rejected: ' + err.message); }
          );
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    h.settle({ 'bible.__probe': (args) => args[0] });

    expect(h.requests().find((r) => r.method === 'storage.set')).toBeUndefined();
    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toMatch(
      /^rejected: .*nested deeper/,
    );
  });

  it('answers the guest rather than hanging it when a host reply cannot be encoded', async () => {
    const h = track(
      await makeHarness(`
        exports.activate = function (api) {
          return api.storage.get('k').then(
            function (v) { return api.bible.__probe('resolved: ' + v); },
            function (err) { return api.bible.__probe('rejected: ' + err.message); }
          );
        };
      `),
    );

    h.realm.deliver(initEnvelope());
    // Answered by hand: `settle` cannot express a reply that fails to encode.
    const get = h.sent.find(
      (e): e is RpcRequest => e.kind === 'request' && e.method === 'storage.get',
    );
    expect(get).toBeDefined();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    h.realm.deliver({ kind: 'response', id: get!.id, result: cyclic });

    h.settle({ 'bible.__probe': (args) => args[0] });
    // Specifically the codec's refusal - not, say, a later `Unknown RPC method`
    // reply for the same id arriving after the guest had already given up.
    expect(h.requests().find((r) => r.method === 'bible.__probe')?.args[0]).toMatch(
      /^rejected: .*(nested deeper|cycle)/,
    );
  });
});
