/**
 * In-process bridge implementations for the api-impls.
 *
 * Same role as `InMemoryRegistryBridges.ts` plays for the command / context
 * bridges: each class is a tiny dependency-free implementation of one of the bridge interfaces in
 * `IExtensionDataBridges.ts` so unit tests can drive an api-impl end-to-end
 * without standing up a Bible repository, dockview, or i18n service.
 *
 * The production wiring lives next to `main.ts` and forwards each call into
 * the focused renderer window via `ipcMain.handle`. Both bridges share the
 * contract here, so swapping between them is a one-line change in
 * `ExtensionHost`.
 */

import type { Extensions } from '@bible/core';

import type {
  IExtensionBibleBridge,
  IExtensionBookBridge,
  IExtensionBookmarksBridge,
  IExtensionCommentaryBridge,
  IExtensionDictionaryBridge,
  IExtensionFolderBridge,
  IExtensionHighlightsBridge,
  IExtensionL10nBridge,
  IExtensionNotesBridge,
  IExtensionUiBridge,
  IExtensionWorkspaceBridge,
} from './IExtensionDataBridges';

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

export class InMemoryBibleBridge implements IExtensionBibleBridge {
  readonly verses = new Map<number, BibleVerseDto>();
  /** Per-verse token data. Set entries here to simulate interlinear modules. */
  readonly tokens = new Map<number, VerseTokenDto[]>();
  readonly modules: BibleModuleInfoDto[] = [];
  readonly books: BibleBookDto[] = [];
  parser: ((input: string, locale?: string) => ParsedReferenceDto | null) | undefined;
  private readonly activeVerseHandlers = new Set<
    (payload: { verseId: number; module: string } | null) => void
  >();
  private readonly wordSelectionHandlers = new Set<
    (payload: VerseWordSelection) => void
  >();

  getVerse(verseId: number, _moduleId?: string): BibleVerseDto | null {
    return this.verses.get(verseId) ?? null;
  }

  getRange(start: number, end: number, _moduleId?: string): BibleVerseDto[] {
    const out: BibleVerseDto[] = [];
    for (let id = start; id <= end; id++) {
      const v = this.verses.get(id);
      if (v) out.push(v);
    }
    return out;
  }

  iterateVerses(
    _moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): VerseIterationResult {
    // Collect all stored verses in ID order.
    const all = Array.from(this.verses.values())
      .filter((v) => {
        if (startVerseId !== undefined && v.verseId < startVerseId) return false;
        if (endVerseId !== undefined && v.verseId > endVerseId) return false;
        return true;
      })
      .sort((a, b) => a.verseId - b.verseId);

    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch { /* start from beginning */ }
    }

    const page = all.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < all.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;
    return {
      verses: page,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }

  getVerseTokens(verseId: number, _moduleId?: string): VerseTokenDto[] | null {
    return this.tokens.get(verseId) ?? null;
  }

  listModules(): BibleModuleInfoDto[] {
    return [...this.modules];
  }

  listBooks(_moduleId?: string): BibleBookDto[] {
    return [...this.books];
  }

  parseReference(input: string, locale?: string): ParsedReferenceDto | null {
    return this.parser ? this.parser(input, locale) : null;
  }

  /** Last verseId passed to navigateToVerse. Test assertion helper. */
  lastNavigatedVerse: number | undefined;

  async navigateToVerse(verseId: number): Promise<void> {
    this.lastNavigatedVerse = verseId;
    // Simulate the active-verse event the real renderer would fire.
    this.fireActiveVerse({ verseId, module: 'test' });
  }

  subscribeActiveVerse(
    handler: (payload: { verseId: number; module: string } | null) => void,
  ): () => void {
    this.activeVerseHandlers.add(handler);
    return () => this.activeVerseHandlers.delete(handler);
  }

  subscribeWordSelection(
    handler: (payload: VerseWordSelection) => void,
  ): () => void {
    this.wordSelectionHandlers.add(handler);
    return () => this.wordSelectionHandlers.delete(handler);
  }

