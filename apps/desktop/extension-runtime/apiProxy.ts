/**
 * BibleExtensionAPI proxy generator (worker side).
 *
 * The host injects a `BibleExtensionAPI` instance into each extension
 * worker. Rather than ship a hand-written namespace
 * shim per API surface area, we use a `Proxy` that turns every method call
 * into an `RpcRequest` envelope on the wire and resolves with the response.
 *
 * Each top-level namespace (`bible`, `commentary`, ...) is itself a Proxy that
 * routes property access to the request channel. `events.subscribe` and
 * `events.publish` are special-cased - the former cannot become an RPC
 * request at all (`handler` is a function and would not survive the wire),
 * routing instead to the runtime's `ExtensionEventEmitter`.
 *
 * The proxy is intentionally permissive - every method call becomes an RPC
 * regardless of whether the host actually implements it. The host's router
 * answers unknown methods with `RpcProtocolError` (`Unknown RPC method`),
 * which the runtime re-raises as an `ExtensionApiError` inside the
 * extension's promise rejection.
 */

// Values come from deep paths, types from the barrel: this file is bundled
// into the QuickJS guest realm, and `@bible/core`'s barrel re-exports the
// whole Data layer. `import type` is erased, so only these two small modules
// reach the guest bundle.
import { EXTENSION_API_VERSION } from '@bible/core/Extensions/ExtensionApiTypes';
import { reviveExtensionApiError } from '@bible/core/Extensions/ExtensionApiErrors';
import type { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type DisposableHandle = Extensions.DisposableHandle;
type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcRequestId = Extensions.RpcRequestId;
type RpcResponse = Extensions.RpcResponse;
type RpcSubscribe = Extensions.RpcSubscribe;
type RpcUnsubscribe = Extensions.RpcUnsubscribe;

import type { ExtensionEventEmitter } from './eventEmitter';

/**
 * Bidirectional channel the proxy uses. The runtime constructs one over the
 * worker's `parentPort` and hands it to the proxy + the event emitter so
 * both share the same RPC stream.
 */
export interface IRpcChannel {
  send(envelope: RpcEnvelope): void;
  onMessage(handler: (envelope: RpcEnvelope) => void): void;
}

interface PendingForwardRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Worker-local reverse-RPC endpoint table, owned by `ExtensionRuntime` and
 * handed to the proxy so `api.runtime.expose(...)` can bind a callback the
 * host will later call back on.
 *
 * The proxy cannot own this itself: the runtime is what dispatches inbound
 * `request` envelopes, and it is constructed before the proxy.
 */
export interface IReverseEndpointTable {
  register(endpoint: string, handler: (args: unknown[]) => unknown | Promise<unknown>): void;
  unregister(endpoint: string): void;
  list(): string[];
}

/**
 * Endpoint prefixes the host reserves for itself. An extension binding here
 * could shadow a runtime control message (`runtime.`) or impersonate a
 * filter/provider hook subscription and receive payloads it never
 * subscribed to (`hook:`, registered by `ExtensionEventEmitter` for
 * `filter`/`provider` channels - see `eventEmitter.ts`), so `expose` refuses
 * both.
 */
const RESERVED_ENDPOINT_PREFIXES = ['runtime.', 'hook:'];

function isReservedEndpoint(endpoint: string): boolean {
  return RESERVED_ENDPOINT_PREFIXES.some((p) => endpoint.startsWith(p));
}

/** Endpoint the host calls to deliver a panel iframe's message. */
export const PANEL_MESSAGE_ENDPOINT = 'panels.onMessage';

/**
 * Build the `BibleExtensionAPI` proxy. Returns the API plus a `dispatch`
 * callback the runtime feeds incoming `RpcResponse` envelopes into so the
 * proxy can resolve pending requests.
 */
export function createApiProxy(opts: {
  channel: IRpcChannel;
  emitter: ExtensionEventEmitter;
  /**
   * Reverse-RPC endpoint table. Omitted only by tests that never exercise
   * `api.runtime.*` or `api.panels.*`; those namespaces then reject with a
   * clear message rather than silently doing nothing.
   */
  endpoints?: IReverseEndpointTable;
}): {
  api: BibleExtensionAPI;
  /** Routes incoming responses to pending forward requests. */
  handleResponse(res: RpcResponse): void;
  /** True iff a request with that id is awaiting a response. */
  hasPending(id: RpcRequestId): boolean;
  /** API version the proxy was built against. */
  apiVersion: string;
} {
  const pending = new Map<RpcRequestId, PendingForwardRequest>();
  let nextRequestId = 1;

  function makeRequest(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id: RpcRequestId = `worker-${nextRequestId++}`;
      pending.set(id, { resolve, reject });
      const env: RpcRequest = { kind: 'request', id, method, args };
      try {
        opts.channel.send(env);
      } catch (err) {
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function makeNamespaceProxy(namespace: string): Record<string, unknown> {
    const cache = new Map<string, unknown>();
    return new Proxy<Record<string, unknown>>(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (cache.has(prop)) return cache.get(prop);
          // `storage.openDatabase` returns a worker-side
          // `IExtensionDatabase` wrapper rather than a bare RPC payload. The
          // host returns an opaque string handle; we wrap it in a small
          // object whose methods round-trip through `storage.db*` RPCs.
          if (namespace === 'storage' && prop === 'openDatabase') {
            const fn = async (...args: unknown[]) => {
              const handle = await makeRequest('storage.openDatabase', args);
              if (typeof handle !== 'string') {
                throw new TypeError('storage.openDatabase: expected string handle');
              }
              return makeExtensionDatabaseWrapper(handle, makeRequest);
            };
            cache.set(prop, fn);
            return fn;
          }
          // `runtime.*` never leaves the worker. `expose` takes a function,
          // which cannot cross the RPC envelope, and the thing it binds to is
          // the worker's own inbound-request table - so there is nothing to
          // send and no host round trip to make.
          if (namespace === 'runtime') {
            const fn = makeRuntimeMethod(prop, opts.endpoints);
            if (fn) {
              cache.set(prop, fn);
              return fn;
            }
          }
          // `panels.onMessage` is `runtime.expose` under a fixed endpoint
          // name, with the host told once that a handler now exists.
          if (namespace === 'panels' && prop === 'onMessage') {
            const fn = (handler: unknown) => {
              if (typeof handler !== 'function') {
                return Promise.reject(
                  new TypeError('panels.onMessage: handler must be a function'),
                );
              }
              const table = opts.endpoints;
              if (!table) {
                return Promise.reject(
                  new Error('panels.onMessage: this runtime has no endpoint table'),
                );
              }
              const fn2 = handler as (
                message: unknown,
                sender: unknown,
              ) => unknown | Promise<unknown>;
              table.register(PANEL_MESSAGE_ENDPOINT, (args) => fn2(args[0], args[1]));
              // Tell the host a handler exists, so a panel message that
              // arrives before this call can be refused with a useful error
              // instead of a bare `Unknown reverse RPC method`.
              return makeRequest('panels.setMessageHandler', [true]).then(() => ({
                dispose: async () => {
                  table.unregister(PANEL_MESSAGE_ENDPOINT);
                  await makeRequest('panels.setMessageHandler', [false]);
                },
              }));
            };
            cache.set(prop, fn);
            return fn;
          }
          // `IEventsApi.subscribe(channel, handler, opts?)` cannot become an
          // RPC request - `handler` is a function and would not survive
          // serialization. Special-case it so the call goes straight to the
          // worker-side event emitter, which sends the appropriate
          // `RpcSubscribe` envelope (and, for `filter`/`provider` channels,
          // registers a `hook:` reverse handler) and dispatches `RpcEvent`s
          // back to the local handler.
          if (namespace === 'events' && prop === 'subscribe') {
            const fn = (channelName: unknown, handler: unknown, subscribeOpts?: unknown) => {
              if (typeof channelName !== 'string') {
                return Promise.reject(new TypeError('events.subscribe: channel must be a string'));
              }
              if (typeof handler !== 'function') {
                return Promise.reject(new TypeError('events.subscribe: handler must be a function'));
              }
              const order = (subscribeOpts as { order?: unknown } | undefined)?.order;
              return opts.emitter.subscribe(
                channelName,
                handler as (payload: unknown) => unknown | Promise<unknown>,
                typeof order === 'number' ? { order } : undefined,
              );
            };
            cache.set(prop, fn);
            return fn;
          }
          // `events.publish(channel, payload)` (P1.8) IS a genuine RPC call -
          // unlike `subscribe`, there is no local worker-side state to route
          // to, only the host's fan-out to *other* workers. It falls through
          // to the generic RPC branch below like any other method, so no
          // special case is needed here beyond documenting why one isn't.
          const fn = async (...args: unknown[]) => {
            const result = await makeRequest(`${namespace}.${prop}`, args);
            return maybeWrapDisposable(namespace, result, makeRequest);
          };
          cache.set(prop, fn);
          return fn;
        },
      },
    );
  }

  // --- Build the API root ----------------------------------------------
  // We list the namespaces explicitly so a typo in a call site surfaces at
  // runtime as the host's `Unknown RPC method` error, rather than silently
  // reaching an undefined namespace proxy.
  const namespaces = [
    'bible',
    'commentary',
    'book',
    'dictionary',
    'notes',
    'highlights',
    'bookmarks',
    'collections',
    'commands',
    'ui',
    'workspace',
    'context',
    'storage',
    'l10n',
    'events',
    'runtime',
    'panels',
    'network',
    'auth',
    'tasks',
    'extensions',
    'ai',
  ] as const;

  const root: Record<string, unknown> = {};
  for (const ns of namespaces) {
    root[ns] = makeNamespaceProxy(ns);
  }

  return {
    api: root as unknown as BibleExtensionAPI,
    handleResponse(res: RpcResponse): void {
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.error) {
        p.reject(reviveExtensionApiError(res.error));
      } else {
        p.resolve(res.result);
      }
    },
    hasPending(id: RpcRequestId): boolean {
      return pending.has(id);
    },
    apiVersion: EXTENSION_API_VERSION,
  };
}

