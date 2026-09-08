/**
 * Worker-side runtime smoke test.
 *
 * Drives the runtime + apiProxy + emitter against an in-memory channel.
 * Asserts the worker can:
 *
 *   - issue an `api.bible.getVerse(...)` call and resolve when the host
 *     replies with an `RpcResponse`;
 *   - reject the same call when the host replies with an error envelope;
 *   - subscribe to an event channel and receive an `RpcEvent`;
 *   - dispatch a reverse RPC to a registered handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { Extensions } from '@bible/core';

import type { IRpcChannel } from '../apiProxy';
import { ExtensionRuntime } from '../runtime';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

/**
 * Test channel that records every envelope written by the worker and lets
 * the test inject envelopes back into `runtime.dispatch()` to simulate the
 * host side.
 */
function makeChannel(): { channel: IRpcChannel; sent: RpcEnvelope[] } {
  const sent: RpcEnvelope[] = [];
  const channel: IRpcChannel = {
    send(env) {
      sent.push(env);
    },
    onMessage() {
      /* not used - runtime drives dispatch directly */
    },
  };
  return { channel, sent };
}

function makeRuntime(channel: IRpcChannel): ExtensionRuntime {
  return new ExtensionRuntime({
    channel,
    moduleLoader: async () => ({
      activate: () => Promise.resolve(),
    }),
  });
}

