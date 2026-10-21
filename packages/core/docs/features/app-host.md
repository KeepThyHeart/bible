# App Host

**Last verified:** 2026-10-07 (task 0080)

The app host is the platform-free part of the shell: which "apps" exist (Study, Presenter, extension apps), which one is on screen, and what the switcher, menus and verse context menu show. Core owns the data, state and selection rules; web and desktop own the surfaces and the lazy code. Everything is exported flat from `@bible/core/browser`.

## Files

| File | Role |
|---|---|
| `src/Apps/AppDescriptor.ts` | `AppDescriptor` (data), `AppIcon`, `AppLifecycle` (`keepAlive`, `restore`), `AppBadge` + `normalizeBadge`, `STUDY_APP_ID`, `appLinkSegment` |
| `src/Apps/AppRegistry.ts` | `AppRegistry`: the `apps` contribution point plus `setBadge` / `setBusy`; `registry.state` is the store surfaces read |
| `src/Apps/AppHostState.ts` | `createAppHostState`: async activation, mounted set, eviction, back stack, `serialize` / `restore` |
| `src/Apps/AppBinding.ts` | `AppBinding<View>` (code) and `createAppBindingController`: loads a binding on `onWillActivate`, prefetch, companions |
| `src/Apps/AppLink.ts` | `parseAppLink`, `formatAppLink`, `isAppHash` |
| `src/Apps/NavItems.ts`, `NavSettings.ts` | `selectNavItems`, `hasMultipleApps`, nav prefs, the three `shell.appSwitcher` settings |
| `src/Apps/VerseActions.ts`, `VerseActionRegistry.ts` | The `verseActions` contribution point and `selectVerseActions` |
| `src/Modules/*` | `ContributionRegistry` (base of every point) and the feature-module host (`FeatureModuleHost.ts`, `FeatureModule.ts`) |
| `packages/ui/src/components/apps/` | Shared surfaces: `AppRail`, `AppStage`, `AppSheet`, `AppSwitchButton`, `AppTileGrid`, `AppBadge`, `AppsPreferences` |

Per-platform wiring: `apps/web/src/host/` (see [Web navigation](../../../../apps/web/docs/features/navigation-layout.md)) and `apps/desktop/src/ui/apps/` (see [Desktop apps](../../../../apps/desktop/docs/features/apps.md)).

## What an app is

| Piece | What it is | Where |
|---|---|---|
| `AppDescriptor` | **Data**, small, registered at boot: `id`, `title` (`LabelRef`), `icon`, `order`, `when`, `platforms`, `lifecycle`, `deepLink`, `mobile` | Core, same on both platforms |
| `AppBinding<View>` | **Code**: `load()` returns `{ View, activate?, deactivate? }`; optional `companion` | Each platform, imported lazily |

`LabelRef` is `{ key, fallback }` (built-in, translated by the surface) or `{ extensionId, text }` (extension). `AppIcon` is `{ kind: 'builtin', name }` (the platform maps the name: Font Awesome on web, lucide on desktop) or `{ kind: 'image', src }` (extensions, always drawn through `<img>`).

`lifecycle`:

| Field | Values | Meaning |
|---|---|---|
| `keepAlive` | `always` | Stays mounted (hidden + inert) for the session. Study |
| | `while-busy` | Stays mounted while `registry.setBusy(id, true)`; unmounted after `idleGraceMs` (60 s) once hidden and idle. Presenter |
| | `never` | Unmounted as soon as another app commits. Extension apps |
| `restore` | `reopen` / `while-busy` / `default` | Whether a restart reopens the app: always, only if busy at boot, or never (Study opens) |

`binding.activate(ctx)` runs on each mount (first, and after an eviction), so it must be idempotent; `deactivate()` runs on unmount.

## AppRegistry

`ContributionRegistry<AppDescriptor>` with unique ids. Order is clamped into the source's band: built-ins 0-99, extensions 100-1000. An extension app id must start with its extension id. `disposeBySource` removes everything one source added.