  /** Test helper: fire the active-verse change event. */
  fireActiveVerse(payload: { verseId: number; module: string } | null): void {
    for (const h of this.activeVerseHandlers) h(payload);
  }

  /** Test helper: fire the word-selection event. */
  fireWordSelection(payload: VerseWordSelection): void {
    for (const h of this.wordSelectionHandlers) h(payload);
  }
}

// --- Commentary / Dictionary / Book bridges --------------------------------

export class InMemoryCommentaryBridge implements IExtensionCommentaryBridge {
  readonly modules: CommentaryModuleInfoDto[] = [];
  readonly entries = new Map<string, Map<number, CommentaryEntryDto>>();

  listModules(): CommentaryModuleInfoDto[] {
    return [...this.modules];
  }

  getEntry(moduleId: string, verseId: number): CommentaryEntryDto | null {
    return this.entries.get(moduleId)?.get(verseId) ?? null;
  }

  getEntriesForRange(
    moduleId: string,
    startVerseId: number,
    endVerseId: number,
  ): CommentaryEntryDto[] {
    const map = this.entries.get(moduleId);
    if (!map) return [];
    const out: CommentaryEntryDto[] = [];
    for (const e of map.values()) {
      if (e.endVerseId >= startVerseId && e.startVerseId <= endVerseId) out.push(e);
    }
    return out;
  }

  iterateEntries(
    moduleId: string,
    startVerseId: number | undefined,
    endVerseId: number | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): CommentaryIterationResult {
    const map = this.entries.get(moduleId);
    if (!map) return { entries: [], hasMore: false };

    let all = Array.from(map.values()).sort((a, b) => a.startVerseId - b.startVerseId);
    if (startVerseId !== undefined) all = all.filter((e) => e.endVerseId >= startVerseId);
    if (endVerseId !== undefined) all = all.filter((e) => e.startVerseId <= endVerseId);

    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch { /* start from beginning */ }
    }

    const page = all.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < all.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;
    return {
      entries: page,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

export class InMemoryDictionaryBridge implements IExtensionDictionaryBridge {
  readonly modules: DictionaryModuleInfoDto[] = [];
  readonly entries = new Map<string, Map<string, DictionaryEntryDto>>();

  listModules(): DictionaryModuleInfoDto[] {
    return [...this.modules];
  }

  lookup(moduleId: string, key: string): DictionaryEntryDto | null {
    return this.entries.get(moduleId)?.get(key) ?? null;
  }

  search(moduleId: string, query: string, limit?: number): DictionaryEntryDto[] {
    const map = this.entries.get(moduleId);
    if (!map) return [];
    const q = query.toLowerCase();
    const matches: DictionaryEntryDto[] = [];
    for (const e of map.values()) {
      if (e.headword.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)) {
        matches.push(e);
        if (limit !== undefined && matches.length >= limit) break;
      }
    }
    return matches;
  }

  iterateEntries(
    moduleId: string,
    keyPrefix: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): DictionaryIterationResult {
    const map = this.entries.get(moduleId);
    if (!map) return { entries: [], hasMore: false };

    let all = Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
    if (keyPrefix) {
      const prefix = keyPrefix.toLowerCase();
      all = all.filter((e) => e.key.toLowerCase().startsWith(prefix));
    }

    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch { /* start from beginning */ }
    }

    const page = all.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < all.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;
    return {
      entries: page,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

export class InMemoryBookBridge implements IExtensionBookBridge {
  readonly modules: BookModuleInfoDto[] = [];
  readonly sections = new Map<string, Map<string, BookSectionDto>>();

  listModules(): BookModuleInfoDto[] {
    return [...this.modules];
  }

  getSection(moduleId: string, sectionId: string): BookSectionDto | null {
    return this.sections.get(moduleId)?.get(sectionId) ?? null;
  }

  listSections(moduleId: string, parentId?: string): BookSectionSummaryDto[] {
    const map = this.sections.get(moduleId);
    if (!map) return [];
    const out: BookSectionSummaryDto[] = [];
    for (const s of map.values()) {
      if ((parentId === undefined && !s.parentId) || s.parentId === parentId) {
        // Strip the body fields from the summary form.
        out.push({
          id: s.id,
          moduleId: s.moduleId,
          ...(s.parentId !== undefined ? { parentId: s.parentId } : {}),
          title: s.title,
          depth: s.depth,
          hasChildren: s.hasChildren,
          order: s.order,
        });
      }
    }
    return out;
  }

  iterateSections(
    moduleId: string,
    rootSectionId: string | undefined,
    pageSize: number,
    cursor: string | undefined,
  ): BookIterationResult {
    const map = this.sections.get(moduleId);
    if (!map) return { sections: [], hasMore: false };

    let all = Array.from(map.values()).sort((a, b) => a.order - b.order);
    if (rootSectionId !== undefined) {
      // Include only descendants of rootSectionId (or the root itself).
      const isDescendant = (s: BookSectionDto): boolean => {
        if (s.id === rootSectionId) return true;
        if (s.parentId === rootSectionId) return true;
        // Walk up via parentId.
        let current = s.parentId;
        while (current) {
          if (current === rootSectionId) return true;
          const parent = map.get(current);
          current = parent?.parentId;
        }
        return false;
      };
      all = all.filter(isDescendant);
    }

    let offset = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: number };
        offset = decoded.o;
      } catch { /* start from beginning */ }
    }

    const page = all.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < all.length;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ o: offset + pageSize })).toString('base64url')
      : undefined;
    return {
      sections: page,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    };
  }
}

