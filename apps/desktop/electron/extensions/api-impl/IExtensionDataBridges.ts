/**
 * Bridge interfaces between the host-side api-impls and the rest of
 * the desktop process (module loaders, the renderer's layout store, the i18n
 * service).
 *
 * Same separation-of-concerns rationale as `IExtensionRegistryBridges.ts`:
 * the api-impls only depend on these narrow interfaces so they can be unit
 * tested without standing up a real Bible repository / dockview / electron
 * window. Production wiring lives next to `main.ts`; an in-memory test
 * implementation lives in `InMemoryDataBridges.ts` alongside this file.
 */

import type { Extensions } from '@bible/core';

type BibleVerseDto = Extensions.BibleVerseDto;
type BibleModuleInfoDto = Extensions.BibleModuleInfoDto;
type BibleBookDto = Extensions.BibleBookDto;
type ParsedReferenceDto = Extensions.ParsedReferenceDto;
type VerseIterationResult = Extensions.VerseIterationResult;
type VerseTokenDto = Extensions.VerseTokenDto;
type VerseWordSelection = Extensions.VerseWordSelection;
type CommentaryEntryDto = Extensions.CommentaryEntryDto;
type CommentaryModuleInfoDto = Extensions.CommentaryModuleInfoDto;
type CommentaryIterationResult = Extensions.CommentaryIterationResult;
type DictionaryEntryDto = Extensions.DictionaryEntryDto;
type DictionaryModuleInfoDto = Extensions.DictionaryModuleInfoDto;
type DictionaryIterationResult = Extensions.DictionaryIterationResult;
type BookSectionDto = Extensions.BookSectionDto;
type BookSectionSummaryDto = Extensions.BookSectionSummaryDto;
type BookModuleInfoDto = Extensions.BookModuleInfoDto;
type BookIterationResult = Extensions.BookIterationResult;
type ExtensionPanelTypeDef = Extensions.ExtensionPanelTypeDef;
type LocalizedString = Extensions.LocalizedString;
type NotificationOpts = Extensions.NotificationOpts;
type QuickPickItemDescriptor<T> = Extensions.QuickPickItemDescriptor<T>;
type QuickPickOpts = Extensions.QuickPickOpts;
type InputBoxOpts = Extensions.InputBoxOpts;
type ConfirmOpts = Extensions.ConfirmOpts;
type PanelInfoDto = Extensions.PanelInfoDto;
type OpenPanelOpts = Extensions.OpenPanelOpts;
type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;
type DecorationDto = Extensions.DecorationDto;
type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type ContextMenuTarget = Extensions.ContextMenuTarget;
type ContextMenuItemDescriptor = Extensions.ContextMenuItemDescriptor;
type DisplayModeDescriptor = Extensions.DisplayModeDescriptor;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;
type PickFileOpts = Extensions.PickFileOpts;
type PickedFileDto = Extensions.PickedFileDto;
type SaveFileOpts = Extensions.SaveFileOpts;
type UserNoteDto = Extensions.UserNoteDto;
type NewNoteDto = Extensions.NewNoteDto;
type NoteQueryDto = Extensions.NoteQueryDto;
type UserHighlightDto = Extensions.UserHighlightDto;
type NewHighlightDto = Extensions.NewHighlightDto;
type HighlightStyleDescriptor = Extensions.HighlightStyleDescriptor;
type BookmarkDto = Extensions.BookmarkDto;
type CollectionDto = Extensions.CollectionDto;

// --- Bible bridge ----------------------------------------------------------

/**
 * Bridge to the desktop's Bible module loader. Returns DTOs (not internal
 * model classes) so the api-impl is a thin pass-through with no marshaling.
 */
