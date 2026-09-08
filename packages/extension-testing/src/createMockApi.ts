/**
 * Creates a fully-mocked `BibleExtensionAPI` for unit testing extensions.
 *
 * Every method on every namespace is a `vi.fn()` (Vitest) or a plain stub
 * function when Vitest is not available. Callers can override individual
 * methods via the `overrides` parameter.
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

import type { Extensions } from '@bible/core';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type DisposableHandle = Extensions.DisposableHandle;
type IEventApi<T> = Extensions.IEventApi<T>;

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

/** Create a mock DisposableHandle. */
function mockDisposable(): DisposableHandle {
  return { dispose: asyncMock<void>(undefined) };
}

/** Create a mock IEventApi<T>. */
function mockEvent<T>(): IEventApi<T> {
  return {
    subscribe: asyncMock(mockDisposable()) as IEventApi<T>['subscribe'],
  };
}

// ─── Namespace mock builders ──────────────────────────────────────────────────

function createMockBibleApi(): Extensions.IBibleApi {
  return {
    getVerse: asyncMock({ verseId: 0, text: '' } as Extensions.BibleVerseDto),
    getRange: asyncMock([] as Extensions.BibleVerseDto[]),
    listModules: asyncMock([] as Extensions.BibleModuleInfoDto[]),
    listBooks: asyncMock([] as Extensions.BibleBookDto[]),
    iterateVerses: asyncMock({ verses: [], hasMore: false } as Extensions.VerseIterationResult),
    parseReference: asyncMock(null),
    getVerseTokens: asyncMock(null),
    navigateToVerse: asyncMock<void>(undefined),
    registerProvider: asyncMock(mockDisposable()),
    onDidChangeActiveVerse: mockEvent(),
    onDidSelectVerseWord: mockEvent(),
  };
}

function createMockCommentaryApi(): Extensions.ICommentaryApi {
  return {
    listModules: asyncMock([] as Extensions.CommentaryModuleInfoDto[]),
    getEntry: asyncMock(null),
    getEntriesForRange: asyncMock([] as Extensions.CommentaryEntryDto[]),
    iterateEntries: asyncMock({ entries: [], hasMore: false } as Extensions.CommentaryIterationResult),
    registerProvider: asyncMock(mockDisposable()),
    onDidChangeActiveCommentary: mockEvent(),
  };
}

function createMockDictionaryApi(): Extensions.IDictionaryApi {
  return {
    listModules: asyncMock([] as Extensions.DictionaryModuleInfoDto[]),
    lookup: asyncMock(null),
    search: asyncMock([] as Extensions.DictionaryEntryDto[]),
    iterateEntries: asyncMock({ entries: [], hasMore: false } as Extensions.DictionaryIterationResult),
    registerProvider: asyncMock(mockDisposable()),
    onDidChangeActiveDictionary: mockEvent(),
  };
}

function createMockBookApi(): Extensions.IBookApi {
  return {
    listModules: asyncMock([] as Extensions.BookModuleInfoDto[]),
    getSection: asyncMock(null),
    listSections: asyncMock([] as Extensions.BookSectionSummaryDto[]),
    iterateSections: asyncMock({ sections: [], hasMore: false } as Extensions.BookIterationResult),
    registerProvider: asyncMock(mockDisposable()),
    onDidChangeActiveBook: mockEvent(),
  };
}

function createMockNotesApi(): Extensions.INotesApi {
  return {
    list: asyncMock([] as Extensions.UserNoteDto[]),
    get: asyncMock(null),
    create: asyncMock({ id: 'mock-note', content: '', createdAt: 0, updatedAt: 0 } as Extensions.UserNoteDto),
    update: asyncMock({ id: 'mock-note', content: '', createdAt: 0, updatedAt: 0 } as Extensions.UserNoteDto),
    delete: asyncMock<void>(undefined),
    onDidChange: mockEvent(),
  };
}

