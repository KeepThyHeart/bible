/**
 * BibleExtensionAPI proxy generator (worker side).
 *
 * The host injects a `BibleExtensionAPI` instance into each extension
 * worker. Rather than ship a hand-written namespace
 * shim per API surface area, we use a `Proxy` that turns every method call
 * into an `RpcRequest` envelope on the wire and resolves with the response.
 *
 * Each top-level namespace (`bible`, `commentary`, ...) is itself a Proxy that
 * routes property access to the request channel. Method names like
 * `onDidChangeActiveVerse` are special-cased: they return an `IEventApi<T>`
 * backed by the runtime's event emitter, so extension code can write
 * `api.bible.onDidChangeActiveVerse.subscribe(handler)` and get a real
 * disposable handle.
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
type IEventApi<T> = Extensions.IEventApi<T>;
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

/**
 * Method names that should be returned as `IEventApi<T>` rather than
 * dispatched as RPC.
 *
 * This table **must** name exactly the `IEventApi<...>` members of
 * `ExtensionApiTypes.ts` - no more, no less. Both kinds of drift fail
 * silently, which is why `ApiSurfaceContract.test.ts` derives the expected
 * table from the type declarations and diffs it against this one:
 *
 *   - **A missing name** falls through to the generic RPC branch below, so
 *     `api.notes.onDidChange` evaluates to a *function*. The author writes
 *     the documented `.subscribe(handler)` and gets
 *     `TypeError: api.notes.onDidChange.subscribe is not a function`,
 *     against an API the types say exists.
 *   - **An extra name** yields an `IEventApi` for a channel nothing ever
 *     emits. `subscribe()` resolves with a real handle and the handler is
 *     never called - indistinguishable, from inside the extension, from an
 *     event that simply has not fired yet.
 *
 * The shape is `Record<namespace, Set<eventPropName>>` so we can short-
 * circuit lookups in the proxy without iterating a flat list.
 *
 * Exported for the contract test only; extension code never sees it.
 */
export const EVENT_PROPERTIES: Record<string, ReadonlySet<string>> = {
  bible: new Set(['onDidChangeActiveVerse', 'onDidSelectVerseWord']),
  commentary: new Set(['onDidChangeActiveCommentary']),
  dictionary: new Set(['onDidChangeActiveDictionary']),
  book: new Set(['onDidChangeActiveBook']),
  notes: new Set(['onDidChange']),
  highlights: new Set(['onDidChange']),
  workspace: new Set(['onDidChangeActivePanel', 'onDidOpenPanel', 'onDidClosePanel']),
  context: new Set(['onDidChange']),
  storage: new Set(['onDidChangeSettings']),
  l10n: new Set(['onDidChangeLocale']),
  extensions: new Set(['onDidActivate', 'onDidDeactivate']),
};

interface PendingForwardRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Build the `BibleExtensionAPI` proxy. Returns the API plus a `dispatch`
 * callback the runtime feeds incoming `RpcResponse` envelopes into so the
 * proxy can resolve pending requests.
 */
export function createApiProxy(opts: {
  channel: IRpcChannel;
  emitter: ExtensionEventEmitter;
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

  function makeEventApi<T>(channel: string): IEventApi<T> {
    return {
      subscribe: (handler: (payload: T) => void | Promise<void>) =>
        opts.emitter.subscribe<T>(channel, handler),
    };
  }

  function makeNamespaceProxy(namespace: string): Record<string, unknown> {
    const eventNames = EVENT_PROPERTIES[namespace] ?? new Set<string>();
    const cache = new Map<string, unknown>();
    return new Proxy<Record<string, unknown>>(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (cache.has(prop)) return cache.get(prop);
          if (eventNames.has(prop)) {
            const ev = makeEventApi(`${namespace}.${prop}`);
            cache.set(prop, ev);
            return ev;
          }
          // `IEventsApi.subscribe(channel, handler)` cannot become an RPC
          // request - `handler` is a function and would not survive
          // serialization. Special-case it so the call goes straight to
          // the worker-side event emitter, which sends the appropriate
          // `RpcSubscribe` envelope and dispatches `RpcEvent`s back to
          // the local handler.

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
          if (namespace === 'events' && prop === 'subscribe') {
            const fn = (channelName: unknown, handler: unknown) => {
              if (typeof channelName !== 'string') {
                return Promise.reject(new TypeError('events.subscribe: channel must be a string'));
              }
              if (typeof handler !== 'function') {
                return Promise.reject(new TypeError('events.subscribe: handler must be a function'));
              }
              return opts.emitter.subscribe(
                channelName,
                handler as (payload: unknown) => void | Promise<void>,
              );
            };
            cache.set(prop, fn);
            return fn;
          }
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
  // We list the namespaces explicitly so a typo in `EVENT_PROPERTIES` is
  // caught at runtime - if a namespace is missing here, the host's
  // `Unknown RPC method` error surfaces immediately.
  const namespaces = [
    'bible',
    'commentary',
    'book',
    'dictionary',
    'notes',
    'highlights',
    'bookmarks',
    'commands',
    'ui',
    'workspace',
    'context',
    'storage',
    'l10n',
    'events',
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
): void {
  const env: RpcSubscribe = { kind: 'subscribe', id, channel: channelName };
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
