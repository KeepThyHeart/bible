/**
 * Commands / context integration tests.
 *
 * Drives the full host-side pipeline:
 *
 *   worker -> ExtensionRpcRouter -> CommandsApiImpl/ContextApiImpl
 *          -> InMemory{Command,Context}Bridge -> renderer services
 *
 * The test uses a paired in-memory `IRpcTransport` so we can simulate the
 * worker side without spawning an `electron utilityProcess`. The router
 * runs against the host transport; the test acts as the worker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import {
  CommandsApiImpl,
  ContextApiImpl,
  InMemoryCommandBridge,
  InMemoryContextBridge,
} from '../api-impl';
import { CommandRegistry } from '../../../src/ui/services/CommandRegistry';
import { WhenContextService } from '../../../src/ui/services/WhenContextService';
import { I18nService } from '../../../src/ui/services/I18nService';

type RpcResponse = Extensions.RpcResponse;
type RpcRequest = Extensions.RpcRequest;

function pairedTransports(): {
  host: IRpcTransport;
  worker: IRpcTransport;
  hostInbox: unknown[];
  workerInbox: unknown[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostInbox: unknown[] = [];
  const workerInbox: unknown[] = [];
  const host: IRpcTransport = {
    send(env) {
      // Sent by host -> arrives at worker.
      workerInbox.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const worker: IRpcTransport = {
    send(env) {
      hostInbox.push(env);
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  return { host, worker, hostInbox, workerInbox };
}

interface Harness {
  router: ExtensionRpcRouter;
  pair: ReturnType<typeof pairedTransports>;
  registry: CommandRegistry;
  whenContext: WhenContextService;
  commandsApi: CommandsApiImpl;
  contextApi: ContextApiImpl;
}

function makeHarness(extensionId = 'demo'): Harness {
  const i18n = new I18nService();
  const whenContext = new WhenContextService();
  const registry = new CommandRegistry({ i18n, whenContext });
  const pair = pairedTransports();
  const router = new ExtensionRpcRouter(pair.host);
  const commandsApi = new CommandsApiImpl({
    extensionId,
    router,
    bridge: new InMemoryCommandBridge(registry),
  });
  const contextApi = new ContextApiImpl({
    extensionId,
    router,
    bridge: new InMemoryContextBridge(whenContext),
  });
  commandsApi.attach();
  contextApi.attach();
  return { router, pair, registry, whenContext, commandsApi, contextApi };
}

/** Send an envelope as if from the worker, then drain pending microtasks. */
async function workerSend(h: Harness, env: RpcRequest): Promise<void> {
  h.pair.worker.send(env);
  await new Promise((r) => setImmediate(r));
}

function lastResponse(h: Harness): RpcResponse {
  // Responses are sent by the host router -> arrive in the worker's inbox.
  const responses = h.pair.workerInbox.filter(
    (e): e is RpcResponse => (e as { kind?: string }).kind === 'response',
  );
  expect(responses.length).toBeGreaterThan(0);
  return responses[responses.length - 1]!;
}

