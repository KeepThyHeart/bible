/**
 * Shared types for the `ExtensionHost` facade and its decomposed subsystems
 * (`ExtensionHostDiscovery`, `ExtensionHostInstaller`, `ExtensionHostLifecycle`,
 * `ExtensionHostPermissions`).
 */

import type { ISql } from '@bible/core';
import { Extensions } from '@bible/core';

type ExtensionPermission = Extensions.ExtensionPermission;
type InstallConsentRequest = Extensions.InstallConsentRequest;

import type { ExtensionRegistry } from './ExtensionRegistry';
import type { ExtensionLifecycleLogger } from './ExtensionLifecycleLogger';
import type {
  ExtensionWorkerProcess,
  IUtilityProcessFactory,
} from './ExtensionWorkerProcess';
import type { ExtensionRpcRouter } from './ExtensionRpcRouter';
import type {
  AuthApiImpl,
  BibleApiImpl,
  BookApiImpl,
  BookmarksApiImpl,
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
  UiApiImpl,
  WorkspaceApiImpl,
  ExternalUrlOpener,
  IExtensionAuthBroker,
  IExtensionBibleBridge,
  IExtensionBookBridge,
  IExtensionBookmarksBridge,
  IExtensionCommandBridge,
  IExtensionCommentaryBridge,
  IExtensionContextBridge,
  IExtensionDictionaryBridge,
  IExtensionFolderBridge,
  IExtensionHighlightsBridge,
  IExtensionL10nBridge,
  IExtensionNotesBridge,
  IExtensionTaskStatusBridge,
  IExtensionUiBridge,
  IExtensionWorkspaceBridge,
  TaskNotifier,
} from './api-impl';
import type { IExtensionNetworkGateway } from './gateways/ExtensionNetworkGateway';
import type { ISecretsKeychain } from './SecretsKeychain';
import type { ExtensionDatabaseRegistry } from './ExtensionDatabaseRegistry';
import type { ExtensionDevConfig } from './ExtensionDevConfig';
import type { ExtensionDevWatcher } from './ExtensionDevWatcher';
import type { ContributionRegistry } from './ContributionRegistry';
import type { ExtensionBlocklistService } from './marketplace/ExtensionBlocklistService';
import type {
  SingleActiveProviderRegistry,
  ProviderPreferencePersistence,
} from './SingleActiveProviderRegistry';

/**
 * Pluggable hook the host raises when an install request arrives without
 * pre-approved consent. Wired by main.ts to the renderer's
 * `ExtensionPermissionPrompt` component. The default is to refuse -
 * `installExtension` returns `consent.required` until the UI
 * provides a real prompter or the caller passes `consent.grantedPermissions`
 * up front.
 */
export type ConsentPrompter = (req: InstallConsentRequest) => Promise<
  | { granted: true; grantedPermissions: ExtensionPermission[] }
  | { granted: false }
>;

/** State the host tracks per active worker. */
export interface ActiveWorker {
  worker: ExtensionWorkerProcess;
  router: ExtensionRpcRouter;
  /** Last RPC method dispatched - captured for the crash log. */
  lastRpcMethod?: string;
  /** Consecutive reverse-RPC timeouts. Reset on successful response. */
  consecutiveTimeouts: number;
  /** Per-namespace api impls owned by this worker; disposed on deactivate. */
  commandsApi?: CommandsApiImpl;
  contextApi?: ContextApiImpl;
  bibleApi?: BibleApiImpl;
  commentaryApi?: CommentaryApiImpl;
  dictionaryApi?: DictionaryApiImpl;
  bookApi?: BookApiImpl;
  storageApi?: StorageApiImpl;
  folderStorageApi?: FolderStorageApiImpl;
  uiApi?: UiApiImpl;
  workspaceApi?: WorkspaceApiImpl;
  l10nApi?: L10nApiImpl;
  eventsApi?: EventsApiImpl;
  networkApi?: NetworkApiImpl;
  authApi?: AuthApiImpl;
  tasksApi?: TasksApiImpl;
  extensionsApi?: ExtensionsApiImpl;
  notesApi?: NotesApiImpl;
  highlightsApi?: HighlightsApiImpl;
  bookmarksApi?: BookmarksApiImpl;
}