/**
 * Build one `api.runtime.*` method, or return null for an unknown property so
 * the caller falls through to the generic RPC branch (which produces the
 * host's `Unknown RPC method` - the right error for a typo).
 *
 * Every method here is synchronous work wrapped in a promise: the endpoint
 * table is a local Map. They are `async` only because the contract declares
 * them so, and because making them sync later would be a breaking change
 * while making them async later would not be.
 */
function makeRuntimeMethod(
  prop: string,
  table: IReverseEndpointTable | undefined,
): ((...args: unknown[]) => Promise<unknown>) | null {
  const requireTable = (): IReverseEndpointTable => {
    if (!table) {
      throw new Error(
        `api.runtime.${prop}: this runtime was built without an endpoint table`,
      );
    }
    return table;
  };

  switch (prop) {
    case 'expose':
      return async (...args: unknown[]) => {
        const [endpoint, handler] = args;
        if (typeof endpoint !== 'string' || endpoint.length === 0) {
          throw new TypeError('runtime.expose: endpoint must be a non-empty string');
        }
        if (isReservedEndpoint(endpoint)) {
          throw new Error(
            `runtime.expose: endpoint prefixes ${RESERVED_ENDPOINT_PREFIXES.join(', ')} are reserved by the host`,
          );
        }
        if (typeof handler !== 'function') {
          throw new TypeError('runtime.expose: handler must be a function');
        }
        const t = requireTable();
        const fn = handler as (...a: unknown[]) => unknown | Promise<unknown>;
        t.register(endpoint, (callArgs) => fn(...callArgs));
        return {
          dispose: async () => {
            t.unregister(endpoint);
          },
        };
      };

    case 'unexpose':
      return async (...args: unknown[]) => {
        const [endpoint] = args;
        if (typeof endpoint !== 'string' || endpoint.length === 0) {
          throw new TypeError('runtime.unexpose: endpoint must be a non-empty string');
        }
        requireTable().unregister(endpoint);
        return undefined;
      };

    case 'listExposed':
      return async () => requireTable().list();

    default:
      return null;
  }
}

