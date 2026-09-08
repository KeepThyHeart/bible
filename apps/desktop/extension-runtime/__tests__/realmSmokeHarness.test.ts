/**
 * @vitest-environment node
 *
 * Acceptance - the smoke harness driving a real QuickJS realm.
 *
 * `@bible/extension-testing` defines realm mode but deliberately does not
 * import an engine (see its `smoke/realm/types.ts`). This test is the other
 * half of that contract: it supplies a `RealmFactory` backed by the actual
 * `QuickJSRealm` the app ships, then runs the harness and the assertion engine
 * through it.
 *
 * The point of the suite is not that realm mode works in general - it is that
 * realm mode and mock mode *disagree in exactly the places they should*. The
 * mock path hands an extension a Node realm, so anything an extension does
 * with `require`, `process` or `Buffer` passes there and fails once installed.
 * Several tests below run the same extension source both ways and pin that
 * difference, because that discrepancy is the reason realm mode exists.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createRealmSmokeHarness,
  createSmokeHarness,
  runSmokeSuite,
  type RealmFactory,
  type RealmSmokeHarness,
} from '@bible/extension-testing/smoke';

import type { Extensions } from '@bible/core';
import { QuickJSRealm } from '../host/QuickJSRealm';
import { buildGuestBundle } from './guestBundle';

type ExtensionManifest = Extensions.ExtensionManifest;

// -- Realm factory -----------------------------------------------------------

const openRealms: QuickJSRealm[] = [];

afterEach(() => {
  while (openRealms.length) openRealms.pop()?.dispose();
});

/**
 * The whole desktop-side adapter: ~15 lines mapping the harness's
 * `RealmSession` onto `QuickJSRealm`. If this ever needs to grow, that is a
 * signal the seam is in the wrong place.
 */
async function makeRealmFactory(): Promise<RealmFactory> {
  const guestBundleSource = await buildGuestBundle();
  return async (opts) => {
    const realm = await QuickJSRealm.create({
      extensionId: opts.extensionId,
      guestBundleSource,
      loadEntryBundle: () => ({
        source: opts.entrySource,
        filename: opts.entryFilename,
      }),
      onSend: opts.onSend,
      onLog: opts.onLog,
      onFatal: opts.onFatal,
    });
    openRealms.push(realm);
    return {
      deliver: (envelope) => realm.deliver(envelope),
      requestGuestDispose: () => realm.requestGuestDispose(),
      dispose: () => realm.dispose(),
    };
  };
}

// -- Fixture extension -------------------------------------------------------

function manifest(over: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'ext.test.smoke',
    name: { key: 'ext.test.smoke' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: './main.js',
    permissions: ['bible:read'],
    ...over,
  } as ExtensionManifest;
}

/**
 * A CJS bundle in the shape esbuild emits for a scaffolded extension. Kept as
 * a string so both harness modes can consume it: realm mode evaluates it
 * inside QuickJS, mock mode evaluates it in Node (see `loadInProcess`).
 */
const FIXTURE_SOURCE = `
exports.activate = async function activate(api) {
  // Probe ambient authority and report it where a test can read it back.
  // \`require\` is probed by *calling* it, not by typeof: the realm's CJS
  // wrapper always supplies a \`require\` parameter, so the name exists in
  // both modes and only its behaviour distinguishes them.
  var requireResult;
  try {
    requireResult = typeof require('fs');
  } catch (err) {
    requireResult = 'denied';
  }
  console.log('ambient', JSON.stringify({
    require: requireResult,
    process: typeof process,
    fetch: typeof fetch,
    Buffer: typeof Buffer,
  }));

  await api.ui.registerPanelType({
    id: 'ext.test.smoke.panel',
    title: { key: 'panel.title' },
    uiEntry: './ui.html',
  });

  await api.bible.onDidChangeActiveVerse.subscribe(async function (payload) {
    exports.__lastVerse = payload;
  });
};
`;