// --- UI bridge -------------------------------------------------------------

export class InMemoryUiBridge implements IExtensionUiBridge {
  readonly notifications: { extensionId: string; message: LocalizedString; opts?: NotificationOpts }[] = [];
  readonly inputs: { extensionId: string; opts: InputBoxOpts }[] = [];
  readonly confirms: { extensionId: string; opts: ConfirmOpts }[] = [];
  readonly quickPicks: { extensionId: string; items: QuickPickItemDescriptor<unknown>[]; opts?: QuickPickOpts }[] = [];

  /** Sentinel responses tests can override before driving the api-impl. */
  inputBoxResponse: string | undefined = undefined;
  confirmResponse: boolean = false;
  quickPickResponse: unknown | undefined = undefined;

  private readonly panelTypes = new Map<string, ExtensionPanelTypeDef>();
  private readonly panelTypeOwners = new Map<string, string>();

  async showNotification(
    extensionId: string,
    message: LocalizedString,
    opts?: NotificationOpts,
  ): Promise<void> {
    this.notifications.push({ extensionId, message, ...(opts !== undefined ? { opts } : {}) });
  }

  async showQuickPick<T>(
    extensionId: string,
    items: QuickPickItemDescriptor<T>[],
    opts?: QuickPickOpts,
  ): Promise<T | undefined> {
    this.quickPicks.push({
      extensionId,
      items: items as QuickPickItemDescriptor<unknown>[],
      ...(opts !== undefined ? { opts } : {}),
    });
    return this.quickPickResponse as T | undefined;
  }

  async showInputBox(extensionId: string, opts: InputBoxOpts): Promise<string | undefined> {
    this.inputs.push({ extensionId, opts });
    return this.inputBoxResponse;
  }

  async showConfirm(extensionId: string, opts: ConfirmOpts): Promise<boolean> {
    this.confirms.push({ extensionId, opts });
    return this.confirmResponse;
  }

  registerPanelType(extensionId: string, def: ExtensionPanelTypeDef): () => void {
    const key = `${extensionId}.${def.id}`;
    this.panelTypes.set(key, def);
    this.panelTypeOwners.set(key, extensionId);
    return () => {
      this.panelTypes.delete(key);
      this.panelTypeOwners.delete(key);
    };
  }

