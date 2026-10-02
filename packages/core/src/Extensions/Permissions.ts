/**
 * Extension permission identifiers and ordering constants.
 *
 * Permissions are declared in `extension.json` and approved by the user at
 * install time. The host enforces them at every API boundary call via
 * `ExtensionPermissionGuard`. On failure, the host throws
 * `PermissionDeniedError` over RPC.
 *
 * Every permission is declared - with its consent text and grant policy - by
 * the API namespace that owns it (`Declarations/namespaces/*.ts`); the lists
 * here are derived from that registry.
 */

import { EXTENSION_API_REGISTRY, type DeclaredPermission } from './Declarations/registry';

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

/**
 * Provider registration.
 *
 * `search:provide`, `import:provide`, `tts:provide` and `ai:provide` used to
 * live here as reserved slots, and so did `display-mode:provide` - but each
 * had, or ended up with, no API surface behind it at all: nothing an
 * extension could call, and nothing that would ever fail loudly.
 * `display-mode:provide` did briefly have a real, if rejecting,
 * `ui.registerDisplayMode` method (see `uiApiImpl.ts`'s history), but once
 * that reserved slot was removed outright (round 3, P2.13 - custom display
 * modes were never built and nothing renders one), the stated reason for
 * keeping the permission went with it. Asking a user to grant a capability
 * the host cannot deliver, silently, forever, is worse than not asking - so
 * all five were removed outright rather than kept as dead weight. Re-add a
 * permission (in the owning namespace's declaration) only once there is a
 * real API namespace to gate.
 */
export const PERM_BIBLE_PROVIDE = 'bible:provide' as const;
export const PERM_COMMENTARY_PROVIDE = 'commentary:provide' as const;
export const PERM_DICTIONARY_PROVIDE = 'dictionary:provide' as const;
export const PERM_BOOK_PROVIDE = 'book:provide' as const;

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
/**
 * Lets `commands.execute` reach a built-in (host-owned) command from the
 * host's allowlist (see `BUILTIN_COMMAND_ALLOWLIST` in `commandsApiImpl.ts`).
 * An extension may always execute its *own* commands (those under its
 * `ext.<id>.` prefix) without this permission - it is only the confused-
 * deputy path into host functionality that is gated. Not default-granted.
 */
export const PERM_COMMANDS_EXECUTE_BUILTIN = 'commands:execute-builtin' as const;
export const PERM_TASKS = 'tasks' as const;

/**
 * Schedule reminders (`api.reminders`): the host shows the extension's
 * reminders as OS notifications at times the extension chooses, even while
 * the app is in the background, and wakes the extension (`onReminder`) when
 * the user clicks one. It interrupts the user outside the app, so it is NOT
 * default-granted: it appears in the ordinary install consent dialog. It is
 * deliberately not in `SEPARATELY_PROMPTED_PERMISSIONS` - that list is for
 * data-exfiltration and persistent-storage surfaces (network, keychain,
 * databases, folders); a notification is bounded (64 plain-text items, no
 * data leaves the machine) and the user can silence a single extension or all
 * of them in Preferences > Notifications. One omnibus line is the right weight.
 */
export const PERM_NOTIFICATIONS_SCHEDULE = 'notifications:schedule' as const;

/** Network */
export const PERM_NETWORK = 'network' as const;
export const PERM_NETWORK_OAUTH = 'network:oauth' as const;

/**
 * Speech. `speech:listen` opens the microphone (transcripts only, never audio)
 * and is separately prompted; `speech:speak` plays synthesized speech and earcons.
 */
export const PERM_SPEECH_LISTEN = 'speech:listen' as const;
export const PERM_SPEECH_SPEAK = 'speech:speak' as const;

/** Inter-extension */
export const PERM_EXTENSIONS_CALL = 'extensions:call' as const;

/** Filesystem (user-mediated only) */
export const PERM_FS_READ_USER = 'fs:read-user' as const;
export const PERM_FS_WRITE_USER = 'fs:write-user' as const;
/** Managed folder - scoped read/write access to a user-chosen folder. */
export const PERM_FS_MANAGED_FOLDER = 'fs:managed-folder' as const;

/**
 * Union of every permission identifier the host knows about, derived from
 * the namespace declarations (`Declarations/registry.ts`). Useful for
 * exhaustive switches in the permission guard and the install consent UI.
 *
 * The `PERM_*` constants above are kept for existing call sites; a new
 * permission is declared in its namespace's declaration file and needs no
 * constant here. `Declarations/registry.test.ts` checks the two agree.
 */
export type ExtensionPermission = DeclaredPermission;

/**
 * Permissions that are auto-granted when an extension is installed. These do
 * not appear in the consent dialog (the user implicitly grants them by
 * installing the extension at all). Declared with `grant: 'default'`.
 */
export const DEFAULT_GRANTED_PERMISSIONS: readonly ExtensionPermission[] =
  EXTENSION_API_REGISTRY.defaultGranted as readonly ExtensionPermission[];

/**
 * Permissions that show a SEPARATE detail dialog at install time, in addition
 * to the omnibus consent. These touch sensitive subsystems (network, OS
 * keychain, persistent on-disk databases, the microphone) and the user deserves a focused
 * decision rather than a buried checkbox. Declared with `grant: 'separate'`.
 */
export const SEPARATELY_PROMPTED_PERMISSIONS: readonly ExtensionPermission[] =
  EXTENSION_API_REGISTRY.separatelyPrompted as readonly ExtensionPermission[];

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
