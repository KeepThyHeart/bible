# Scripture memory (task 0114)

Memorization with a ladder of exercises (put in order, match the reference, fill the blanks, first letters, name the
reference, recite aloud), spaced-repetition scheduling, lists, hands-free recitation and push cards. It began as the
`bible-memory` extension and is now a built-in feature module and app. The code is in `packages/memory`
(`@bible/memory`); the desktop wires it in, the web registers it hidden.

| Layer | Where |
|---|---|
| Domain, store, scheduler, recite, push cards, `MemoryService` | `packages/memory/src/core/` (platform-free; talks to a `MemorySql` and a `MemoryHostApi`) |
| Storage | host user-database tables `memory_*` (Backup Registry classes, `USER_SCHEMA_VERSION` 2); `packages/memory/src/core/schema.ts` |
| UI | `packages/memory/src/ui/` (framework-free DOM, scoped `memory.css` mapped to KTH tokens); `mountMemoryUi(container, { api, subscribe, t, locale })` |
| Manifest | `packages/memory/src/manifest.ts`: app `memory` (`#/@memory`), verse action `memory.memorize`, `platforms: ['desktop']`, activation `onStartupFinished`, namespace `memory` |
| Desktop main | `apps/desktop/electron/modules/memory/`: IPC `module:memory:*` over `MemoryService`, the `app:memory` reminder source, restore hooks, retirement of the old extension |
| Desktop renderer | `apps/desktop/src/ui/modules/memory/`: `memoryModule.ts` (entry chunk, loaders), `module.ts` (activation), `MemoryAppView.tsx` (lazy app view), `memorize.ts` (verse action) |
| Web | `apps/web/src/modules/memory/binding.ts`: registered, off for the platform |
| Strings | `apps/desktop/locales/<lng>/memory.json` (all locales); manifest labels (`apps.memory.title`, `verseActions.memorize`) stay in `ui.json` |

## How it runs on desktop

The main module registers its IPC handlers at startup and nothing else heavy: the core, the one-time import and the
speech port load on the first call. `getStatus` (the badge) and `takeNotices` are answered straight from the user
database with no core. Users with push cards on get the core started shortly after launch so it keeps planning them.

The renderer module is an ordinary `DesktopFeatureModule`: its app binding, verse-action handler and the pieces in
`module.ts` (badge and its refresh, push subscription, notice pickup, notification-click routing) all register when
the module is enabled and unregister when it is switched off, with no reload. `kthModules.disable('memory')` in a dev
build shows it.

### Notification clicks

Main sends the click on the Notifications event channel. When the Notifications module is listening it routes
`app:memory/cards` to the app's link handler (`bindAppLinkHandler`). When it is not, Memory listens itself. "Listening"
is asked when the click arrives (`featureModules.isActive('notifications')`), not at activation.

### Moving from the old extension

- The first start imports the old extension database (schema v4 to v7) once, keeping list ids, then disables a
  still-enabled copy of the extension (after a catch-up merge, within two days of the import) and queues a notice.
- If Memory already had a plan, the import is skipped and a notice points at the manual "Import data from the old
  Scripture Memory extension" in Memory's settings, which merges instead of overwriting.
- A merge matches lists by the id recorded at import (so a rename does not duplicate a plan), then by name; a matched
  card takes the old schedule when the old database was practised more recently than anything here.
- Notices are queued in `memory_import` and handed over by `takeNotices` only while a window is visible, so a
  hidden or tray launch does not use them up.

## Strings

Every user-visible string is `tr('memory.ui.<area>.<name>', 'English', params)` in the UI and
`tc('memory.core.<name>', 'English', params)` in the core. The English beside the key is the fallback when no catalog
is wired; `packages/memory/test/catalog.test.ts` keeps it equal to `apps/desktop/locales/en/memory.json`, checks that every key
is used and that every locale has the same keys and placeholders. UI messages may use ICU plurals; core messages
(shown by the main process) use plain `{name}` placeholders only. Constants holding text are getters or functions, so
a language change applies at the next render; the app view remounts when the language changes.

## Web

Hidden until accounts exist (task 0063): the web saves no user content in the browser. To enable it, add `'web'`
to `platforms` on the manifest and the app descriptor, and give the web binding an app and a verse-action handler
over a browser `MemoryApi` (`MemoryService` over a `MemorySql` plus `mountMemoryUi`).

## Related

- [App host](app-host.md), [Migrating a feature onto the feature-module contract](feature-modules-migration.md)
- [Backup format](backup-format.md) (Registry classes), [Notifications](notifications.md)