  disposePanelTypesByOwner(extensionId: string): number {
    let removed = 0;
    for (const [key, owner] of this.panelTypeOwners) {
      if (owner === extensionId) {
        this.panelTypes.delete(key);
        this.panelTypeOwners.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getPanelType(extensionId: string, panelTypeId: string): ExtensionPanelTypeDef | undefined {
    return this.panelTypes.get(`${extensionId}.${panelTypeId}`);
  }

  listPanelTypes(): { extensionId: string; def: ExtensionPanelTypeDef }[] {
    const out: { extensionId: string; def: ExtensionPanelTypeDef }[] = [];
    for (const [key, def] of this.panelTypes) {
      const owner = this.panelTypeOwners.get(key);
      if (owner) out.push({ extensionId: owner, def });
    }
    return out;
  }

  // --- T2 UI methods -------------------------------------------------------

  readonly decorators: { extensionId: string; descriptor: VerseDecoratorDescriptor }[] = [];
  readonly decorationUpdates: { extensionId: string; groupId: string; decorations: DecorationDto[] }[] = [];
  readonly hoverProviders: { extensionId: string; descriptor: VerseHoverProviderDescriptor }[] = [];
  readonly contextMenuItems: { extensionId: string; target: ContextMenuTarget; item: ContextMenuItemDescriptor }[] = [];
  readonly displayModes: { extensionId: string; descriptor: DisplayModeDescriptor }[] = [];
  readonly statusBarItems: { extensionId: string; item: StatusBarItemDescriptor }[] = [];
  readonly filePickRequests: { extensionId: string; opts?: PickFileOpts }[] = [];
  readonly fileSaveRequests: { extensionId: string; content: string | ArrayBuffer | Uint8Array; opts?: SaveFileOpts }[] = [];

  /** Sentinel responses tests can configure for file operations. */
  pickFileResponse: PickedFileDto | undefined = undefined;
  saveFileResponse = true;

  registerVerseDecorator(extensionId: string, descriptor: VerseDecoratorDescriptor): () => void {
    const entry = { extensionId, descriptor };
    this.decorators.push(entry);
    return () => {
      const idx = this.decorators.indexOf(entry);
      if (idx >= 0) this.decorators.splice(idx, 1);
    };
  }

  async updateVerseDecorations(
    extensionId: string,
    groupId: string,
    decorations: DecorationDto[],
  ): Promise<void> {
    this.decorationUpdates.push({ extensionId, groupId, decorations });
  }

  registerVerseHover(extensionId: string, descriptor: VerseHoverProviderDescriptor): () => void {
    const entry = { extensionId, descriptor };
    this.hoverProviders.push(entry);
    return () => {
      const idx = this.hoverProviders.indexOf(entry);
      if (idx >= 0) this.hoverProviders.splice(idx, 1);
    };
  }

  registerContextMenu(
    extensionId: string,
    target: ContextMenuTarget,
    item: ContextMenuItemDescriptor,
  ): () => void {
    const entry = { extensionId, target, item };
    this.contextMenuItems.push(entry);
    return () => {
      const idx = this.contextMenuItems.indexOf(entry);
      if (idx >= 0) this.contextMenuItems.splice(idx, 1);
    };
  }

  registerDisplayMode(extensionId: string, descriptor: DisplayModeDescriptor): () => void {
    const entry = { extensionId, descriptor };
    this.displayModes.push(entry);
    return () => {
      const idx = this.displayModes.indexOf(entry);
      if (idx >= 0) this.displayModes.splice(idx, 1);
    };
  }

  registerStatusBarItem(extensionId: string, item: StatusBarItemDescriptor): () => void {
    const entry = { extensionId, item };
    this.statusBarItems.push(entry);
    return () => {
      const idx = this.statusBarItems.indexOf(entry);
      if (idx >= 0) this.statusBarItems.splice(idx, 1);
    };
  }

  async pickFile(extensionId: string, opts?: PickFileOpts): Promise<PickedFileDto | undefined> {
    this.filePickRequests.push({ extensionId, ...(opts !== undefined ? { opts } : {}) });
    return this.pickFileResponse;
  }

  async saveFile(
    extensionId: string,
    content: string | ArrayBuffer | Uint8Array,
    opts?: SaveFileOpts,
  ): Promise<boolean> {
    this.fileSaveRequests.push({ extensionId, content, ...(opts !== undefined ? { opts } : {}) });
    return this.saveFileResponse;
  }

  disposeUiContributionsByOwner(extensionId: string): number {
    let removed = 0;
    const arrays = [
      this.decorators,
      this.hoverProviders,
      this.contextMenuItems,
      this.displayModes,
      this.statusBarItems,
    ] as { extensionId: string }[][];
    for (const arr of arrays) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].extensionId === extensionId) {
          arr.splice(i, 1);
          removed++;
        }
      }
    }
    return removed;
  }
}

