# Notifications and reminders

`src/Reminders/` is the one reminder engine every feature uses: verse of the day, reading plans (task 0073),
prayer reminders, and extensions such as the memory push cards (task 0072). It holds the schedule model and its
time-zone-safe expansion, the missed-reminder policy, the settings document and the scheduler. It is pure
TypeScript, exported flat from `@bible/core/browser` and as the `Reminders` namespace from `@bible/core`; each app
supplies the platform parts (timer, notification display, persistence) through small ports.

## Files

| File | Purpose |
|---|---|
| `src/Reminders/types.ts` | `ReminderSlot` (`fixed`, `window`, `date`), `ReminderPlan`, `QuietHours`, `FireTime`, `ReminderItem`, `NotificationContent`, `ReminderTarget`, `ReminderCapabilities`, `MissedPolicy`, `REMINDER_LIMITS`. |
| `src/Reminders/time.ts` | Wall clock and instants through `Intl.DateTimeFormat` with an explicit zone: `wallToInstant`, `zonedParts`, `zoneOffset`, civil-date helpers, `systemTimeZone`. |
| `src/Reminders/plan.ts` | `expandPlan`, `nextFireAt`, `firesBetween`, quiet-hours helpers (`isInQuietHours`, `endOfQuietHours`), `spreadInWindow`. |
| `src/Reminders/reconcile.ts` | `reconcileMissed`: on time / collapse / drop / future. |
| `src/Reminders/settings.ts` | `NotificationSettings`, `normalizeNotificationSettings`, `NotificationSettingsStore` over `IUserDataRepository`. |
| `src/Reminders/ReminderScheduler.ts` | The engine: sources, pending items, one timer, missed collapse, clicks. |
| `src/Reminders/ports.ts` | `createTimeoutTimer`, `createMemoryStatePort`, `createStringStatePort`, the `ReminderPlatform` contract. |
| `src/Reminders/view.ts` | `NotificationsViewState` (what a settings page shows) and the desktop-only `NotificationDeviceSettings`. |
| `src/Reminders/__tests__/` | Rule math (DST, quiet hours, caps, windows), reconciliation, settings and scheduler tests. |

## The schedule model

A `ReminderPlan` is a list of slots, optional plan-level quiet hours and an optional daily cap:

```ts
{ slots: [
    { id: 'morning', kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },          // daily
    { id: 'sunday', kind: 'fixed', time: '18:30', days: [0] },                             // weekly
    { id: 'spread', kind: 'window', start: '09:00', end: '17:00', count: 3, days: [1, 2, 3, 4, 5] },
    { id: 'once', kind: 'date', date: '2026-12-24', time: '19:00' },                       // one-off
  ],
  quiet: { start: '21:30', end: '07:00' },  // fires inside are dropped
  maxPerDay: 3 }
```

Times are local wall-clock times in the engine's zone (the platform's, re-read on every wake, so travelling or a
zone change is picked up). Days are `0` (Sunday) to `6`.

`expandPlan(plan, from, horizonMs, timeZone, { seed })` resolves each local day whole, then filters to the query
window, so the result never depends on where the window starts:

1. each slot that applies to the day becomes an instant;
2. fires inside the plan's quiet hours are dropped;
3. fires at the same instant merge (first slot wins);
4. the earliest `maxPerDay` are kept;
5. only fires in `[from, from + horizonMs)` are returned.

**DST.** A wall time skipped by a spring-forward change fires at the first valid minute after the gap (02:30 on
the night clocks jump from 02:00 to 03:00 fires at 03:00). A wall time that happens twice when clocks go back fires
at the first occurrence. Times outside the change keep their wall-clock time, so a daily 07:00 stays at 07:00.
`wallToInstant` finds candidate offsets a day either side of the wall time and binary-searches the transition for
gaps; it works for 30-minute shifts (Lord Howe) and gaps at midnight (Santiago).

**Windows** place `count` fires between `start` and `end` (wrapping midnight when `end` is earlier), at least
`minGapMinutes` (default 45) apart, uniformly among valid spreads. The random draw is seeded by the plan seed (the
scheduler uses the source id), the slot id and the date, so recomputing never moves a time already announced.
A window too short for `count` gives fewer fires.

**Quiet hours** are `[start, end)`; `end` before `start` wraps past midnight; `start === end` means none. Plan-level
quiet hours drop fires. The user's global quiet hours (settings) hold them instead: the engine does nothing during
quiet hours and shows what came due, collapsed, when they end.

## Sources

