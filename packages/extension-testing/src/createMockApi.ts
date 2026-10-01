/**
 * Creates a fully-mocked `BibleExtensionAPI` for unit testing extensions.
 *
 * Every method on every namespace is a `vi.fn()` (Vitest) or a plain stub
 * function when Vitest is not available. Callers can override individual
 * methods via the `overrides` parameter.
 *
 * **Defaults come from the declarations.** The fake for each namespace is
 * generated from `Extensions.EXTENSION_API_REGISTRY`: each method resolves the
 * `fake` its namespace declaration names (`createDeclaredNamespaceFake`), so a
 * namespace declared in core is faked here with no edit to this file. Only the
 * behavioural fakes below are hand-written and overlaid on top: the whole
 * `storage` namespace (in-memory KV/secrets/database), `bible.listChapters`
 * (John extents), `runtime` and `panels` (working implementations).
 *
 * **`api.storage` is the deliberate exception.** Its KV and secrets tiers are
 * backed by real in-memory maps and round-trip, and `openDatabase` returns a
 * `MockExtensionDatabase` whose `transaction()` actually invokes the work
 * function and actually rolls back. A stub that resolves `undefined` from
 * `get` no matter what `set` was handed makes every persistence test pass
 * vacuously, and persistence is exactly what extension authors most need to
 * test. See `createMockDatabase` for what the database mock does *not* do.
 *
 * Usage:
 * ```ts
 * import { createMockApi } from '@bible/extension-testing';
 *
 * const api = createMockApi({
 *   bible: { getVerse: vi.fn().mockResolvedValue({ verseId: 43003016, text: 'For God...' }) }
 * });
 * ```
 */

import { Extensions } from '@bible/core';

import { CHAPTERS_JOHN } from './fixtures';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type DisposableHandle = Extensions.DisposableHandle;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Try to use `vi.fn()` from Vitest if available; fall back to a plain stub.
 * This lets the package work in both Vitest and Jest environments, and also
 * in plain Node.js without any test framework.
 */
function createMockFn(): (...args: unknown[]) => unknown {
  try {
    // Dynamic require to avoid hard dependency on vitest at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { vi } = require('vitest') as { vi: { fn: () => (...args: unknown[]) => unknown } };
    return vi.fn();
  } catch {
    // Vitest not available — return a plain recording stub.
    const calls: unknown[][] = [];
    const fn = (...args: unknown[]): undefined => {
      calls.push(args);
      return undefined;
    };
    (fn as unknown as Record<string, unknown>).mock = { calls };
    return fn;
  }
}

/** Create a no-op async mock fn that resolves to `value`. */
function asyncMock<T>(value: T): () => Promise<T> {
  const fn = createMockFn();
  const wrapper = (...args: unknown[]): Promise<T> => {
    fn(...args);
    return Promise.resolve(value);
  };
  // Preserve .mock for assertion
  (wrapper as unknown as Record<string, unknown>).mock = (fn as unknown as Record<string, unknown>)
    .mock;
  return wrapper;
}

/**
 * Like `asyncMock`, but runs a real implementation instead of resolving to a
 * fixed value - while keeping the `.mock.calls` affordance intact.
 *
 * `asyncMock` is right for the bulk of the surface: a test that never touches
 * `api.book.iterateSections` is better served by an empty default than by a
 * simulator. Storage is the exception. An extension's own persistence logic
 * is frequently the thing under test, and a `set` whose following `get`
 * cannot see it turns every such test into a tautology that passes no matter
 * what the extension does. So the storage namespace gets behaviour, not
 * defaults.
 */
function recordingImpl<A extends unknown[], R>(
  impl: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  const spy = createMockFn();
  const wrapper = async (...args: A): Promise<R> => {
    spy(...(args as unknown[]));
    return impl(...args);
  };
  // Same handoff `asyncMock` performs, so `fn.mock.calls` keeps working.
  (wrapper as unknown as Record<string, unknown>).mock = (spy as unknown as Record<string, unknown>)
    .mock;
  return wrapper;
}

/** Create a mock DisposableHandle. */
function mockDisposable(): DisposableHandle {
  return { dispose: asyncMock<void>(undefined) };
}

/** One statement an extension asked a `MockExtensionDatabase` to run. */
export interface MockDbStatement {
  /** `exec` carries no params; the others record whatever was bound. */
  method: 'exec' | 'query' | 'queryOne' | 'run';
  sql: string;
  params: readonly unknown[];
}