// --- Workspace bridge ------------------------------------------------------

export class InMemoryWorkspaceBridge implements IExtensionWorkspaceBridge {
  readonly panels = new Map<string, PanelInfoDto>();
  activePanelId: string | null = null;
  private nextId = 1;
  private readonly activeHandlers = new Set<(p: PanelInfoDto | null) => void>();
  private readonly openHandlers = new Set<(p: PanelInfoDto) => void>();
  private readonly closeHandlers = new Set<(info: { panelId: string; contentType: string }) => void>();

  getActivePanel(): PanelInfoDto | null {
    if (!this.activePanelId) return null;
    return this.panels.get(this.activePanelId) ?? null;
  }

  getOpenPanels(): PanelInfoDto[] {
    return Array.from(this.panels.values());
  }

  openPanel(contentType: string, opts?: OpenPanelOpts): string {
    const panelId = `panel-${this.nextId++}`;
    const panel: PanelInfoDto = {
      panelId,
      contentType,
      ...(opts?.state !== undefined ? { state: opts.state } : {}),
    };
    this.panels.set(panelId, panel);
    if (opts?.focus !== false) this.activePanelId = panelId;
    for (const h of this.openHandlers) h(panel);
    if (opts?.focus !== false) {
      for (const h of this.activeHandlers) h(panel);
    }
    return panelId;
  }

  closePanel(panelId: string): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;
    this.panels.delete(panelId);
    if (this.activePanelId === panelId) this.activePanelId = null;
    for (const h of this.closeHandlers) {
      h({ panelId, contentType: panel.contentType });
    }
  }

  subscribeActivePanel(handler: (p: PanelInfoDto | null) => void): () => void {
    this.activeHandlers.add(handler);
    return () => this.activeHandlers.delete(handler);
  }

  subscribeOpenPanel(handler: (p: PanelInfoDto) => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  subscribeClosePanel(
    handler: (info: { panelId: string; contentType: string }) => void,
  ): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
}

// --- L10n bridge -----------------------------------------------------------

export class InMemoryL10nBridge implements IExtensionL10nBridge {
  /** Maps `${extensionId}.${key}` -> translated string. */
  readonly catalog = new Map<string, string>();
  locale = 'en';
  private readonly localeHandlers = new Set<(locale: string) => void>();

  t(extensionId: string, key: string, params?: Record<string, unknown>): string {
    const fullKey = `${extensionId}.${key}`;
    const template = this.catalog.get(fullKey) ?? `[${fullKey}]`;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => {
      const v = params[name];
      return v !== undefined ? String(v) : `{${name}}`;
    });
  }

  currentLocale(): string {
    return this.locale;
  }

  subscribeLocaleChange(handler: (locale: string) => void): () => void {
    this.localeHandlers.add(handler);
    return () => this.localeHandlers.delete(handler);
  }

  /** Test helper: fire a locale change. */
  setLocale(locale: string): void {
    this.locale = locale;
    for (const h of this.localeHandlers) h(locale);
  }
}

// --- Notes bridge ---------------------------------------------------------

export class InMemoryNotesBridge implements IExtensionNotesBridge {
  readonly notes: UserNoteDto[] = [];
  private nextId = 1;
  private readonly changeHandlers = new Set<
    (payload: { id: string; type: 'created' | 'updated' | 'deleted' }) => void
  >();