describe('Commands / context integration', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  // --- commands.register ------------------------------------------------

  it('commands.register installs an extension command into the renderer registry', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.register',
      args: [
        {
          id: 'ext.demo.greet',
          title: 'Greet',
          handlerEndpoint: 'cmd.greet',
        },
      ],
    });
    const res = lastResponse(h);
    expect(res.error).toBeUndefined();
    expect((res.result as { disposalId: string }).disposalId).toBe('cmd-1');
    expect(h.registry.get('ext.demo.greet')?.ownerExtensionId).toBe('demo');
  });

  it('commands.register rejects an id outside the ext.<id>. namespace', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w2',
      method: 'commands.register',
      args: [
        {
          id: 'ext.other.greet',
          title: 'Greet',
          handlerEndpoint: 'cmd.greet',
        },
      ],
    });
    const res = lastResponse(h);
    expect(res.error?.code).toBe('PermissionDeniedError');
  });

  it('commands.register without handlerEndpoint returns RpcProtocolError', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w3',
      method: 'commands.register',
      args: [{ id: 'ext.demo.greet', title: 'Greet' }],
    });
    expect(lastResponse(h).error?.code).toBe('RpcProtocolError');
  });

  // --- reverse RPC dispatch ---------------------------------------------

  it('executing a registered command issues a reverse RPC into the worker', async () => {
    // Register the command.
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.register',
      args: [
        { id: 'ext.demo.greet', title: 'Greet', handlerEndpoint: 'cmd.greet' },
      ],
    });
    // The host now sees the command. Trigger an execute as if the user
    // clicked it in the menu - this should send a reverse RPC to the worker.
    const execPromise = h.registry.execute('ext.demo.greet', { name: 'world' });

    // Drain the microtask so the request envelope reaches the worker side.
    await new Promise((r) => setImmediate(r));

    const reverseReq = h.pair.workerInbox.find(
      (e): e is RpcRequest =>
        (e as { kind?: string }).kind === 'request' &&
        (e as RpcRequest).method === 'cmd.greet',
    );
    expect(reverseReq).toBeDefined();
    expect(reverseReq!.args).toEqual([{ name: 'world' }]);

    // Worker side: send the response back.
    h.pair.worker.send({
      kind: 'response',
      id: reverseReq!.id,
      result: 'hello world',
    });
    await execPromise;
  });

  // --- commands.execute (extension-initiated) ---------------------------

  it('commands.execute routes through the bridge', async () => {
    // Pre-register a built-in command directly on the registry.
    let invoked = false;
    h.registry.register({
      id: 'test.builtin',
      title: 'Builtin',
      handler: () => {
        invoked = true;
      },
    });
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.execute',
      args: ['test.builtin'],
    });
    expect(invoked).toBe(true);
    expect(lastResponse(h).error).toBeUndefined();
  });

  // --- commands.dispose + bulk disposeByOwner ---------------------------

  it('disposing the api removes every command this extension registered', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.register',
      args: [{ id: 'ext.demo.a', title: 'A', handlerEndpoint: 'cmd.a' }],
    });
    await workerSend(h, {
      kind: 'request',
      id: 'w2',
      method: 'commands.register',
      args: [{ id: 'ext.demo.b', title: 'B', handlerEndpoint: 'cmd.b' }],
    });
    expect(h.registry.list()).toHaveLength(2);
    h.commandsApi.dispose();
    expect(h.registry.list()).toHaveLength(0);
  });

  it('commands.dispose removes a single registration by disposalId', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.register',
      args: [{ id: 'ext.demo.a', title: 'A', handlerEndpoint: 'cmd.a' }],
    });
    const disposalId = (lastResponse(h).result as { disposalId: string }).disposalId;
    await workerSend(h, {
      kind: 'request',
      id: 'w2',
      method: 'commands.dispose',
      args: [disposalId],
    });
    expect(h.registry.get('ext.demo.a')).toBeUndefined();
  });

  // --- context.set / context.get ----------------------------------------

  it('context.set writes an ext.<id>.* key', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'context.set',
      args: ['ext.demo.ready', true],
    });
    expect(lastResponse(h).error).toBeUndefined();
    expect(h.whenContext.get('ext.demo.ready')).toBe(true);
  });

  it('context.set rejects a built-in key with PermissionDeniedError', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'context.set',
      args: ['editorFocused', true],
    });
    const res = lastResponse(h);
    expect(res.error?.code).toBe('PermissionDeniedError');
    expect(h.whenContext.get('editorFocused')).toBeUndefined();
  });

  it('context.set rejects another extension\'s key', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'context.set',
      args: ['ext.other.flag', true],
    });
    expect(lastResponse(h).error?.code).toBe('PermissionDeniedError');
  });

  it('context.get reads built-in keys', async () => {
    h.whenContext.set('verseSelected', true);
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'context.get',
      args: ['verseSelected'],
    });
    const res = lastResponse(h);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(true);
  });

  it('disposing the context api drops the extension\'s keys', async () => {
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'context.set',
      args: ['ext.demo.ready', true],
    });
    expect(h.whenContext.get('ext.demo.ready')).toBe(true);
    h.contextApi.dispose();
    expect(h.whenContext.get('ext.demo.ready')).toBeUndefined();
  });

  // --- disposed-after-detach guard --------------------------------------

  it('calls after dispose return ExtensionNotActiveError', async () => {
    h.commandsApi.dispose();
    h.contextApi.dispose();
    await workerSend(h, {
      kind: 'request',
      id: 'w1',
      method: 'commands.register',
      args: [{ id: 'ext.demo.x', title: 'X', handlerEndpoint: 'cmd.x' }],
    });
    expect(lastResponse(h).error?.code).toBe('ExtensionNotActiveError');

    await workerSend(h, {
      kind: 'request',
      id: 'w2',
      method: 'context.set',
      args: ['ext.demo.k', 1],
    });
    expect(lastResponse(h).error?.code).toBe('ExtensionNotActiveError');
  });
});
