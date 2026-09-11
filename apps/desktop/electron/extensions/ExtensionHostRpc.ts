/**
 * RPC namespace wiring for `ExtensionHost`.
 *
 * `attachApiImpls` is called once per worker spawn, *after* the router is
 * created but *before* the `runtime.init` handshake, so every api-impl has
 * claimed its RPC namespace by the time the extension code runs.
 *
 * Each api-impl is gated behind:
 *   - The corresponding bridge/factory being wired on the host (so test
 *     harnesses that omit a bridge get a smaller attack surface), and/or
 *   - The extension having been granted the matching permission.
 *
 * The rules are mechanical: the gate is the only thing that decides whether a
 * namespace is attached.
 */

import log from 'electron-log';
import { Extensions } from '@bible/core';

import {
  AuthApiImpl,
  BibleApiImpl,
  BookApiImpl,
  BookmarksApiImpl,
  CollectionsApiImpl,
  CommandsApiImpl,
  CommentaryApiImpl,
  ContextApiImpl,
  DictionaryApiImpl,
  EventsApiImpl,
  ExtensionsApiImpl,
  FolderStorageApiImpl,
  HighlightsApiImpl,
  L10nApiImpl,
  NetworkApiImpl,
  NotesApiImpl,
  StorageApiImpl,
  TasksApiImpl,
  PanelsApiImpl,
  UiApiImpl,
  WorkspaceApiImpl,
} from './api-impl';
import type { ExtensionRpcRouter } from './ExtensionRpcRouter';
import { buildGrant } from './ExtensionPermissionGuard';
import type { ActiveWorker, ExtensionHostContext } from './ExtensionHostTypes';

const { RpcProtocolError } = Extensions;

type ExtensionRegistryEntry = ReturnType<
  ExtensionHostContext['registry']['getEntry']
>;

/**
 * Attach every eligible api-impl to the freshly-spawned worker's router.
 * Mutates `active` in place. Safe to assume `entry` is non-null - the caller
 * already dereferenced it to spawn the worker.
 */
