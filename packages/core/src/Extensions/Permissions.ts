/**
 * Extension permission identifiers and ordering constants.
 *
 * Permissions are declared in `extension.json` and approved by the user at
 * install time. The host enforces them at every API boundary call via
 * `ExtensionPermissionGuard`. On failure, the host throws
 * `PermissionDeniedError` over RPC.
 */

// --- Permission identifiers ------------------------------------------------

/** Reads */
export const PERM_BIBLE_READ = 'bible:read' as const;
export const PERM_COMMENTARY_READ = 'commentary:read' as const;
export const PERM_DICTIONARY_READ = 'dictionary:read' as const;
export const PERM_BOOK_READ = 'book:read' as const;
export const PERM_NOTES_READ = 'notes:read' as const;
export const PERM_NOTES_WRITE = 'notes:write' as const;
export const PERM_HIGHLIGHTS_READ = 'highlights:read' as const;
export const PERM_HIGHLIGHTS_WRITE = 'highlights:write' as const;
export const PERM_BOOKMARKS_READ = 'bookmarks:read' as const;
export const PERM_BOOKMARKS_WRITE = 'bookmarks:write' as const;

/** Provider registration */
export const PERM_BIBLE_PROVIDE = 'bible:provide' as const;
export const PERM_COMMENTARY_PROVIDE = 'commentary:provide' as const;
export const PERM_DICTIONARY_PROVIDE = 'dictionary:provide' as const;
export const PERM_BOOK_PROVIDE = 'book:provide' as const;
export const PERM_SEARCH_PROVIDE = 'search:provide' as const;
export const PERM_DISPLAY_MODE_PROVIDE = 'display-mode:provide' as const;
export const PERM_IMPORT_PROVIDE = 'import:provide' as const;
/** RESERVED - registering AI providers (no host UI in v1). */
export const PERM_AI_PROVIDE = 'ai:provide' as const;
/** RESERVED - registering text-to-speech voices. */
export const PERM_TTS_PROVIDE = 'tts:provide' as const;

/** Storage */
export const PERM_STORAGE = 'storage' as const;
export const PERM_STORAGE_SECRETS = 'storage:secrets' as const;
export const PERM_STORAGE_DATABASE = 'storage:database' as const;

/** UI */
export const PERM_UI_CONTRIBUTE_PANE = 'ui:contribute-pane' as const;
export const PERM_UI_VERSE_DECORATOR = 'ui:verse-decorator' as const;
export const PERM_UI_VERSE_HOVER = 'ui:verse-hover' as const;
export const PERM_UI_CONTEXT_MENU = 'ui:context-menu' as const;
export const PERM_UI_NOTIFICATION = 'ui:notification' as const;
export const PERM_UI_STATUS_BAR = 'ui:status-bar' as const;
/** Allows the extension's panel iframe to auto-play audio/video. */
export const PERM_UI_MEDIA = 'ui:media' as const;

/** Commands & tasks */
export const PERM_COMMANDS_REGISTER = 'commands:register' as const;
export const PERM_TASKS = 'tasks' as const;

/** Network */
export const PERM_NETWORK = 'network' as const;
export const PERM_NETWORK_OAUTH = 'network:oauth' as const;

/** Inter-extension */
export const PERM_EXTENSIONS_CALL = 'extensions:call' as const;

/** Filesystem (user-mediated only) */
export const PERM_FS_READ_USER = 'fs:read-user' as const;
export const PERM_FS_WRITE_USER = 'fs:write-user' as const;
/** Managed folder - scoped read/write access to a user-chosen folder. */
export const PERM_FS_MANAGED_FOLDER = 'fs:managed-folder' as const;

/**
 * Union of every permission identifier the host knows about. Useful for
 * exhaustive switches in the permission guard and the install consent UI.
 */
export type ExtensionPermission =
  | typeof PERM_BIBLE_READ
  | typeof PERM_COMMENTARY_READ
  | typeof PERM_DICTIONARY_READ
  | typeof PERM_BOOK_READ
  | typeof PERM_NOTES_READ
  | typeof PERM_NOTES_WRITE
  | typeof PERM_HIGHLIGHTS_READ
  | typeof PERM_HIGHLIGHTS_WRITE
  | typeof PERM_BOOKMARKS_READ
  | typeof PERM_BOOKMARKS_WRITE
  | typeof PERM_BIBLE_PROVIDE
  | typeof PERM_COMMENTARY_PROVIDE
  | typeof PERM_DICTIONARY_PROVIDE
  | typeof PERM_BOOK_PROVIDE
  | typeof PERM_SEARCH_PROVIDE
  | typeof PERM_DISPLAY_MODE_PROVIDE
  | typeof PERM_IMPORT_PROVIDE
  | typeof PERM_AI_PROVIDE
  | typeof PERM_TTS_PROVIDE
  | typeof PERM_STORAGE
  | typeof PERM_STORAGE_SECRETS
  | typeof PERM_STORAGE_DATABASE
  | typeof PERM_UI_CONTRIBUTE_PANE
  | typeof PERM_UI_VERSE_DECORATOR
  | typeof PERM_UI_VERSE_HOVER
  | typeof PERM_UI_CONTEXT_MENU
  | typeof PERM_UI_NOTIFICATION
  | typeof PERM_UI_STATUS_BAR
  | typeof PERM_UI_MEDIA
  | typeof PERM_COMMANDS_REGISTER
  | typeof PERM_TASKS
  | typeof PERM_NETWORK
  | typeof PERM_NETWORK_OAUTH
  | typeof PERM_EXTENSIONS_CALL
  | typeof PERM_FS_READ_USER
  | typeof PERM_FS_WRITE_USER
  | typeof PERM_FS_MANAGED_FOLDER;

/**
 * Permissions that are auto-granted when an extension is installed. These do
 * not appear in the consent dialog (the user implicitly grants them by
 * installing the extension at all).
 */
export const DEFAULT_GRANTED_PERMISSIONS: readonly ExtensionPermission[] = [
  PERM_BIBLE_READ,
  PERM_COMMANDS_REGISTER,
] as const;

/**
 * Permissions that show a SEPARATE detail dialog at install time, in addition
 * to the omnibus consent. These touch sensitive subsystems (network, OS
 * keychain, persistent on-disk databases) and the user deserves a focused
 * decision rather than a buried checkbox.
 */
export const SEPARATELY_PROMPTED_PERMISSIONS: readonly ExtensionPermission[] = [
  PERM_NETWORK,
  PERM_NETWORK_OAUTH,
  PERM_STORAGE_SECRETS,
  PERM_STORAGE_DATABASE,
  PERM_FS_MANAGED_FOLDER,
] as const;

// --- `order` hint constants ------------------------------------------------

/**
 * Render-order range reserved for built-in (host-supplied) contributions.
 * Built-ins always render before/above third-party plugins so a misbehaving
 * plugin cannot push core UI off the visible Z-stack.
 */
export const ORDER_BUILTIN_MIN = 0;
export const ORDER_BUILTIN_MAX = 99;

/**
 * Render-order range reserved for third-party plugin contributions. The
 * manifest validator rejects any plugin contribution declaring `order < 100`.
 */
export const ORDER_PLUGIN_MIN = 100;
export const ORDER_PLUGIN_MAX = 1000;

/** Default `order` for plugins that do not declare one. Sits in the middle so
 *  later plugins can sort either side without colliding. */
export const ORDER_DEFAULT = 500;
