# Apps (app host)

**Last verified:** 2026-10-07 (task 0080)

Desktop is a host of apps. **Study** (the dockview workbench) is the built-in app and always on screen at boot; extensions can add more (see "Extension apps"). With one app the window looks exactly as it did before: no rail, no apps row, no View > Apps menu. The shared model (descriptors, bindings, host state, nav selection, verse actions) is in [App Host](../../../../packages/core/docs/features/app-host.md); this doc is the desktop wiring.

## Files

All under `src/ui/apps/` unless noted.

| File | Role |
|---|---|
| `appHost.ts` | Singletons: `appRegistry`, `appHost`, binding controller, `verseActions`. `openApp(id, { source })`, `getAppView`, `getAppCompanion`, `useIsAppActive(id)`. No router: opening is `appHost.activate` |
| `builtinApps.ts` | `registerBuiltinApps()`: the Study descriptor (`keepAlive: 'always'`, `restore: 'reopen'`, order 0) and its binding (an eager static import with the same `load()` shape). Registers the dev fixture app when `localStorage['kth.devFixtureApp'] === '1'` in a dev build |
| `StudyView.tsx`, `useStudyLayoutBoot.ts` | Study's view (`DockviewLayout`) and the small store that hands it the saved layout |
| `DesktopAppStage.tsx` | `[AppRail?][stage]`, focus handling, live-region announcement |
| `appCommands.ts` | Generated `app.open.<id>` commands and `app.goToStudy` |
| `appSession.ts` | Session serializer, pending restore, `restoreActiveApp` |
| `extensionApps.ts` | Renderer registration of extension apps (descriptors, bindings, badges, open requests) |
| `ExtensionAppView.tsx` | The view of an extension app: host app bar plus the extension's iframe |
| `CompanionSlot.tsx` | Companion strips between the workbench and the status bar (renders only while Study is active; no built-in desktop app has one yet) |
| `verseActions.ts` | `installExtensionVerseActions()`: mirrors extension verse-menu rows into the registry |
| `publishActiveApp.ts` | Publishes the `studyActive` when-context key |
| `navEntries.tsx`, `navPrefs.ts`, `AppIconGlyph.tsx` | Registry + prefs through `selectNavItems`, label resolution, builtin icon names to lucide |
| `src/ui/styles/app-stage.css` | The stage grid and the hidden-app rule |

## The shell

`App.tsx` renders `<main>` as a flex row: `[AppRail][AppStage]`.