  list(query?: NoteQueryDto): UserNoteDto[] {
    let results = [...this.notes];
    if (query) {
      if (query.verseId !== undefined) {
        results = results.filter((n) => n.linkedVerses?.includes(query.verseId!));
      }
      if (query.tag !== undefined) {
        results = results.filter((n) => n.tags?.includes(query.tag!));
      }
      if (query.type !== undefined) {
        results = results.filter((n) => n.type === query.type);
      }
      if (query.parentId !== undefined) {
        results = results.filter((n) => n.parentId === query.parentId);
      }
      if (query.search !== undefined) {
        const q = query.search.toLowerCase();
        results = results.filter(
          (n) =>
            (n.title?.toLowerCase().includes(q)) ||
            n.content.toLowerCase().includes(q),
        );
      }
      if (query.offset !== undefined) results = results.slice(query.offset);
      if (query.limit !== undefined) results = results.slice(0, query.limit);
    }
    return results;
  }

  get(id: string): UserNoteDto | null {
    return this.notes.find((n) => n.id === id) ?? null;
  }

  create(note: NewNoteDto): UserNoteDto {
    const now = Date.now();
    const dto: UserNoteDto = {
      id: `note-${this.nextId++}`,
      content: note.content,
      createdAt: now,
      updatedAt: now,
      ...(note.parentId !== undefined ? { parentId: note.parentId } : {}),
      ...(note.type !== undefined ? { type: note.type } : {}),
      ...(note.title !== undefined ? { title: note.title } : {}),
      ...(note.linkedVerses !== undefined ? { linkedVerses: note.linkedVerses } : {}),
      ...(note.tags !== undefined ? { tags: note.tags } : {}),
      ...(note.metadata !== undefined ? { metadata: note.metadata } : {}),
    };
    this.notes.push(dto);
    this.fireChange({ id: dto.id, type: 'created' });
    return dto;
  }

  update(id: string, patch: Partial<UserNoteDto>): UserNoteDto {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx < 0) throw new Error(`Note not found: ${id}`);
    const updated = { ...this.notes[idx], ...patch, updatedAt: Date.now() };
    this.notes[idx] = updated;
    this.fireChange({ id, type: 'updated' });
    return updated;
  }

  delete(id: string): void {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx >= 0) {
      this.notes.splice(idx, 1);
      this.fireChange({ id, type: 'deleted' });
    }
  }

  subscribeChange(
    handler: (payload: { id: string; type: 'created' | 'updated' | 'deleted' }) => void,
  ): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }

  /** Test helper: fire a change event. */
  private fireChange(payload: { id: string; type: 'created' | 'updated' | 'deleted' }): void {
    for (const h of this.changeHandlers) h(payload);
  }
}

// --- Highlights bridge ----------------------------------------------------

export class InMemoryHighlightsBridge implements IExtensionHighlightsBridge {
  readonly highlights: UserHighlightDto[] = [];
  readonly styles: { extensionId: string; style: HighlightStyleDescriptor }[] = [];
  private nextId = 1;
  private readonly changeHandlers = new Set<(payload: { verseId: number }) => void>();

  list(verseId?: number): UserHighlightDto[] {
    if (verseId !== undefined) {
      return this.highlights.filter((h) => {
        const ranges = Array.isArray(h.range) ? h.range : [h.range];
        return ranges.some((r) => r.verseId === verseId);
      });
    }
    return [...this.highlights];
  }

  create(highlight: NewHighlightDto): UserHighlightDto {
    const now = Date.now();
    const dto: UserHighlightDto = {
      id: `hl-${this.nextId++}`,
      range: highlight.range,
      styleId: highlight.styleId,
      createdAt: now,
      updatedAt: now,
      ...(highlight.data !== undefined ? { data: highlight.data } : {}),
      ...(highlight.comment !== undefined ? { comment: highlight.comment } : {}),
    };
    this.highlights.push(dto);
    const ranges = Array.isArray(dto.range) ? dto.range : [dto.range];
    for (const r of ranges) this.fireChange({ verseId: r.verseId });
    return dto;
  }

  update(id: string, patch: Partial<NewHighlightDto>): UserHighlightDto {
    const idx = this.highlights.findIndex((h) => h.id === id);
    if (idx < 0) throw new Error(`Highlight not found: ${id}`);
    const updated = { ...this.highlights[idx], ...patch, updatedAt: Date.now() };
    this.highlights[idx] = updated;
    const ranges = Array.isArray(updated.range) ? updated.range : [updated.range];
    for (const r of ranges) this.fireChange({ verseId: r.verseId });
    return updated;
  }

