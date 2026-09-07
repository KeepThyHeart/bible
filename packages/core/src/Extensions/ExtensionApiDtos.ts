/**
 * Plain JSON DTOs and shared shapes for the extension API contract.
 *
 * Spec A section "DTO Schemas" + the data shapes scattered through section "Public extension
 * API surface". Everything in this file MUST be plain JSON-serializable -
 * no class instances, no methods, no functions, no Date objects, no Maps,
 * no circular references. The host marshals between its internal types
 * (`packages/core/src/Data/Models/...`) and these DTOs at the API boundary.
 *
 * These shapes are **load-bearing** - they appear in many APIs and storage
 * formats. Per section "Implementation tiers" they are part of T1 (the foundation
 * locked in 1.0.0) even when the methods that use them are T2.
 *
 * The fully-namespaced API interfaces live in `ExtensionApiTypes.ts`, which
 * imports from this file.
 */

// --- Shared host primitives mirrored into the extension contract -----------

/**
 * A user-facing string that may either be a literal (already-localized) or a
 * reference into the extension's i18n catalog. Structurally identical to the
 * desktop package's `LocalizedString` so values flow freely between the host
 * and the extension boundary.
 */
export type LocalizedString = string | { key: string; params?: Record<string, unknown> };

/**
 * Single keybinding attached to a command. `key` uses cross-platform tokens
 * (e.g. `Ctrl+J`, `Cmd+Shift+P`). When `mac` is provided it overrides `key`
 * on macOS. `when` is an optional `when`-expression that further constrains
 * the binding beyond the command's own `when` clause.
 *
 * Structurally identical to Spec B's `KeybindingDescriptor`.
 */
export interface KeybindingDescriptor {
  key: string;
  mac?: string;
  when?: string;
}

/**
 * Value types accepted by the `when`-context bag. Structurally identical to
 * Spec B's `WhenContextValue`.
 */
export type WhenContextValue = string | number | boolean | null;

/**
 * Handle returned by every `register*` API. Calling `dispose()` removes the
 * registration. The host also auto-disposes everything an extension owns when
 * it deactivates, so extensions only need to track disposables when they want
 * lifecycle finer-grained than activation.
 */
export interface DisposableHandle {
  dispose(): Promise<void>;
}

/**
 * Worker-side subscription handle exposed by every `IXxxApi.onDidXxx` event.
 * Mirrors VSCode's `Event<T>` shape - `subscribe` returns a `DisposableHandle`
 * the worker can dispose to stop receiving events.
 */
export interface IEventApi<T> {
  subscribe(handler: (payload: T) => void | Promise<void>): Promise<DisposableHandle>;
}

// --- Verse ranges & token data ---------------------------------------------

/**
 * Targets a verse, a multi-verse range, or a sub-verse word range. The host
 * supports word-range targeting only on modules that ship token data; for
 * other modules, character offsets are used instead. Extensions can use either.
 */
export interface VerseRange {
  verseId: number;
  /**
   * Optional UTF-16 character offset into the verse plaintext (after stripping
   * formatting). Inclusive start, exclusive end. Omit both for whole-verse
   * targeting.
   */
  startOffset?: number;
  endOffset?: number;
  /**
   * Optional token indexes when the module has tokenized data. Preferred over
   * character offsets for languages with complex morphology. The host resolves
   * token indexes to render coordinates.
   */
  startTokenIndex?: number;
  endTokenIndex?: number;
  /** For multi-verse ranges, the inclusive end verse. */
  endVerseId?: number;
}

export interface VerseTokenDto {
  /** 0-based token index in the verse. */
  index: number;
  /** Surface form. */
  text: string;
  lemma?: string;
  /** e.g. 'G2424'. */
  strongsNumber?: string;
  /** Module-specific morph code. */
  morphology?: string;
  /** Character offset of this token in the verse plaintext. */
  startOffset: number;
  endOffset: number;
}

export interface VerseWordSelection {
  verseId: number;
  range: VerseRange;
  word: string;
  token?: VerseTokenDto;
}

