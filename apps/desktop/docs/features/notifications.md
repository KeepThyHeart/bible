# Notifications (desktop)

The desktop side of the shared reminders engine (`packages/core/src/Reminders/`). The engine runs in the main process; the renderer only shows and edits its state.

## Preferences > Notifications

- The `notifications` feature module (task 0128, `src/ui/modules/notifications/`) contributes the section (id `notifications`, order 30; icon in `sectionDefs.tsx`) and the lazy `preferences:notifications` view `NotificationsSection.tsx`. `KTH_MODULES=-notifications` removes the section, the IPC and the click routing; the reminder engine in main still runs (extensions' `api.reminders`, the Bible Memory source).
- `NotificationsSection` loads `getState()` through the module client (`notificationsAPI.ts`), subscribes to the `state-changed` event (unsubscribed on unmount) and renders the shared `NotificationPreferences` component from `@bible/ui` with translated labels (`notifications.*` in `locales/*/notifications.json`; `{time}`, `{count}` and `{source}` placeholders are passed back verbatim so the component fills them in; the plural "N scheduled" comes from the ICU key `notifications.scheduledCount` via `formatScheduled`). Main-process strings have no ICU, so `main.notifications.collapsed` is phrased without a plural noun ("Reminders waiting: {count}").
- Settings edits update the view optimistically, then take the state main returns. The device section (tray, start at login) appears only because main reports `state.device`.
- "Allow notifications" calls `requestPermission` then refreshes; "Send a test notification" calls `sendTest`.

## Main process

`electron/notifications/ElectronReminderHost.ts` wires core's `ReminderScheduler` to Electron: OS `Notification`s (held until closed or clicked), `NotificationStateFile` (`notifications.json`), the settings store, `powerMonitor` (`resume`, `unlock-screen`) and a 60 s drift guard that re-arms the scheduler when the wall clock jumps relative to the monotonic clock or the time zone changes (in Electron's main process `Intl` may not reflect an OS zone change until restart). `main.ts` builds it before the window and `start()`s it in the background once the user DB is open; `setSettings` waits for that start. App sources: `votdSource.ts` (verse of the day, `app:votd`, off by default, 08:00 daily, KJV text when available). Extension sources `ext:<id>` come through the `remindersBridge` (see `extensions.md`) and only notify while the extension is installed, enabled and holds `notifications:schedule`. On Linux `&`, `<` and `>` are escaped in the title and body (some servers interpret markup). `whenClosed` is `fires` with the tray on, and always on macOS (the app keeps running after the window closes).

## IPC

Invoke channels (`electron/modules/notifications/index.ts`, a `FeatureMainModule`, `Result` envelope): `module:notifications:getState`, `setSettings`, `setDevice`, `sendTest`, `requestPermission`, `takeOpenTarget`. Events to the renderer, sent by the engine (`electron/notifications/channels.ts`): `module:notifications:event:state-changed`, `module:notifications:event:open-target`. The renderer uses `createModuleClient('notifications')`. The engine is published to the module with `setActiveReminderHost` (called by `main.ts`).

## Tray, login item, `--hidden`

Both are opt-in, off by default and stored per device in `notifications.json` (never in user data). "Start at login" is disabled in the UI while the tray is off. Windows and the Linux XDG autostart `.desktop` file launch with `--hidden`; `--hidden` is honoured only when the tray is on (otherwise a normal window opens). macOS login items cannot pass arguments (and `openAsHidden` is deprecated), so there `app.getLoginItemSettings().wasOpenedAtLogin` stands in. If a hidden launch ends with no active tray (tray failed, or the host failed to start) the window is shown. With the tray on, closing the window hides it; on Windows `session-end` and `before-quit` let the close through. A hidden start keeps the saved maximized state for when the window is first shown.

## Single instance

`app.requestSingleInstanceLock()` (per user-data directory, so E2E workers with their own `ELECTRON_USER_DATA` do not clash). A second launch quits at once and the running instance shows and focuses its window (`second-instance`), unless the second launch passed `--hidden`. The losing instance skips startup and the quit teardown. On macOS the dock icon always shows the window (it is hidden, not closed, in tray mode). Two schedulers would otherwise double-fire and share `notifications.json` and the user DB.

## Notification click routing

Main shows and focuses the window, then sends `open-target` with a `ReminderTarget`. The target is also kept as pending until the renderer calls `takeOpenTarget` (once, when the module's routing starts after `onStartupFinished`), so a click that lands while the page is loading is not lost; a renderer that is already loaded just gets the event, and the wait for `did-finish-load` times out. `src/ui/modules/notifications/openTarget.ts` (started by the module's `activate`) routes it; Preferences opens through the generic `open-preferences-section` window event that `App.tsx` listens for:

- `verse` -> `useBibleStore.getState().navigateToVerseInPrimary(verseId, endVerseId)`
- `route` `settings/notifications` -> opens Preferences at the Notifications section
- other targets (extension targets are handled in main) are ignored.

## Where state lives

`NotificationSettings` is a user-data item (`NotificationSettingsStore`, owner `app:notifications`), so it is backed up and restored with the rest of the user's data. `notifications.json` in the user data directory holds only the scheduler state (checkpoints, pending items, labels) and the per-device settings (tray, start at login). The renderer holds no copy beyond the last received `NotificationsViewState`.

## Tests

`electron/notifications/__tests__` (host: firing, click routing, take-open-target, escaping, allowed-extension gating, setSettings before start, power/guard re-arm, state file, login item), `electron/modules/notifications/mainModule.test.ts`, `electron/utils/__tests__/runOnce.test.ts` (IPC handlers register once), `NotificationsSection.test.tsx` (fake `window.electron.modules` bridge), `openTarget.test.ts`, `notificationsModule.test.ts`.

Startup order: the tray is created from `notifications.json` before the user DB opens, so a hidden launch is reachable early. Extension reminders are not vetoed until the extension registry has loaded (`extensionRegistryLoaded`); afterwards remembered `ext:` sources of uninstalled extensions are forgotten. A click target is sent to the renderer once (the pending copy is cleared when sent), and the renderer's hook takes any pending target exactly once on mount.