function createMockHighlightsApi(): Extensions.IHighlightsApi {
  return {
    list: asyncMock([] as Extensions.UserHighlightDto[]),
    create: asyncMock({ id: 'mock-hl', range: { verseId: 0 }, styleId: '', createdAt: 0, updatedAt: 0 } as Extensions.UserHighlightDto),
    update: asyncMock({ id: 'mock-hl', range: { verseId: 0 }, styleId: '', createdAt: 0, updatedAt: 0 } as Extensions.UserHighlightDto),
    delete: asyncMock<void>(undefined),
    registerStyle: asyncMock(mockDisposable()),
    listStyles: asyncMock([] as Extensions.HighlightStyleDescriptor[]),
    onDidChange: mockEvent(),
  };
}

function createMockBookmarksApi(): Extensions.IBookmarksApi {
  return {
    list: asyncMock([] as Extensions.BookmarkDto[]),
    add: asyncMock({ id: 'mock-bm', verseId: 0, createdAt: 0 } as Extensions.BookmarkDto),
    remove: asyncMock<void>(undefined),
    listCollections: asyncMock([] as Extensions.CollectionDto[]),
    createCollection: asyncMock({ id: 'mock-col', name: '', count: 0, createdAt: 0 } as Extensions.CollectionDto),
  };
}

function createMockCommandsApi(): Extensions.ICommandsApi {
  return {
    register: asyncMock(mockDisposable()),
    execute: asyncMock(undefined as unknown),
  };
}

function createMockUiApi(): Extensions.IUiApi {
  return {
    registerPanelType: asyncMock(mockDisposable()),
    registerVerseDecorator: asyncMock(mockDisposable()),
    updateVerseDecorations: asyncMock<void>(undefined),
    registerVerseHover: asyncMock(mockDisposable()),
    registerContextMenu: asyncMock(mockDisposable()),
    registerDisplayMode: asyncMock(mockDisposable()),
    registerStatusBarItem: asyncMock(mockDisposable()),
    showNotification: asyncMock<void>(undefined),
    showQuickPick: asyncMock(undefined),
    showInputBox: asyncMock(undefined),
    showConfirm: asyncMock(false),
    pickFile: asyncMock(undefined),
    saveFile: asyncMock(false),
  };
}

function createMockWorkspaceApi(): Extensions.IWorkspaceApi {
  return {
    getActivePanel: asyncMock(null),
    getOpenPanels: asyncMock([] as Extensions.PanelInfoDto[]),
    openPanel: asyncMock('mock-panel-id'),
    closePanel: asyncMock<void>(undefined),
    onDidChangeActivePanel: mockEvent(),
    onDidOpenPanel: mockEvent(),
    onDidClosePanel: mockEvent(),
  };
}

function createMockContextApi(): Extensions.IContextApi {
  return {
    get: asyncMock(undefined),
    set: asyncMock<void>(undefined),
    onDidChange: mockEvent(),
  };
}

function createMockStorageApi(): Extensions.IStorageApi {
  return {
    get: asyncMock(undefined),
    set: asyncMock<void>(undefined),
    delete: asyncMock<void>(undefined),
    keys: asyncMock([] as string[]),
    setSecret: asyncMock<void>(undefined),
    getSecret: asyncMock(undefined),
    deleteSecret: asyncMock<void>(undefined),
    getSetting: asyncMock(undefined),
    onDidChangeSettings: mockEvent(),
    openDatabase: asyncMock({
      exec: asyncMock<void>(undefined),
      query: asyncMock([]),
      queryOne: asyncMock(undefined),
      run: asyncMock({ changes: 0, lastInsertRowid: 0 }),
      transaction: asyncMock(undefined),
      close: asyncMock<void>(undefined),
    } as Extensions.IExtensionDatabase),
    diskUsage: asyncMock({ kv: 0, databases: 0, secretsCount: 0 }),
    // Managed folder methods
    requestFolder: asyncMock(null),
    getFolderGrant: asyncMock(null),
    revokeFolderGrant: asyncMock<void>(undefined),
    readFile: asyncMock(new ArrayBuffer(0)),
    writeFile: asyncMock<void>(undefined),
    deleteFile: asyncMock<void>(undefined),
    listFiles: asyncMock([] as Extensions.FileInfo[]),
    statFile: asyncMock(null),
    getFolderUsage: asyncMock({ path: '', fileCount: 0, totalBytes: 0 } as Extensions.FolderUsageInfo),
  };
}