// --- Decorations -----------------------------------------------------------

export type ColorValue =
  /** '#RRGGBB' or '#RRGGBBAA'. */
  | { hex: string }
  /** Resolved against the active theme. */
  | { themeKey: string };

export interface DecorationStyle {
  underline?: {
    color?: ColorValue;
    style?: 'solid' | 'dashed' | 'dotted' | 'double' | 'wavy';
    thickness?: 'thin' | 'medium' | 'thick';
    /** Pixels below baseline. Useful for stacking multiple underlines. */
    offset?: number;
  };
  background?: ColorValue;
  foreground?: ColorValue;
  border?: {
    color: ColorValue;
    width: number;
    style: 'solid' | 'dashed' | 'dotted';
    radius?: number;
  };
  fontWeight?: 'normal' | 'bold' | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'line-through' | 'overline';
  /** Icon ID from the host's icon set or from `contributes.icons`. */
  beforeIcon?: string;
  afterIcon?: string;
  /**
   * CSS class name from a stylesheet contributed via `contributes.styles`.
   * The host scopes the stylesheet to the rendered verse area only - the
   * extension's CSS cannot leak into the rest of the app.
   */
  cssClass?: string;
  /** 0..1. */
  opacity?: number;
}

export interface DecorationDto {
  /** A single range or several ranges to apply the same style. */
  range: VerseRange | VerseRange[];
  style: DecorationStyle;
  /** Optional hover content shown when the user mouses over the decorated text. */
  hoverContent?: HoverContentDto;
  /**
   * Command to execute when the user clicks the decoration. The command
   * receives `{ range, data }` as args.
   */
  onClickCommand?: string;
  /** Opaque data passed through to the click handler. */
  data?: unknown;
  /** Render order. See "order hint" section of the spec. */
  order?: number;
  /**
   * Optional ID for grouping related decorations. Pass the same groupId to
   * `ui.updateVerseDecorations` to replace the whole group atomically.
   */
  groupId?: string;
}

export interface VerseDecoratorDescriptor {
  id: string;
  /** Reverse-RPC endpoint: (verseId[]) -> DecorationDto[]. */
  decorateEndpoint: string;
  /** If true, the host calls `decorateEndpoint` for visible verses only. Default true. */
  visibleVersesOnly?: boolean;
  /** When the decorator should rebuild. */
  invalidateOn?: ('verse.activeChanged' | 'theme.changed' | 'settings.changed' | 'manual')[];
}

// --- Hover content ---------------------------------------------------------

export type HoverContentDto =
  | { kind: 'text'; text: string }
  | {
      kind: 'markdown';
      markdown: string;
      /** Allow inline images. Sources must be in the extension's webview CSP allowlist. */
      allowImages?: boolean;
    }
  | {
      kind: 'iframe';
      /** Path under ext-ui://<extId>/. The hover popup mounts this in a small sandboxed iframe. */
      uiEntry: string;
      width?: number;
      height?: number;
    };

export interface VerseHoverProviderDescriptor {
  id: string;
  /** Reverse-RPC endpoint: (verseId, modifiers) -> HoverContentDto[] */
  hoverEndpoint: string;
  /** Modifier keys that must be held for this hover to fire. Default: none (any hover). */
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  /** Order among multiple hover providers. */
  order?: number;
}

// --- Context menus ---------------------------------------------------------

export type ContextMenuTarget =
  | 'verse'
  /** sub-verse word selection */
  | 'verse.word'
  | 'commentary.entry'
  | 'dictionary.entry'
  | 'book.section'
  | 'note'
  | 'highlight'
  | 'reference'
  | 'search.result'
  | 'panel.tab';

export interface ContextMenuItemDescriptor {
  /** Unique within the extension. */
  id: string;
  label: LocalizedString;
  icon?: string;
  /** Command ID to execute. */
  command: string;
  /** Passed to the command handler. */
  args?: unknown;
  /** when-clause from Spec B. */
  when?: string;
  order?: number;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
}