/**
 * Stable error code for stubbed methods. Lets tests + the renderer detect
 * "not implemented yet" without sniffing strings.
 */
export class MethodNotImplementedYet extends Error {
  readonly code = 'MethodNotImplementedYet';
  constructor(method: string) {
    super(`${method} is not implemented yet.`);
    this.name = 'MethodNotImplementedYet';
  }
}

/**
 * Options accepted by `ExtensionHost`'s constructor. Extracted to
 * `ExtensionHostTypes.ts` so the facade can stay thin.
 */
export interface ExtensionHostOptions {
  /** Per-user encrypted database connection. */
  db: ISql;
  /** Absolute path to `data/extensions/` (created if missing). */
  extensionsRoot: string;
  /** Optional renderer-backed consent prompter. */
  consentPrompter?: ConsentPrompter;
  /**
   * Developer Mode switch. Pass one to enable unpacked loading and hot-reload;
   * omit it and the host has no Developer Mode at all, which is what most
   * tests want and what a headless host should be.
   */
  devConfig?: ExtensionDevConfig;
  /** Debounce for the dev hot-reload watcher. Tests use a short value. */
  devWatchDebounceMs?: number;
  /**
   * Worker process factory. Production wires
   * `electronUtilityProcessFactory`; tests inject an in-memory fake. If
   * omitted, `activate()` throws - which keeps unit tests of the discovery
   * surface decoupled from the worker subsystem.
   */
  workerFactory?: IUtilityProcessFactory;
  /**
   * Absolute path to the bundled extension-runtime entry script. Defaults
   * to `out/extension-runtime/index.js` next to the main bundle.
   */
  workerScriptPath?: string;
  /** Override the heartbeat interval (ms). Mostly useful for tests. */
  workerHeartbeatIntervalMs?: number;
  /** Override the auto-disable crash threshold. Default 3 per spec. */
  crashThreshold?: number;
  /**
   * Bridge into the renderer's `CommandRegistry`. When supplied, every activated
   * worker gets a `CommandsApiImpl` wired to its router so extensions can
   * register and execute commands. Omit in unit tests of the discovery
   * surface that don't exercise the api-impls.
   */
  commandBridge?: IExtensionCommandBridge;
  /**
   * Bridge into the renderer's `WhenContextService`. When supplied, every
   * activated worker gets a `ContextApiImpl` wired to its router so
   * extensions can read built-in context keys and write their own
   * `ext.<id>.*` namespace.
   */
  contextBridge?: IExtensionContextBridge;
  /** Bridges to the rest of the desktop process. */
  bibleBridge?: IExtensionBibleBridge;
  commentaryBridge?: IExtensionCommentaryBridge;
  dictionaryBridge?: IExtensionDictionaryBridge;
  bookBridge?: IExtensionBookBridge;
  uiBridge?: IExtensionUiBridge;
  workspaceBridge?: IExtensionWorkspaceBridge;
  l10nBridge?: IExtensionL10nBridge;
  /** Bridges to the user-data notes / highlights / bookmarks tables. */
  notesBridge?: IExtensionNotesBridge;
  highlightsBridge?: IExtensionHighlightsBridge;
  bookmarksBridge?: IExtensionBookmarksBridge;
  /**
   * Bridge for the managed folder API (`fs:managed-folder` permission).
   * Production wires an Electron dialog-based picker; tests inject
   * `InMemoryFolderBridge`. Omit to leave the folder API disabled.
   */
  folderBridge?: IExtensionFolderBridge;
  /**
   * Override the per-extension KV quota. Default is `DEFAULT_KV_QUOTA_BYTES`
   * (5 MB). Mostly useful for tests.
   */
  storageQuotaBytes?: number;
  /**
   * Secrets tier. Per-extension encrypted-secret adapter
   * routed through the `storage.{set,get,delete}Secret` api-impl. Production
   * wires `SafeStorageSecretsKeychain` (Electron `safeStorage` + per-extension
   * JSON files); tests inject `InMemorySecretsKeychain`. Omit to leave the
   * secrets tier disabled (calls reject with `RpcProtocolError`).
   */
  secretsKeychain?: ISecretsKeychain;
  /**
   * `openDatabase` tier. Per-extension SQLite registry. The
   * host owns this across the lifetime of the process so files persist
   * across activate / deactivate cycles. Omit to leave `openDatabase`
   * disabled (calls reject with `RpcProtocolError`).
   */
  extensionDatabaseRegistry?: ExtensionDatabaseRegistry;
  /**
   * Outbound HTTP gateway. The host calls this for every
   * `api.network.fetch` (and indirectly for every OAuth token exchange).
   * Production wires `ElectronNetworkGateway`; tests inject a fake. Either
   * a single shared gateway *or* a per-extension factory may be supplied.
   * Omit to leave the network tier disabled (calls reject with
   * `RpcProtocolError` because the api-impl is never attached).
   */
  networkGatewayFactory?: (extensionId: string) => IExtensionNetworkGateway;
  /**
   * OAuth broker. Owns the BrowserWindow that drives the
   * authorization-code flow. Production wraps a renderer-side window;
   * tests inject a fake. Required if `networkGatewayFactory` is supplied
   * and any installed extension declares `network:oauth`.
   */
  authBrokerFactory?: (extensionId: string) => IExtensionAuthBroker;
  /**
   * `api.auth.openExternal` opener. Production wraps
   * `shell.openExternal` after a per-host first-click confirmation; tests
   * inject a fake. Required for any extension that declares
   * `network:oauth`.
   */
  externalUrlOpener?: ExternalUrlOpener;
  /**
   * Override the per-extension request-per-minute throttle.
   * Defaults to 120. Mostly useful for tests.
   */
  networkThrottleRequestsPerMinute?: number;
  /**
   * Override the per-extension bandwidth cap (bytes per 60 s window).
   * Defaults to 50 MB/min. Mostly useful for tests.
   */
  networkBandwidthBytesPerMinute?: number;
  /**
   * Built-in status-bar observer for `api.tasks.run`. Receives
   * a snapshot fan-out every time a task starts, progresses, or settles.
   * Production wires the renderer-side task widget; tests inject
   * `InMemoryTaskStatusBridge`. Omit to leave the observer disabled - the
   * tasks api still works, just without status-bar visibility.
   */
  taskStatusBridge?: IExtensionTaskStatusBridge;
  /**
   * Completion notifier wired to the renderer's notification
   * stack when an extension calls `api.tasks.run({ notifyOnComplete: true })`.
   * Production maps this to `uiBridge.showNotification`; tests inject a fake.
   */
  taskNotifier?: TaskNotifier;
  /**
   * Override how long `deactivate` waits for in-flight tasks to settle
   * after cancellation. Defaults to 2 s.
   */
  taskDisposeDrainMs?: number;
  /**
   * Shared contribution registry. If omitted, the host
   * creates its own instance. Pass one in when you want to share the registry
   * with other host-side components (e.g. the renderer's module list).
   */
  contributionRegistry?: ContributionRegistry;
  /**
   * Kill-switch. Omit to leave every extension runnable - the right
   * default for a host with no marketplace behind it, and for tests.
   */
  blocklist?: ExtensionBlocklistService;
  /**
   * Single-active provider registry. If omitted, the host
   * creates its own instance with in-memory preferences.
   */
  singleActiveProviderRegistry?: SingleActiveProviderRegistry;
  /**
   * Persistence adapter for provider-role user preferences.
   * Only used when `singleActiveProviderRegistry` is not provided. Ignored
   * when a registry is supplied directly.
   */
  providerPreferencePersistence?: ProviderPreferencePersistence;
}

