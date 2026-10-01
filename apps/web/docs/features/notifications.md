# Notifications (web, tier 1)

Reminders while the app is open in a browser tab, built on the shared engine in `packages/core/src/Reminders/` (see `packages/core/docs/features/notifications.md`). Tier 1 only: no push, no service-worker delivery (task 0085). Nothing is shown when the app is closed.

## Files

| File | Purpose |
|---|---|
| `src/notifications/webReminders.ts` | The host: core `ReminderScheduler` with `createTimeoutTimer()`, a presenter over the Notifications API, a `NotificationsViewState` store (`store.subscribe` / `getSnapshot`), wake listeners. `getWebReminders()` is the singleton, `startWebReminders()` the boot hook, `webCapabilities()` the capability check. |
| `src/notifications/votdSource.ts` | Rule source `app:verse-of-the-day`: off by default, 08:00 daily, time editable; "Book C:V — text" (plain text, about 180 characters), target `{kind:'verse'}`, tag `votd`. |
| `src/notifications/notificationSettings.ts` | `NotificationSettings` in `localStorage` key `bible-notifications` (normalized with core `normalizeNotificationSettings`). |
| `src/notifications/NotificationsSettingsTab.tsx` | Settings > Notifications tab (see [Settings](settings.md)). |
| `src/main.tsx` | Starts the host after the stores are ready, through a lazy `import()`, only when `'Notification' in window`. |
| `src/locales/*/ui.json` | `notifications.*` strings and `settings.tabs.notifications`. |

## Behavior

- **Capability.** `unsupported` when there is no `Notification` API or the context is not secure (iOS Safari outside an installed app has none); otherwise `Notification.permission` mapped (`default` is `prompt`). `whenClosed` is `background-only` (a background tab works, a closed one does not), `actions` false.
- **Permission** is requested only from the "Allow notifications" button. Nothing is shown unless it is `granted`.
- **Presenting.** `new Notification(title, {body, tag})`; if the constructor throws (Android Chrome), `registration.showNotification` through an active service-worker registration is used instead. Those notifications do not route clicks (the service worker is not touched here). A click focuses the window, calls `scheduler.activate(id)`, opens a `verse` target in the reader (`bibleStore.navigateTo`) and closes the notification.
- **Wakes.** The scheduler's own timer, `visibilitychange` (visible), `focus`, `online`, and a `storage` event for the settings key from another tab.
- **Storage.** Settings (`bible-notifications`) are a UI preference. Scheduler checkpoints use core `createStringStatePort(localStorage, 'bible-notifications-state')`. The web app keeps no personal content in the browser; neither holds any. All access is wrapped in try/catch.
- **Verse of the day** is fetched fresh at each fire from the data provider (the bible store's copy is cached for the session and would be stale after midnight).

## Tests

`src/notifications/*.test.ts(x)`: capability mapping, presenter and click, settings round trip and corrupt fallback, the VOTD source, the tab (permission button, toggle persists, unsupported), and `localeKeys.test.ts` for the `notifications.*` keys.