/** Alias preserved for spec parity - the descriptor IS the wire DTO. */
export type ContextMenuItemDto = ContextMenuItemDescriptor;

// --- Notifications, quick-pick, input boxes, confirms ----------------------

export interface NotificationOpts {
  severity?: 'info' | 'warning' | 'error';
  /** Default 4000; 0 = sticky. */
  durationMs?: number;
  actions?: { id: string; label: LocalizedString }[];
}

export interface QuickPickItemDescriptor<T> {
  label: LocalizedString;
  description?: LocalizedString;
  detail?: LocalizedString;
  iconId?: string;
  value: T;
}

export interface QuickPickOpts {
  placeholder?: LocalizedString;
  matchOnDescription?: boolean;
  canPickMany?: boolean;
}

export interface InputBoxOpts {
  prompt: LocalizedString;
  placeholder?: LocalizedString;
  initialValue?: string;
  password?: boolean;
  /** Reverse-RPC endpoint that validates input on each keystroke; returns null if valid. */
  validateEndpoint?: string;
}

export interface ConfirmOpts {
  title: LocalizedString;
  message: LocalizedString;
  confirmLabel?: LocalizedString;
  cancelLabel?: LocalizedString;
  destructive?: boolean;
}

// --- File picker -----------------------------------------------------------

export interface PickFileOpts {
  title?: LocalizedString;
  filters?: { name: LocalizedString; extensions: string[] }[];
  multiple?: boolean;
  /** Default 'text'. Determines how the host returns the contents. */
  encoding?: 'text' | 'binary';
}

export interface PickedFileDto {
  /** Filename only - no path. */
  name: string;
  /** Bytes. */
  size: number;
  contents: string | ArrayBuffer;
  /**
   * An opaque handle the host uses to refer to this file later (e.g. for
   * subsequent reads of the same file the user picked). The handle does NOT
   * encode the absolute path.
   */
  handle: string;
}

export interface SaveFileOpts {
  title?: LocalizedString;
  defaultFilename?: string;
  filters?: { name: LocalizedString; extensions: string[] }[];
}

// --- Managed folder DTOs --------------------------------------------------

/**
 * Handle representing a user-granted folder the extension can read/write.
 * The `path` is the absolute folder path on disk. Extensions only operate on
 * relative paths within the grant - the host resolves them against `path`.
 */
export interface FolderGrantHandle {
  /** Absolute path of the granted folder on disk. */
  path: string;
  /** ISO 8601 date string when the user granted access. */
  grantedAt: string;
}

/**
 * Metadata about a file inside a managed folder grant.
 */
export interface FileInfo {
  /** Filename (basename). */
  name: string;
  /** Path relative to the grant root. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** True if the entry is a directory. */
  isDirectory: boolean;
  /** ISO 8601 date string of last modification. */
  modifiedAt: string;
}

/**
 * Summary of disk usage inside a managed folder grant.
 */
export interface FolderUsageInfo {
  /** Absolute path of the granted folder. */
  path: string;
  /** Total number of files (not directories). */
  fileCount: number;
  /** Total size of all files in bytes. */
  totalBytes: number;
}

// --- Bible DTOs (mirror Data/Models/Bible/* stripped to plain JSON) --------

export interface BibleVerseFormattingFootnote {
  position: number;
  marker: string;
  text: string;
}

export interface BibleVerseFormattingCrossRef {
  position: number;
  marker: string;
  /** Verse IDs the cross-reference points at. */
  references: number[];
}

export interface BibleVerseFormattingDataDto {
  paragraphStart?: boolean;
  poetry?: { isPoetry: boolean; indentLevel?: number };
  wordsOfChrist?: { start: number; end: number }[];
  addedWords?: { start: number; end: number }[];
  sectionHeading?: string;
  footnotes?: BibleVerseFormattingFootnote[];
  crossReferences?: BibleVerseFormattingCrossRef[];
}

export interface BibleVerseDto {
  verseId: number;
  text: string;
  /** Plain text without inline formatting markup. */
  textPlain?: string;
  formattingData?: BibleVerseFormattingDataDto;
  wordCount?: number;
  /** Free-form per-verse metadata preserved from the source module. */
  metadata?: Record<string, unknown>;
}

