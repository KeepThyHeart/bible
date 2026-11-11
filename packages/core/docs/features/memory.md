# Memory (task 0114, redesigned in 0219)

Memorization with a ladder of activities (put in order, match the reference, fill in the blanks, first letters, name
the reference, recite aloud), spaced-repetition scheduling, lists, hands-free recitation and reminders. It began as
the `bible-memory` extension and is now a built-in feature module and app named **Memory**. The code is in
`packages/memory` (`@bible/memory`); the desktop wires it in, the web registers it hidden.

**1.0: recite and hands-free are hidden.** "Recite aloud" and hands-free mode stay in the code and its tests, but
the `recite` feature flag (`FEATURE_FLAGS` in `packages/core/src/Settings/FeatureFlags.ts`) defaults to off, so the
Practice something else menu, verse actions, settings block and the start/command entry points leave them out.
Turning it on brings them back; the recite engine itself is planned for the next release.

## What the user sees

Words: a **verse** is one memorized item (a range such as John 3:16-18 is still one verse; "passage" appears only
where a range must be told apart from a single verse), verses live in **lists**, each exercise type is an
**activity**, doing one is to **practice**, and coming back to a verse later is a **review**.

The app is three tabs plus a settings gear: **Today**, **My verses** and **Progress**. Practice, the verse page,
reminders and recite are focused screens with a close button and no tabs.

### Today

The default screen. It shows the queue for the day with a count ("3 to review, 2 new"), a time estimate and one
**Start** button (**Continue** once started). Start walks the queue one verse at a time and the user never picks
an activity.

- **Order:** reviews first (verses that are due, earliest due date first, ties by date added), then new verses
  (oldest added first).
- **Three new verses per day.** Starting a new verse counts against the day's three, so adding twenty verses never
  makes a twenty-verse day. "Learn a new verse" offers one more after the queue is done.
- **Once per verse per day.** A verse practiced today leaves the queue, even if another activity is also due; it
  comes back when its next review date arrives.
- When the queue is empty the screen says "Done for today" and when the next review is due. "Practice anyway"
  starts verses that are not due, nearest review first. With no verses at all, Today is the welcome screen: add a
  verse by typing a reference, or start from a set of starter verses.
- **Practice something else** (a menu) lists Mixed, then each activity that has at least one verse it can run on,
  and starts that kind of practice across the lists in focus.
- **Reminders** row: when reminders are waiting, a line with a Review button opens the reminder stack.
- After "Memorize" in the Bible, Today shows "Added {reference} to Memory" with a **Practice now** button.

### One status per verse

Every verse is **New** (nothing practiced yet), **Learning** or **Known** (every activity that applies to it is
learned), always shown as text plus a chip, never by color alone. Next to it the review date reads "Due today",
"Tomorrow", "In 3 days", a date, or "Not started". Level numbers, tiers and per-activity squares are not shown on
these screens. Scheduling, intervals and thresholds underneath are unchanged.

### Lists and focus

A verse belongs to one list. **Focus** is the one list Today and Practice something else draw from; the default is
all lists. When a focus is set, both Today and My verses show a "Focus: {name}" chip with a clear button. A focused
list with no verses shows an empty-focus message instead of the welcome screen. Focus is stored in the existing
`practiceScope` setting.

### My verses

Every verse in every list as a table (verse, status, next review), with list chips ("All (12)", "{name} (4)") and
a New list chip. A list menu offers rename, delete (typing the name to confirm when the list has history) and
"Focus Today on this list". The add field takes one reference to a chosen list; "Add several at once" takes many.
Row actions: Practice, move to another list, remove (restorable for seven days). Starter sets are offered when the
user has few verses. A row opens the **verse page**: its activities (only those that apply), Practice, answer mode
(first letters or full words), move, remove and reset progress.

### Practice screen

Close button, title "{reference} · {activity}" (just the activity name when the reference is hidden), a "step of
total" bar and a "More" menu: Switch activity, Skip this verse, Show in Bible, and Harder or Easier version when the
activity has levels. Escape closes. The activity code itself (keyboard A-D and Enter, hints, reveal) is unchanged.

After the last step the **after-verse screen** shows the reference, "{correct} of {total} right first time", when
the verse is next due and its status. Buttons: **Continue (n left)** moves to the next verse in the queue, **Again**
repeats the verse, **Stop for today** returns to Today; a single verse started from a menu offers **Done**.

### Locked activities are hidden

Match the reference and Name the reference need 25 or more verses in the verse's list, so they do not appear in
any menu, picker or verse page until then (no greyed-out entries). Applicability is decided per verse from its own
list, so a menu entry always starts.

### Reminders

Settings has a Reminders block: a toggle ("Send me verses to recall") with a one-sentence summary and Change to
open the schedule fields; the rest sits under Advanced. A reminder is a short prompt for one verse, delivered as a
notification or, when notifications are unavailable, held in the app and shown on Today and as a stack to review.

### Progress

A tab with a "Progress" heading: day streak, verses learned, verses well learned, a five-week practice calendar,
recent level-ups and the next milestone. It has no close button.

### Memorize becomes Practice now

The Bible's "Memorize" verse action adds the verse (to the focused list, or the default list) and, on desktop,
shows a toast "Added {reference} to Memory" with a **Practice now** button that opens Memory and starts that verse.
On the web the app opens with the same offer on Today. The verse is added once; adding it again says it is already
in Memory.

## Where things are

| Layer | Where |
|---|---|
| Domain, store, scheduler, recite, reminders, `MemoryService` | `packages/memory/src/core/` (platform-free; talks to a `MemorySql` and a `MemoryHostApi`) |
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
database with no core. Users with reminders on get the core started shortly after launch so it keeps planning them.

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
- If Memory already had verses, the import is skipped and a notice points at the manual "Import data from the old
  Scripture Memory extension" in Memory's settings, which merges instead of overwriting.
- A merge matches lists by the id recorded at import (so a rename does not duplicate a list), then by name; a matched
  verse takes the old schedule when the old database was practiced more recently than anything here.
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