/** Outcome of one `transaction()` call on a `MockExtensionDatabase`. */
export interface MockDbTransactionRecord {
  /** Everything the work function issued, whether or not it survived. */
  attempted: readonly MockDbStatement[];
  outcome: 'commit' | 'rollback';
  /** The error that caused the rollback, if any. */
  error?: unknown;
}

/**
 * The object `createMockApi()`'s `storage.openDatabase` resolves to: a real
 * `IExtensionDatabase` plus the inspection handles a test needs.
 */
export interface MockExtensionDatabase extends Extensions.IExtensionDatabase {
  /** The database name it was opened under. */
  readonly name: string;
  /**
   * Durable statement log. Statements issued inside a transaction land here
   * only when that transaction commits - a rollback discards them, which is
   * the whole point of the log being the mock's state (see the class note on
   * `createMockDatabase`).
   */
  readonly statements: readonly MockDbStatement[];
  /** One entry per completed `transaction()` call, in completion order. */
  readonly transactions: readonly MockDbTransactionRecord[];
  readonly isClosed: boolean;
}

/**
 * In-memory stand-in for a per-extension SQLite database.
 *
 * **Stated limitation, because a silent one would be worse than none:** there
 * is no SQL engine here. `exec` / `query` / `queryOne` / `run` record the
 * statement and return the empty defaults - no table is created, no row is
 * stored, and `query` will not return what a previous `run` inserted. A test
 * that needs rows back must override `storage.openDatabase` with its own
 * fake (or drive a real `better-sqlite3` if it can).
 *
 * What *is* real, and what the old `asyncMock(undefined)` got wrong:
 *
 *   - `transaction(work)` **calls `work`**, passing a transaction-scoped
 *     handle, resolves with whatever `work` resolves to, and rethrows what
 *     `work` throws. The previous mock never invoked the callback at all, so
 *     every line of transactional code went unexecuted and the test passed
 *     regardless.
 *   - Rollback is **really performed** over the only state the mock holds.
 *     Statements issued inside a transaction are buffered; on success they
 *     are appended to `statements`, on failure they are dropped. So an
 *     assertion on `db.statements` sees the post-rollback world, exactly as
 *     an assertion against a real database would. `db.transactions` keeps the
 *     attempted statements so a test can still inspect what was tried.
 *   - Nested transactions throw, as the host's `ExtensionDatabaseRegistry`
 *     does - `beginTransaction` rejects a second `BEGIN` on the same handle.
 *   - Use after `close()` throws, as a closed handle does on the host.
 */
function createMockDatabase(name: string): MockExtensionDatabase {
  const statements: MockDbStatement[] = [];
  const transactions: MockDbTransactionRecord[] = [];
  let closed = false;
  let inTransaction = false;

  const assertOpen = (method: string): void => {
    if (closed) {
      throw new Error(`storage.db.${method}: database '${name}' is closed`);
    }
  };

  /**
   * Build the surface shared by the database and its transaction handle. The
   * only difference between the two is where statements accumulate and
   * whether `transaction` is allowed to nest.
   */
  const makeSurface = (
    sink: MockDbStatement[],
    nested: boolean,
  ): Extensions.IExtensionDatabase => ({
    exec: recordingImpl(async (sql: string): Promise<void> => {
      assertOpen('exec');
      sink.push({ method: 'exec', sql, params: [] });
    }),
    query: recordingImpl(async (sql: string, params?: unknown[]): Promise<unknown[]> => {
      assertOpen('query');
      sink.push({ method: 'query', sql, params: params ?? [] });
      return [];
    }) as Extensions.IExtensionDatabase['query'],
    queryOne: recordingImpl(async (sql: string, params?: unknown[]): Promise<undefined> => {
      assertOpen('queryOne');
      sink.push({ method: 'queryOne', sql, params: params ?? [] });
      return undefined;
    }) as Extensions.IExtensionDatabase['queryOne'],
    run: recordingImpl(async (sql: string, params?: unknown[]) => {
      assertOpen('run');
      sink.push({ method: 'run', sql, params: params ?? [] });
      // No engine, so no honest row count. Override `openDatabase` if the
      // code under test branches on `changes` or `lastInsertRowid`.
      return { changes: 0, lastInsertRowid: 0 as number | string };
    }),
    transaction: recordingImpl(
      async (work: (tx: Extensions.IExtensionDatabase) => Promise<unknown>): Promise<unknown> => {
        assertOpen('transaction');
        if (nested || inTransaction) {
          throw new Error(
            'storage.db.transaction: nested transactions are not supported',
          );
        }
        if (typeof work !== 'function') {
          throw new TypeError('storage.db.transaction: work must be a function');
        }
        inTransaction = true;
        const buffered: MockDbStatement[] = [];
        try {
          const result = await work(makeSurface(buffered, true));
          statements.push(...buffered);
          transactions.push({ attempted: buffered, outcome: 'commit' });
          return result;
        } catch (err) {
          // Rollback: `buffered` is discarded rather than merged, so the
          // durable log never shows work the transaction abandoned.
          transactions.push({ attempted: buffered, outcome: 'rollback', error: err });
          throw err;
        } finally {
          inTransaction = false;
        }
      },
    ) as Extensions.IExtensionDatabase['transaction'],
    close: recordingImpl(async (): Promise<void> => {
      closed = true;
    }),
  });

  const surface = makeSurface(statements, false);

  return {
    ...surface,
    name,
    statements,
    transactions,
    get isClosed() {
      return closed;
    },
  };
}