export interface BibleModuleInfoDto {
  /** Module identifier - `abbreviation` or filename stem, depending on caller. */
  id: string;
  abbreviation: string;
  name: LocalizedString;
  language?: string;
  version?: string;
  /** True if the module is in the original language (Hebrew/Greek). */
  isOriginalLanguage?: boolean;
  /**
   * Presentation form of the module's `right_to_left` flag, shaped for the HTML
   * `dir` attribute. The schema stores the boolean; this DTO is the only place
   * the two-value string survives, because that is what a renderer wants.
   */
  textDirection?: 'ltr' | 'rtl';
  metadata?: Record<string, unknown>;
}

export interface BibleBookDto {
  bookNumber: number;
  /** Standard short name (e.g. 'Gen'). */
  shortName: string;
  /** Localized full name (e.g. 'Genesis'). */
  name: LocalizedString;
  testament: 'old' | 'new';
  chapterCount: number;
}

export interface ParsedReferenceDto {
  bookNumber: number;
  chapter: number;
  /** Inclusive start verse. Omit for whole-chapter references. */
  startVerse?: number;
  /** Inclusive end verse. Omit for single-verse references. */
  endVerse?: number;
  /** The original input string the parser consumed. */
  input: string;
  /** Calculated verse ID for the start verse, if available. */
  startVerseId?: number;
  endVerseId?: number;
}

// --- Commentary DTOs -------------------------------------------------------

