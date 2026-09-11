/**
 * Barrel for the host-side extension api implementations.
 *
 * Each api-impl owns one namespace of `BibleExtensionAPI` and is constructed
 * once per active worker. The owning `ExtensionHost.activate(...)` builds the
 * impls, calls `attach()` on each, and tracks them on the `ActiveWorker`
 * record so `deactivate(...)` can call `dispose()` on each in turn.
 */

// --- Inter-extension calls + providers ------------------------------------
export {
  ExtensionsApiImpl,
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from './extensionsApiImpl';
export type {
  ExtensionsApiImplOptions,
  IExtensionsHostDelegate,
} from './extensionsApiImpl';

// --- Background tasks -----------------------------------------------------
export {
  TasksApiImpl,
  TASK_DISPOSE_DRAIN_MS,
  InMemoryTaskStatusBridge,
} from './tasksApiImpl';
export type {
  TasksApiImplOptions,
  IExtensionTaskStatusBridge,
  TaskNotifier,
} from './tasksApiImpl';

// --- Network + auth -------------------------------------------------------
export {
  NetworkApiImpl,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  MAX_MAX_RESPONSE_BYTES,
  DEFAULT_THROTTLE_REQUESTS_PER_MINUTE,
  matchesHostPattern,
  isLiteralIp,
  isPrivateAddress,
} from './networkApiImpl';
export type {
  NetworkApiImplOptions,
  DnsResolver,
  DnsLookupResult,
} from './networkApiImpl';
export {
  AuthApiImpl,
  base64UrlEncode,
  sha256Base64Url,
  constantTimeEquals,
  buildAuthorizeUrl,
} from './authApiImpl';
export type {
  AuthApiImplOptions,
  IExtensionAuthBroker,
  AuthBrokerResult,
  AuthBrokerError,
  ExternalUrlOpener,
} from './authApiImpl';

// --- Commands + context ---------------------------------------------------
export { CommandsApiImpl } from './commandsApiImpl';
export type { CommandsApiImplOptions } from './commandsApiImpl';
export { ContextApiImpl } from './contextApiImpl';
export type { ContextApiImplOptions } from './contextApiImpl';
export { InMemoryCommandBridge, InMemoryContextBridge } from './InMemoryRegistryBridges';
export type {
  ExtensionCommandSpec,
  IExtensionCommandBridge,
  IExtensionContextBridge,
} from './IExtensionRegistryBridges';

// --- Data + UI namespaces -------------------------------------------------
export { BibleApiImpl } from './bibleApiImpl';
export type { BibleApiImplOptions } from './bibleApiImpl';
export { CommentaryApiImpl } from './commentaryApiImpl';
export type { CommentaryApiImplOptions } from './commentaryApiImpl';
export { DictionaryApiImpl } from './dictionaryApiImpl';
export type { DictionaryApiImplOptions } from './dictionaryApiImpl';
export { BookApiImpl } from './bookApiImpl';
export type { BookApiImplOptions } from './bookApiImpl';
export { StorageApiImpl, DEFAULT_KV_QUOTA_BYTES } from './storageApiImpl';
export type { StorageApiImplOptions } from './storageApiImpl';
export { FolderStorageApiImpl } from './folderStorageApiImpl';
export type { FolderStorageApiImplOptions } from './folderStorageApiImpl';
export { UiApiImpl } from './uiApiImpl';
export type { UiApiImplOptions } from './uiApiImpl';
export {
  PanelsApiImpl,
  PanelMessageTooLargeError,
  assertPanelMessageWithinCap,
  PANEL_MESSAGE_ENDPOINT,
  PANEL_MESSAGE_TIMEOUT_MS,
  MAX_PANEL_MESSAGE_BYTES,
} from './panelsApiImpl';
export type { PanelsApiImplOptions } from './panelsApiImpl';
export { WorkspaceApiImpl } from './workspaceApiImpl';
export type { WorkspaceApiImplOptions } from './workspaceApiImpl';
export { L10nApiImpl } from './l10nApiImpl';
export type { L10nApiImplOptions } from './l10nApiImpl';
export { EventsApiImpl } from './eventsApiImpl';
export type { EventsApiImplOptions } from './eventsApiImpl';

// --- Notes / highlights / bookmarks ---------------------------------------
export { NotesApiImpl } from './notesApiImpl';
export type { NotesApiImplOptions } from './notesApiImpl';
export { HighlightsApiImpl } from './highlightsApiImpl';
export type { HighlightsApiImplOptions } from './highlightsApiImpl';
export { BookmarksApiImpl } from './bookmarksApiImpl';
export type { BookmarksApiImplOptions } from './bookmarksApiImpl';

// --- Ordered passage collections ------------------------------------------
export { CollectionsApiImpl } from './collectionsApiImpl';
export type { CollectionsApiImplOptions } from './collectionsApiImpl';

export type {
  IExtensionBibleBridge,
  IExtensionCommentaryBridge,
  IExtensionDictionaryBridge,
  IExtensionBookBridge,
  IExtensionUiBridge,
  IExtensionWorkspaceBridge,
  IExtensionL10nBridge,
  IExtensionNotesBridge,
  IExtensionHighlightsBridge,
  IExtensionBookmarksBridge,
  IExtensionCollectionsBridge,
  IExtensionFolderBridge,
} from './IExtensionDataBridges';
export {
  InMemoryBibleBridge,
  InMemoryCommentaryBridge,
  InMemoryDictionaryBridge,
  InMemoryBookBridge,
  InMemoryUiBridge,
  InMemoryWorkspaceBridge,
  InMemoryL10nBridge,
  InMemoryNotesBridge,
  InMemoryHighlightsBridge,
  InMemoryBookmarksBridge,
  InMemoryCollectionsBridge,
  InMemoryFolderBridge,
} from './InMemoryDataBridges';
