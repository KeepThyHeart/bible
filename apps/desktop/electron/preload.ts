import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MenuSpec } from './menu/menuSpec';

// electron-log/renderer is NOT available in sandboxed preload contexts (Electron
// sandbox restricts require() to a small set of built-in modules). We try to
// load it and fall back to console if the import fails, so the preload does not
// FATAL-error on sandbox: true windows.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let log: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void; debug: (...a: any[]) => void };
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  log = require('electron-log/renderer') as typeof log;
} catch {
  log = {
    info: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
}
import { ALLOWED_IPC_CHANNELS, AllowedIpcChannel, IpcChannel } from './ipc/allowedChannels';

/**
 * Type-safe wrapper around `ipcRenderer.invoke`. Narrows the first argument
 * to the `IpcChannel` union (defined in `./ipc/allowedChannels`), so typos in
 * channel names fail to compile. See item 3.1 of the Apr-14 cleanup doc.
 *
 * Runtime behavior is identical to `ipcRenderer.invoke` - the only thing this
 * helper adds is a compile-time check on the channel string. All bridge
 * functions in this file should prefer `typedInvoke` over raw
 * `ipcRenderer.invoke` for new code.
 */
// Using `any` as the default return type matches Electron's own
// `ipcRenderer.invoke` signature and avoids forcing every bridge function
// below to carry an explicit generic just to satisfy the `ElectronAPI`
// declared return types. The channel name is still narrowed to `IpcChannel`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function typedInvoke<T = any>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}
import type { Result } from './ipc/result';
import type { UpdateCheckInfo, UpdateCheckOutcome } from './services/UpdateCheckService';
import type {
  UnsupportedReason,
  UpdateDownloadOutcome,
  UpdateDownloadProgress,
} from './services/UpdateInstallService';
// Type-only, so nothing from the main-process service or @bible/core is pulled
// into the preload bundle - the imports are erased at compile time.
import type { FeaturePack as FeaturePackListing } from '@bible/core';
import type { SemanticPackStatus as FeaturePackStatus } from './services/SemanticPackService';
import type { ModuleInstallDialogResult } from './ipc/moduleHandlers';
import type { StudyOverviewPayload } from './services/StudyCacheService';
import type { ModulePackInstallSummary } from './services/ModulePackService';
import type { ModuleInstallPolicy } from './ipc/moduleHandlers';
import type { StarterPack, CatalogModule } from '@bible/core';
import { APP_CONFIG, type AppConfig } from './config/appConfig';

// Define the API interface for type safety
export interface ElectronAPI {
  /**
   * Build-time application configuration (product name, issue reporting
   * target, default module catalog URL). Exposed as a plain frozen object
   * rather than an IPC call so the renderer can read it synchronously while
   * rendering - see `src/ui/config/appConfig.ts`.
   */
  appConfig: AppConfig;

  // Logging methods
  log: {
    info: (...params: any[]) => void;
    warn: (...params: any[]) => void;
    error: (...params: any[]) => void;
    debug: (...params: any[]) => void;
  };

  // Bible data methods. Replies use the `Result<T>` envelope (cleanup item
  // 2.3a); callers should unwrap via `services/ipcResult.ts#unwrap`. The
  // `bibleAPI` convenience wrapper in `services/electronAPI.ts` does this for
  // every method so downstream call sites stay unchanged.
  bible: {
    getAvailableBibles: () => Promise<Result<any[]>>;
    getVerse: (abbreviation: string, verseId: number) => Promise<Result<any>>;
    getVerses: (abbreviation: string, startId: number, endId: number) => Promise<Result<any[]>>;
    getChapter: (abbreviation: string, bookNumber: number, chapter: number) => Promise<Result<{ verses: any[]; hasInterlinearData: boolean }>>;
    search: (abbreviation: string, query: string) => Promise<Result<any[]>>;
    getBookName: (bookNumber: number) => Promise<Result<string>>;
    getAllBooks: () => Promise<Result<any[]>>;
    // Batch method for faster initial load
    getInitialData: (defaultAbbreviation?: string, defaultBook?: number, defaultChapter?: number) => Promise<Result<{
      availableBibles: any[];
      defaultBible: any | null;
      defaultVerses: any[];
      hasInterlinearData: boolean;
      bookName: string;
      bookNumber: number;
      chapter: number;
    }>>;
    // Study mode methods
    getInterlinearWords: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
    getInterlinearWordsForChapter: (abbreviation: string, bookNumber: number, chapter: number) => Promise<Result<Record<number, any[]>>>;
    hasInterlinearData: (abbreviation: string) => Promise<Result<boolean>>;
    getUserCrossReferences: (username: string, verseId: number) => Promise<Result<any[]>>;
    createUserCrossReference: (username: string, fromVerseId: number, toVerseId: number, notes?: string) => Promise<Result<{ success: boolean; userXrefId?: number }>>;
    deleteUserCrossReference: (username: string, userXrefId: number) => Promise<Result<{ success: boolean }>>;
    getVerseTexts: (abbreviation: string, verseIds: number[]) => Promise<Result<{ [key: number]: string }>>;
  };

  // Commentary data methods. Replies use the `Result<T>` envelope (item 2.3a of
  // the Apr-14 cleanup); callers should unwrap via `services/ipcResult.ts#unwrap`
  // (the `commentaryAPI` convenience wrapper in `services/electronAPI.ts` does
  // this for every method, so downstream call sites stay unchanged).
  commentary: {
    getAvailableCommentaries: () => Promise<Result<any[]>>;
    getCommentaryInfo: (abbreviation: string) => Promise<Result<any>>;
    getEntriesForVerse: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
    hasContentForVerse: (abbreviation: string, verseId: number) => Promise<Result<boolean>>;
    getNextVerseWithContent: (abbreviation: string, currentVerseId: number) => Promise<Result<number | null>>;
    getPreviousVerseWithContent: (abbreviation: string, currentVerseId: number) => Promise<Result<number | null>>;
    getAllEntrySummaries: (abbreviation: string) => Promise<Result<any[]>>;
    search: (abbreviation: string, query: string, options?: { limit?: number }) => Promise<Result<any[]>>;
    // Batch method for session restore - loads everything in one IPC call
    batchRestoreSession: (request: {
      abbreviations: string[];
      verseId: number;
      browseModeByTab?: Record<string, boolean>;
    }) => Promise<Result<{
      availableCommentaries: any[];
      entriesByTab: Record<string, any[]>;
      summariesByTab: Record<string, any[]>;
    }>>;
  };

  // Dictionary data methods. Replies use the `Result<T>` envelope;
  // callers should unwrap via `src/ui/services/ipcResult.ts#unwrap` (the
  // `dictionaryAPI` convenience wrapper in `services/electronAPI.ts` does this).
  dictionary: {
    getAvailableDictionaries: () => Promise<Result<any[]>>;
    getDictionaryInfo: (abbreviation: string) => Promise<Result<any>>;
    getEntry: (abbreviation: string, entryId: number) => Promise<Result<any>>;
    getEntryByKey: (abbreviation: string, entryKey: string) => Promise<Result<any>>;
    searchEntries: (abbreviation: string, query: string, limit?: number) => Promise<Result<any[]>>;
    getAllEntries: (abbreviation: string, limit?: number, offset?: number) => Promise<Result<any[]>>;
    getOccurrences: (abbreviation: string, entryKey: string) => Promise<Result<any[]>>;
    getOccurrencesForVerse: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
  };

  // Book data methods. Replies use the `Result<T>` envelope (cleanup item
  // 2.3a); callers should unwrap via `services/ipcResult.ts#unwrap`. The
  // single-chokepoint `bookAPI` in `services/electronAPI.ts` already does
  // this so downstream stores/components don't change.
  book: {
    getAvailableBooks: () => Promise<Result<any[]>>;
    getBookInfo: (abbreviation: string) => Promise<Result<any>>;
    getSection: (abbreviation: string, sectionId: number) => Promise<Result<any | null>>;
    getTopLevelSections: (abbreviation: string) => Promise<Result<any[]>>;
    getSectionsByParent: (abbreviation: string, parentSectionId: number) => Promise<Result<any[]>>;
    getAllSectionSummaries: (abbreviation: string) => Promise<Result<any[]>>;
    getNextSection: (abbreviation: string, currentSectionId: number) => Promise<Result<any | null>>;
    getPreviousSection: (abbreviation: string, currentSectionId: number) => Promise<Result<any | null>>;
    getParentSection: (abbreviation: string, currentSectionId: number) => Promise<Result<any | null>>;
    searchSections: (abbreviation: string, query: string, limit?: number) => Promise<Result<any[]>>;
    getScriptureReferences: (abbreviation: string, sectionId: number) => Promise<Result<any[]>>;
    getSectionsReferencingVerse: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
  };

  // Topical index methods. Replies use the `Result<T>` envelope (item 2.3a of
  // the Apr-14 cleanup); callers should unwrap via `services/ipcResult.ts#unwrap`.
  topical: {
    getAvailable: () => Promise<Result<any[]>>;
    getTopicsForVerse: (verseId: number) => Promise<Result<any[]>>;
    getTopic: (abbreviation: string, topicId: number) => Promise<Result<any | null>>;
    getChildren: (abbreviation: string, parentTopicId: number) => Promise<Result<any[]>>;
    getParentChain: (abbreviation: string, topicId: number) => Promise<Result<any[]>>;
    getVersesForTopic: (abbreviation: string, topicId: number, limit?: number, offset?: number) => Promise<Result<any[]>>;
    /** Paginated: the Topics pane renders these inline as its main list. */
    searchTopics: (query: string, sources?: string[], limit?: number, offset?: number) => Promise<Result<any[]>>;
    /** `rootsOnly` applies to plain browsing only; a filtered page spans every level. */
    browseTopics: (sources?: string[], limit?: number, offset?: number, filter?: string, rootsOnly?: boolean) => Promise<Result<any[]>>;
    getAlsoIn: (topicName: string, excludeAbbreviation: string) => Promise<Result<any[]>>;
  };

  // Tag graph methods. Replies use the `Result<T>` envelope (item 2.3a of the
  // Apr-14 cleanup); callers should unwrap via `services/ipcResult.ts#unwrap`.
  tagGraph: {
    getEntity: (entityId: string, category: string) => Promise<Result<any | null>>;
    getAssociationsForEntity: (entityId: string, category: string) => Promise<Result<any[]>>;
    getPeopleRelationships: (personId: string) => Promise<Result<any[]>>;
    searchEntities: (query: string, categories?: string[]) => Promise<Result<any[]>>;
    getEntityAliases: (entityId: string, category: string) => Promise<Result<string[]>>;
    getTopicLinksForEntity: (entityId: string, category: string, sourceModule?: string) => Promise<Result<any[]>>;
    getEntityForTopic: (sourceModule: string, topicId: number) => Promise<Result<any | null>>;
    getEntityByName: (name: string) => Promise<Result<any | null>>;
    getVersesForEntity: (entityId: string, category: string) => Promise<Result<any[]>>;
    getFacetsForEntity: (entityId: string, category: string) => Promise<Result<any[]>>;
  };

  // Cross-reference methods. Replies use the `Result<T>` envelope;
  // callers should unwrap via `src/ui/services/ipcResult.ts#unwrap`.
  crossReference: {
    getAvailable: () => Promise<Result<any[]>>;
    getGroupsForVerse: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
    /** Phrase groups for a whole chapter in one call - see `xref:getGroupsForRange`. */
    getGroupsForRange: (abbreviation: string, startVerseId: number, endVerseId: number) => Promise<Result<any[]>>;
    getReverseReferences: (abbreviation: string, verseId: number) => Promise<Result<any[]>>;
    /** Reverse references for a whole chapter in one call. */
    getReverseReferencesForRange: (abbreviation: string, startVerseId: number, endVerseId: number) => Promise<Result<any[]>>;
    getEntryCount: (abbreviation: string, verseId: number) => Promise<Result<number>>;
  };

  // Search methods. Replies use the `Result<T>` envelope (item 2.3a of the
  // Apr-14 cleanup); callers should unwrap via `services/ipcResult.ts#unwrap`.
  // The `searchAPI` convenience wrapper in `services/electronAPI.ts` already
  // calls `unwrap()` on every method, so downstream call sites stay unchanged.
  search: {
    performSearch: (query: string, options: any) => Promise<Result<any[]>>;
    getSavedSearches: () => Promise<Result<any[]>>;
    saveSearch: (name: string, query: string, searchType: string, scope: any, options: any) => Promise<Result<any>>;
    loadSavedSearch: (searchId: number) => Promise<Result<any>>;
    deleteSavedSearch: (searchId: number) => Promise<Result<boolean>>;
    getIndexStatus: (modules: string[]) => Promise<Result<Record<string, any>>>;
    buildIndex: (modules: string[], onProgress?: (progress: any) => void) => Promise<Result<void>>;
    getBookIndexStatus: (moduleAbbr: string) => Promise<Result<any[]>>;
    // Semantic search
    semanticAvailable: () => Promise<Result<boolean>>;
    semanticSearch: (query: string, options?: { maxResults?: number; levels?: string[] }) => Promise<Result<any[]>>;
  };

  // Session methods. Replies use the `Result<T>` envelope;
  // callers should unwrap via `services/ipcResult.ts#unwrap`. The
  // `sessionAPI` convenience wrapper in `services/electronAPI.ts` handles
  // this for all renderer call sites.
  session: {
    getAll: () => Promise<Result<any[]>>;
    load: (sessionId: number) => Promise<Result<any | null>>;
    getOrCreateAutosave: () => Promise<Result<any>>;
    create: (data: { name: string; description?: string; sessionData: any; isDefault?: boolean }) => Promise<Result<any>>;
    update: (sessionId: number, updates: { name?: string; description?: string; sessionData?: any; isDefault?: boolean }) => Promise<Result<any>>;
    delete: (sessionId: number) => Promise<Result<boolean>>;
    setAsDefault: (sessionId: number) => Promise<Result<boolean>>;
    getDefault: () => Promise<Result<any | null>>;
    getRecent: (limit?: number) => Promise<Result<any[]>>;
    onSaveRequested: (callback: () => Promise<{ success: boolean; message?: string }>) => void;
  };

  // Study mode verse links methods. Replies use the `Result<T>` envelope;
  // callers should unwrap via `services/ipcResult.ts#unwrap`.
  study: {
    getVerseLinks: (verseId: number, openModuleIds?: number[]) => Promise<Result<any>>;
    getBatchVerseLinks: (verseIds: number[], openModuleIds?: number[]) => Promise<Result<Record<number, any>>>;
    /**
     * Pre-generated per-chapter study overview. Replies with
     * `{ available: false }` when the cache is missing or stale - callers must
     * fall back to live queries.
     */
    getOverview: (book: number, chapter: number) => Promise<Result<StudyOverviewPayload>>;
    getCommentaryMentions: (moduleId: number, verseId: number) => Promise<Result<any[]>>;
  };

  // Expose ipcRenderer for notes API. Channel is narrowed to AllowedIpcChannel
  // for compile-time typo detection; return type defaults to `any` so existing
  // callers that destructure the response don't need individual annotations.
  // Callers can still pass an explicit generic to get a typed return.
  ipcRenderer: {
    invoke: <T = any>(channel: AllowedIpcChannel, ...args: unknown[]) => Promise<T>;
  };

  // Menu methods
  menu: {
    // Listen to menu events from main process
    onNewSession: (callback: () => void) => void;
    onOpenSession: (callback: () => void) => void;
    onSaveSession: (callback: () => void) => void;
    onImportModule: (callback: () => void) => void;
    onExportData: (callback: () => void) => void;
    onPreferences: (callback: () => void) => void;
    onFind: (callback: () => void) => void;
    onFindInPane: (callback: () => void) => void;
    onGoToVerse: (callback: () => void) => void;
    onCompareTranslations: (callback: () => void) => void;
    onAddNote: (callback: () => void) => void;
    onAddHighlight: (callback: () => void) => void;
    onSearchAll: (callback: () => void) => void;
    onDocumentation: (callback: () => void) => void;
    onKeyboardShortcuts: (callback: () => void) => void;
    onLayoutChange: (callback: (layout: string) => void) => void;
    onPaneToggle: (callback: (paneId: string, visible: boolean) => void) => void;
    onThemeChange: (callback: (theme: string) => void) => void;

    // Update menu state from renderer process
    updateLayout: (layoutId: string) => void;
    updatePane: (paneId: string, visible: boolean) => void;
    updateTheme: (themeId: string) => void;
  };

  // Application menu bridge - the renderer is the source of truth for the
  // application menu (labels come from the i18n service, accelerators from
  // the keybinding service). The renderer ships a serializable MenuSpec to
  // main, which builds the Electron menu from it. Main dispatches command
  // clicks back via `onCommandExecute`.
  electronMenu: {
    rebuild: (spec: MenuSpec) => void;
    onCommandExecute: (callback: (commandId: string) => void) => () => void;
  };

  // Locale catalog bridge - read by `LocaleCatalogLoader` in the renderer.
  // Built-in catalogs ship with the app (asarUnpack'd to resourcesPath/locales);
  // user catalogs live under `userData/locales` so users / extensions can drop
  // in new languages without touching the install directory.
  i18n: {
    listBuiltinCatalogs: () => Promise<Array<{ locale: string; namespace: string }>>;
    readBuiltinCatalog: (locale: string, namespace: string) => Promise<Record<string, string>>;
    listUserCatalogs: () => Promise<Array<{ locale: string; namespace: string }>>;
    readUserCatalog: (locale: string, namespace: string) => Promise<Record<string, string>>;
    /** Tell main which locale to build menus, dialogs and window titles in. */
    setLocale: (locale: string) => Promise<void>;
  };

  // Window management methods
  window: {
    // Detach a pane to a new window
    detachPane: (paneType: string, initialState: any) => Promise<{
      success: boolean;
      windowId?: string;
      error?: string;
    }>;
    // Close a detached window
    closeDetachedWindow: (windowId: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    // Get all detached windows
    getDetachedWindows: () => Promise<{
      success: boolean;
      windows?: Array<{
        id: string;
        paneType: string;
        linkedToMain: boolean;
      }>;
      error?: string;
    }>;
    // Listen for initialization data (for detached windows)
    onInitializePane: (callback: (data: any) => void) => void;
    // Broadcast verse change to detached windows
    broadcastVerseChange: (verseId: number) => Promise<{ success: boolean; error?: string }>;
    // Listen for verse changes (for detached windows)
    onVerseChanged: (callback: (verseId: number) => void) => void;
    // Listen for extension-driven verse navigation requests
    onExtensionNavigateToVerse: (callback: (verseId: number) => void) => void;
  };

  // App-level events
  app: {
    // Listen for when user data (notes, highlights, sessions) is ready
    onUserDataReady: (callback: () => void) => void;
  };

  // Backup/Restore methods. Replies use the `Result<T>` envelope;
  // callers should unwrap via `src/ui/services/ipcResult.ts#unwrap`.
  backup: {
    create: (options: { password: string; includeHistory?: boolean }) => Promise<Result<{
      path: string;
      metadata?: any;
    } | null>>;
    selectFile: () => Promise<Result<{ path: string } | null>>;
    validate: (backupPath: string, password: string) => Promise<Result<{
      valid: boolean;
      metadata?: any;
      error?: string;
    }>>;
    restore: (options: { backupPath: string; password: string; mode: 'merge' | 'replace' }) => Promise<Result<{
      success: boolean;
      tablesRestored?: string[];
      rowCounts?: Record<string, number>;
      error?: string;
    }>>;
  };

  // Module Manager methods. Replies use the `Result<T>` envelope (cleanup item
  // 2.3a); callers should unwrap via `services/ipcResult.ts#unwrap`. The
  // `moduleManagerAPI` chokepoint in `services/electronAPI.ts` does this for
  // every method so downstream call sites stay unchanged.
  moduleManager: {
    // Initialize module manager
    init: () => Promise<Result<void>>;
    // Get available modules
    getAvailableModules: (filter?: any) => Promise<Result<any[]>>;
    // Get installed modules
    getInstalledModules: () => Promise<Result<any[]>>;
    // Search modules
    searchModules: (filter: any) => Promise<Result<any[]>>;
    /**
     * Starter packs recommended for a UI locale. An empty array is a normal
     * answer - not every supported language has redistributable content.
     */
    getStarterPacks: (languageCode: string) => Promise<Result<StarterPack[]>>;
    /** Resolve a starter pack's module ids to their catalog entries. */
    getStarterPackModules: (
      packId: string
    ) => Promise<Result<{ pack?: StarterPack; modules: CatalogModule[] }>>;
    // Install module
    installModule: (moduleId: string) => Promise<Result<{ moduleId?: number; moduleName?: string }>>;
    // Install module(s) from file (opens file dialog; supports multi-select
    // and pack archives). null means user cancelled.
    installFromFile: () => Promise<Result<ModuleInstallDialogResult>>;
    // Install module from a given file path (for drag-and-drop)
    /**
     * `policy` also accepts the legacy boolean (`true` = replace always,
     * `false` = fail on conflict) that this channel shipped with.
     */
    installFromPath: (
      filePath: string,
      policy?: ModuleInstallPolicy | boolean
    ) => Promise<Result<{ moduleId?: number; moduleName?: string; overwritten?: boolean; upToDateReason?: string }>>;
    // Install a pack archive (.zip/.biblepack) from a given (blessed) file
    // path - the drag-and-drop counterpart to selecting a pack via the file
    // dialog.
    installPackFromPath: (
      archivePath: string,
      policy?: ModuleInstallPolicy | boolean
    ) => Promise<Result<ModulePackInstallSummary>>;
    // Uninstall module
    uninstallModule: (moduleId: number, removeUserData?: boolean) => Promise<Result<boolean>>;
    // Update module
    updateModule: (moduleId: number) => Promise<Result<{ moduleId?: number; moduleName?: string }>>;
    // Check for updates
    checkForUpdates: (moduleId: number) => Promise<Result<{ hasUpdate: boolean; currentVersion?: string; availableVersion?: string }>>;
    // Get module details
    getModuleDetails: (moduleId: number) => Promise<Result<any>>;
    // Download management
    getDownloadProgress: (queueId: number) => Promise<Result<any>>;
    getActiveDownloads: () => Promise<Result<any[]>>;
    pauseDownload: (queueId: number) => Promise<Result<void>>;
    resumeDownload: (queueId: number) => Promise<Result<void>>;
    cancelDownload: (queueId: number) => Promise<Result<void>>;
    // Repository management
    getAllRepositories: () => Promise<Result<any[]>>;
    refreshCatalog: (repositoryId: number) => Promise<Result<any>>;
    refreshAllCatalogs: () => Promise<Result<any[]>>;
    getCatalog: (repositoryId: number) => Promise<Result<any>>;
    addRepository: (name: string, url: string, type: string, abbreviation?: string) => Promise<Result<any>>;
    removeRepository: (repositoryId: number) => Promise<Result<boolean>>;
    updateRepositoryUrl: (repositoryId: number, newUrl: string) => Promise<Result<any>>;
    setRepositoryEnabled: (repositoryId: number, enabled: boolean) => Promise<Result<void>>;
  };

  // Optional feature packs (semantic search). A pack is a downloadable
  // *capability*, not study content, so it has its own bridge rather than
  // living under `moduleManager`. Install is asynchronous: `install` returns as
  // soon as the download starts and the renderer polls `getStatus`.
  featurePacks: {
    listAvailable: () => Promise<Result<FeaturePackListing[]>>;
    getStatus: () => Promise<Result<FeaturePackStatus>>;
    install: (packId: string) => Promise<Result<{ started: true }>>;
    /**
     * Install from a local package. The renderer chooses which picker to show,
     * never the path - the dialog is the main process's, and resolves to `null`
     * if the user cancels it.
     */
    installFromFile: (
      kind: 'file' | 'folder'
    ) => Promise<Result<{ started: true; fileName: string } | null>>;
    cancel: () => Promise<Result<{ cancelled: boolean }>>;
    uninstall: () => Promise<Result<{ removed: boolean }>>;
  };

  // Extension Host bridge channel
  extensionBridge: {
    on: (channel: string, handler: (payload: unknown) => void) => () => void;
    send: (channel: string, payload: unknown) => void;
    invoke: <T = unknown>(channel: string, payload: unknown) => Promise<T>;
  };

  // Diagnostics & issue reporting
  diagnostics: {
    getQueue: () => Promise<unknown>;
    getReport: (id: string) => Promise<unknown>;
    deleteReport: (id: string) => Promise<unknown>;
    deleteAll: () => Promise<unknown>;
    submitCrashReport: (args: { reportId: string; description?: string }) => Promise<unknown>;
    submitManualReport: (args: { description: string; includeDiagnostics: boolean }) => Promise<unknown>;
    submitFeedback: (args: { description: string }) => Promise<unknown>;
    getStateSnapshot: () => Promise<unknown>;
    getConfig: () => Promise<unknown>;
    setConfig: (patch: Record<string, unknown>) => Promise<unknown>;
    reportRendererError: (payload: { message: string; stack?: string; componentStack?: string }) => Promise<unknown>;
    flushNow: () => Promise<unknown>;
    onCrashDetected: (handler: (payload: { id: string }) => void) => () => void;
  };

  // Network privacy - master "Allow web requests" switch. Replies use
  // the `Result<T>` envelope; callers unwrap via `services/ipcResult.ts#unwrap`.
  //
  // `setAllowWebRequests(true)` resolves to the flag's value AFTER the main
  // process has shown its confirmation dialog, so it returns `false` when the
  // user cancels. Callers must render from the returned value, never assume the
  // requested one took effect.
  network: {
    getAllowWebRequests: () => Promise<Result<boolean>>;
    setAllowWebRequests: (allow: boolean) => Promise<Result<boolean>>;
    /** @deprecated Inverse of the above; kept for existing callers. */
    getOfflineMode: () => Promise<Result<boolean>>;
    /** @deprecated Inverse of the above; kept for existing callers. */
    setOfflineMode: (offline: boolean) => Promise<Result<boolean>>;
  };

  // Manual "Check for Updates". `getInfo()` is pre-flight and makes
  // no network request (it reports the host + offline state so the UI can
  // confirm before contacting anything); `check()` performs the actual check
  // via the NetworkGateway. Replies use the `Result<T>` envelope.
  updates: {
    getInfo: () => Promise<Result<UpdateCheckInfo>>;
    check: () => Promise<Result<UpdateCheckOutcome>>;
    /** Makes no network request - reports whether this install can self-update. */
    canInstall: () => Promise<Result<{ supported: boolean; reason?: UnsupportedReason }>>;
    download: () => Promise<Result<UpdateDownloadOutcome>>;
    /** Quits and runs the installer. Does not resolve on success. */
    install: () => Promise<Result<void>>;
    /** Subscribe to download progress. Returns an unsubscribe function. */
    onDownloadProgress: (cb: (progress: UpdateDownloadProgress) => void) => () => void;
  };

  // Resolve the absolute path of a dropped/selected File. Electron 32 removed
  // the non-standard `File.path` property; `webUtils.getPathForFile` is the
  // supported replacement and must be called from the preload. Used by the
  // Module Manager's drag-and-drop install (B2).
  //
  // Also authorizes ("blesses") the resolved path via
  // `module:bless-dropped-path` before returning it, so the subsequent
  // `module:install-from-path` / `module:install-pack-from-path` call is not
  // refused as unauthorized. This is safe because a `File` object can only
  // carry a real OS path when the browser attached one from an actual native
  // file picker or OS drag-and-drop - a page cannot fabricate one - so a
  // non-empty path returned here always reflects something the user's own
  // action revealed to the renderer.
  webUtils: {
    getPathForFile: (file: File) => Promise<string>;
  };

  // Extension Host
  extensions: {
    list: () => Promise<any[]>;
    get: (extensionId: string) => Promise<any | null>;
    pickFolderAndInstall: () => Promise<any>;
    installFromFolder: (sourcePath: string) => Promise<any>;
    pickZipAndInstall: () => Promise<any>;
    installFromZip: (zipPath: string) => Promise<any>;
    getDeveloperMode: () => Promise<boolean>;
    setDeveloperMode: (enabled: boolean) => Promise<boolean>;
    pickFolderAndLoadUnpacked: () => Promise<any>;
    reloadUnpacked: (extensionId: string) => Promise<any>;
    updatePermissions: (extensionId: string, grantedPermissions: string[]) => Promise<void>;
    getSettings: (extensionId: string) => Promise<Record<string, unknown>>;
    setSettings: (extensionId: string, values: Record<string, unknown>) => Promise<void>;
    uninstall: (extensionId: string) => Promise<void>;
    enable: (extensionId: string) => Promise<void>;
    disable: (extensionId: string) => Promise<void>;
    activate: (extensionId: string) => Promise<void>;
    deactivate: (extensionId: string) => Promise<void>;
    resetCrashState: (extensionId: string) => Promise<void>;
    getLog: (extensionId: string, limit?: number) => Promise<any[]>;
    getCrashLog: (extensionId: string, limit?: number) => Promise<any[]>;
    getPanelTypeUiEntry: (extensionId: string, panelTypeId: string) => Promise<{ uiEntry: string; title?: string; allowAutoplay?: boolean } | null>;
    openInstallFolder: (extensionId: string) => Promise<boolean>;
    /** Panel-iframe egress, routed through the extension's own gateway. */
    uiFetch: (extensionId: string, url: string, init?: unknown) => Promise<unknown>;
    /**
     * Marketplace. `addSource`'s `acknowledgeRisk` must only be true
     * when the user has actually seen the warning - a source added without it
     * is stored but never fetched.
     */
    catalog: {
      listSources: () => Promise<any[]>;
      addSource: (url: string, label?: string, acknowledgeRisk?: boolean) => Promise<any>;
      acknowledgeRisk: (url: string) => Promise<any>;
      removeSource: (url: string) => Promise<void>;
      refresh: (url: string) => Promise<any>;
      refreshAll: () => Promise<any[]>;
      listAvailable: () => Promise<any[]>;
      install: (extensionId: string, sourceUrl?: string) => Promise<any>;
    };
    blocklist: {
      list: () => Promise<any[]>;
      /** Blocked *installed* extensions, keyed by id. Empty when nothing is blocked. */
      checkInstalled: () => Promise<Record<string, any>>;
    };
  };
}

// Expose protected methods to the renderer process
const electronAPI: ElectronAPI = {
  appConfig: APP_CONFIG,

  log: {
    info: (...params: any[]) => log.info(...params),
    warn: (...params: any[]) => log.warn(...params),
    error: (...params: any[]) => log.error(...params),
    debug: (...params: any[]) => log.debug(...params)
  },

  // bible bridge - migrated to `typedInvoke` so the channel-name strings are
  // checked against the `IpcChannel` union at compile time (item 3.1).
  bible: {
    getAvailableBibles: () => typedInvoke('bible:getAvailableBibles'),
    getVerse: (abbreviation: string, verseId: number) =>
      typedInvoke('bible:getVerse', abbreviation, verseId),
    getVerses: (abbreviation: string, startId: number, endId: number) =>
      typedInvoke('bible:getVerses', abbreviation, startId, endId),
    getChapter: (abbreviation: string, bookNumber: number, chapter: number) =>
      typedInvoke('bible:getChapter', abbreviation, bookNumber, chapter),
    search: (abbreviation: string, query: string) =>
      typedInvoke('bible:search', abbreviation, query),
    getBookName: (bookNumber: number) => typedInvoke('bible:getBookName', bookNumber),
    getAllBooks: () => typedInvoke('bible:getAllBooks'),
    // Batch method for faster initial load
    getInitialData: (defaultAbbreviation?: string, defaultBook?: number, defaultChapter?: number) =>
      typedInvoke('bible:getInitialData', defaultAbbreviation, defaultBook, defaultChapter),
    // Study mode methods
    getInterlinearWords: (abbreviation: string, verseId: number) =>
      typedInvoke('bible:getInterlinearWords', abbreviation, verseId),
    getInterlinearWordsForChapter: (abbreviation: string, bookNumber: number, chapter: number) =>
      typedInvoke('bible:getInterlinearWordsForChapter', abbreviation, bookNumber, chapter),
    hasInterlinearData: (abbreviation: string) =>
      typedInvoke('bible:hasInterlinearData', abbreviation),
    getUserCrossReferences: (username: string, verseId: number) =>
      typedInvoke('bible:getUserCrossReferences', username, verseId),
    createUserCrossReference: (username: string, fromVerseId: number, toVerseId: number, notes?: string) =>
      typedInvoke('bible:createUserCrossReference', username, fromVerseId, toVerseId, notes),
    deleteUserCrossReference: (username: string, userXrefId: number) =>
      typedInvoke('bible:deleteUserCrossReference', username, userXrefId),
    getVerseTexts: (abbreviation: string, verseIds: number[]) =>
      typedInvoke('bible:getVerseTexts', abbreviation, verseIds)
  },

  commentary: {
    getAvailableCommentaries: () => ipcRenderer.invoke('commentary:getAvailableCommentaries'),
    getCommentaryInfo: (abbreviation: string) =>
      ipcRenderer.invoke('commentary:getCommentaryInfo', abbreviation),
    getEntriesForVerse: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('commentary:getEntriesForVerse', abbreviation, verseId),
    hasContentForVerse: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('commentary:hasContentForVerse', abbreviation, verseId),
    getNextVerseWithContent: (abbreviation: string, currentVerseId: number) =>
      ipcRenderer.invoke('commentary:getNextVerseWithContent', abbreviation, currentVerseId),
    getPreviousVerseWithContent: (abbreviation: string, currentVerseId: number) =>
      ipcRenderer.invoke('commentary:getPreviousVerseWithContent', abbreviation, currentVerseId),
    getAllEntrySummaries: (abbreviation: string) =>
      ipcRenderer.invoke('commentary:getAllEntrySummaries', abbreviation),
    search: (abbreviation: string, query: string, options?: { limit?: number }) =>
      ipcRenderer.invoke('commentary:search', abbreviation, query, options),
    // Batch method for session restore
    batchRestoreSession: (request: {
      abbreviations: string[];
      verseId: number;
      browseModeByTab?: Record<string, boolean>;
    }) => ipcRenderer.invoke('commentary:batchRestoreSession', request)
  },

  dictionary: {
    getAvailableDictionaries: () => ipcRenderer.invoke('dictionary:getAvailableDictionaries'),
    getDictionaryInfo: (abbreviation: string) =>
      ipcRenderer.invoke('dictionary:getDictionaryInfo', abbreviation),
    getEntry: (abbreviation: string, entryId: number) =>
      ipcRenderer.invoke('dictionary:getEntry', abbreviation, entryId),
    getEntryByKey: (abbreviation: string, entryKey: string) =>
      ipcRenderer.invoke('dictionary:getEntryByKey', abbreviation, entryKey),
    searchEntries: (abbreviation: string, query: string, limit?: number) =>
      ipcRenderer.invoke('dictionary:searchEntries', abbreviation, query, limit),
    getAllEntries: (abbreviation: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke('dictionary:getAllEntries', abbreviation, limit, offset),
    getOccurrences: (abbreviation: string, entryKey: string) =>
      ipcRenderer.invoke('dictionary:getOccurrences', abbreviation, entryKey),
    getOccurrencesForVerse: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('dictionary:getOccurrencesForVerse', abbreviation, verseId)
  },

  book: {
    getAvailableBooks: () => ipcRenderer.invoke('book:getAvailableBooks'),
    getBookInfo: (abbreviation: string) =>
      ipcRenderer.invoke('book:getBookInfo', abbreviation),
    getSection: (abbreviation: string, sectionId: number) =>
      ipcRenderer.invoke('book:getSection', abbreviation, sectionId),
    getTopLevelSections: (abbreviation: string) =>
      ipcRenderer.invoke('book:getTopLevelSections', abbreviation),
    getSectionsByParent: (abbreviation: string, parentSectionId: number) =>
      ipcRenderer.invoke('book:getSectionsByParent', abbreviation, parentSectionId),
    getAllSectionSummaries: (abbreviation: string) =>
      ipcRenderer.invoke('book:getAllSectionSummaries', abbreviation),
    getNextSection: (abbreviation: string, currentSectionId: number) =>
      ipcRenderer.invoke('book:getNextSection', abbreviation, currentSectionId),
    getPreviousSection: (abbreviation: string, currentSectionId: number) =>
      ipcRenderer.invoke('book:getPreviousSection', abbreviation, currentSectionId),
    getParentSection: (abbreviation: string, currentSectionId: number) =>
      ipcRenderer.invoke('book:getParentSection', abbreviation, currentSectionId),
    searchSections: (abbreviation: string, query: string, limit?: number) =>
      ipcRenderer.invoke('book:searchSections', abbreviation, query, limit),
    getScriptureReferences: (abbreviation: string, sectionId: number) =>
      ipcRenderer.invoke('book:getScriptureReferences', abbreviation, sectionId),
    getSectionsReferencingVerse: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('book:getSectionsReferencingVerse', abbreviation, verseId)
  },

  topical: {
    getAvailable: () => typedInvoke('topical:getAvailable'),
    getTopicsForVerse: (verseId: number) =>
      typedInvoke('topical:getTopicsForVerse', verseId),
    getTopic: (abbreviation: string, topicId: number) =>
      typedInvoke('topical:getTopic', abbreviation, topicId),
    getChildren: (abbreviation: string, parentTopicId: number) =>
      typedInvoke('topical:getChildren', abbreviation, parentTopicId),
    getParentChain: (abbreviation: string, topicId: number) =>
      typedInvoke('topical:getParentChain', abbreviation, topicId),
    getVersesForTopic: (abbreviation: string, topicId: number, limit?: number, offset?: number) =>
      typedInvoke('topical:getVersesForTopic', abbreviation, topicId, limit, offset),
    searchTopics: (query: string, sources?: string[], limit?: number, offset?: number) =>
      typedInvoke('topical:searchTopics', query, sources, limit, offset),
    browseTopics: (sources?: string[], limit?: number, offset?: number, filter?: string, rootsOnly?: boolean) =>
      typedInvoke('topical:browseTopics', sources, limit, offset, filter, rootsOnly),
    getAlsoIn: (topicName: string, excludeAbbreviation: string) =>
      typedInvoke('topical:getAlsoIn', topicName, excludeAbbreviation)
  },

  tagGraph: {
    getEntity: (entityId: string, category: string) =>
      ipcRenderer.invoke('tagGraph:getEntity', entityId, category),
    getAssociationsForEntity: (entityId: string, category: string) =>
      ipcRenderer.invoke('tagGraph:getAssociationsForEntity', entityId, category),
    getPeopleRelationships: (personId: string) =>
      ipcRenderer.invoke('tagGraph:getPeopleRelationships', personId),
    searchEntities: (query: string, categories?: string[]) =>
      ipcRenderer.invoke('tagGraph:searchEntities', query, categories),
    getEntityAliases: (entityId: string, category: string) =>
      ipcRenderer.invoke('tagGraph:getEntityAliases', entityId, category),
    getTopicLinksForEntity: (entityId: string, category: string, sourceModule?: string) =>
      ipcRenderer.invoke('tagGraph:getTopicLinksForEntity', entityId, category, sourceModule),
    getEntityForTopic: (sourceModule: string, topicId: number) =>
      ipcRenderer.invoke('tagGraph:getEntityForTopic', sourceModule, topicId),
    getEntityByName: (name: string) =>
      ipcRenderer.invoke('tagGraph:getEntityByName', name),
    getVersesForEntity: (entityId: string, category: string) =>
      ipcRenderer.invoke('tagGraph:getVersesForEntity', entityId, category),
    getFacetsForEntity: (entityId: string, category: string) =>
      ipcRenderer.invoke('tagGraph:getFacetsForEntity', entityId, category),
  },

  crossReference: {
    getAvailable: () => ipcRenderer.invoke('xref:getAvailable'),
    getGroupsForVerse: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('xref:getGroupsForVerse', abbreviation, verseId),
    getGroupsForRange: (abbreviation: string, startVerseId: number, endVerseId: number) =>
      typedInvoke('xref:getGroupsForRange', abbreviation, startVerseId, endVerseId),
    getReverseReferences: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('xref:getReverseReferences', abbreviation, verseId),
    getReverseReferencesForRange: (abbreviation: string, startVerseId: number, endVerseId: number) =>
      typedInvoke('xref:getReverseReferencesForRange', abbreviation, startVerseId, endVerseId),
    getEntryCount: (abbreviation: string, verseId: number) =>
      ipcRenderer.invoke('xref:getEntryCount', abbreviation, verseId)
  },

  search: {
    performSearch: (query: string, options: any) =>
      ipcRenderer.invoke('search:performSearch', query, options),
    getSavedSearches: () => ipcRenderer.invoke('search:getSavedSearches'),
    saveSearch: (name: string, query: string, searchType: string, scope: any, options: any) =>
      ipcRenderer.invoke('search:saveSearch', name, query, searchType, scope, options),
    loadSavedSearch: (searchId: number) =>
      ipcRenderer.invoke('search:loadSavedSearch', searchId),
    deleteSavedSearch: (searchId: number) =>
      ipcRenderer.invoke('search:deleteSavedSearch', searchId),
    getIndexStatus: (modules: string[]) =>
      ipcRenderer.invoke('search:getIndexStatus', modules),
    buildIndex: (modules: string[], onProgress?: (progress: any) => void) =>
      ipcRenderer.invoke('search:buildIndex', modules, onProgress),
    getBookIndexStatus: (moduleAbbr: string) =>
      ipcRenderer.invoke('search:getBookIndexStatus', moduleAbbr),
    // Semantic search
    semanticAvailable: () =>
      ipcRenderer.invoke('search:semanticAvailable'),
    semanticSearch: (query: string, options?: { maxResults?: number; levels?: string[] }) =>
      ipcRenderer.invoke('search:semanticSearch', query, options),
  },

  session: {
    getAll: () => typedInvoke('session:getAll'),
    load: (sessionId: number) => typedInvoke('session:load', sessionId),
    getOrCreateAutosave: () => typedInvoke('session:getOrCreateAutosave'),
    create: (data: { name: string; description?: string; sessionData: any; isDefault?: boolean }) =>
      typedInvoke('session:create', data),
    update: (sessionId: number, updates: { name?: string; description?: string; sessionData?: any; isDefault?: boolean }) =>
      typedInvoke('session:update', sessionId, updates),
    delete: (sessionId: number) => typedInvoke('session:delete', sessionId),
    setAsDefault: (sessionId: number) => typedInvoke('session:setAsDefault', sessionId),
    getDefault: () => typedInvoke('session:getDefault'),
    getRecent: (limit?: number) => typedInvoke('session:getRecent', limit),
    onSaveRequested: (callback: () => Promise<{ success: boolean; message?: string }>) => {
      ipcRenderer.on('session:save-requested', async () => {
        try {
          const result = await callback();
          ipcRenderer.send('session:save-result', result);
        } catch (error: unknown) {
          ipcRenderer.send('session:save-result', { success: false, message: error instanceof Error ? error.message : 'Unknown error' });
        }
      });
    }
  },

  study: {
    getVerseLinks: (verseId: number, openModuleIds?: number[]) =>
      typedInvoke('study:getVerseLinks', verseId, openModuleIds),
    getBatchVerseLinks: (verseIds: number[], openModuleIds?: number[]) =>
      typedInvoke('study:getBatchVerseLinks', verseIds, openModuleIds),
    getOverview: (book: number, chapter: number) =>
      typedInvoke('study:getOverview', book, chapter),
    getCommentaryMentions: (moduleId: number, verseId: number) =>
      typedInvoke('study:getCommentaryMentions', moduleId, verseId)
  },

  // Expose ipcRenderer.invoke for notes API. The `channel` param is typed as
  // AllowedIpcChannel so renderer code gets compile-time autocomplete/typo
  // checking; the runtime `.includes` check stays as defense-in-depth against
  // any caller that bypasses the type system (e.g., via `as any`).
  ipcRenderer: {
    invoke: (channel: AllowedIpcChannel, ...args: unknown[]) => {
      if ((ALLOWED_IPC_CHANNELS as readonly string[]).includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      } else {
        return Promise.reject(new Error(`IPC channel '${channel}' not allowed`));
      }
    }
  },

  menu: {
    // Listeners for menu events from main process
    onNewSession: (callback: () => void) => {
      ipcRenderer.on('menu:new-session', callback);
    },
    onOpenSession: (callback: () => void) => {
      ipcRenderer.on('menu:open-session', callback);
    },
    onSaveSession: (callback: () => void) => {
      ipcRenderer.on('menu:save-session', callback);
    },
    onImportModule: (callback: () => void) => {
      ipcRenderer.on('menu:import-module', callback);
    },
    onExportData: (callback: () => void) => {
      ipcRenderer.on('menu:export-data', callback);
    },
    onPreferences: (callback: () => void) => {
      ipcRenderer.on('menu:preferences', callback);
    },
    onFind: (callback: () => void) => {
      ipcRenderer.on('menu:find', callback);
    },
    onFindInPane: (callback: () => void) => {
      ipcRenderer.on('menu:find-in-pane', callback);
    },
    onGoToVerse: (callback: () => void) => {
      ipcRenderer.on('menu:go-to-verse', callback);
    },
    onCompareTranslations: (callback: () => void) => {
      ipcRenderer.on('menu:compare-translations', callback);
    },
    onAddNote: (callback: () => void) => {
      ipcRenderer.on('menu:add-note', callback);
    },
    onAddHighlight: (callback: () => void) => {
      ipcRenderer.on('menu:add-highlight', callback);
    },
    onSearchAll: (callback: () => void) => {
      ipcRenderer.on('menu:search-all', callback);
    },
    onDocumentation: (callback: () => void) => {
      ipcRenderer.on('menu:documentation', callback);
    },
    onKeyboardShortcuts: (callback: () => void) => {
      ipcRenderer.on('menu:keyboard-shortcuts', callback);
    },
    onLayoutChange: (callback: (layout: string) => void) => {
      ipcRenderer.on('menu:layout-change', (_event, layout: string) => callback(layout));
    },
    onPaneToggle: (callback: (paneId: string, visible: boolean) => void) => {
      ipcRenderer.on('menu:pane-toggle', (_event, paneId: string, visible: boolean) =>
        callback(paneId, visible)
      );
    },
    onThemeChange: (callback: (theme: string) => void) => {
      ipcRenderer.on('menu:theme-change', (_event, theme: string) => callback(theme));
    },

    // Methods to update menu state from renderer
    updateLayout: (layoutId: string) => {
      ipcRenderer.send('menu:update-layout', layoutId);
    },
    updatePane: (paneId: string, visible: boolean) => {
      ipcRenderer.send('menu:update-pane', paneId, visible);
    },
    updateTheme: (themeId: string) => {
      ipcRenderer.send('menu:update-theme', themeId);
    }
  },

  electronMenu: {
    rebuild: (spec: MenuSpec) => {
      ipcRenderer.send('menu:rebuild', spec);
    },
    onCommandExecute: (callback: (commandId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, commandId: string) => callback(commandId);
      ipcRenderer.on('commands:execute', handler);
      return () => {
        ipcRenderer.removeListener('commands:execute', handler);
      };
    }
  },

  i18n: {
    listBuiltinCatalogs: () => ipcRenderer.invoke('i18n:listBuiltinCatalogs'),
    readBuiltinCatalog: (locale: string, namespace: string) =>
      ipcRenderer.invoke('i18n:readBuiltinCatalog', locale, namespace),
    listUserCatalogs: () => ipcRenderer.invoke('i18n:listUserCatalogs'),
    readUserCatalog: (locale: string, namespace: string) =>
      ipcRenderer.invoke('i18n:readUserCatalog', locale, namespace),
    setLocale: (locale: string) => ipcRenderer.invoke('i18n:setLocale', locale),
  },

  window: {
    // Detach a pane to a new window
    detachPane: (paneType: string, initialState: any) =>
      ipcRenderer.invoke('window:detach-pane', paneType, initialState),

    // Close a detached window
    closeDetachedWindow: (windowId: string) =>
      ipcRenderer.invoke('window:close-detached', windowId),

    // Get all detached windows
    getDetachedWindows: () =>
      ipcRenderer.invoke('window:get-detached-windows'),

    // Listen for initialization data (for detached windows)
    onInitializePane: (callback: (data: any) => void) => {
      ipcRenderer.on('initialize-pane', (_event, data: any) => callback(data));
    },

    // Broadcast verse change to detached windows (called from main window)
    broadcastVerseChange: (verseId: number) =>
      ipcRenderer.invoke('window:broadcast-verse-change', verseId),

    // Listen for verse changes (for detached windows)
    onVerseChanged: (callback: (verseId: number) => void) => {
      ipcRenderer.on('verse-changed', (_event, verseId: number) => callback(verseId));
    },

    // Listen for extension-driven verse navigation requests
    onExtensionNavigateToVerse: (callback: (verseId: number) => void) => {
      ipcRenderer.on('extension:navigate-to-verse', (_event, verseId: number) => callback(verseId));
    }
  },

  app: {
    onUserDataReady: (callback: () => void) => {
      ipcRenderer.on('user-data-ready', callback);
    }
  },

  backup: {
    create: (options: { password: string; includeHistory?: boolean }) =>
      ipcRenderer.invoke('backup:create', options),
    selectFile: () => ipcRenderer.invoke('backup:selectFile'),
    validate: (backupPath: string, password: string) =>
      ipcRenderer.invoke('backup:validate', backupPath, password),
    restore: (options: { backupPath: string; password: string; mode: 'merge' | 'replace' }) =>
      ipcRenderer.invoke('backup:restore', options),
  },

  moduleManager: {
    // Initialize module manager
    init: () => typedInvoke('module:init'),
    // Get available modules
    getAvailableModules: (filter?: any) => typedInvoke('module:get-available', filter),
    // Get installed modules
    getInstalledModules: () => typedInvoke('module:get-installed'),
    // Search modules
    searchModules: (filter: any) => typedInvoke('module:search', filter),
    // Starter packs for a UI locale, and the catalog entries one names.
    getStarterPacks: (languageCode: string) =>
      typedInvoke('module:get-starter-packs', languageCode),
    getStarterPackModules: (packId: string) =>
      typedInvoke('module:get-starter-pack-modules', packId),
    // Install module
    installModule: (moduleId: string) => typedInvoke('module:install', moduleId),
    // Install module from file (opens file dialog)
    installFromFile: () => typedInvoke('module:install-from-file'),
    // Install module from a given file path (for drag-and-drop)
    installFromPath: (filePath: string, policy?: ModuleInstallPolicy | boolean) =>
      typedInvoke('module:install-from-path', filePath, policy ?? true),
    // Install a pack archive from a given (blessed) file path (drag-and-drop)
    installPackFromPath: (archivePath: string, policy?: ModuleInstallPolicy | boolean) =>
      typedInvoke('module:install-pack-from-path', archivePath, policy ?? 'replace-if-newer'),
    // Uninstall module
    uninstallModule: (moduleId: number, removeUserData?: boolean) =>
      typedInvoke('module:uninstall', moduleId, removeUserData),
    // Update module
    updateModule: (moduleId: number) => typedInvoke('module:update', moduleId),
    // Check for updates
    checkForUpdates: (moduleId: number) => typedInvoke('module:check-for-updates', moduleId),
    // Get module details
    getModuleDetails: (moduleId: number) => typedInvoke('module:get-details', moduleId),
    // Download management
    getDownloadProgress: (queueId: number) => typedInvoke('download:get-progress', queueId),
    getActiveDownloads: () => typedInvoke('download:get-active'),
    pauseDownload: (queueId: number) => typedInvoke('download:pause', queueId),
    resumeDownload: (queueId: number) => typedInvoke('download:resume', queueId),
    cancelDownload: (queueId: number) => typedInvoke('download:cancel', queueId),
    // Repository management
    getAllRepositories: () => typedInvoke('repository:get-all'),
    refreshCatalog: (repositoryId: number) => typedInvoke('repository:refresh-catalog', repositoryId),
    refreshAllCatalogs: () => typedInvoke('repository:refresh-all'),
    getCatalog: (repositoryId: number) => typedInvoke('repository:get-catalog', repositoryId),
    addRepository: (name: string, url: string, type: string, abbreviation?: string) =>
      typedInvoke('repository:add', name, url, type, abbreviation),
    removeRepository: (repositoryId: number) => typedInvoke('repository:remove', repositoryId),
    updateRepositoryUrl: (repositoryId: number, newUrl: string) =>
      typedInvoke('repository:update-url', repositoryId, newUrl),
    setRepositoryEnabled: (repositoryId: number, enabled: boolean) =>
      typedInvoke('repository:set-enabled', repositoryId, enabled)

  },

  featurePacks: {
    listAvailable: () => typedInvoke('featurePack:list-available'),
    getStatus: () => typedInvoke('featurePack:get-status'),
    install: (packId: string) => typedInvoke('featurePack:install', packId),
    installFromFile: (kind: 'file' | 'folder') =>
      typedInvoke('featurePack:install-from-file', kind),
    cancel: () => typedInvoke('featurePack:cancel'),
    uninstall: () => typedInvoke('featurePack:uninstall'),
  },

  // Bidirectional bridge channel for the renderer-backed
  // extension bridges (Command / Context / Ui / Workspace / L10n). The
  // renderer side of the protocol is in
  // `src/ui/extensions/extensionRendererBridge.ts`. We expose `on` / `send`
  // / `invoke` rather than the raw `ipcRenderer` so contextIsolation stays
  // honest.
  extensionBridge: {
    on: (channel: string, handler: (payload: unknown) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => handler(payload);
      ipcRenderer.on(channel, wrapped);
      return () => {
        ipcRenderer.removeListener(channel, wrapped);
      };
    },
    send: (channel: string, payload: unknown) => {
      ipcRenderer.send(channel, payload);
    },
    invoke: (channel: string, payload: unknown) => {
      return ipcRenderer.invoke(channel, payload);
    },
  },

  diagnostics: {
    getQueue: () => ipcRenderer.invoke('diagnostics:get-queue'),
    getReport: (id: string) => ipcRenderer.invoke('diagnostics:get-report', id),
    deleteReport: (id: string) => ipcRenderer.invoke('diagnostics:delete-report', id),
    deleteAll: () => ipcRenderer.invoke('diagnostics:delete-all'),
    submitCrashReport: (args: { reportId: string; description?: string }) =>
      ipcRenderer.invoke('diagnostics:submit-crash-report', args),
    submitManualReport: (args: { description: string; includeDiagnostics: boolean }) =>
      ipcRenderer.invoke('diagnostics:submit-manual-report', args),
    submitFeedback: (args: { description: string }) =>
      ipcRenderer.invoke('diagnostics:submit-feedback', args),
    getStateSnapshot: () => ipcRenderer.invoke('diagnostics:get-state-snapshot'),
    getConfig: () => ipcRenderer.invoke('diagnostics:get-config'),
    setConfig: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke('diagnostics:set-config', patch),
    reportRendererError: (payload: { message: string; stack?: string; componentStack?: string }) =>
      ipcRenderer.invoke('diagnostics:report-renderer-error', payload),
    flushNow: () => ipcRenderer.invoke('diagnostics:flush-now'),
    onCrashDetected: (handler: (payload: { id: string }) => void) => {
      const wrapped = (_event: unknown, payload: { id: string }): void => handler(payload);
      ipcRenderer.on('diagnostics:crash-detected', wrapped);
      return () => {
        ipcRenderer.removeListener('diagnostics:crash-detected', wrapped);
      };
    },
  },

  network: {
    getAllowWebRequests: () => typedInvoke('network:get-allow-web-requests'),
    setAllowWebRequests: (allow: boolean) =>
      typedInvoke('network:set-allow-web-requests', allow),
    getOfflineMode: () => typedInvoke('network:get-offline-mode'),
    setOfflineMode: (offline: boolean) =>
      typedInvoke('network:set-offline-mode', offline),
  },

  updates: {
    getInfo: () => typedInvoke('update:get-info'),
    check: () => typedInvoke('update:check'),
    canInstall: () => typedInvoke('update:can-install'),
    download: () => typedInvoke('update:download'),
    install: () => typedInvoke('update:install'),
    onDownloadProgress: (cb: (progress: UpdateDownloadProgress) => void) => {
      const listener = (_e: unknown, progress: UpdateDownloadProgress): void => cb(progress);
      ipcRenderer.on('update:download-progress', listener);
      return () => ipcRenderer.removeListener('update:download-progress', listener);
    },
  },

  webUtils: {
    getPathForFile: async (file: File) => {
      const path = webUtils.getPathForFile(file);
      if (path) {
        // Best-effort: if the bless call fails (e.g. the file vanished
        // between the drop and now), the subsequent install call will
        // correctly refuse the path as unauthorized rather than silently
        // proceeding.
        await typedInvoke('module:bless-dropped-path', path);
      }
      return path;
    },
  },

  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    get: (extensionId: string) => ipcRenderer.invoke('extensions:get', extensionId),
    pickFolderAndInstall: () => ipcRenderer.invoke('extensions:pickFolderAndInstall'),
    installFromFolder: (sourcePath: string) =>
      ipcRenderer.invoke('extensions:installFromFolder', sourcePath),
    pickZipAndInstall: () => ipcRenderer.invoke('extensions:pickZipAndInstall'),
    installFromZip: (zipPath: string) => ipcRenderer.invoke('extensions:installFromZip', zipPath),
    getDeveloperMode: () => ipcRenderer.invoke('extensions:getDeveloperMode'),
    setDeveloperMode: (enabled: boolean) =>
      ipcRenderer.invoke('extensions:setDeveloperMode', enabled),
    pickFolderAndLoadUnpacked: () => ipcRenderer.invoke('extensions:pickFolderAndLoadUnpacked'),
    reloadUnpacked: (extensionId: string) =>
      ipcRenderer.invoke('extensions:reloadUnpacked', extensionId),
    updatePermissions: (extensionId: string, grantedPermissions: string[]) =>
      ipcRenderer.invoke('extensions:updatePermissions', extensionId, grantedPermissions),
    getSettings: (extensionId: string) => ipcRenderer.invoke('extensions:getSettings', extensionId),
    setSettings: (extensionId: string, values: Record<string, unknown>) =>
      ipcRenderer.invoke('extensions:setSettings', extensionId, values),
    uninstall: (extensionId: string) => ipcRenderer.invoke('extensions:uninstall', extensionId),
    enable: (extensionId: string) => ipcRenderer.invoke('extensions:enable', extensionId),
    disable: (extensionId: string) => ipcRenderer.invoke('extensions:disable', extensionId),
    activate: (extensionId: string) => ipcRenderer.invoke('extensions:activate', extensionId),
    deactivate: (extensionId: string) => ipcRenderer.invoke('extensions:deactivate', extensionId),
    resetCrashState: (extensionId: string) =>
      ipcRenderer.invoke('extensions:resetCrashState', extensionId),
    getLog: (extensionId: string, limit?: number) =>
      ipcRenderer.invoke('extensions:getLog', extensionId, limit),
    getCrashLog: (extensionId: string, limit?: number) =>
      ipcRenderer.invoke('extensions:getCrashLog', extensionId, limit),
    getPanelTypeUiEntry: (extensionId: string, panelTypeId: string) =>
      ipcRenderer.invoke('extensions:getPanelTypeUiEntry', extensionId, panelTypeId),
    openInstallFolder: (extensionId: string) =>
      ipcRenderer.invoke('extensions:openInstallFolder', extensionId),
    /**
     * Outbound request for an extension panel iframe, routed
     * through that extension's own network api-impl. The panel host supplies
     * `extensionId`; the iframe never does.
     */
    uiFetch: (extensionId: string, url: string, init?: unknown) =>
      ipcRenderer.invoke('extensions:uiFetch', extensionId, url, init),
    /** Marketplace catalogs. */
    catalog: {
      listSources: () => ipcRenderer.invoke('extensions:catalog:listSources'),
      addSource: (url: string, label?: string, acknowledgeRisk?: boolean) =>
        ipcRenderer.invoke('extensions:catalog:addSource', url, label, acknowledgeRisk),
      acknowledgeRisk: (url: string) =>
        ipcRenderer.invoke('extensions:catalog:acknowledgeRisk', url),
      removeSource: (url: string) => ipcRenderer.invoke('extensions:catalog:removeSource', url),
      refresh: (url: string) => ipcRenderer.invoke('extensions:catalog:refresh', url),
      refreshAll: () => ipcRenderer.invoke('extensions:catalog:refreshAll'),
      listAvailable: () => ipcRenderer.invoke('extensions:catalog:listAvailable'),
      install: (extensionId: string, sourceUrl?: string) =>
        ipcRenderer.invoke('extensions:catalog:install', extensionId, sourceUrl),
    },
    /** Block rules currently in force. Read-only by design. */
    blocklist: {
      list: () => ipcRenderer.invoke('extensions:blocklist:list'),
      checkInstalled: () => ipcRenderer.invoke('extensions:blocklist:checkInstalled'),
    },
  },
};

// Expose the API to window.electron
contextBridge.exposeInMainWorld('electron', electronAPI);

// TypeScript declaration for window.electron
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