/**
 * `bible.listChapters`: answers for John, empty for every other book, and
 * rejects an id outside the canon.
 *
 * An empty default would be actively misleading here. `listChapters` is how a
 * passage range is resolved (`collections.addPassage` needs the `lastVerseId`
 * only this call can give), so an extension that gets `[]` back does not fail,
 * it silently adds nothing, and the test passes. John is the book every other
 * fixture in this package anchors to. The out-of-canon rejection mirrors
 * `bibleApiImpl.handleListChapters`. Override the method for anything else.
 */
function createMockListChapters() {
  return recordingImpl(
    async (bookNumber: number, _moduleId?: string): Promise<Extensions.BibleChapterDto[]> => {
      if (!Number.isInteger(bookNumber) || bookNumber < 1 || bookNumber > 66) {
        throw new TypeError(
          `bible.listChapters: bookNumber must be an integer 1-66, got ${String(bookNumber)}`,
        );
      }
      return bookNumber === 43 ? CHAPTERS_JOHN.map((c) => ({ ...c })) : [];
    },
  );
}

function createMockStorageOverlay(): Partial<Extensions.IStorageApi> {
  // Real backing stores. The KV tier round-trips through `kv`, so an
  // extension that writes a value and reads it back on the next activation
  // sees what it wrote - the behaviour its own tests are trying to pin.
  const kv = new Map<string, string>();
  const secrets = new Map<string, string>();
  const databases = new Map<string, MockExtensionDatabase>();

  /**
   * The host serializes every KV value with `JSON.stringify` before it
   * touches SQLite (`storageApiImpl.handleSet`) and rejects anything that
   * will not survive. Storing the caller's object by reference instead would
   * hide two real bugs: a value that cannot cross the RPC boundary, and code
   * that mutates an object after storing it and "reads back" the mutation.
   */
  const serialize = (value: unknown): string => {
    let out: string | undefined;
    try {
      out = JSON.stringify(value);
    } catch (err) {
      throw new TypeError(
        `storage.set: value is not JSON-serializable: ${(err as Error).message}`,
      );
    }
    if (out === undefined) {
      throw new TypeError('storage.set: value is not JSON-serializable');
    }
    return out;
  };

  return {
    get: recordingImpl(async (key: string): Promise<unknown> => {
      const raw = kv.get(key);
      return raw === undefined ? undefined : JSON.parse(raw);
    }) as Extensions.IStorageApi['get'],
    set: recordingImpl(async (key: string, value: unknown): Promise<void> => {
      kv.set(key, serialize(value));
    }),
    delete: recordingImpl(async (key: string): Promise<void> => {
      kv.delete(key);
    }),
    keys: recordingImpl(async (): Promise<string[]> => Array.from(kv.keys())),
    setSecret: recordingImpl(async (key: string, value: string): Promise<void> => {
      secrets.set(key, value);
    }),
    getSecret: recordingImpl(async (key: string): Promise<string | undefined> => secrets.get(key)),
    deleteSecret: recordingImpl(async (key: string): Promise<void> => {
      secrets.delete(key);
    }),
    // Keyed by name, so a test can re-open the same database to inspect what
    // the extension did to it. A closed handle is replaced rather than
    // resurrected, which is what a second `openDatabase` gets on the host.
    openDatabase: recordingImpl(async (name: string): Promise<Extensions.IExtensionDatabase> => {
      const existing = databases.get(name);
      if (existing && !existing.isClosed) return existing;
      const db = createMockDatabase(name);
      databases.set(name, db);
      return db;
    }) as Extensions.IStorageApi['openDatabase'],
    // Derived from the real stores rather than pinned at zero, so a quota
    // check in the extension has something that moves to look at.
    diskUsage: recordingImpl(async () => {
      let bytes = 0;
      for (const [key, value] of kv) bytes += key.length + value.length;
      return { kv: bytes, databases: 0, secretsCount: secrets.size };
    }),
  };
}

