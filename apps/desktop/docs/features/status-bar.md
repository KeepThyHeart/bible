# Status Bar

**Last verified:** 2026-09-23

A one-line strip along the bottom of the main window, filled entirely by extension-contributed items. It renders nothing at all when no extension has contributed one, so a user with no extensions sees exactly the chrome they saw before it existed.

Nothing in the app's own UI writes to it directly - the strip is 100% extension-contributed items, now including a built-in one: `api.tasks.run`'s progress (see [Background Tasks](#background-tasks) below). `ui:status-bar` has been a defined permission since the extension API shipped, and `packages/word-count-example` - the platform's only reference extension - exists for the sole purpose of writing to it.

## Files

### Renderer

| File | Description |
|---|---|
| `src/ui/components/StatusBar.tsx` | The whole surface. Splits items into a leading and a trailing slot by `alignment`, sorts each by `priority` descending (ties broken by key, so equal priorities are stable rather than dependent on activation order), and returns `null` when there are no items. An item without a `command` renders as a plain `<span>` readout - no hover affordance, no tab stop, no `role` - because it is a readout, not a control; one with a `command` renders as a `<button>` that dispatches through the command registry |
| `src/ui/App.tsx` | Mounts `<StatusBar />` as a sibling of the `<main>` element that holds `DockviewLayout`, so the strip sits below the whole workbench rather than inside a pane |
| `src/ui/extensions/extensionUiStore.ts` | Holds `statusBarItems` and the `addStatusBarItem` / `removeStatusBarItem` actions. Items are keyed `${extensionId}::${itemId}`, so a re-registration replaces rather than duplicates, and every item an extension owns is dropped when that extension deactivates |
| `src/ui/extensions/extensionRendererBridge.ts` | Turns the host's `statusBarItemRegistered` / `statusBarItemUnregistered` notifications into those store actions |
| `locales/en/ui.json` | `statusBar.label` - the `aria-label` on the strip. Item text comes from the extension's own catalog, not this one |

### Host

| File | Description |
|---|---|
| `electron/extensions/api-impl/uiApiImpl.ts` | `ui.registerStatusBarItem` - permission gate (`ui:status-bar`), descriptor validation, and the disposer the returned handle disposes. `ui.updateStatusBarItem(itemId, patch)` patches just the given fields of an already-registered item and reuses its handle, instead of the author re-registering the whole descriptor to change one field |
| `electron/extensions/bridges/RendererUiBridge.ts` | Keeps the registry of live items, keyed `${extensionId}::${item.id}` - re-registering (or updating) an id replaces the entry, it never stacks a second one - and pushes the register/unregister notifications at the renderer |
| `electron/extensions/bridges/RendererTaskStatusBridge.ts` | The `api.tasks.run` -> status bar path: one active task becomes one status bar item, id-namespaced `__task.<taskId>` so it can never collide with an id the extension itself registers |
| `packages/core/src/Extensions/ExtensionApiDtos.ts` | `StatusBarItemDescriptor`: `id`, `text`, optional `tooltip`, `command`, `alignment` and `priority` |
| `packages/core/src/Extensions/Permissions.ts` | `PERM_UI_STATUS_BAR` (`ui:status-bar`) |

### Reference extension

| File | Description |
|---|---|
| `packages/word-count-example/src/main.js` | Registers a status bar item, then updates it as the active verse changes. The item is the visible half of the example; the rest of it is there to have something to display |
| `apps/desktop/scripts/stage-extensions.js` | Stages that package into `data/extensions/` so it is present in `npm run dev` and can be bundled into an installer - see [Extensions](extensions.md) |

### Tests

| File | Description |
|---|---|
| `src/ui/extensions/contributedUi.test.tsx` | Empty-case rendering (nothing at all), leading/trailing placement, priority ordering, readout-versus-button behaviour, and command dispatch on click. Shares a file with the verse context menu because the two are the same gap - contributions the host already accepted, with nothing rendering them |

## How It Works

1. An extension holding `ui:status-bar` calls `api.ui.registerStatusBarItem({ id, text, ... })`.
2. `UiApiImpl` checks the grant, validates the descriptor, and hands it to `RendererUiBridge`, which stores it and notifies the renderer with `statusBarItemRegistered`.
3. `extensionRendererBridge` receives the notification and calls `addStatusBarItem` on `extensionUiStore`.
4. `StatusBar` re-renders. If this was the first item, the strip appears; if the last item goes away, it disappears again.
5. Clicking an item with a `command` calls `registry.execute(command)` - the same `ICommandRegistry` that serves the command palette, the keyboard and the Tools menu, so no new IPC path exists for this.

## Background Tasks

`api.tasks.run(descriptor)` has always documented "the host shows a progress entry in the status bar"; `RendererTaskStatusBridge` is what makes that true. It piggy-backs on this same surface rather than a second status-bar widget: `TasksApiImpl` fans out a snapshot of the extension's running tasks on every `reportProgress` call, and the bridge turns each one into a status bar item (`__task.<taskId>`, right-aligned, low priority so it does not routinely push an extension's own items aside), reading `descriptor.showInStatusBar` (default `true`) to decide whether a given task appears at all. A task's item is removed the moment it settles (completes/cancels/fails) or the extension deactivates.

## Design notes

**Empty means invisible, not empty.** The one real cost of a status bar is that it is a permanent strip in a shipping app's layout, and a strip that is blank most of the time is a tax on everyone to serve a few. `StatusBar` returns `null` when `statusBarItems` is empty, so the cost is paid only by users who installed something that uses it.

**An item's command failing is the extension's problem to report.** The click handler catches and logs; it does not toast, and it does not let the rejection escape as an unhandled promise rejection or take the strip down with it.

**No icons.** `StatusBarItemDescriptor` has no icon field, deliberately - the same reasoning as the verse context menu, where `icon` exists on the descriptor and is not rendered. An icon name chosen by an extension is either a vocabulary the app has to define or arbitrary extension-supplied markup in the app's own chrome, and neither is worth doing before something needs it.

**Not rendered in detached windows.** A popped-out pane is a single document surface, and a second copy of the app's global status would be noise. `DetachedWindow` mounts the pane component and nothing else; see [Pop-Out / Detach Pane](pop-out.md).

**Text is the extension's, localized by the extension.** `text` and `tooltip` are `LocalizedString`s resolved through `i18n.resolve`, which means the extension's own catalog answers for them. The app cannot know a phrase for something it did not ship, which is the same rule the Tools menu follows for command titles.

**Update in place, don't re-register.** `word-count-example` used to call `registerStatusBarItem` again on every active-verse change - the only way to change one field before `updateStatusBarItem` existed. That re-registered the whole descriptor (permission check, validation, a full IPC round trip) and minted a new disposal handle every time without ever dropping the previous one, so the handle table grew for the extension's whole session. `updateStatusBarItem(itemId, patch)` keeps every field the patch does not mention and reuses the same handle - re-registering (or updating) an id now always replaces its entry, never stacks a new one.