| Kind | Who | Content | Persisted |
|---|---|---|---|
| `RuleSource` (`kind: 'rules'`) | App features (`app:verse-of-the-day`, `app:reading-plan`, ...) | `render(ctx)` at fire time; `null` skips a fire (today's reading already done) | Only a per-source checkpoint |
| `ItemSource` (`kind: 'items'`) | Extensions (`ext:<extensionId>`) through `api.reminders.replaceAll` | Bound when scheduled (`ReminderItem`) | The pending set, so it fires without the extension running |

A rule source gives `plan()` (or `null`); the user's plan in settings replaces it unless the source sets
`userEditable: false`. A reading-plan source would give one fixed slot per active plan with a reminder time. App
sources are opt-in (`defaultEnabled` defaults to false); extension sources are on by default, since the extension
was granted `notifications:schedule` at install and has its own switch.

Item sources are sanitized by `sanitizeReminderItems`: unique keys, finite times, title 120 and body 500
characters, `data` at most 1 KB of JSON, nothing older than a day, at most 64 per source (earliest kept).

## The scheduler

```ts
const scheduler = new ReminderScheduler({
  timer: createTimeoutTimer(),
  presenter: { show: (n) => showOsNotification(n) },   // keep n.id for the click
  state: myStatePort,                                   // checkpoints + item sources' pending sets
  settings: () => settingsStore.get(),
  strings: { collapsed: (label, count) => ({ title: label, body: t('n waiting', { count }) }) },
  onChange: () => pushStateToSettingsPage(),
});
scheduler.registerSource(verseOfTheDaySource);
await scheduler.start();
// on click:     const a = scheduler.activate(n.id); route(a?.target)
// on resume:    scheduler.wake()
// on change:    scheduler.refresh()
```

Every `wake()` (timer, resume from sleep, clock or zone change, settings change, an hourly guard) does the same:

- For each rule source, the fires in `(checkpoint, now]` (never further back than the collapse window); for each
  item source, its items in `(checkpoint, now]`. `replaceItems` also drops items at or before the checkpoint, so an
  extension that re-sends its whole list after a reminder fired does not fire it again, and a list replaced before
  `start()` is kept. More than three items of one source due at the same wake are collapsed too.
- An item source can be vetoed with `isItemSourceAllowed(id)` (desktop: the extension is installed, enabled and
  still holds `notifications:schedule`); a vetoed source consumes its items silently.
- `reconcileMissed` sorts them: late by at most `lateToleranceMs` (5 minutes) is on time and shown as is; late by at
  most `collapseWithinMs` (12 hours) is collapsed into **one** notification per source (a rule source renders its
  latest fire with `missed: true` and `count`; an item source uses `collapse()` or `strings.collapsed`); older is
  dropped. `onMissed` tells an item source which keys were collapsed or dropped. Never a backlog.
- A disabled source, or the master switch off, consumes its fires silently, so switching it on later does not replay them.
- The checkpoint moves to `now`, state is saved, and the one timer is armed for the next fire (at most `guardMs`,
  default one hour, ahead; the end of quiet hours while they last).

The engine never trusts its timer: the checkpoint makes a late, early or repeated wake harmless, and a clock that
jumped more than a day backwards resets the checkpoint so reminders are not muted until the old date returns.

## Settings and backup

`NotificationSettings` is one JSON `user_data_item` (owner `app:notifications`, collection `settings`, key
`preferences`): the master switch, global quiet hours and per-source `{ enabled?, plan? }`. `user_data_item` is
classified `content` in the backup registry (newer `modified_date` wins in a merge), so these preferences are backed
up and will sync with the user's data; no new table is needed. Read through `normalizeNotificationSettings`, which
never throws and drops anything malformed.

Device switches (desktop tray and start at login, `NotificationDeviceSettings`) and the scheduler state (checkpoints,
pending sets) are deliberately **not** user data: they describe one machine, and a backup restored elsewhere must not
turn on autostart. The desktop app keeps them in a JSON file in its user-data folder.

## Platforms

| | Desktop (Electron main) | Web (tier 1) |
|---|---|---|
| Display | `Notification`, click focuses the window and routes the target | Notifications API (`new Notification`) while a tab is open |
| State | `notifications.json` in the app's user-data folder | `localStorage` |
| Settings | `NotificationSettingsStore` over the user database | `localStorage` (a UI preference: the web app keeps no personal content in the browser until accounts exist) |
| Wakes | timer, `powerMonitor` resume/unlock, a 60 s drift and zone check | timer, `visibilitychange`, `online`/focus |
| When closed | opt-in tray keeps firing; opt-in start at login (`--hidden`) | nothing (push and service-worker delivery are later work, task 0085) |
| Extensions | `api.reminders` (permission `notifications:schedule`, activation event `onReminder`) | no extension host yet |

`ReminderCapabilities` tells a settings page (and `api.reminders.capabilities()`) what will happen:
`permission` (`granted` / `denied` / `prompt` / `unsupported`), `whenClosed` (`fires` / `background-only` / `never`)
and `actions` (notification buttons are not relied on anywhere).

## Adding a source (checklist)

1. Pick a stable id: `app:<feature>` (lowercase, hyphenated, kept forever: it keys the user's settings).
2. Implement `RuleSource`: `label`/`description` already localized, `plan()`, `render(ctx)` returning plain text and a
   `target` (`verse`, or a `route` the app knows), `defaultEnabled` (keep it off unless the user asked).
3. Register it with the app's scheduler at startup, before `start()`, and call `scheduler.refresh()` when its plan
   changes (a reading plan's reminder time was edited).
4. Do not put personal content on the lock screen without an option to hide it.

## Gotchas

- Content of rule sources is rendered at fire time; content of item sources is fixed when scheduled. An extension
  should call `replaceAll` again after any change, and check the item again on activation (it may be stale).
- On a click, an extension gets `{ key, keys, data, firedAt }`: `firedAt` is when the reminder was due, and for a
  collapsed notification `key` is `keys[0]` and `data` is absent.
- `activate(id)` works for the last 100 notifications of the current run only; after a restart an old OS
  notification just focuses the app.
- `expandPlan` walks at most 400 days; `nextFireAt` looks 8 days ahead by default, enough for weekly plans. Use a
  longer `lookaheadMs` for sparse `date` slots.
- Window slots need the seed to stay the same: the scheduler uses the source id.