// ─── Runtime + panels: real behaviour, not stubs ──────────────────────────────

/**
 * Unlike every other namespace here, `runtime` and `panels` are mocked with
 * working implementations rather than recording stubs.
 *
 * A stub would make them untestable in the one way that matters. The whole
 * point of `runtime.expose` is that the host can later call the function you
 * bound; the whole point of `panels.onMessage` is that a panel can later send
 * you something. A `vi.fn()` that resolves a fake handle records the
 * registration and then has nowhere to call back to, so a test can assert
 * "the extension registered a handler" but never "the handler does the right
 * thing" - which is the assertion worth writing.
 *
 * Both are pure in-memory maps with no host behind them, so they behave
 * exactly as the real worker-side implementations do: those are worker-local
 * too.
 */
export interface MockPanelChannel {
  /**
   * Call the handler the extension registered with
   * `api.panels.onMessage(...)`, as the host would when a panel posts.
   *
   * Rejects if the extension never registered one - the same failure a real
   * panel gets, rather than a silent undefined.
   */
  deliver(message: unknown, sender?: Partial<Extensions.PanelMessageSender>): Promise<unknown>;
  /** True once the extension has registered a handler. */
  hasHandler(): boolean;
  /** Everything the extension pushed with `api.panels.postMessage(...)`. */
  posted: { message: unknown; panelId?: string }[];
}

export interface MockRuntimeEndpoints {
  /** Call an endpoint the extension bound with `api.runtime.expose(...)`. */
  invoke(endpoint: string, ...args: unknown[]): Promise<unknown>;
  /** Endpoint names currently bound. */
  list(): string[];
}

const panelChannels = new WeakMap<object, MockPanelChannel>();
const runtimeEndpoints = new WeakMap<object, MockRuntimeEndpoints>();

/**
 * The driver for a mock api's panel channel.
 *
 * ```ts
 * const api = createMockApi();
 * await extension.activate(api);
 * const reply = await getMockPanelChannel(api).deliver({ type: 'load' });
 * ```
 */
export function getMockPanelChannel(api: BibleExtensionAPI): MockPanelChannel {
  const channel = panelChannels.get(api as unknown as object);
  if (!channel) {
    throw new Error('getMockPanelChannel: this api was not built by createMockApi()');
  }
  return channel;
}

/** The driver for a mock api's `runtime.expose` endpoint table. */
export function getMockRuntimeEndpoints(api: BibleExtensionAPI): MockRuntimeEndpoints {
  const endpoints = runtimeEndpoints.get(api as unknown as object);
  if (!endpoints) {
    throw new Error('getMockRuntimeEndpoints: this api was not built by createMockApi()');
  }
  return endpoints;
}

function createMockRuntimeApi(): {
  api: Extensions.IRuntimeApi;
  driver: MockRuntimeEndpoints;
} {
  const table = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>();
  return {
    api: {
      expose: async (endpoint, handler) => {
        if (typeof endpoint !== 'string' || endpoint.length === 0) {
          throw new TypeError('runtime.expose: endpoint must be a non-empty string');
        }
        if (typeof handler !== 'function') {
          throw new TypeError('runtime.expose: handler must be a function');
        }
        table.set(endpoint, handler);
        return {
          dispose: async () => {
            table.delete(endpoint);
          },
        };
      },
      unexpose: async (endpoint) => {
        table.delete(endpoint);
      },
      listExposed: async () => [...table.keys()],
    },
    driver: {
      invoke: async (endpoint, ...args) => {
        const handler = table.get(endpoint);
        if (!handler) {
          throw new Error(
            `No handler bound to '${endpoint}'. Bound: ${[...table.keys()].join(', ') || '(none)'}`,
          );
        }
        return handler(...args);
      },
      list: () => [...table.keys()],
    },
  };
}