export function attachApiImpls(
  ctx: ExtensionHostContext,
  extensionId: string,
  entry: NonNullable<ExtensionRegistryEntry>,
  router: ExtensionRpcRouter,
  active: ActiveWorker,
): void {
  // Build the per-extension permission grant. The grant is a snapshot at
  // activation time - `updatePermissions` rebuilds it on the next call.
  const grant = buildGrant(extensionId, entry.grantedPermissions);

  // Wire renderer integration: commands + context. Both api-impls register
  // their RPC namespaces on the router *before* the init handshake so an
  // extension that calls `api.commands.register(...)` from inside its
  // own `activate()` does not race the wiring.
  if (ctx.commandBridge) {
    const commandsApi = new CommandsApiImpl({
      extensionId,
      router,
      bridge: ctx.commandBridge,
    });
    commandsApi.attach();
    active.commandsApi = commandsApi;
  }
  if (ctx.contextBridge) {
    const contextApi = new ContextApiImpl({
      extensionId,
      router,
      bridge: ctx.contextBridge,
    });
    contextApi.attach();
    active.contextApi = contextApi;
  }

  // Data + UI namespaces: bible / commentary / dictionary / book / storage / ui /
  // workspace / l10n / events. Each api-impl is gated on its bridge
  // being supplied - so unit tests of the discovery surface that omit
  // bridges still pass without the api-impls coming along.
  if (ctx.bibleBridge) {
    const api = new BibleApiImpl({
      extensionId,
      router,
      bridge: ctx.bibleBridge,
      grant,
    });
    api.attach();
    active.bibleApi = api;
  }
  if (ctx.commentaryBridge) {
    const api = new CommentaryApiImpl({
      extensionId,
      router,
      bridge: ctx.commentaryBridge,
      grant,
      contributionRegistry: ctx.contributionRegistry,
    });
    api.attach();
    active.commentaryApi = api;
  }
  if (ctx.dictionaryBridge) {
    const api = new DictionaryApiImpl({
      extensionId,
      router,
      bridge: ctx.dictionaryBridge,
      grant,
      contributionRegistry: ctx.contributionRegistry,
    });
    api.attach();
    active.dictionaryApi = api;
  }
  if (ctx.bookBridge) {
    const api = new BookApiImpl({
      extensionId,
      router,
      bridge: ctx.bookBridge,
      grant,
      contributionRegistry: ctx.contributionRegistry,
    });
    api.attach();
    active.bookApi = api;
  }
  // The storage namespace is wired unconditionally, but every tier inside it
  // is gated by `requirePermission` in the api-impl: KV on `storage`, secrets
  // on `storage:secrets`, `openDatabase` on `storage:database`. Unlike
  // `network` below we do not skip the attach for an ungranted extension,
  // because the namespace also carries `getSetting`, which every extension may
  // call. The secrets and database adapters are only injected here if the host
  // wired them at all.
  {
    const storageApi = new StorageApiImpl({
      extensionId,
      router,
      db: ctx.db,
      grant,
      ...(ctx.storageQuotaBytes !== undefined ? { quotaBytes: ctx.storageQuotaBytes } : {}),
      ...(ctx.secretsKeychain ? { keychain: ctx.secretsKeychain } : {}),
      ...(ctx.extensionDatabaseRegistry
        ? { databaseRegistry: ctx.extensionDatabaseRegistry }
        : {}),
    });
    storageApi.attach();
    active.storageApi = storageApi;
  }
  // Managed folder storage - gated on the bridge being supplied AND the
  // extension having `fs:managed-folder` permission.
  if (ctx.folderBridge && entry.grantedPermissions.includes('fs:managed-folder')) {
    const folderApi = new FolderStorageApiImpl({
      extensionId,
      router,
      grant,
      bridge: ctx.folderBridge,
    });
    folderApi.attach();
    active.folderStorageApi = folderApi;
  }
  // Network + auth. Network is gated on the gateway
  // factory being wired *and* the extension having declared `network`
  // permission (the api-impl re-checks at every call, but skipping the
  // attach when the permission is missing keeps the namespace cleanly
  // absent so an extension can feature-detect via `typeof api.network`).
  if (
    ctx.networkGatewayFactory &&
    entry.grantedPermissions.includes('network')
  ) {
    const gateway = ctx.networkGatewayFactory(extensionId);
    const networkApi = new NetworkApiImpl({
      extensionId,
      router,
      grant,
      allowedHosts: entry.manifest.network?.allowedHosts ?? [],
      gateway,
      ...(ctx.networkThrottleRequestsPerMinute !== undefined
        ? { throttleRequestsPerMinute: ctx.networkThrottleRequestsPerMinute }
        : {}),
      ...(ctx.networkBandwidthBytesPerMinute !== undefined
        ? { bandwidthBytesPerMinute: ctx.networkBandwidthBytesPerMinute }
        : {}),
    });
    networkApi.attach();
    active.networkApi = networkApi;

    // Auth depends on the network api-impl (token exchange goes back
    // through the same throttle + allowlist). Only attach if the
    // auth broker + opener are both wired - otherwise auth methods
    // would silently appear and then fail at first call.
    if (ctx.authBrokerFactory && ctx.externalUrlOpener) {
      const broker = ctx.authBrokerFactory(extensionId);
      const authApi = new AuthApiImpl({
        extensionId,
        router,
        grant,
        network: networkApi,
        broker,
        openExternal: ctx.externalUrlOpener,
      });
      authApi.attach();
      active.authApi = authApi;
    } else if (entry.grantedPermissions.includes('network:oauth')) {
      // Auth is declared but the host has no broker. Answering with the
      // router's default `Unknown RPC method` would tell an author their
      // method name is wrong, when in fact the build simply does not ship
      // the OAuth broker (no production `IExtensionAuthBroker` /
      // `ExternalUrlOpener` exists yet - only the interface and test fakes).
      // Say that instead, using the same "tier is not configured" idiom the
      // secrets and database tiers use.
      for (const method of ['startOAuth', 'refreshOAuth', 'openExternal']) {
        router.registerMethod(`auth.${method}`, () => {
          throw new RpcProtocolError(
            `auth.${method}: the OAuth tier is not configured on this host`,
          );
        });
      }
    }
  }

  // Background tasks. Gated on the `tasks` permission so
  // an extension that doesn't ask for it never sees the namespace.
  if (entry.grantedPermissions.includes('tasks')) {
    const tasksApi = new TasksApiImpl({
      extensionId,
      router,
      grant,
      ...(ctx.taskStatusBridge ? { statusBridge: ctx.taskStatusBridge } : {}),
      ...(ctx.taskNotifier ? { notifier: ctx.taskNotifier } : {}),
      ...(ctx.taskDisposeDrainMs !== undefined
        ? { disposeDrainMs: ctx.taskDisposeDrainMs }
        : {}),
    });
    tasksApi.attach();
    active.tasksApi = tasksApi;
  }

  if (ctx.uiBridge) {
    const api = new UiApiImpl({
      extensionId,
      router,
      bridge: ctx.uiBridge,
      grant,
    });
    api.attach();
    active.uiApi = api;
  }
  // Unconditional, and deliberately ungated. A panel talking to its own
  // worker is not a capability - the capabilities are whatever the worker
  // does in response, and those are gated where they always were. Attached
  // even without a UI bridge so panel -> worker still works in harnesses that
  // wire no renderer; only the worker -> panel direction needs the bridge.
  {
    const api = new PanelsApiImpl({
      extensionId,
      router,
      ...(ctx.uiBridge ? { uiBridge: ctx.uiBridge } : {}),
    });
    api.attach();
    active.panelsApi = api;
  }
  if (ctx.workspaceBridge) {
    const api = new WorkspaceApiImpl({
      extensionId,
      router,
      bridge: ctx.workspaceBridge,
    });
    api.attach();
    active.workspaceApi = api;
  }
  if (ctx.l10nBridge) {
    // Eagerly prime the renderer-side L10n bridge with
    // this extension's catalogs before the worker calls api.l10n.t.
    try {
      ctx.l10nBridge.loadExtensionCatalog?.(extensionId, entry.installPath);
    } catch (err) {
      log.warn(`[ExtensionHost] loadExtensionCatalog(${extensionId}) failed:`, err);
    }
    const api = new L10nApiImpl({
      extensionId,
      router,
      bridge: ctx.l10nBridge,
    });
    api.attach();
    active.l10nApi = api;
  }
  // Notes / highlights / bookmarks. Each api-impl is
  // gated on its bridge being supplied - so unit tests that omit bridges
  // still pass without these api-impls coming along.
  if (ctx.notesBridge) {
    const api = new NotesApiImpl({
      extensionId,
      router,
      bridge: ctx.notesBridge,
      grant,
    });
    api.attach();
    active.notesApi = api;
  }
  if (ctx.highlightsBridge) {
    const api = new HighlightsApiImpl({
      extensionId,
      router,
      bridge: ctx.highlightsBridge,
      grant,
    });
    api.attach();
    active.highlightsApi = api;
  }
  if (ctx.bookmarksBridge) {
    const api = new BookmarksApiImpl({
      extensionId,
      router,
      bridge: ctx.bookmarksBridge,
      grant,
    });
    api.attach();
    active.bookmarksApi = api;
  }
  // Ordered passage collections. Gated on its own bridge rather than riding
  // along with `bookmarksBridge`: the two are separate views of the same
  // rows, and a host that wires only one should expose only one. Permission
  // gating inside the api-impl reuses `bookmarks:read` / `bookmarks:write` -
  // see `collectionsApiImpl.ts` for why a `collections:*` pair would have
  // been a permission boundary in name only.
  if (ctx.collectionsBridge) {
    const api = new CollectionsApiImpl({
      extensionId,
      router,
      bridge: ctx.collectionsBridge,
      grant,
    });
    api.attach();
    active.collectionsApi = api;
  }

  // Inter-extension calls + provider listing. Always
  // wired; permission gates are enforced per-call inside the api-impl.
  {
    const extensionsApi = new ExtensionsApiImpl({
      extensionId,
      router,
      grant,
      host: buildHostDelegate(ctx),
    });
    extensionsApi.attach();
    active.extensionsApi = extensionsApi;
  }

  // Events api is always wired - see eventsApiImpl.ts header for the
  // worker-side / dispatch-side split.
  {
    const eventsApi = new EventsApiImpl({ extensionId });
    eventsApi.attach();
    active.eventsApi = eventsApi;
  }

  // `IAiApi` is reserved provider plumbing: one method, whose v1 answer is
  // the constant `false`. It gets no api-impl class of its own because there
  // is no state to own - but it does need a handler. Without one the proxy's
  // generic branch turns `api.ai.isAvailable()` into an RPC the router
  // rejects with `Unknown RPC method`, so an extension politely checking for
  // AI support before using it would take an exception instead of the
  // documented `false`.
  router.registerMethod('ai.isAvailable', async () => false);
}