/** Same extension, but its event handler touches a permission it never declared. */
const OVERREACHING_SOURCE = `
exports.activate = async function activate(api) {
  await api.bible.onDidChangeActiveVerse.subscribe(async function () {
    await api.notes.create({ content: 'written without notes:write' });
  });
};
`;

/** Same extension, but its event handler throws. */
const THROWING_SOURCE = `
exports.activate = async function activate(api) {
  await api.bible.onDidChangeActiveVerse.subscribe(async function () {
    throw new Error('handler exploded');
  });
};
`;

/**
 * Evaluate a bundle the way the in-process harness would reach it - a plain
 * `require` in Node - so the mock path can run the very same source.
 */
function loadInProcess(source: string): {
  activate: (api: Extensions.BibleExtensionAPI) => Promise<void>;
} {
  const module = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('exports', 'module', 'require', source) as (
    exports: unknown,
    module: unknown,
    require: unknown,
  ) => void;
  fn(module.exports, module, require);
  return module.exports as unknown as {
    activate: (api: Extensions.BibleExtensionAPI) => Promise<void>;
  };
}

async function activateInRealm(
  source: string,
  over: Partial<ExtensionManifest> = {},
): Promise<RealmSmokeHarness> {
  const harness = createRealmSmokeHarness({
    manifest: manifest(over),
    entrySource: source,
    realmFactory: await makeRealmFactory(),
  });
  await harness.activate();
  return harness;
}

// -- 1. The harness drives a real realm --------------------------------------

describe('realm-mode smoke harness', () => {
  it('activates an extension bundle inside the realm', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE);
    expect(harness.isActive()).toBe(true);
    expect(harness.runtimeErrors()).toEqual([]);
  }, 60_000);

  it('captures registrations made over RPC, not against the mock object', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE);

    // The extension never touched the mock API object - it sent an envelope.
    const registerCall = harness
      .sentEnvelopes()
      .find((e) => e.kind === 'request' && e.method === 'ui.registerPanelType');
    expect(registerCall).toBeDefined();

    // ...yet the recording layer captured it exactly as in-process mode would.
    expect(harness.getCaptured().panelTypes.map((p) => p.id)).toEqual([
      'ext.test.smoke.panel',
    ]);
  }, 60_000);

  it('turns guest subscriptions into enumerable event hooks', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE);
    expect(harness.subscribedChannels()).toContain('bible.onDidChangeActiveVerse');
    expect(harness.enumerate().map((h) => h.hookId)).toContain(
      'event:bible.onDidChangeActiveVerse',
    );
  }, 60_000);

  it('answers an unknown method the way the host does, without crashing', async () => {
    const harness = await activateInRealm(`
      exports.activate = async function activate(api) {
        try {
          await api.bible.thisMethodDoesNotExist();
        } catch (err) {
          exports.__err = String(err && err.message);
          console.log('caught', exports.__err);
        }
      };
    `);
    const caught = harness.logs().find((l) => l.args[0] === 'caught');
    expect(String(caught?.args[1])).toMatch(/Unknown RPC method: bible\.thisMethodDoesNotExist/);
  }, 60_000);
});

// -- 2. The reason realm mode exists -----------------------------------------