- The rail shows when `appSwitcher` is `rail`, or `auto` with more than one visible app (`shouldShowRail`). It is a conditional **sibling** that precedes the stage, and the stage has a stable key, so toggling the rail never reparents Study and dockview is never remounted (a remount would rebuild the layout and reload extension panel iframes).
- Inactive apps stay mounted. The shared `AppStage` marks them `hidden`, `inert` and `aria-hidden`; `app-stage.css` turns that into `visibility: hidden` inside a one-cell grid, **not** `display: none`. The box keeps its size, so dockview and the panes keep measuring, scroll positions survive, and Study is never laid out at zero width.
- **Reveal.** When Study becomes active again, `DockviewLayout` calls `api.layout(width, height, true)` on the next frame, inside `layoutPresetService.runInternal(...)` so the "current preset" checkmark is not cleared.
- **Study-only chrome.** `LayoutDropdown` renders only while Study is active, and `FindBar` only when it is visible *and* Study is active (it walks Study's DOM). Other commands that only make sense in Study can use the `studyActive` when-key.
- **Popups.** Body-level popups are not hidden with the stage. On leaving an app the stage hides the verse popup and fires the `app:will-hide` window event (`APP_WILL_HIDE_EVENT`), which context menus and menus listen to.
- Call sites that need Study (extension `bible.navigateToVerse`, notification open target, top-search verse results) call `openApp('study')` first.

## Surfaces

| Surface | Where | Shown when |
|---|---|---|
| Rail | `AppRail`, vertical, left (right in RTL) | see above |
| New Tab page | `AppTileGrid` row above the pane tiles in `NewTabPage.tsx` | more than one app |
| View > Apps | submenu in `src/ui/menu/buildMenuSpec.ts`, built from `deps.apps` | more than one app |
| Commands | `app.open.<id>` per visible app, category "Apps"; `app.goToStudy` | always |
| Shortcuts | Ctrl+Shift+1..9 (Cmd+Shift on macOS) open the nth app in the user's order, Ctrl/Cmd+Shift+0 opens Study | slots come from `selectNavItems` |

The commands are rebuilt whenever the registry, the nav prefs or the locale change, and disposed when an app unregisters. Preferences > Apps sets `appSwitcher`, `appOrder` and `appHidden`.

## Companion slot

`CompanionSlot` sits between `</main>` and `<StatusBar/>`. For each registry entry whose binding has a `companion` with `when: 'always'` or (`'busy'` and the app is busy), it loads the strip once (a module-level promise map, retried after a failure) and renders it. It renders only while Study is active.

## Session persistence

The active app and per-app routes ride in the session blob as `appHost` (`SessionData.appHost`, written by the `appHost` serializer in `appSession.ts`; a change marks the session dirty). Older sessions without the key need nothing.

The restore has a race to avoid: autosave can run after the session loads but before the saved app is shown, and extension apps register over IPC later still. So:

1. `AppInitService` hands the blob it read to `setPendingAppRestore(blob)`.
2. While a restore is pending, the serializer returns that blob instead of the live state, so an early save cannot overwrite the saved app with the boot-time Study.
3. `restoreActiveApp(persisted)` runs after the layout is decided. Study saved: clear. App registered: open it with `source: 'restore'`, then clear. Not registered yet: wait for it to appear in the registry, up to **30 s** (`RESTORE_WAIT_MS`), then open it. If the user opens any app first (their choice wins), give up and clear. On timeout, give up and clear **without** marking the session dirty, so a slow extension host never rewrites the saved app as Study.
4. Clearing (other than on timeout) marks the session dirty so the live state is saved.

## Extension apps

An extension adds an app with `contributes.apps` and the `ui:contribute-app` permission; the contract (manifest keys, `api.apps`, activation event, identity) is in [Extensions and Plugins](../../../../packages/core/docs/features/extensions-plugins.md#extension-apps-contributesapps). The desktop side:

| Piece | File |
|---|---|
| Main process: declared apps registered only when the extension is eligible and holds the grant; `api.apps` implementation | `electron/extensions/DeclaredContributions.ts`, `electron/extensions/api-impl/appsApiImpl.ts` |
| Renderer registration: descriptors into `appRegistry`, badges, open requests | `src/ui/apps/extensionApps.ts`, fed by `src/ui/extensions/extensionRendererBridge.ts` |
| The view | `src/ui/apps/ExtensionAppView.tsx` (iframe host: `src/ui/components/extensions/ExtensionPanelHost.tsx`) |
| Gesture gate | `electron/extensions/UserGestureTracker.ts` |

- **Descriptor.** Source `{ kind: 'extension', extensionId }`, `keepAlive: 'never'`, `restore: 'reopen'`, `platforms: ['desktop']`, order `100 + clamp(order, 0, 900)`, icon from `ext-ui://<extensionId>/<icon>` or the builtin `app` glyph. Unregistering removes the app, and the host falls back to Study if it was active.
- **Host app bar.** `ExtensionAppView` draws a 32 px bar that the extension cannot touch: icon, an `h1` title (focus target on first open), "by `<publisher>`", a Settings button (only when the extension has `contributes.configuration`; opens Preferences at the extension), and Close (back to Study). Because it is host UI, an extension cannot imitate it.
- **Iframe identity.** Below the bar is the extension's iframe, through the desktop `ExtensionPanelHost` in app mode (the `appShortId` prop, with `onReady` and `appTitle`). Its bridge identity is `panelId = panelTypeId = 'app:<id>'` with `appId = <id>`, set by the host, never by the iframe.
- **Lazy activation.** Opening calls IPC `extensions:getAppUiEntry(extensionId, shortId)`: unknown returns null; an inactive owner is activated (`onApp:<id>`, owner only); it returns the UI entry, title and granted permissions. Opening always activates the owner, whether or not the manifest lists `onApp:<id>`. An unavailable app shows a short message and "Back to Study".
- **Visibility.** The view reports shown once the `getAppUiEntry` lookup has resolved (that lookup activates a lazily activated owner, so the worker is listening by then) and hidden on unmount, through `extensions:appVisibility`; the owner receives `app.visibilityChanged` (`api.apps.onVisibilityChanged`). With `keepAlive: 'never'`, mounted means shown.
- **Badges.** `api.apps.setBadge` is validated in main, forwarded to the renderer and normalised again by `AppRegistry.setBadge`. Main keeps the last badge per app and re-sends it after every `appRegistered` (renderer reload, re-registration). A dead worker's badges are cleared on dispose.
- **`apps.open` gesture rule.** `api.apps.open(appId)` opens the extension's own app only if that extension had a **user gesture in the last 5 s**; otherwise it logs one line to the extension log and resolves `false`. Grants come only from host-side facts: (1) `extensions:panelInvoke` with `userGesture` set by the renderer when `navigator.userActivation.isActive` and focus is in that extension's iframe; (2) `ext-bridge:command:invoke` with `userGesture` set by the renderer from `navigator.userActivation.isActive` only for a **user-started** run (palette, keybinding, menu, status-bar click, New Tab tile); this path has no iframe-focus check, but a run started by code never counts: a worker's `api.commands.execute(...)` reaches the renderer with `programmatic: true` (`CommandRegistry.execute(id, args, { programmatic: true })` into `CommandContext.programmatic`) and sends `userGesture: false`. A declared command whose owner must first activate is granted again once activation completes. (3) a notification action click, granting that extension. Nothing an iframe or a worker says counts. The window is about 5 s from the gesture reaching the host; an iframe that keeps calling `panel.invoke` while activation is live can extend it to about 10 s.
- **Icons.** `index.html` allows `img-src ... ext-ui:`, so the icon loads from the extension's own origin through `<img>` only (never inline SVG).

See also [Extensions](extensions.md#extension-apps).

## Accessibility

| Item | Behaviour |
|---|---|
| Landmark | The rail is a `nav` labelled by `apps.rail.label` ("Apps") |
| Current app | `aria-current="page"` on the active rail item |
| Keyboard | Roving tabindex in the rail (arrows move focus, Enter/Space activate) |
| Focus per app | The stage remembers the last focused element of each app (`data-app` wrapper) and restores it on return |
| First open | The app's `h1[tabindex="-1"]` gets focus; for Study with no remembered element, the active dockview panel |
| Announcement | A polite live region (`apps.stage.announce`) says which app opened; the boot activation never steals focus or announces |
| Inactive apps | `inert` + `aria-hidden`, so they are out of the tab order and the accessibility tree |

## Tests

`appHost.test.ts`, `DesktopAppStage.test.tsx` (the Study node is the same before and after the rail appears), `appCommands.test.ts`, `appSession.test.ts`, `verseActions.test.ts`, `CompanionSlot.test.tsx`, `extensionApps.test.ts`, `ExtensionAppView.test.tsx`, `src/ui/extensions/extensionRendererBridge.gesture.test.ts`, `electron/extensions/__tests__/` (`AppsApi.test.ts`, `AppsBridges.test.ts`, `UserGestureTracker.test.ts`), and `src/ui/components/DockviewLayout.reveal.test.tsx` (layout runs once on reveal, never while hidden).