/**
 * Give a registration result the `dispose()` the contract promises.
 *
 * Twelve methods across six namespaces are declared
 * `Promise<DisposableHandle>`, and not one of them resolved with something
 * that had a `dispose` method: the wire shapes are `{disposalId}`,
 * `{providerId}` and `{handle}` depending on the namespace. An author
 * following the types - and the docs, and the `deactivate()` example every
 * scaffold ships with - wrote
 *
 *     const handle = await api.ui.registerPanelType(def);
 *     ...
 *     await handle.dispose();
 *
 * and got `TypeError: handle.dispose is not a function`, at teardown, where
 * it is least likely to be noticed during development. The host's
 * `<ns>.dispose(disposalId)` RPC existed the whole time; nothing typed could
 * reach it, because `dispose` is not a member of `IUiApi`.
 *
 * Wrapping happens here rather than in each api-impl because a function
 * cannot cross the RPC boundary - the host has no way to *send* a disposable,
 * only an id the guest can turn back into one.
 *
 * Detection is by result shape, not a list of method names: a new `register*`
 * method inherits the behaviour by returning a `disposalId`, and there is no
 * second list to fall out of sync with the first. Other keys are preserved,
 * so `providerId` and `handle` remain readable alongside `dispose()`.
 */
function maybeWrapDisposable(
  namespace: string,
  result: unknown,
  makeRequest: (method: string, args: unknown[]) => Promise<unknown>,
): unknown {
  if (result === null || typeof result !== 'object') return result;
  const disposalId = (result as { disposalId?: unknown }).disposalId;
  if (typeof disposalId !== 'string') return result;
  return {
    ...(result as Record<string, unknown>),
    async dispose(): Promise<void> {
      await makeRequest(`${namespace}.dispose`, [disposalId]);
    },
  };
}

