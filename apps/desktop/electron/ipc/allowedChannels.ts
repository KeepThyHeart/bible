/**
 * Whitelist of IPC channels allowed through the generic `ipcRenderer.invoke`
 * bridge exposed to the renderer process.
 *
 * Channels that are exposed via typed API methods (e.g., `bible.*`,
 * `commentary.*`) in preload.ts do NOT need to appear here because they
 * have their own dedicated bridge functions. This list covers channels that
 * are invoked through the generic `window.electron.ipcRenderer.invoke()`
 * escape hatch (primarily notes, highlights, collections, search extras,
 * backup, module manager, and file-based notes).
 *
 * MAINTENANCE: When adding a new `ipcHandler` or `ipcMain.handle`
 * registration that the renderer calls via `ipcRenderer.invoke`, add the
 * channel string here. Keeping this in one file makes it easy to audit and
 * prevents the preload whitelist from drifting out of sync with handlers.
 */
export const ALLOWED_IPC_CHANNELS = [
  // Highlights
  'highlights:create',
  'highlights:update',
  'highlights:delete',
  'highlights:get-by-id',
  'highlights:get-for-verse',
  'highlights:get-for-verse-range',
  'highlights:get-for-module',
  'highlights:get-by-color',
  'highlights:delete-for-verse',
  'highlights:count-for-module',
  'highlights:get-by-note',
  'highlights:delete-for-verse-range',
  'highlights:find-overlapping',
  // Notes
  'notes:get-by-id',
  'notes:get-all',
  'notes:get-by-type',
  'notes:get-verse-notes',
  'notes:get-documents',
  'notes:get-journals',
  'notes:get-prayers',
  'notes:get-for-verse',
  'notes:get-for-verse-range',
  'notes:search',
  'notes:get-by-tag',
  'notes:get-all-tags',
  'notes:create',
  'notes:create-verse-note',
  'notes:create-document',
  'notes:update',
  'notes:update-content',
  'notes:update-title',
  'notes:add-tag',
  'notes:remove-tag',
  'notes:count-descendants',
  'notes:delete',
  'notes:get-recent',
  'notes:get-statistics',
  'notes:getNextVerseWithContent',
  'notes:getPreviousVerseWithContent',
  'notes:getAllNoteSummaries',
  'notes:get-verses-with-notes',
  'prayer-lists:get-all',
  'prayer-lists:get-by-id',
  'prayer-lists:create',
  'prayer-lists:update',
  'prayer-lists:delete',
  'prayer-lists:get-prayers',
  'prayer-lists:get-prayer-count',
  'prayer-lists:reorder-prayers',
  'prayer-lists:reorder',
  'collection:get-all',
  'collection:get-tree',
  'collection:get-by-id',
  'collection:get-top-level',
  'collection:get-children',
  'collection:create',
  'collection:update',
  'collection:delete',
  'collection:move',
  'collection:search',
  'collection:get-items',
  'collection:add-verse',
  'collection:add-passage',
  'collection:quick-bookmark',
  'collection:get-bookmarks',
  'collection:bookmark-passage',
  'collection:replace-bookmark-reference',
  'collection:rename-bookmark',
  'collection:remove-item',
  'collection:remove-verse-bookmark',
  'collection:is-verse-bookmarked',
  'collection:get-containing-verse',
  'collection:move-item',
  'collection:update-item',
  'collection:bulk-add-verses',
  'collection:reorder',
  'collection:reorder-items',
  // Search channels
  'search:getBookIndexStatus',
  'search:semanticAvailable',
  'search:semanticSearch',
  // Backup/Restore channels
  'backup:create',
  'backup:selectFile',
  'backup:validate',
  'backup:restore',
  // File-based notes channels
  'file-notes:get-notes-dir',
  'file-notes:is-initialized',
  'file-notes:initialize',
  'file-notes:list-directory',
  'file-notes:read-note',
  'file-notes:read-note-absolute',
  'file-notes:create-note',
  'file-notes:save-note',
  'file-notes:save-note-absolute',
  'file-notes:create-folder',
  'file-notes:rename',
  'file-notes:delete',
  'file-notes:open-in-file-manager',
  'file-notes:show-open-dialog',
  'file-notes:pick-image',
  'file-notes:show-save-dialog',
  'file-notes:show-folder-dialog',
  'file-notes:create-verse-note',
  'file-notes:read-verse-note',
  'file-notes:has-verse-note',
  'file-notes:list-verse-note-books',
  'file-notes:list-verse-note-chapters',
  'file-notes:list-verse-notes-in-chapter',
  'file-notes:ensure-verse-notes-folder',
  'file-notes:export-markdown',
  'file-notes:export-docx',
  // Print / PDF - registered in main.ts beside the hidden-window plumbing
  // they share, not in fileNotesHandlers.
  'notes:print',
  'notes:export-pdf',
  // App-shell commands invoked by command handlers (about dialog,
  // dev tools toggle, zoom, external links). Routed through
  // ipcRenderer.invoke so they share the existing whitelist.
  'app:show-about',
  'app:toggle-dev-tools',
  'app:zoom-in',
  'app:zoom-out',
  'app:actual-size',
  'app:open-external',
  // Diagnostics & issue reporting
  'diagnostics:get-queue',
  'diagnostics:get-report',
  'diagnostics:delete-report',
  'diagnostics:delete-all',
  'diagnostics:submit-crash-report',
  'diagnostics:submit-manual-report',
  'diagnostics:submit-feedback',
  'diagnostics:get-state-snapshot',
  'diagnostics:get-config',
  'diagnostics:set-config',
  'diagnostics:report-renderer-error',
  'diagnostics:flush-now',
  // Renderer-bound event (main -> renderer): `diagnostics:crash-detected`
  // Network privacy - master offline switch
  'network:get-allow-web-requests',
  'network:set-allow-web-requests',
  'network:get-offline-mode',
  'network:set-offline-mode',
  // Manual "Check for Updates". User-initiated only; routed through
  // the NetworkGateway. `get-info` is pre-flight (no egress); `check` contacts
  // the update host after the user confirms.
  'update:get-info',
  'update:check',
  'update:can-install',
  'update:download',
  'update:install',
] as const;