| Method | Notes |
|---|---|
| `setBadge(id, badge \| undefined)` | `normalizeBadge`: count capped at `99+` (0 shows nothing), text at 4 characters, label required and cut at 80. Unknown id ignored |
| `setBusy(id, busy)` | Keeps a `while-busy` app mounted; drives `companion.when: 'busy'` |
| `state` | `{ apps: [{ item, badge, busy, order, source }] }`, sorted by order then id |

Badge tones: `neutral`, `live`, `attention`.

## AppHostState

`createAppHostState({ registry, defaultAppId = 'study', isAvailable, idleGraceMs, maxHistory = 20 })`.

- **Nothing is mounted at construction.** `mounted` fills on the first committed activation, so a cold boot at `#/@present` mounts the Presenter only.
- **`activate(id, { route, source })` is async.** It awaits every `onWillActivate` listener (the binding controller loads the chunk and runs `activate(ctx)` there), then commits. Results: `activated`, `already`, `superseded`, `unavailable`, `failed` (a throwing listener leaves state unchanged).
- **Latest request wins.** Every call takes a ticket; a stale one resolves `superseded`. Asking for the active app cancels a pending switch.
- **Eviction** follows `keepAlive`. An app removed from the registry, or unavailable after `revalidate()`, unmounts at once; if it was active the host activates `defaultAppId`. Call `revalidate()` when the `when` context changes.
- **Back stack.** `back()` pops the host's own stack, else activates the default app. Browser history is the web router's job.
- **Persistence.** `serialize()` returns `{ v: 1, activeId, routes }`. `restore(persisted)` ignores garbage, loads routes and returns the app to open under the active app's `restore` policy. It does not activate; the shell decides between a link, a restore and the default.
- `snapshot`: `activeId`, `pendingId` (shown as "opening"), `mounted`, `routes`, `canGoBack`. `onDidMount` / `onDidUnmount` are the other hooks.

## Deep links

`AppLink.ts`: web `#/@id[/route]`, desktop `app:id[/route]` (no OS protocol is registered). The segment is the descriptor's `deepLink.segment`, else its id. The route is opaque to the host; each route segment is percent-encoded. Study's own reader hash (`#/KJV/43/3`) has no `@` and is not an app link. `isAppHash` is true for any `#/@...` hash, parseable or not.

## Navigation selection and prefs

`selectNavItems(apps, { platform, prefs, evalWhen, surface })` is the only thing surfaces read. It drops apps for another platform, a false `when`, apps the user hid (Study cannot be hidden), and, for the `sheet` surface, apps with `mobile: 'hidden'`. Then it applies the user's order and gives the first nine items `shortcutSlot` 1-9.

Declared once in `APP_NAV_SETTINGS` (group `apps`) and merged into the web and desktop settings registries. Desktop also keeps them in `usePreferencesStore`.

| Setting | Scope | Values |
|---|---|---|
| `appSwitcher` | device | `auto` (rail only when more than one app is available), `rail`, `none` |
| `appOrder` | device | app ids |
| `appHidden` | device | app ids |

`shouldShowRail(mode, count)` and `hasMultipleApps(items)` are the two checks: with one available app nothing changes anywhere (no rail, no tiles, no menu). The order and hide lists are edited in Preferences > Apps (`AppsPreferences`), not as plain text.

## Verse actions

`VerseActionRegistry` is the `verseActions` point behind the verse context menu. Contributions are data loaded at boot (`id`, `title`, `icon`, `appId`, `when`, `order`, `group`), so the menu can be drawn without code.

- `bindHandler({ id, load })` attaches the lazy handler; a second binding for the same id throws.
- `run(id, ctx)` fires `onVerseAction:<id>` (when the registry was given an `activate` option), loads the handler once across concurrent calls, retries after a failed load, and rejects for an unknown id or a missing handler. `ctx` is `{ verseId, verseIds, module, surface }`.
- `selectVerseActions(entries, { evalWhen })` applies `when` (which must be cheap and synchronous: it runs per menu open) and returns items by clamped order, then **id**.
- **Extension adapter (desktop).** `registerContextMenu('verse')` rows are mirrored into the registry with `order = 100 + clamp(order, 0, 900)`. Ties sort by id, not by registration order. Rows with a `when` are skipped, as before.

## Companion strips

