# Notifications (desktop)

The desktop side of the shared reminders engine (`packages/core/src/Reminders/`). The engine runs in the main process; the renderer only shows and edits its state.

## Preferences > Notifications

- Section id `notifications` in `src/ui/components/PreferencesDialog/sectionDefs.tsx`; body is `PreferencesDialog/NotificationsSection.tsx`.
- `NotificationsSection` loads `window.electron.notifications.getState()`, subscribes to `onStateChanged` (unsubscribed on unmount) and renders the shared `NotificationPreferences` component from `@bible/ui` with translated labels (`notifications.*` in `locales/*/ui.json`; `{time}` and `{count}` placeholders are passed back verbatim so the component fills them in).
- Settings edits update the view optimistically, then take the state main returns. The device section (tray, start at login) appears only because main reports `state.device`.
- "Allow notifications" calls `requestPermission` then refreshes; "Send a test notification" calls `sendTest`.

## Tray and login item

Both are opt-in, off by default and stored per device (never in user data). Launching at login passes `--hidden` (start in the tray with no window). On Linux the login item is an XDG autostart `.desktop` file.

## Notification click routing

Main shows and focuses the window, then sends `notifications:open-target` with a `ReminderTarget`. `src/ui/hooks/useNotificationOpenTarget.ts` (used by `App.tsx`) routes it:

- `verse` -> `useBibleStore.getState().navigateToVerseInPrimary(verseId, endVerseId)`
- `route` `settings/notifications` -> opens Preferences at the Notifications section
- other targets (extension targets are handled in main) are ignored.

## Where state lives

Notification settings (`NotificationSettings`) are stored in `notifications.json` in the user data directory by the main process; the engine's pending schedule is persisted separately. Device settings are per device. The renderer holds no copy beyond the last received `NotificationsViewState`.

## Tests

`NotificationsSection.test.tsx` (fake `window.electron.notifications`), `useNotificationOpenTarget.test.ts`; `vitest.setup.ts` stubs `window.electron.notifications`.