export interface IExtensionBibleBridge {
  getVerse(verseId: number, moduleId?: string): BibleVerseDto | null;
  getRange(startVerseId: number, endVerseId: number, moduleId?: string): BibleVerseDto[];
  listModules(): BibleModuleInfoDto[];
  listBooks(moduleId?: string): BibleBookDto[];
  parseReference(input: string, locale?: string): ParsedReferenceDto | null;
  /**
   * Cursor-based iteration over all verses in a module. Page sizes capped at
   * 1000 (default 200). Cursors encode the last-seen verse ID.
   */
  iterateVerses(
    moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): VerseIterationResult;

  /**
   * Return interlinear token data for a verse, or `null` if the module has no
   * token data (e.g. non-interlinear translations).
   */
  getVerseTokens(verseId: number, moduleId?: string): VerseTokenDto[] | null;

  /**
   * Navigate the primary Bible pane to a specific verse. The bridge sends an
   * IPC message to the renderer which calls `navigateToVerseInPrimary`. The
   * existing `broadcast-verse-change` flow fires `onDidChangeActiveVerse`
   * after the renderer processes the navigation.
   */
  navigateToVerse(verseId: number): Promise<void>;

  /**
   * Subscribe to "active verse changed" events. The bridge invokes `handler`
   * every time the user navigates anywhere in the app. Returns a disposer.
   */
  subscribeActiveVerse(
    handler: (payload: { verseId: number; module: string } | null) => void,
  ): () => void;

  /**
   * Subscribe to "verse word selected" events. Fires when the user clicks or
   * selects a word in the Bible pane. Returns a disposer.
   */
  subscribeWordSelection(
    handler: (payload: VerseWordSelection) => void,
  ): () => void;
}

// --- Commentary / Dictionary / Book bridges --------------------------------

export interface IExtensionCommentaryBridge {
  listModules(): CommentaryModuleInfoDto[];
  getEntry(moduleId: string, verseId: number): CommentaryEntryDto | null;
  getEntriesForRange(
    moduleId: string,
    startVerseId: number,
    endVerseId: number,
  ): CommentaryEntryDto[];
  /** Cursor-based iteration over commentary entries. Max page size 500, default 50. */
  iterateEntries(
    moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): CommentaryIterationResult;
}

export interface IExtensionDictionaryBridge {
  listModules(): DictionaryModuleInfoDto[];
  lookup(moduleId: string, key: string): DictionaryEntryDto | null;
  search(moduleId: string, query: string, limit?: number): DictionaryEntryDto[];
  /** Cursor-based iteration over dictionary entries. Max page size 500, default 100. */
  iterateEntries(
    moduleId: string,
    keyPrefix: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): DictionaryIterationResult;
}

export interface IExtensionBookBridge {
  listModules(): BookModuleInfoDto[];
  getSection(moduleId: string, sectionId: string): BookSectionDto | null;
  listSections(moduleId: string, parentId?: string): BookSectionSummaryDto[];
  /** Cursor-based iteration over book sections. Max page size 500, default 100. */
  iterateSections(
    moduleId: string,
    rootSectionId: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): BookIterationResult;
}

// --- UI bridge -------------------------------------------------------------

/**
 * Bridge to the renderer's notification + dialog + panel-type registry. The
 * production wiring sends `ipcMain.handle` round-trips into the focused
 * window; the in-memory bridge resolves immediately so unit tests can drive
 * the api-impl without an Electron window.
 */
export interface IExtensionUiBridge {
  showNotification(
    extensionId: string,
    message: LocalizedString,
    opts?: NotificationOpts,
  ): Promise<void>;

  showQuickPick<T>(
    extensionId: string,
    items: QuickPickItemDescriptor<T>[],
    opts?: QuickPickOpts,
  ): Promise<T | undefined>;

  showInputBox(extensionId: string, opts: InputBoxOpts): Promise<string | undefined>;

  showConfirm(extensionId: string, opts: ConfirmOpts): Promise<boolean>;

  /**
   * Register an extension-contributed panel type. The host-side registry
   * stores `${extensionId}.${def.id}` and the renderer reads it when a
   * panel of `ext:<extensionId>.<id>` content type opens.
   *
   * Returns a disposer that removes the registration. Idempotent.
   */
  registerPanelType(extensionId: string, def: ExtensionPanelTypeDef): () => void;