`AppBinding.companion = { when: 'busy' | 'always', load() }` is a slim strip an app shows inside Study (the Presenter's `PresentBar`). Its code loads only while the condition holds. Each platform has one small `CompanionSlot` that reads `registry.state` and `controller.getCompanion(id)`.

## Feature modules

A feature module is a product feature described like an extension: a data-only `FeatureModuleManifest` loaded at boot plus a lazy `FeatureModuleBinding` per platform. `createFeatureModuleHost` does `add`, `reconcile` (enable or disable and register contributions, no code), `fire(event)` (lazy activation) and `dispatch(hook, payload)`. Code loads only on an activation event (`onApp:`, `onCommand:`, `onVerseAction:`, `onPanel:`, `onSetting:`, or an explicit `onStartupFinished`); there is no eager default. Wired contribution points: `apps` and `verseActions`. Off switch order: platform, dev override (`kth.modules`, dev builds only), feature flag, `requires`.

The host is part of core and tested, but today both apps register Study and the Presenter directly (`registerBuiltinApps()`), without going through it; extension apps use the extension host instead.

Scripture memory ([Memory](memory.md)) is a worked example of a desktop-only module with an app, a verse action (with an icon: the desktop verse menu draws a contribution's `icon` through `AppIconGlyph`; extension rows carry none), a badge, and activation pieces that follow the module on and off at runtime.

## Adding a built-in app

1. Write the `AppDescriptor` (id, `title` key + fallback, icon, `order` 0-99, `lifecycle`; `platforms` if it is not on both).
2. Write the `AppBinding` with a **dynamic** `import()` in `load()`. A static import from host code pulls the app into the entry chunk.
3. Register both in `registerBuiltinApps()`:
   - web: `apps/web/src/host/builtinApps.ts`; put the app's code under `apps/web/src/apps/<id>/` (the entry-chunk check forbids static imports of `src/apps/**`);
   - desktop: `apps/desktop/src/ui/apps/builtinApps.ts`.
4. Add the title key (and any badge or announcement strings) to every locale catalog.
5. Give the app an `h1` with `tabIndex={-1}` (the stage focuses it on first open) and, on web phones, either its own top bar with `AppSwitchSlot` and a way back, or nothing, in which case the shell's `AppTopBar` draws "Back to Study" (`apps/web/src/host/appChrome.ts` lists the apps with their own chrome).
6. If it has a live state, call `appRegistry.setBusy` and `setBadge`; add a `companion` if Study should show a strip.
7. Tests: the descriptor registers, the chunk is not loaded until activation, and the entry-chunk check still passes (web).

## Extension apps

Extensions add apps through `contributes.apps` and `api.apps` (permission `ui:contribute-app`, API 0.2.1). The contract is in [Extensions and Plugins](extensions-plugins.md#extension-apps-contributesapps); this doc does not repeat it. In the host they are ordinary registry entries with source `{ kind: 'extension', extensionId }`, `keepAlive: 'never'`, `restore: 'reopen'`, order `100 + clamp(order, 0, 900)`, and a binding whose view is the extension's sandboxed iframe. Desktop only for now; web waits for web extension hosting. See [Desktop apps](../../../../apps/desktop/docs/features/apps.md#extension-apps).

## What a navigation-surface change still needs

The registry makes the switcher data-driven, but these are placed by hand and need a decision when the app set or the surfaces change:

| Item | Why |
|---|---|
| Layout width | The rail takes width from the stage; check the narrowest supported window |
| Badge placement | `AppBadge` sits on rail, tile, menu and phone-button; a new surface must place it and keep the `label` as accessible text |
| Live indicator | The Presenter's live dot is a badge set from its busy sink; another "live" app needs its own `setBadge` |
| Guided-tour anchors | The tour spotlights DOM anchors; moving or hiding chrome can orphan a step (desktop `tourSteps.ts`) |
| Landmark copy | The rail is a `nav` landmark labelled `apps.rail.label`; new surfaces need a unique label |
| Phone bottom nav | The web phone layout has its own bottom nav; apps reach the phone through `AppSheet`, not through it |

## Related

- [Extensions and Plugins](extensions-plugins.md), [Extension API namespaces](extension-api-namespaces.md)
- [Settings registry](settings-registry.md)