/**
 * Build the narrow delegate the `ExtensionsApiImpl` uses to mediate
 * inter-extension calls. Captures `ctx` so the delegate always reflects the
 * current host state.
 */
export function buildHostDelegate(
  ctx: ExtensionHostContext,
): import('./api-impl/extensionsApiImpl').IExtensionsHostDelegate {
  return {
    isActive: (id) => ctx.activeWorkers.has(id),
    activate: (id) => ctx.activate(id),
    getRouter: (id) => ctx.activeWorkers.get(id)?.router,
    getManifest: (id) => ctx.registry.getEntry(id)?.manifest,
    listInstalled: () =>
      ctx.registry
        .listEntries()
        .map(({ id, entry }) => ({ id, manifest: entry.manifest })),
  };
}

/**
 * Dispose every api-impl owned by an active worker. Called from `deactivate`,
 * `handleWorkerExit`, and the activate-error path. Each api-impl's `dispose`
 * is best-effort and may be called multiple times safely.
 */
export async function disposeApiImpls(active: ActiveWorker): Promise<void> {
  // Drain in-flight tasks first so the worker has a chance
  // to observe cancellation and settle gracefully *before* the router closes
  // and starts rejecting reverse RPCs.
  if (active.tasksApi) {
    try {
      await active.tasksApi.dispose();
    } catch {
      /* swallow - best-effort */
    }
  }
  active.commandsApi?.dispose();
  active.contextApi?.dispose();
  active.bibleApi?.dispose();
  active.commentaryApi?.dispose();
  active.dictionaryApi?.dispose();
  active.bookApi?.dispose();
  active.storageApi?.dispose();
  active.folderStorageApi?.dispose();
  active.uiApi?.dispose();
  active.panelsApi?.dispose();
  active.workspaceApi?.dispose();
  active.l10nApi?.dispose();
  active.eventsApi?.dispose();
  active.networkApi?.dispose();
  active.authApi?.dispose();
  active.extensionsApi?.dispose();
  active.notesApi?.dispose();
  active.highlightsApi?.dispose();
  active.bookmarksApi?.dispose();
  active.collectionsApi?.dispose();
}