  /**
   * Drop every panel-type owned by `extensionId`. Used by the api-impl's
   * own `dispose()` so the host always cleans up even if the extension
   * crashed before disposing handles itself.
   */
  disposePanelTypesByOwner(extensionId: string): number;

  /** Look up a registered panel type. Used by the renderer when rendering. */
  getPanelType(extensionId: string, panelTypeId: string): ExtensionPanelTypeDef | undefined;

  /** Snapshot of every registered extension panel type - used by tests + diagnostics. */
  listPanelTypes(): { extensionId: string; def: ExtensionPanelTypeDef }[];

  // --- T2 UI methods -------------------------------------------------------

  /** Register a verse decorator. Returns a disposer. */
  registerVerseDecorator(
    extensionId: string,
    descriptor: VerseDecoratorDescriptor,
  ): () => void;

  /** Replace all decorations in a group atomically. */
  updateVerseDecorations(
    extensionId: string,
    groupId: string,
    decorations: DecorationDto[],
  ): Promise<void>;

  /** Register a verse hover provider. Returns a disposer. */
  registerVerseHover(
    extensionId: string,
    descriptor: VerseHoverProviderDescriptor,
  ): () => void;

  /** Register a context menu item on a target. Returns a disposer. */
  registerContextMenu(
    extensionId: string,
    target: ContextMenuTarget,
    item: ContextMenuItemDescriptor,
  ): () => void;

  /** Register an extension-contributed display mode. Returns a disposer. */
  registerDisplayMode(
    extensionId: string,
    descriptor: DisplayModeDescriptor,
  ): () => void;

  /** Register a status bar item. Returns a disposer. */
  registerStatusBarItem(
    extensionId: string,
    item: StatusBarItemDescriptor,
  ): () => void;

  /** Open the system file picker and return file contents. */
  pickFile(extensionId: string, opts?: PickFileOpts): Promise<PickedFileDto | undefined>;

  /** Open the system save picker and write contents. */
  saveFile(
    extensionId: string,
    content: string | ArrayBuffer | Uint8Array,
    opts?: SaveFileOpts,
  ): Promise<boolean>;

  /** Drop every T2 UI registration owned by `extensionId`. */
  disposeUiContributionsByOwner(extensionId: string): number;
}

// --- Workspace bridge ------------------------------------------------------

/**
 * Bridge to the renderer's `useLayoutStore`. The production wiring forwards
 * each call into the focused window via `ipcMain.handle`; the in-memory
 * bridge keeps a local panel list for tests.
 */
export interface IExtensionWorkspaceBridge {
  getActivePanel(): PanelInfoDto | null;
  getOpenPanels(): PanelInfoDto[];
  openPanel(contentType: string, opts?: OpenPanelOpts): string;
  closePanel(panelId: string): void;
  subscribeActivePanel(handler: (panel: PanelInfoDto | null) => void): () => void;
  subscribeOpenPanel(handler: (panel: PanelInfoDto) => void): () => void;
  subscribeClosePanel(
    handler: (info: { panelId: string; contentType: string }) => void,
  ): () => void;
}

// --- L10n bridge -----------------------------------------------------------

/**
 * Bridge to the renderer's `I18nService`. The production wiring loads each
 * extension's `l10n/<bcp47>.json` catalog under an `ext.<id>.` namespace; the
 * in-memory bridge ships with a tiny static catalog so tests can assert
 * lookups round-trip.
 */
export interface IExtensionL10nBridge {
  /**
   * Resolve a key in the extension's catalog. The host prepends
   * `ext.<extensionId>.` automatically - extensions reference catalog keys
   * relative to their own catalog (e.g. `'greeting'`, not
   * `'ext.greekTools.greeting'`).
   */
  t(extensionId: string, key: string, params?: Record<string, unknown>): string;
  currentLocale(): string;
  subscribeLocaleChange(handler: (locale: string) => void): () => void;
  /**
   * Optional host hook called from `ExtensionHost.activate()` once the install
   * path is known. Production bridges read `<installPath>/l10n/<bcp47>.json`
   * and prime their cache. The in-memory bridge omits this - its catalog is
   * pre-seeded by tests.
   */
  loadExtensionCatalog?(extensionId: string, installPath: string): void;
  /** Optional drop hook called from `ExtensionHost.deactivate()`. */
  dropExtensionCatalog?(extensionId: string): void;
}