describe('realm mode vs mock mode', () => {
  it('denies the ambient authority that the mock path silently allows', async () => {
    const realmHarness = await activateInRealm(FIXTURE_SOURCE);
    const realmProbe = JSON.parse(
      String(realmHarness.logs().find((l) => l.args[0] === 'ambient')?.args[1]),
    ) as Record<string, string>;

    // Inside the realm the extension has none of Node's ambient authority.
    // `require` is present but refuses - the wrapper hands the guest a stub
    // whose only behaviour is to explain why there is no module system.
    expect(realmProbe).toEqual({
      require: 'denied',
      process: 'undefined',
      fetch: 'undefined',
      Buffer: 'undefined',
    });

    // The mock path runs the same source in Node, where all of it is real.
    // This is not a bug in the mock harness - it is the gap realm mode closes,
    // and an extension author who only ever runs the fast path will not see it.
    const logged: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args);
    try {
      const mockHarness = createSmokeHarness({
        manifest: manifest(),
        activate: loadInProcess(FIXTURE_SOURCE).activate,
      });
      await mockHarness.activate();
    } finally {
      console.log = originalLog;
    }
    const mockProbe = JSON.parse(
      String(logged.find((a) => a[0] === 'ambient')?.[1]),
    ) as Record<string, string>;
    expect(mockProbe.require).toBe('object'); // `require('fs')` simply worked
    expect(mockProbe.process).toBe('object');
  }, 60_000);

  it('captures the same registrations in both modes', async () => {
    const realmHarness = await activateInRealm(FIXTURE_SOURCE);
    const mockHarness = createSmokeHarness({
      manifest: manifest(),
      activate: loadInProcess(FIXTURE_SOURCE).activate,
    });
    await mockHarness.activate();

    expect(realmHarness.getCaptured().panelTypes.map((p) => p.id)).toEqual(
      mockHarness.getCaptured().panelTypes.map((p) => p.id),
    );
    expect([...realmHarness.getCaptured().eventSubscribers.keys()]).toEqual(
      [...mockHarness.getCaptured().eventSubscribers.keys()],
    );
  }, 60_000);
});

// -- 3. The assertion engine, running through the realm ----------------------

describe('runSmokeSuite against a realm-backed harness', () => {
  it('drives event hooks through the realm and passes a clean extension', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE);
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 3 });

    const eventRecords = result.records.filter(
      (r) => r.hookId === 'event:bible.onDidChangeActiveVerse',
    );
    expect(eventRecords.length).toBeGreaterThan(0);
    expect(eventRecords.every((r) => r.status === 'pass')).toBe(true);
    expect(result.totals.failed).toBe(0);
  }, 60_000);

  it('reports a permission the extension never declared as a violation', async () => {
    // `notes:write` is absent from the manifest, so the interceptor rejects
    // the call. The rejection happens inside the guest, surfaces on
    // `__runtime.error`, and has to survive the whole round trip to be seen.
    const harness = await activateInRealm(OVERREACHING_SOURCE);
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });

    const violation = result.records.find(
      (r) => r.failureReason === 'permission-violation',
    );
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/notes:write/);
  }, 60_000);

  it('detects a handler that throws inside the realm', async () => {
    // In-process a throw propagates to the caller. Across the boundary event
    // dispatch is one-way, so this only works because the harness watches
    // `__runtime.error` and attributes it to the invocation in flight.
    const harness = await activateInRealm(THROWING_SOURCE);
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });

    const failure = result.records.find((r) => r.status === 'fail');
    expect(failure?.failureReason).toBe('threw');
    expect(failure?.message).toMatch(/handler exploded/);
  }, 60_000);

  it('skips endpoint hooks with an accurate reason rather than faking a pass', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE, {
      contributes: {
        commands: [
          {
            id: 'ext.test.smoke.hello',
            title: { key: 'cmd.hello' },
            handlerEndpoint: 'commands.execute',
          },
        ],
      },
    } as Partial<ExtensionManifest>);
    const result = await runSmokeSuite({ harness, maxInputsPerHook: 1 });

    const command = result.records.find((r) => r.hookId.startsWith('command:'));
    expect(command?.status).toBe('skip');
    expect(command?.message).toMatch(/no reverse-RPC binding/);
  }, 60_000);
});

// -- 4. Teardown -------------------------------------------------------------

describe('realm harness lifecycle', () => {
  it('disposes the realm on deactivate and refuses a second activate', async () => {
    const harness = await activateInRealm(FIXTURE_SOURCE);
    await expect(harness.activate()).rejects.toThrow(/already active/);
    await harness.deactivate();
    expect(harness.isActive()).toBe(false);
    // Idempotent - a second deactivate must not throw on an already-dead realm.
    await harness.deactivate();
  }, 60_000);
});