  delete(id: string): void {
    const idx = this.highlights.findIndex((h) => h.id === id);
    if (idx >= 0) {
      const removed = this.highlights.splice(idx, 1)[0];
      const ranges = Array.isArray(removed.range) ? removed.range : [removed.range];
      for (const r of ranges) this.fireChange({ verseId: r.verseId });
    }
  }

  registerStyle(extensionId: string, style: HighlightStyleDescriptor): void {
    this.styles.push({ extensionId, style });
  }

  unregisterStyle(extensionId: string, styleId: string): boolean {
    const idx = this.styles.findIndex(
      (s) => s.extensionId === extensionId && s.style.id === styleId,
    );
    if (idx < 0) return false;
    this.styles.splice(idx, 1);
    return true;
  }

  disposeStylesByOwner(extensionId: string): number {
    let removed = 0;
    for (let i = this.styles.length - 1; i >= 0; i--) {
      if (this.styles[i].extensionId === extensionId) {
        this.styles.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  listStyles(): HighlightStyleDescriptor[] {
    return this.styles.map((s) => s.style);
  }

  subscribeChange(handler: (payload: { verseId: number }) => void): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }

  /** Test helper: fire a change event. */
  private fireChange(payload: { verseId: number }): void {
    for (const h of this.changeHandlers) h(payload);
  }
}

// --- Bookmarks bridge ----------------------------------------------------

export class InMemoryBookmarksBridge implements IExtensionBookmarksBridge {
  readonly bookmarks: BookmarkDto[] = [];
  readonly collections: CollectionDto[] = [];
  private nextBookmarkId = 1;
  private nextCollectionId = 1;

  list(collectionId?: string): BookmarkDto[] {
    if (collectionId !== undefined) {
      return this.bookmarks.filter((b) => b.collectionId === collectionId);
    }
    return [...this.bookmarks];
  }

  add(verseId: number, collectionId?: string): BookmarkDto {
    const dto: BookmarkDto = {
      id: `bm-${this.nextBookmarkId++}`,
      verseId,
      createdAt: Date.now(),
      ...(collectionId !== undefined ? { collectionId } : {}),
    };
    this.bookmarks.push(dto);
    return dto;
  }

  remove(id: string): void {
    const idx = this.bookmarks.findIndex((b) => b.id === id);
    if (idx >= 0) this.bookmarks.splice(idx, 1);
  }

  listCollections(): CollectionDto[] {
    return this.collections.map((c) => ({
      ...c,
      count: this.bookmarks.filter((b) => b.collectionId === c.id).length,
    }));
  }

  createCollection(name: LocalizedString): CollectionDto {
    const dto: CollectionDto = {
      id: `col-${this.nextCollectionId++}`,
      name,
      count: 0,
      createdAt: Date.now(),
    };
    this.collections.push(dto);
    return dto;
  }
}

// --- Folder bridge -------------------------------------------------------

export class InMemoryFolderBridge implements IExtensionFolderBridge {
  /**
   * Sentinel folder path tests can set before calling `requestFolder`.
   * If `null`, the bridge simulates the user cancelling the dialog.
   */
  requestFolderResponse: string | null = '/tmp/test-managed-folder';

  /** Per-extension folder grants. */
  private readonly grants = new Map<string, { path: string; grantedAt: string }>();

  /** Recorded calls for test assertions. */
  readonly requestFolderCalls: { extensionId: string; purpose: string }[] = [];

  async requestFolder(extensionId: string, purpose: string): Promise<string | null> {
    this.requestFolderCalls.push({ extensionId, purpose });
    return this.requestFolderResponse;
  }

  async getFolderGrant(extensionId: string): Promise<{ path: string; grantedAt: string } | null> {
    return this.grants.get(extensionId) ?? null;
  }

  async persistFolderGrant(extensionId: string, path: string): Promise<void> {
    this.grants.set(extensionId, { path, grantedAt: new Date().toISOString() });
  }

  async revokeFolderGrant(extensionId: string): Promise<void> {
    this.grants.delete(extensionId);
  }
}