/**
 * Union of every channel name permitted through the generic invoke bridge.
 * Narrowing the preload `invoke()` signature to this type gives the renderer
 * compile-time feedback on typos and makes the IPC surface intentional.
 */
export type AllowedIpcChannel = typeof ALLOWED_IPC_CHANNELS[number];

/**
 * Full registry of IPC channel names used by typed preload bridges
 * (`window.electron.bible.*`, `window.electron.commentary.*`, etc.) - i.e.
 * channels that do NOT go through the generic `ipcRenderer.invoke` escape
 * hatch and therefore are not in `ALLOWED_IPC_CHANNELS`.
 *
 * Keeping these as a `const` tuple + derived union gives us compile-time
 * guarantees that preload bridge functions cannot mistype a channel name.
 * Combined with `ALLOWED_IPC_CHANNELS`, `IpcChannel` below covers every
 * channel the renderer is allowed to invoke.
 *
 * MAINTENANCE: When adding a new `ipcMain.handle` / `ipcHandler`
 * registration for a typed bridge, add the channel string
 * here so preload's `typedInvoke` can find it.
 */
export const TYPED_IPC_CHANNELS = [
  // Bible
  'bible:getAvailableBibles',
  'bible:getVerse',
  'bible:getVerses',
  'bible:getChapter',
  'bible:search',
  'bible:getBookName',
  'bible:getAllBooks',
  'bible:getInitialData',
  'bible:getInterlinearWords',
  'bible:getInterlinearWordsForChapter',
  'bible:hasInterlinearData',
  'bible:getUserCrossReferences',
  'bible:createUserCrossReference',
  'bible:deleteUserCrossReference',
  'bible:getVerseTexts',
  // Commentary
  'commentary:getAvailableCommentaries',
  'commentary:getCommentaryInfo',
  'commentary:getEntriesForVerse',
  'commentary:hasContentForVerse',
  'commentary:getNextVerseWithContent',
  'commentary:getPreviousVerseWithContent',
  'commentary:getAllEntrySummaries',
  'commentary:search',
  'commentary:batchRestoreSession',
  // Dictionary
  'dictionary:getAvailableDictionaries',
  'dictionary:getDictionaryInfo',
  'dictionary:getEntry',
  'dictionary:getEntryByKey',
  'dictionary:searchEntries',
  'dictionary:getAllEntries',
  'dictionary:getOccurrences',
  'dictionary:getOccurrencesForVerse',
  // Book
  'book:getAvailableBooks',
  'book:getBookInfo',
  'book:getSection',
  'book:getTopLevelSections',
  'book:getSectionsByParent',
  'book:getAllSectionSummaries',
  'book:getNextSection',
  'book:getPreviousSection',
  'book:getParentSection',
  'book:searchSections',
  'book:getScriptureReferences',
  'book:getSectionsReferencingVerse',
  // Topical index
  'topical:getAvailable',
  'topical:getTopicsForVerse',
  'topical:getTopic',
  'topical:getChildren',
  'topical:getParentChain',
  'topical:getVersesForTopic',
  'topical:searchTopics',
  'topical:browseTopics',
  'topical:getAlsoIn',
  // Tag graph
  'tagGraph:getEntity',
  'tagGraph:getAssociationsForEntity',
  'tagGraph:getPeopleRelationships',
  'tagGraph:searchEntities',
  'tagGraph:getEntityAliases',
  'tagGraph:getTopicLinksForEntity',
  'tagGraph:getEntityForTopic',
  'tagGraph:getEntityByName',
  'tagGraph:getVersesForEntity',
  'tagGraph:getFacetsForEntity',
  // Cross-references
  'xref:getAvailable',
  'xref:getGroupsForVerse',
  'xref:getReverseReferences',
  'xref:getEntryCount',
  'xref:getGroupsForRange',
  'xref:getReverseReferencesForRange',
  // Search (typed bridge - see also search:* in ALLOWED_IPC_CHANNELS)
  'search:performSearch',
  'search:getSavedSearches',
  'search:saveSearch',
  'search:loadSavedSearch',
  'search:deleteSavedSearch',
  'search:getIndexStatus',
  'search:buildIndex',
  // Sessions
  'session:getAll',
  'session:load',
  'session:getOrCreateAutosave',
  'session:create',
  'session:update',
  'session:delete',
  'session:setAsDefault',
  'session:getDefault',
  'session:getRecent',
  // Study
  'study:getVerseLinks',
  'study:getBatchVerseLinks',
  'study:getOverview',
  'study:getCommentaryMentions',
  // i18n
  'i18n:listBuiltinCatalogs',
  'i18n:readBuiltinCatalog',
  'i18n:listUserCatalogs',
  'i18n:readUserCatalog',
  'i18n:setLocale',
  // Window / pane detach
  'window:detach-pane',
  'window:close-detached',
  'window:get-detached-windows',
  'window:broadcast-verse-change',
  // Module Manager
  'module:init',
  'module:get-available',
  'module:get-installed',
  'module:search',
  'module:get-starter-packs',
  'module:get-starter-pack-modules',
  'module:install',
  'module:install-from-file',
  'module:install-from-path',
  'module:install-pack-from-path',
  'module:bless-dropped-path',
  'module:uninstall',
  'module:update',
  'module:check-for-updates',
  'module:get-details',
  // Feature packs (optional downloadable capabilities - currently semantic
  // search). Separate from `module:*` because a pack is not a module: it
  // carries no `module_info`, is never registered in `module_metadata`, and
  // installs to its own directory. See FeaturePackTypes.ts in @bible/core.
  'featurePack:list-available',
  'featurePack:get-status',
  'featurePack:install',
  'featurePack:install-from-file',
  'featurePack:cancel',
  'featurePack:uninstall',
  // Download management
  'download:get-progress',
  'download:get-active',
  'download:pause',
  'download:resume',
  'download:cancel',
  // Repository management
  'repository:get-all',
  'repository:refresh-catalog',
  'repository:refresh-all',
  'repository:get-catalog',
  'repository:add',
  'repository:remove',
  'repository:update-url',
  'repository:set-enabled',
  // Extensions
  'extensions:list',
  'extensions:get',
  'extensions:pickFolderAndInstall',
  'extensions:installFromFolder',
  'extensions:pickZipAndInstall',
  'extensions:installFromZip',
  'extensions:getDeveloperMode',
  'extensions:setDeveloperMode',
  'extensions:pickFolderAndLoadUnpacked',
  'extensions:reloadUnpacked',
  'extensions:updatePermissions',
  'extensions:getSettings',
  'extensions:setSettings',
  'extensions:uninstall',
  'extensions:enable',
  'extensions:disable',
  'extensions:activate',
  'extensions:deactivate',
  'extensions:resetCrashState',
  'extensions:getLog',
  'extensions:getCrashLog',
  'extensions:getPanelTypeUiEntry',
  'extensions:openInstallFolder',
  'extensions:uiFetch',
  // Marketplace. No `blocklist:refresh` channel by design - the
  // blocklist is fetched only from the manual "Check for Updates" flow.
  'extensions:catalog:listSources',
  'extensions:catalog:addSource',
  'extensions:catalog:acknowledgeRisk',
  'extensions:catalog:removeSource',
  'extensions:catalog:refresh',
  'extensions:catalog:refreshAll',
  'extensions:catalog:listAvailable',
  'extensions:catalog:install',
  'extensions:blocklist:list',
  'extensions:blocklist:checkInstalled',
] as const;

export type TypedIpcChannel = typeof TYPED_IPC_CHANNELS[number];

/**
 * Union of every IPC channel the renderer is allowed to invoke - both
 * typed-bridge channels and generic-invoke-whitelist channels.
 */
export type IpcChannel = TypedIpcChannel | AllowedIpcChannel;