/**
 * Worker-side `IExtensionDatabase` wrapper.
 *
 * The host returns an opaque string handle from `storage.openDatabase`. We
 * round-trip every method through `storage.db*` RPCs, passing the handle as
 * the first argument so the host's registry can route the call to the right
 * underlying connection.
 *
 * Transactions are implemented entirely in the worker: `beginTransaction`
 * returns a tx handle (currently the same string as the parent handle, but
 * the host treats it as a sentinel marking the connection as in-transaction),
 * we recursively wrap it, and on the inner work's success or throw we issue
 * `commit` or `rollback`. Auto-rollback on throw is the spec contract.
 */
function makeExtensionDatabaseWrapper(
  handle: string,
  makeRequest: (method: string, args: unknown[]) => Promise<unknown>,
): Record<string, unknown> {
  const wrapper: Record<string, unknown> = {
    exec: (sql: string) => makeRequest('storage.dbExec', [handle, sql]) as Promise<void>,
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      makeRequest('storage.dbQuery', [handle, sql, params ?? []]) as Promise<T[]>,
    queryOne: <T = unknown>(sql: string, params?: unknown[]) =>
      makeRequest('storage.dbQueryOne', [handle, sql, params ?? []]) as Promise<T | undefined>,
    run: (sql: string, params?: unknown[]) =>
      makeRequest('storage.dbRun', [handle, sql, params ?? []]) as Promise<{
        changes: number;
        lastInsertRowid: number | string;
      }>,
    transaction: async <T = unknown>(
      work: (tx: Record<string, unknown>) => Promise<T>,
    ): Promise<T> => {
      const txHandle = (await makeRequest('storage.dbBeginTransaction', [handle])) as string;
      const tx = makeExtensionDatabaseWrapper(txHandle, makeRequest);
      try {
        const result = await work(tx);
        await makeRequest('storage.dbCommit', [txHandle]);
        return result;
      } catch (err) {
        try {
          await makeRequest('storage.dbRollback', [txHandle]);
        } catch {
          /* swallow - surface the original error */
        }
        throw err;
      }
    },
    close: () => makeRequest('storage.dbClose', [handle]) as Promise<void>,
  };
  return wrapper;
}

/**
 * Tiny helper for the runtime to issue a `subscribe` envelope on behalf of
 * the event emitter. Pulled out so the emitter can stay channel-only and
 * not import the proxy file.
 */
export function sendSubscribe(
  channel: IRpcChannel,
  id: RpcRequestId,
  channelName: string,
  order?: number,
): void {
  const env: RpcSubscribe = {
    kind: 'subscribe',
    id,
    channel: channelName,
    ...(order !== undefined ? { order } : {}),
  };
  channel.send(env);
}

export function sendUnsubscribe(channel: IRpcChannel, id: RpcRequestId): void {
  const env: RpcUnsubscribe = { kind: 'unsubscribe', id };
  channel.send(env);
}

/** Quick disposable factory used by the emitter when it builds subscription handles. */
export function makeDisposableHandle(dispose: () => void | Promise<void>): DisposableHandle {
  return {
    async dispose() {
      await dispose();
    },
  };
}