describe('ExtensionRuntime', () => {
  it('init() runs the extension activate() with the api proxy', async () => {
    const { channel } = makeChannel();
    const activate = vi.fn(() => Promise.resolve());
    const runtime = new ExtensionRuntime({
      channel,
      moduleLoader: async () => ({ activate }),
    });
    await runtime.init({
      manifest: {
        id: 'ext.test',
        name: { key: 'ext.test' },
        version: '1.0.0',
        publisher: 'test',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      },
      installPath: '/fake/ext.test',
      grantedPermissions: ['bible:read'],
      hostApiVersion: '1.0.0',
      hostMinSupportedApiVersion: '1.0.0',
      locale: 'en',
      hostFeatures: [],
    });
    expect(activate).toHaveBeenCalledTimes(1);
    const passedApi = (activate.mock.calls[0] as unknown[])[0] as Extensions.BibleExtensionAPI;
    expect(passedApi.bible).toBeDefined();
    expect(passedApi.storage).toBeDefined();
  });

  it('init() rejects when activate() throws', async () => {
    const { channel } = makeChannel();
    const runtime = new ExtensionRuntime({
      channel,
      moduleLoader: async () => ({
        activate: () => {
          throw new Error('activate boom');
        },
      }),
    });
    await expect(
      runtime.init({
        manifest: {
          id: 'ext.test',
          name: { key: 'ext.test' },
          version: '1.0.0',
          publisher: 'test',
          engines: { bibleApp: '^1.0.0' },
          main: './main.js',
        },
        installPath: '/fake/ext.test',
        grantedPermissions: [],
        hostApiVersion: '1.0.0',
        hostMinSupportedApiVersion: '1.0.0',
        locale: 'en',
        hostFeatures: [],
      }),
    ).rejects.toThrow(/activate boom/);
  });

  it('api method calls flow as RpcRequest envelopes and resolve on response', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());

    const api = runtime.getApi();
    const promise = (api.bible as { getVerse: (id: number) => Promise<unknown> }).getVerse(43003016);

    // The proxy should have sent a request envelope.
    const req = sent.find((e) => (e as RpcRequest).method === 'bible.getVerse') as RpcRequest;
    expect(req).toBeDefined();
    expect(req.args).toEqual([43003016]);

    // Simulate the host responding.
    const res: RpcResponse = { kind: 'response', id: req.id, result: { verseId: 43003016, text: 'For God so loved...' } };
    await runtime.dispatch(res);
    await expect(promise).resolves.toMatchObject({ verseId: 43003016 });
  });

  it('api method calls reject with the matching ExtensionApiError when the host returns an error', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());

    const api = runtime.getApi();
    const promise = (api.notes as { create: (n: unknown) => Promise<unknown> }).create({});

    const req = sent.find((e) => (e as RpcRequest).method === 'notes.create') as RpcRequest;
    expect(req).toBeDefined();

    await runtime.dispatch({
      kind: 'response',
      id: req.id,
      error: { code: 'PermissionDeniedError', message: 'notes:write missing' },
    });

    await expect(promise).rejects.toMatchObject({ code: 'PermissionDeniedError' });
  });

  it('event subscriptions emit subscribe envelopes and dispatch incoming events', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());

    const handler = vi.fn();
    const api = runtime.getApi();
    const handle = await api.bible.onDidChangeActiveVerse.subscribe(handler);

    // The emitter should have sent a subscribe envelope.
    const sub = sent.find((e) => e.kind === 'subscribe');
    expect(sub).toBeDefined();

    // Inject an event from the host.
    await runtime.dispatch({
      kind: 'event',
      channel: 'bible.onDidChangeActiveVerse',
      payload: { verseId: 1, module: 'kjv' },
    });
    expect(handler).toHaveBeenCalledWith({ verseId: 1, module: 'kjv' });

    // Disposing should fire an unsubscribe envelope.
    await handle.dispose();
    const unsub = sent.find((e) => e.kind === 'unsubscribe');
    expect(unsub).toBeDefined();
  });

  it('reverse RPC routes to a registered handler', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());

    runtime.registerReverseHandler('commands.execute', (args) => `ran:${args[0]}`);

    await runtime.dispatch({
      kind: 'request',
      id: 'host-1',
      method: 'commands.execute',
      args: ['ext.test.greet'],
    });

    const ack = sent.find(
      (e) => e.kind === 'response' && (e as RpcResponse).id === 'host-1',
    ) as RpcResponse;
    expect(ack).toBeDefined();
    expect(ack.result).toBe('ran:ext.test.greet');
  });

  // --- Registration results become real DisposableHandles -----------------
  //
  // Twelve API methods are declared `Promise<DisposableHandle>` and none of
  // them resolved with anything that had a `dispose` method - the host cannot
  // send a function across the RPC envelope, so it sends an id instead and the
  // proxy is responsible for reconstituting the handle. Before this, following
  // the types produced `TypeError: handle.dispose is not a function` inside
  // `deactivate()`.

  /** Issue `method`, answer it with `result`, and return what the caller sees. */
  async function callAndAnswer(
    runtime: ExtensionRuntime,
    sent: RpcEnvelope[],
    method: string,
    invoke: () => Promise<unknown>,
    result: unknown,
  ): Promise<unknown> {
    const promise = invoke();
    const req = sent.find((e) => (e as RpcRequest).method === method) as RpcRequest;
    expect(req, `no request envelope for ${method}`).toBeDefined();
    await runtime.dispatch({ kind: 'response', id: req.id, result });
    return promise;
  }

  it('turns a { disposalId } result into a handle whose dispose() calls <ns>.dispose', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());
    const api = runtime.getApi();

    const handle = (await callAndAnswer(
      runtime,
      sent,
      'ui.registerPanelType',
      () => api.ui.registerPanelType({} as never),
      { disposalId: 'panel-1' },
    )) as Extensions.DisposableHandle;

    expect(typeof handle.dispose).toBe('function');

    void handle.dispose();
    const disposeReq = sent.find((e) => (e as RpcRequest).method === 'ui.dispose') as RpcRequest;
    expect(disposeReq).toBeDefined();
    // The id must round-trip verbatim - it is the host's only handle on the
    // real disposer.
    expect(disposeReq.args).toEqual(['panel-1']);
  });

  it('keeps the result\'s other fields alongside dispose()', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());
    const api = runtime.getApi();

    // `registerProvider` answers with both the namespaced provider id the
    // extension may want to reference and the disposal id. Wrapping must not
    // swallow the former.
    const handle = (await callAndAnswer(
      runtime,
      sent,
      'bible.registerProvider',
      () => api.bible.registerProvider({} as never),
      { providerId: 'ext.ext.test.mine', disposalId: 'provider-1' },
    )) as Extensions.DisposableHandle & { providerId: string };

    expect(handle.providerId).toBe('ext.ext.test.mine');
    expect(typeof handle.dispose).toBe('function');
  });

  it('leaves results without a disposalId untouched', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());
    const api = runtime.getApi();

    // A read method must not grow a phantom `dispose` - an extension probing
    // for one would conclude the verse is disposable.
    const verse = (await callAndAnswer(
      runtime,
      sent,
      'bible.getVerse',
      () => api.bible.getVerse(43003016),
      { verseId: 43003016, text: 'For God so loved...' },
    )) as Record<string, unknown>;

    expect(verse.dispose).toBeUndefined();
    expect(verse.text).toBe('For God so loved...');
  });

  it('passes through non-object results unchanged', async () => {
    const { channel, sent } = makeChannel();
    const runtime = makeRuntime(channel);
    await runtime.init(initPayload());
    const api = runtime.getApi();

    // Guards the `typeof result !== 'object'` branch: `null` in particular
    // would throw on a property read if the wrapper were careless.
    await expect(
      callAndAnswer(
        runtime,
        sent,
        'bible.parseReference',
        () => api.bible.parseReference('not a reference'),
        null,
      ),
    ).resolves.toBeNull();

    await expect(
      callAndAnswer(
        runtime,
        sent,
        'l10n.currentLocale',
        () => api.l10n.currentLocale(),
        'pt-BR',
      ),
    ).resolves.toBe('pt-BR');
  });
});

function initPayload(): Extensions.ExtensionInitPayload {
  return {
    manifest: {
      id: 'ext.test',
      name: { key: 'ext.test' },
      version: '1.0.0',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: './main.js',
    },
    installPath: '/fake/ext.test',
    grantedPermissions: ['bible:read', 'notes:write'],
    hostApiVersion: '1.0.0',
    hostMinSupportedApiVersion: '1.0.0',
    locale: 'en',
    hostFeatures: [],
  };
}