function createMockPanelsApi(): {
  api: Extensions.IPanelsApi;
  driver: MockPanelChannel;
} {
  let handler:
    | ((message: unknown, sender: Extensions.PanelMessageSender) => unknown | Promise<unknown>)
    | null = null;
  const posted: { message: unknown; panelId?: string }[] = [];

  return {
    api: {
      onMessage: async (h) => {
        if (typeof h !== 'function') {
          throw new TypeError('panels.onMessage: handler must be a function');
        }
        handler = h;
        return {
          dispose: async () => {
            handler = null;
          },
        };
      },
      postMessage: async (message, opts) => {
        posted.push({
          message,
          ...(opts?.panelId !== undefined ? { panelId: opts.panelId } : {}),
        });
      },
    },
    driver: {
      deliver: async (message, sender) => {
        if (!handler) {
          throw new Error(
            'No panel message handler registered. Call api.panels.onMessage(...) first.',
          );
        }
        return handler(message, {
          extensionId: 'ext.test.mock',
          panelId: 'panel-1',
          panelTypeId: 'ext.test.mock.panel',
          ...sender,
        });
      },
      hasHandler: () => handler !== null,
      posted,
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deep-partial type for overriding individual methods on any namespace.
 */
export type MockApiOverrides = {
  [K in keyof BibleExtensionAPI]?: Partial<NonNullable<BibleExtensionAPI[K]>>;
};

export interface CreateMockApiOptions {
  /**
   * Namespaces beyond the registry's (e.g. a sample one a test declares with
   * `Extensions.defineApiNamespace`). They are faked from their declarations
   * exactly like the built-in ones.
   */
  extraNamespaces?: readonly Extensions.AnyApiNamespaceDeclaration[];
}

/**
 * Build the fake of one declared namespace: an async recording mock per
 * declared method, resolving that method's declared `fake` (a deep copy of
 * the value made once, here; a mock `DisposableHandle`; or `undefined`).
 */
export function createDeclaredNamespaceFake(
  decl: Extensions.AnyApiNamespaceDeclaration,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [method, m] of Object.entries(decl.methods as Record<string, Extensions.MethodDeclaration>)) {
    const fake = m.fake;
    if (fake === undefined) {
      out[method] = asyncMock<unknown>(undefined);
    } else if (fake.kind === 'disposable') {
      out[method] = asyncMock<unknown>(mockDisposable());
    } else {
      out[method] = asyncMock<unknown>(structuredClone(fake.value));
    }
  }
  return out;
}

/**
 * Create a fully-mocked `BibleExtensionAPI`. Every method returns the default
 * its namespace declaration's `fake` names (empty arrays, null, undefined,
 * false, etc.). Pass `overrides` to replace specific methods with your own
 * mocks or implementations.
 *
 * ```ts
 * const api = createMockApi({
 *   bible: {
 *     getVerse: vi.fn().mockResolvedValue({ verseId: 43003016, text: 'For God so loved...' }),
 *   },
 * });
 * ```
 */
export function createMockApi(
  overrides?: MockApiOverrides,
  options?: CreateMockApiOptions,
): BibleExtensionAPI {
  const runtime = createMockRuntimeApi();
  const panels = createMockPanelsApi();

  const namespaces = [
    ...Extensions.EXTENSION_API_REGISTRY.namespaces,
    ...(options?.extraNamespaces ?? []),
  ];
  const base: Record<string, Record<string, unknown>> = {};
  for (const decl of namespaces) base[decl.name] = createDeclaredNamespaceFake(decl);

  // Behavioural overlays: these replace (or extend) the declared fakes.
  Object.assign(base.bible, { listChapters: createMockListChapters() });
  Object.assign(base.storage, createMockStorageOverlay());
  base.runtime = runtime.api as unknown as Record<string, unknown>;
  base.panels = panels.api as unknown as Record<string, unknown>;

  if (overrides) {
    for (const [ns, nsOverrides] of Object.entries(overrides as Record<string, unknown>)) {
      if (nsOverrides) {
        base[ns] ??= {};
        Object.assign(base[ns], nsOverrides);
      }
    }
  }

  const api = base as unknown as BibleExtensionAPI;
  // Register the drivers *after* overrides, keyed by the api object the caller
  // will hold, so `getMockPanelChannel(api)` works on exactly what they got.
  // Note an override of `panels.onMessage` replaces the recording
  // implementation, and the driver then has nothing to deliver to - which is
  // the correct behaviour: the caller took over the channel.
  panelChannels.set(api as unknown as object, panels.driver);
  runtimeEndpoints.set(api as unknown as object, runtime.driver);

  return api;
}