function createMockL10nApi(): Extensions.IL10nApi {
  return {
    t: asyncMock(''),
    currentLocale: asyncMock('en'),
    onDidChangeLocale: mockEvent(),
  };
}

function createMockEventsApi(): Extensions.IEventsApi {
  return {
    subscribe: asyncMock(mockDisposable()) as Extensions.IEventsApi['subscribe'],
  };
}

function createMockNetworkApi(): Extensions.INetworkApi {
  return {
    fetch: asyncMock({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {},
      url: '',
      body: '',
    } as Extensions.NetworkFetchResponse),
    isHostAllowed: asyncMock(false),
  };
}

function createMockAuthApi(): Extensions.IAuthApi {
  return {
    startOAuth: asyncMock({
      accessToken: '',
      tokenType: 'Bearer',
      raw: {},
    } as Extensions.OAuthResult),
    refreshOAuth: asyncMock({
      accessToken: '',
      tokenType: 'Bearer',
      raw: {},
    } as Extensions.OAuthResult),
    openExternal: asyncMock<void>(undefined),
  };
}

function createMockTasksApi(): Extensions.ITasksApi {
  return {
    // `run` is generic (`<T = void>(...) => Promise<T>`); a concrete mock cannot satisfy an
    // arbitrary caller-chosen `T`, so the cast is required rather than incidental.
    run: asyncMock<void>(undefined) as Extensions.ITasksApi['run'],
    reportProgress: asyncMock<void>(undefined),
    isCancellationRequested: asyncMock(false),
    cancel: asyncMock<void>(undefined),
    list: asyncMock([] as Extensions.BackgroundTaskInfo[]),
  };
}

function createMockExtensionsApi(): Extensions.IExtensionsApi {
  return {
    // Generic (`<T = unknown>(...) => Promise<T>`) — same reason as ITasksApi.run above.
    call: asyncMock(undefined as unknown) as Extensions.IExtensionsApi['call'],
    isActive: asyncMock(false),
    listProviders: asyncMock([] as Extensions.ExtensionProviderInfo[]),
    onDidActivate: mockEvent(),
    onDidDeactivate: mockEvent(),
  };
}

function createMockAiApi(): Extensions.IAiApi {
  return {
    isAvailable: asyncMock(false),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Deep-partial type for overriding individual methods on any namespace.
 */
export type MockApiOverrides = {
  [K in keyof BibleExtensionAPI]?: Partial<BibleExtensionAPI[K]>;
};

/**
 * Create a fully-mocked `BibleExtensionAPI`. Every method returns a sensible
 * default (empty arrays, null, undefined, false, etc.). Pass `overrides` to
 * replace specific methods with your own mocks or implementations.
 *
 * ```ts
 * const api = createMockApi({
 *   bible: {
 *     getVerse: vi.fn().mockResolvedValue({ verseId: 43003016, text: 'For God so loved...' }),
 *   },
 * });
 * ```
 */
export function createMockApi(overrides?: MockApiOverrides): BibleExtensionAPI {
  const base: BibleExtensionAPI = {
    bible: createMockBibleApi(),
    commentary: createMockCommentaryApi(),
    dictionary: createMockDictionaryApi(),
    book: createMockBookApi(),
    notes: createMockNotesApi(),
    highlights: createMockHighlightsApi(),
    bookmarks: createMockBookmarksApi(),
    commands: createMockCommandsApi(),
    ui: createMockUiApi(),
    workspace: createMockWorkspaceApi(),
    context: createMockContextApi(),
    storage: createMockStorageApi(),
    l10n: createMockL10nApi(),
    events: createMockEventsApi(),
    network: createMockNetworkApi(),
    auth: createMockAuthApi(),
    tasks: createMockTasksApi(),
    extensions: createMockExtensionsApi(),
    ai: createMockAiApi(),
  };

  if (overrides) {
    for (const ns of Object.keys(overrides) as (keyof BibleExtensionAPI)[]) {
      const nsOverrides = overrides[ns];
      if (nsOverrides) {
        Object.assign(base[ns], nsOverrides);
      }
    }
  }

  return base;
}