export interface CommentaryModuleInfoDto {
  id: string;
  abbreviation: string;
  name: LocalizedString;
  language?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface CommentaryEntryDto {
  /** Stable identifier within the module. */
  id: string;
  moduleId: string;
  /** First verse the entry covers. */
  startVerseId: number;
  /** Last verse the entry covers (inclusive). Equal to `startVerseId` for single-verse entries. */
  endVerseId: number;
  /** Optional title or heading shown at the top of the entry. */
  title?: string;
  /** Body in HTML or markdown depending on the source module. */
  content: string;
  /** True if `content` is HTML; false (or absent) means plain text / markdown. */
  isHtml?: boolean;
  metadata?: Record<string, unknown>;
}

// --- Dictionary DTOs -------------------------------------------------------

export interface DictionaryModuleInfoDto {
  id: string;
  abbreviation: string;
  name: LocalizedString;
  language?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface DictionaryEntryDto {
  /** Lookup key (Strong's number, lemma, or headword). */
  key: string;
  moduleId: string;
  /** Display headword. */
  headword: string;
  /** Optional pronunciation guide. */
  pronunciation?: string;
  /** Optional language code (e.g. 'el', 'he'). */
  language?: string;
  /** Body in HTML or plain text. */
  content: string;
  isHtml?: boolean;
  /** Strong's number if the entry is keyed on one. */
  strongsNumber?: string;
  metadata?: Record<string, unknown>;
}

// --- Book DTOs -------------------------------------------------------------

export interface BookModuleInfoDto {
  id: string;
  abbreviation: string;
  name: LocalizedString;
  language?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface BookSectionSummaryDto {
  /** Stable identifier within the module. */
  id: string;
  moduleId: string;
  parentId?: string;
  title: LocalizedString;
  /** Depth in the table-of-contents tree. 0 = root. */
  depth: number;
  /** True if this section has children. */
  hasChildren: boolean;
  order: number;
}

export interface BookSectionDto extends BookSectionSummaryDto {
  /** Body content. */
  content: string;
  isHtml?: boolean;
  metadata?: Record<string, unknown>;
}

// --- Cross references ------------------------------------------------------

export interface CrossReferenceDto {
  fromVerseId: number;
  toVerseId: number;
  /** Optional inclusive end if the target is a range. */
  toEndVerseId?: number;
  /** Source identifier (built-in source name or extension-contributed module ID). */
  source: string;
  /** Optional comment / note text. */
  note?: string;
  metadata?: Record<string, unknown>;
}

// --- Notes / highlights / bookmarks DTOs -----------------------------------

export interface UserNoteDto {
  id: string;
  /** Optional parent note (for hierarchical structure). */
  parentId?: string;
  /** Optional note type (e.g. 'general', 'prayer', 'sermon'). */
  type?: string;
  title?: string;
  /** Body in markdown or HTML, per the host's note storage format. */
  content: string;
  /** Verses this note links to. */
  linkedVerses?: number[];
  /** Tags applied to the note. */
  tags?: string[];
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface NewNoteDto {
  parentId?: string;
  type?: string;
  title?: string;
  content: string;
  linkedVerses?: number[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface NoteQueryDto {
  /** Filter to notes linked to this verse. */
  verseId?: number;
  /** Filter by tag. */
  tag?: string;
  /** Filter by type. */
  type?: string;
  /** Filter by parent. */
  parentId?: string;
  /** Free-text query against title + content. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UserHighlightDto {
  id: string;
  range: VerseRange | VerseRange[];
  styleId: string;
  data?: unknown;
  comment?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NewHighlightDto {
  /** Whole-verse, multi-verse, or sub-verse range. */
  range: VerseRange | VerseRange[];
  /** ID of a registered style (built-in or extension-contributed). */
  styleId: string;
  /** Optional opaque metadata, returned with the highlight. */
  data?: unknown;
  /** Optional comment text. */
  comment?: string;
}

export interface HighlightStyleDescriptor {
  /** Namespaced under the extension's ID, e.g. 'ext.greekTools.verbHighlight'. */
  id: string;
  label: LocalizedString;
  /** The visual style applied. Same shape as decorations. */
  style: DecorationStyle;
  /** Optional preview swatch (a small icon ID or hex color). */
  swatch?: string;
  /** True if this style applies to ranges/words instead of whole verses. */
  rangeMode?: 'verse' | 'range' | 'word';
}

export interface BookmarkDto {
  id: string;
  verseId: number;
  collectionId?: string;
  label?: LocalizedString;
  createdAt: number;
}

export interface CollectionDto {
  id: string;
  name: LocalizedString;
  /** Number of bookmarks in this collection. */
  count: number;
  createdAt: number;
}

// --- Workspace DTOs --------------------------------------------------------

export interface PanelInfoDto {
  panelId: string;
  /** Content type, e.g. 'bible', 'commentary', or 'ext:ext.greekTools.lexicon'. */
  contentType: string;
  /** Optional title shown in the tab. */
  title?: LocalizedString;
  /** Optional state object the panel restored from / persists to. */
  state?: Record<string, unknown>;
}

export interface OpenPanelOpts {
  /** Where to dock the new panel. */
  bucket?: 'left' | 'right' | 'bottom' | 'main';
  /** Optional initial state. */
  state?: Record<string, unknown>;
  /** If true, focus the panel after opening. Default true. */
  focus?: boolean;
}

// --- Iteration shapes (Bible / commentary / dictionary / book) -------------

export interface IterateVersesOpts {
  module: string;
  /** Inclusive lower bound. Omit for start of module. */
  startVerseId?: number;
  /** Inclusive upper bound. Omit for end of module. */
  endVerseId?: number;
  /** Default 200, max 1000. */
  pageSize?: number;
  /** Opaque cursor returned by a previous call. */
  cursor?: string;
}

export interface VerseIterationResult {
  verses: BibleVerseDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface IterateCommentaryOpts {
  moduleId: string;
  /** Default 50, max 500. */
  pageSize?: number;
  cursor?: string;
  /** Optional verse range to constrain iteration. */
  startVerseId?: number;
  endVerseId?: number;
}

export interface CommentaryIterationResult {
  entries: CommentaryEntryDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface IterateDictionaryOpts {
  moduleId: string;
  /** Default 100, max 500. */
  pageSize?: number;
  cursor?: string;
  /** Optional prefix to constrain iteration. */
  keyPrefix?: string;
}

export interface DictionaryIterationResult {
  entries: DictionaryEntryDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface IterateBookOpts {
  moduleId: string;
  /** Default 100, max 500. */
  pageSize?: number;
  cursor?: string;
  /** Limit iteration to descendants of this section. */
  rootSectionId?: string;
}

export interface BookIterationResult {
  sections: BookSectionDto[];
  nextCursor?: string;
  hasMore: boolean;
}

// --- Provider descriptors (bible / commentary / dictionary / book) -----------

export type BibleProviderCapability =
  /** single-verse fetch */
  | 'lookup'
  /** multi-verse fetch */
  | 'range'
  /** bulk enumeration */
  | 'iterate'
  /** backed by a network call (warns user, may be slow) */
  | 'remote';

export interface BibleProviderDescriptor {
  /** Namespaced under the extension's ID at registration time. */
  id: string;
  name: LocalizedString;
  abbreviation: string;
  /** bcp47. */
  language?: string;
  capabilities: BibleProviderCapability[];
  /** RPC endpoint name the host calls to fetch a single verse. */
  fetchEndpoint: string;
  /** Optional reverse-RPC endpoint for range fetch. */
  rangeEndpoint?: string;
  /** Optional reverse-RPC endpoint for bulk iteration. */
  iterateEndpoint?: string;
}

export type CommentaryCapability =
  /** single-verse fetch */
  | 'lookup'
  /** multi-verse fetch */
  | 'range'
  /** bulk enumeration */
  | 'iterate'
  /** "find similar paragraphs" given a snippet or entry id */
  | 'similarity'
  /** backed by a network call (warns user, may be slow) */
  | 'remote';

export interface CommentaryProviderDescriptor {
  /** Namespaced under the extension's ID. */
  id: string;
  name: LocalizedString;
  abbreviation: string;
  /** bcp47. */
  language?: string;
  capabilities: CommentaryCapability[];
  /** RPC endpoint name the host calls to fetch a single entry. */
  fetchEndpoint: string;
  /** Optional reverse-RPC endpoint for range fetch. */
  rangeEndpoint?: string;
  /** Optional reverse-RPC endpoint for bulk iteration. */
  iterateEndpoint?: string;
  /** Optional: this provider can also serve "find similar" queries. */
  similarityEndpoint?: string;
}

export type DictionaryCapability =
  | 'lookup'
  | 'search'
  | 'iterate'
  /** accepts Strong's numbers as keys */
  | 'strongs'
  /** accepts lemmas as keys */
  | 'lemma'
  /** returns morphology data with entries */
  | 'morphology'
  | 'remote';

export interface DictionaryProviderDescriptor {
  id: string;
  name: LocalizedString;
  abbreviation: string;
  /** bcp47 - for filtering by Greek/Hebrew/etc. */
  language?: string;
  capabilities: DictionaryCapability[];
  /** (key) -> DictionaryEntryDto | null */
  fetchEndpoint: string;
  /** (query, opts) -> DictionaryEntryDto[] */
  searchEndpoint?: string;
  iterateEndpoint?: string;
  /** Optional: returns morphology / stemming chart data for a token. */
  morphologyEndpoint?: string;
}

export interface BookProviderDescriptor {
  id: string;
  name: LocalizedString;
  abbreviation: string;
  language?: string;
  capabilities: ('lookup' | 'iterate' | 'remote')[];
  /** (sectionId) -> BookSectionDto | null */
  fetchEndpoint: string;
  /** (parentId?) -> BookSectionSummaryDto[] */
  listEndpoint?: string;
  iterateEndpoint?: string;
}

// --- UI registration descriptors -------------------------------------------

export interface ExtensionPanelTypeDef {
  /** Becomes `ext:${extensionId}.${id}`. */
  id: string;
  title: LocalizedString;
  icon?: string;
  /** ext-ui:// path the iframe loads. */
  uiEntry: string;
  /** Optional default home in a preset. */
  defaultBucket?: 'left' | 'right' | 'bottom' | 'unknown';
  /**
   * If true, the panel renders in the writing pane bucket (notes/journal/etc.)
   * instead of the study bucket. Default false.
   */
  writingPane?: boolean;
}

export interface DisplayModeDescriptor {
  id: string;
  label: LocalizedString;
  /** 'overlay' adds decorations on top of the standard rendering; 'replace' substitutes an iframe. */
  kind: 'overlay' | 'replace';
  /** Reverse-RPC: (verseId[]) -> DecorationDto[] for overlay; (verseId) -> uiEntry path for replace. */
  renderEndpoint: string;
  /** Languages this mode applies to. Empty = all. */
  applicableLanguages?: string[];
}

export interface StatusBarItemDescriptor {
  id: string;
  text: LocalizedString;
  tooltip?: LocalizedString;
  command?: string;
  alignment?: 'left' | 'right';
  priority?: number;
}

// --- Commands API registration ---------------------------------------------

export interface ExtensionCommandRegistration {
  /** MUST start with `ext.<extensionId>.`. */
  id: string;
  title: LocalizedString;
  category?: LocalizedString;
  shortcut?: KeybindingDescriptor | KeybindingDescriptor[];
  when?: string;
  /** RPC endpoint name the host calls when the command is invoked. */
  handlerEndpoint: string;
  order?: number;
  hidden?: boolean;
}

// --- Network DTOs ----------------------------------------------------------

export interface NetworkFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  /**
   * Body shape: a string, a binary buffer, a JSON object wrapper, or a form
   * wrapper. The host serializes JSON/form bodies and sets Content-Type
   * automatically when not overridden.
   */
  body?:
    | string
    | ArrayBuffer
    | Uint8Array
    | { json: unknown }
    | { form: Record<string, string> };
  /** Default 30000, max 120000. */
  timeoutMs?: number;
  redirect?: 'follow' | 'error' | 'manual';
  responseType?: 'text' | 'json' | 'arrayBuffer';
  /** Maximum response body size in bytes. Default 10 MB, max 100 MB. */
  maxResponseBytes?: number;
  /** Stripped before logging. Use for things like Authorization headers. */
  redactHeaders?: string[];
}

export interface NetworkFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  /** Shape depends on `init.responseType`. */
  body: string | unknown | ArrayBuffer;
}

// --- OAuth DTOs ------------------------------------------------------------

export interface StartOAuthOpts {
  /** Namespaced 'ext.<id>.<provider>'. */
  providerId: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  /**
   * If present, the host adds it to the token-exchange request. Public clients
   * should omit it and rely on PKCE only. The secret never crosses back into
   * the worker.
   */
  clientSecret?: string;
  scopes: string[];
  /** Default true. */
  pkce?: boolean;
  /** Redirect URI path under ext-ui://<extensionId>/. Default 'oauth/callback'. */
  redirectPath?: string;
  /** Optional, e.g. for Auth0. */
  audience?: string;
  extraAuthorizeParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
  windowTitle?: LocalizedString;
  /** Force re-consent even if the user is signed in to the provider. */
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
}

export interface RefreshOAuthOpts {
  providerId: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scopes?: string[];
}

export interface OAuthResult {
  accessToken: string;
  /** Usually 'Bearer'. */
  tokenType: string;
  /** Epoch ms. */
  expiresAt?: number;
  refreshToken?: string;
  scope?: string;
  /** Full token response, in case the provider returns extra fields (e.g. id_token). */
  raw: Record<string, unknown>;
}

// --- Background tasks ------------------------------------------------------

export interface BackgroundTaskDescriptor {
  /** Namespaced 'ext.<id>.<task>'. Used as a stable ID for cancel/resume. */
  id: string;
  title: LocalizedString;
  /** Optional longer description shown in the task panel. */
  description?: LocalizedString;
  /** Default true. */
  cancellable?: boolean;
  /** Default true. */
  showInStatusBar?: boolean;
  /** Default false. */
  notifyOnComplete?: boolean;
  /** Reverse-RPC endpoint name the host calls to do the work. */
  workEndpoint: string;
  /**
   * If set, only one task with this id may run at a time. A second call with
   * the same id either rejects or joins the running task, per `concurrency`.
   */
  singleton?: boolean;
  concurrency?: 'reject' | 'join';
}

export interface TaskProgressUpdate {
  /** Increment 0..100. Cumulative if `total` is set, instantaneous otherwise. */
  increment?: number;
  /** Optional total for determinate progress bars. */
  total?: number;
  message?: LocalizedString;
}

export interface BackgroundTaskInfo {
  id: string;
  title: LocalizedString;
  /** Epoch ms. */
  startedAt: number;
  state: 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  progress?: { current: number; total?: number; message?: string };
}

// --- Inter-extension call --------------------------------------------------

export interface ExtensionProviderInfo {
  extensionId: string;
  displayName: LocalizedString;
  exports: { method: string; description?: LocalizedString }[];
}

// --- Storage DTOs ----------------------------------------------------------

export interface OpenDatabaseOpts {
  /** If true, the file is excluded from user backups (e.g. derived caches). */
  ephemeral?: boolean;
  /** If true, open read-only. Default false. */
  readonly?: boolean;
}

/**
 * Per-extension SQLite database handle returned by `IStorageApi.openDatabase`.
 *
 * Bind parameters must be `string`, `number`, `boolean`, `null`, or binary
 * (`Uint8Array` / `ArrayBuffer`) - the host rejects anything else rather than
 * let the driver coerce it. Binary binds as a real BLOB and reads back as a
 * `Uint8Array`; there is no need to base64 it yourself.
 */
export interface IExtensionDatabase {
  exec(sql: string): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(
    sql: string,
    params?: unknown[],
  ): Promise<{ changes: number; lastInsertRowid: number | string }>;
  /** Run multiple statements in a transaction. Auto-rollback on throw. */
  transaction<T>(work: (tx: IExtensionDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// --- Filter / search DTOs used by extension points -------------------------

export interface RenderOverride {
  /** If present, replaces the standard verse text content. */
  text?: string;
  /** If present, replaces the formatting metadata. */
  formattingData?: BibleVerseFormattingDataDto;
  /** Optional opaque marker the host preserves alongside the override. */
  reason?: string;
}

export interface FormatOverride {
  /** Replacement text after formatting transforms. */
  text?: string;
  /** Replacement formatting metadata. */
  formattingData?: BibleVerseFormattingDataDto;
}

export interface SearchQueryDto {
  query: string;
  scope?: 'all' | 'current-module' | 'current-pane' | string;
  /** Filters such as testament, book range, language. */
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

export interface SearchResultsDto {
  query: SearchQueryDto;
  total: number;
  /** Hit list - shape mirrors the host's internal SearchResult, plain JSON only. */
  hits: SearchHitDto[];
}

export interface SearchHitDto {
  verseId: number;
  moduleId: string;
  /** Snippet with optional highlight markup. */
  snippet: string;
  /** Relevance score (0..1 or arbitrary backend score). */
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchSuggestionDto {
  text: string;
  /** Optional category label, e.g. 'reference', 'word', 'phrase'. */
  category?: string;
}

// --- Error code names ------------------------------------------------------

/**
 * Stable error `code` strings the host throws over RPC. The worker re-raises
 * them as subclasses of `ExtensionApiError` (defined in the worker runtime).
 * The names match Spec A's "Errors" table.
 */
export const EXTENSION_API_ERROR_CODES = [
  'PermissionDeniedError',
  'NetworkHostNotAllowedError',
  'ResponseTooLargeError',
  'QuotaExceededError',
  'ApiExportNotFoundError',
  'ProviderNotRegisteredError',
  'RpcProtocolError',
  'RpcTimeoutError',
  'RpcCancelledError',
  'ExtensionNotActiveError',
  'SettingRequiredError',
  'IncompatibleApiVersionError',
  'MethodRemovedError',
] as const;

export type ExtensionApiErrorCode = (typeof EXTENSION_API_ERROR_CODES)[number];