// --- Notes bridge ---------------------------------------------------------

/**
 * Bridge to the user database's notes tables. The production wiring uses
 * `UserNoteRepository` via `sharedUserDb`; the in-memory bridge keeps a
 * simple array for tests.
 */
export interface IExtensionNotesBridge {
  list(query?: NoteQueryDto): UserNoteDto[];
  get(id: string): UserNoteDto | null;
  create(note: NewNoteDto): UserNoteDto;
  update(id: string, patch: Partial<UserNoteDto>): UserNoteDto;
  delete(id: string): void;
  subscribeChange(
    handler: (payload: { id: string; type: 'created' | 'updated' | 'deleted' }) => void,
  ): () => void;
}

// --- Highlights bridge ----------------------------------------------------

/**
 * Bridge to the user database's highlights tables. The production wiring uses
 * `UserHighlightRepository` via `sharedUserDb`; the in-memory bridge keeps a
 * simple array for tests.
 */
export interface IExtensionHighlightsBridge {
  list(verseId?: number): UserHighlightDto[];
  create(highlight: NewHighlightDto): UserHighlightDto;
  update(id: string, patch: Partial<NewHighlightDto>): UserHighlightDto;
  delete(id: string): void;
  /** Register a custom highlight style. Returns the registered style's ID. */
  registerStyle(extensionId: string, style: HighlightStyleDescriptor): void;
  /**
   * Remove one style contributed by an extension. Returns true if a style was
   * removed. Needed because `registerStyle` is declared to return a
   * `DisposableHandle`: without a single-style removal the only disposal
   * available was "drop everything this extension owns", which is not what
   * disposing one handle means.
   */
  unregisterStyle(extensionId: string, styleId: string): boolean;
  /** Remove all styles contributed by an extension. */
  disposeStylesByOwner(extensionId: string): number;
  /** List all registered highlight styles (built-in + extension-contributed). */
  listStyles(): HighlightStyleDescriptor[];
  subscribeChange(handler: (payload: { verseId: number }) => void): () => void;
}

// --- Bookmarks bridge ----------------------------------------------------

/**
 * Bridge to the user database's bookmarks / collections tables. The production
 * wiring uses the bookmarks repository via `sharedUserDb`; the in-memory
 * bridge keeps a simple array for tests.
 */
export interface IExtensionBookmarksBridge {
  list(collectionId?: string): BookmarkDto[];
  add(verseId: number, collectionId?: string): BookmarkDto;
  remove(id: string): void;
  listCollections(): CollectionDto[];
  createCollection(name: LocalizedString): CollectionDto;
}

// --- Folder bridge -------------------------------------------------------

/**
 * Bridge for the managed folder API. The production wiring shows an Electron
 * folder picker dialog and persists the grant in the extension registry; the
 * in-memory bridge resolves immediately for tests.
 */
export interface IExtensionFolderBridge {
  /**
   * Show a folder picker dialog and return the selected path, or `null` if
   * the user cancelled.
   */
  requestFolder(extensionId: string, purpose: string): Promise<string | null>;

  /**
   * Get the persisted folder grant for an extension, or `null` if none.
   */
  getFolderGrant(extensionId: string): Promise<{ path: string; grantedAt: string } | null>;

  /**
   * Persist a folder grant (path + timestamp) for an extension.
   */
  persistFolderGrant(extensionId: string, path: string): Promise<void>;

  /**
   * Revoke the persisted folder grant for an extension.
   */
  revokeFolderGrant(extensionId: string): Promise<void>;
}