/**
 * Internal context passed to the extracted subsystem modules. Exposes exactly
 * the mutable state and injected dependencies the helpers need to operate on,
 * so each subsystem can be reasoned about in isolation without re-plumbing
 * every optional bridge through its constructor.
 *
 * This is an internal contract between `ExtensionHost` and its siblings in
 * `electron/extensions/`. It is deliberately NOT exported from the package.
 */
export interface ExtensionHostContext {
  readonly db: ISql;
  readonly extensionsRoot: string;
  readonly registry: ExtensionRegistry;
  readonly logger: ExtensionLifecycleLogger;
  readonly workerFactory: IUtilityProcessFactory | undefined;
  readonly workerScriptPath: string;
  readonly workerHeartbeatIntervalMs: number | undefined;
  readonly crashThreshold: number;
  readonly activeWorkers: Map<string, ActiveWorker>;
  readonly commandBridge: IExtensionCommandBridge | undefined;
  readonly contextBridge: IExtensionContextBridge | undefined;
  readonly bibleBridge: IExtensionBibleBridge | undefined;
  readonly commentaryBridge: IExtensionCommentaryBridge | undefined;
  readonly dictionaryBridge: IExtensionDictionaryBridge | undefined;
  readonly bookBridge: IExtensionBookBridge | undefined;
  readonly uiBridge: IExtensionUiBridge | undefined;
  readonly workspaceBridge: IExtensionWorkspaceBridge | undefined;
  readonly l10nBridge: IExtensionL10nBridge | undefined;
  readonly notesBridge: IExtensionNotesBridge | undefined;
  readonly highlightsBridge: IExtensionHighlightsBridge | undefined;
  readonly bookmarksBridge: IExtensionBookmarksBridge | undefined;
  readonly folderBridge: IExtensionFolderBridge | undefined;
  readonly storageQuotaBytes: number | undefined;
  readonly secretsKeychain: ISecretsKeychain | undefined;
  readonly extensionDatabaseRegistry: ExtensionDatabaseRegistry | undefined;
  readonly networkGatewayFactory:
    | ((extensionId: string) => IExtensionNetworkGateway)
    | undefined;
  readonly authBrokerFactory:
    | ((extensionId: string) => IExtensionAuthBroker)
    | undefined;
  readonly externalUrlOpener: ExternalUrlOpener | undefined;
  readonly networkThrottleRequestsPerMinute: number | undefined;
  readonly networkBandwidthBytesPerMinute: number | undefined;
  readonly taskStatusBridge: IExtensionTaskStatusBridge | undefined;
  readonly taskNotifier: TaskNotifier | undefined;
  readonly taskDisposeDrainMs: number | undefined;
  readonly contributionRegistry: ContributionRegistry;
  readonly singleActiveProviderRegistry: SingleActiveProviderRegistry;
  /**
   * Kill-switch. Consulted before every activation. Absent in tests
   * and in any host wired without marketplace support, which means nothing is
   * blocked - the correct reading, since block rules only exist when an app
   * ships a blocklist endpoint to fetch them from.
   */
  readonly blocklist: ExtensionBlocklistService | undefined;
  consentPrompter: ConsentPrompter | undefined;
  /**
   * Developer Mode switch. Absent in tests and headless hosts that never
   * offer unpacked loading - `loadUnpackedExtension` treats absent as off,
   * which is the safe reading.
   */
  readonly devConfig: ExtensionDevConfig | undefined;
  /** Hot-reload watcher for unpacked extensions. Absent means no auto-reload. */
  readonly devWatcher: ExtensionDevWatcher | undefined;

  /** Back-reference for lifecycle helpers that need to call `activate` recursively. */
  activate(extensionId: string): Promise<void>;
  deactivate(extensionId: string): Promise<void>;
  /** True while the extension's worker is alive and serving RPC. */
  isActive(extensionId: string): boolean;
}
