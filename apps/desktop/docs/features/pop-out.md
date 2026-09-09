# Pop-Out / Detach Pane

**Last verified:** 2026-09-09

Pop out any dockview pane into a standalone window. The detached window preserves the pane's current state (open tabs, loaded content, navigation position).

## Files

### Trigger & State Gathering

| File | Description |
|---|---|
| `src/ui/components/DockviewTabRenderer.tsx` | Right-click context menu with "Pop Out to Window". Gathers per-pane state from stores and dispatches `window:detach-pane` IPC. When the panel has a `contentKey` (a single-module commentary/book/dictionary panel), it hands off to `popOutModule.ts` instead of reading the store - see "Single-Module Pop-Out" below. `POP_OUT_PANE_TYPE` maps each `PanelContentType` to its window type (`dictionary` -> `'book'`); a content type absent from it cannot be popped out and the menu leaves the item off. Extension panels do not go through that record at all - `popOutPaneTypeFor()` and `parseExtensionContentType()` handle the `ext:` prefix, see "Extension Panel Pop-Out" below. |
| `src/ui/utils/popOutModule.ts` | Shared helper for popping **one module** into a window. `currentPrimaryVerseId()` reads the first Bible panel's selected verse (falling back to the first verse of the loaded chapter); `popOutModuleToWindow({ type, abbreviation, name, verseId })` builds the pane-specific payload and awaits `detachPane`, resolving `false` when the detach failed or the bridge is missing. |
| `src/ui/components/CommentaryPane.tsx` | Commentary tab right-click -> "Pop Out to Window" (`handlePopOutTab`). Calls `popOutModuleToWindow` with the pane's `currentVerseId`, and only calls `closeCommentary` once the detach resolved true. |
| `src/ui/components/BookPane.tsx` | Books/Dictionary tab right-click -> "Pop Out to Window", plus the pane menu's "Pop {name} out to its own window" (`bookPane.popOutTabToWindow`). Both go through `handlePopOutTab`, which passes `type: 'book' \| 'dictionary'` and only closes the tab on success. |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesNavigation.ts` | Second pop-out trigger, specific to notes: the pop-out button at the far end of the breadcrumb header (`UserNotesEditorView.tsx`). `handlePopOut` detaches with pane type `'verse-notes'` and `{ initialView, initialCurrentPath, initialCurrentNotePath }` - the same pane type and payload shape `DockviewTabRenderer`'s context-menu path uses for `contentType === 'notes'` (that path also carries `initialSideTab`). On success it dispatches `notes-pane-popped-out` itself (see "Notes Pane Specifics" below); on failure it surfaces the error via `setFileError` instead of failing silently. |

### Main Process

| File | Description |
|---|---|
| `electron/services/WindowManager.ts` | Creates `BrowserWindow` for detached pane, sends `initialize-pane` IPC with component name + state. Manages detached window lifecycle, link toggle, and verse-change broadcasts. Suppresses `page-title-updated` so the computed title survives. **Sets no `webPreferences.partition`, deliberately** - see "Extension Panel Pop-Out" below. |
| `electron/config/paneConfig.ts` | Maps pane types to component names, default dimensions, title format functions. Defines the `PaneType` union: `bible \| commentary \| book \| verse-notes \| prayer \| study \| topics \| extension`. The `extension` entry is one config for every extension panel (900x700, `ExtensionPanelHost`); its `titleFormat` reads the contributed `panelTitle` from the payload and falls back to `main.window.extensionFallback` rather than showing a raw extension id if a saved layout outlives the extension. Every `titleFormat` names the window from what the payload actually carries: `book` reads `paneKind` (so a dictionary window is titled "Dictionary - ...") and the active tab, `commentary` the active tab, `verse-notes` the note file's basename. `getPaneConfig` and `isValidPaneType` are the accessors the main process uses. |
| `electron/ipc/allowedChannels.ts` | Allow-lists `window:detach-pane` and `window:broadcast-verse-change`. |
| `electron/main.ts` | Registers the `window:detach-pane` IPC handler that calls `windowManager.detachPane()`, and the `window:broadcast-verse-change` handler that fans a verse change out to the other windows. |

### Detached Window Renderer

| File | Description |
|---|---|
| `detached.html` | Entry HTML for detached windows. |
| `src/ui/detached.tsx` | Bootstrap only: builds the services bundle, loads locale catalogs, mounts `DetachedWindow` via `createRoot`. |
| `src/ui/components/DetachedWindow.tsx` | Root React component and `COMPONENT_MAP`. Receives `initialize-pane` IPC, resolves the component, spreads state as props with `isDetached={true}`. Kept separate from `detached.tsx` so it can be unit-tested. `ExtensionPanelHost` is in the map once and serves every extension panel. |

### Pane Components (Detached Mode Support)

| File | Description |
|---|---|
| `src/ui/components/CommentaryPane.tsx` | Accepts `isDetached`, `overviewActive`, and initial state props. Initializes store from props via `initializeFromState`, then calls `syncWithBibleVerse` when the payload carried a verse but no cached entries - `initializeFromState` seeds state, it does not fetch, and a window opened from `popOutModule` deliberately arrives with empty caches. Listens for `verse-changed` IPC. |
| `src/ui/components/BiblePane.tsx` | Accepts `isDetached` and initial state props. Restores open tabs, book, chapter, verse. |
| `src/ui/components/BookPane.tsx` | Accepts `isDetached` plus both halves of the payload: `useDetachedInit` restores the book tabs and their Maps, `useDictionaryDetachedInit` restores `dictOpenTabs` / `dictActiveTabIndex` / `dictEntriesByTab`. This is why detached dictionaries use pane type `'book'`. |
| `src/ui/components/notes/UserNotesPane.tsx` | Accepts `isDetached`, `initialView`, `initialSideTab`, `initialCurrentPath`, `initialCurrentNotePath`. Re-opens the note file in the editor on mount. |
| `src/ui/components/StudyPane.tsx` | Accepts `initialVerseId`. Both this pane and Topics seed themselves from the Bible pane's anchor verse, and a detached window has no Bible pane - so the verse travels in the payload. It is taken over the verse `seedInitialVerse` would restore, because every detached window mounts under the same `_default` panel id and that remembered verse belongs to a different pop-out. |
| `src/ui/components/TopicsPane.tsx` | Accepts `initialVerseId`; seeds through `syncAllPanelsWithVerse`, which sets `liveVerseId` as well as navigating, so the pane's Home button has somewhere to go in a window with no Bible pane. Only while the pane is still on its fresh browse view. |
| `src/ui/components/notes/tabs/PrayerTab.tsx` | Loads the prayer lists on mount, so a detached Prayer window - which starts with an empty store - has something to show. |

### State Support

| File | Description |
|---|---|
| `src/ui/stores/useCommentaryStore.ts` | `initializeFromState()` action restores panel state (tabs, verse, entries) in detached windows. |
| `src/ui/stores/useFileNotesStore.ts` | `setNotesPanelNavState()` / `getNotesPanelNavState()` / `clearNotesPanelNavState()` - the imperative wrappers over `panelNavStates`, which is where each notes panel's position is held for pop-out and for session restore. |
| `src/ui/stores/syncPanesWithVerse.ts` | `syncPanesWithVerse(verseId)` - the four-way fan-out (Commentary, Notes, Study, Topics) a received `verse-changed` performs in the main window. |
| `src/ui/stores/crossStoreBridge.ts` | `resolvePrimaryBibleVerseId()` - the bridge `storeSync` fills in so a commentary opened while the Bible pane is popped out still has a verse. |

### IPC / Preload

| File | Description |
|---|---|
| `electron/preload.ts` | Exposes `window.electron.window.detachPane()`, `broadcastVerseChange()`, `onInitializePane()`, `onVerseChanged()` for detached window communication. |

### Tests

| File | Description |
|---|---|
| `e2e/tests/pop-out.spec.ts` | End-to-end: pop-out for Commentary, Bible, Notes, Books, Dictionary; window title; closing a detached window; two detached windows at once. Asserts on the `detached-pane` / `detached-loading` / `detached-error` testids rather than body text length. |
| `electron/config/paneConfig.test.ts` | Every `titleFormat` against populated, empty and `undefined` state; dimension and pane-type-guard invariants. |
| `electron/services/__tests__/WindowManager.test.ts` | Window creation, the `ready-to-show` handover, title suppression, lifecycle/cleanup, link toggle, verse broadcast filtering. Fakes `BrowserWindow`. |
| `src/ui/components/DockviewTabRenderer.test.tsx` | Pop-out state gathering per content type, pane-type routing, Map serialization, structured-clone safety, the notes dual-edit signal. |
| `src/ui/components/extensionPopOut.test.ts` | `popOutPaneTypeFor` and `parseExtensionContentType`: the `ext:` prefix, the last-dot split, and the malformed cases that must return nothing rather than a half-parsed identity. |
| `src/ui/components/BookPane.test.tsx` | "Pop Out to Window" from the Books/Dictionary tab menu and the pane menu: the payload carries the module, and the tab survives a failed detach. |
| `src/ui/components/DetachedWindow.test.tsx` | IPC handshake, component resolution, prop handover. Also cross-checks `COMPONENT_MAP` against every `paneConfig` entry. |
| `src/ui/components/bible/hooks/useDetachedInit.test.ts` | Bible pane seeding: detached-only, once-only, junk-payload tolerance. |
| `src/ui/components/BookPane/hooks/useDetachedInit.test.ts` | Book pane seeding and Map rehydration. |
| `src/ui/components/notes/UserNotesPane/hooks/usePopOutListener.test.ts` | Dual-edit guard: targeting, save-before-exit ordering, listener cleanup. |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesNavigation.test.ts` | The breadcrumb pop-out trigger: correct pane type (`'verse-notes'`) and payload shape, dual-edit-guard event dispatch on success, error surfacing on failure/rejection. |
| `src/ui/stores/__tests__/popOutStateHandover.test.ts` | `initializeFromState` and the notes panel nav registry. |

## How It Works

1. **User right-clicks a dockview tab** -> `DockviewTabRenderer` shows context menu.
2. **"Pop Out to Window"** -> gathers pane state from the relevant Zustand store (commentary, bible, book, dictionary, or the notes nav registry). A single-module panel takes the `popOutModule.ts` path instead (below).
3. **IPC `window:detach-pane`** -> main process creates a `BrowserWindow` loading `detached.html`.
4. **`did-finish-load`** -> main process sends `initialize-pane` IPC with `{ paneType, windowId, componentName, state }`.
5. **`DetachedWindow`** -> receives the IPC, looks the component up in `COMPONENT_MAP`, renders `<Component {...state} isDetached={true} />`.
6. **Pane component** initializes from props, not from the shared store, which is empty in the new window.

## Single-Module Pop-Out

Popping *one* commentary, book or dictionary into its own window is a single gesture: **"Pop Out to Window"** (`ui.dockviewTab.popOutToWindow`) on the module's own tab, or on the Books pane menu. The payload is built from what the caller already holds rather than from a store lookup, because a single-module panel (`CommentarySinglePanel`, `BookSinglePanel`, `DictionarySinglePanel`) keeps its tabs, entries and verse in local React state and writes nothing to the store.

- `src/ui/utils/popOutModule.ts` assembles `{ openTabs: [{ abbreviation, name }], activeTabIndex: 0, currentVerseId, ... }` from the module abbreviation plus the verse - the caller's own `currentVerseId`, else `currentPrimaryVerseId()`. The per-tab caches (entries, sections) are deliberately sent **empty**: the new window fetches them for itself, and a stale cache copy is worse than a fetch. What has to travel is the *identity* - which module, at which verse.
- `currentPrimaryVerseId()` reads the **first** Bible panel rather than `DEFAULT_PANEL_ID`; a dockview-hosted Bible pane registers under its own id (`bible_default` and onwards), and the `'_default'` key only exists in detached windows.
- `DockviewTabRenderer.handlePopOut` uses the helper whenever the panel has a `contentKey` and the content type is `commentary`, `book` or `dictionary`, and returns before the store-gathering branches.
- **The tab is only closed once the detach actually succeeded.** `handlePopOutTab` in `CommentaryPane` / `BookPane` awaits the helper's boolean, so a failed detach leaves the module where it was.
- `POP_OUT_PANE_TYPE` maps `dictionary` -> `'book'`: dictionaries ride in the Books window, sharing one tab strip as they do in the docked layout. There is **no** `'dictionary'` entry in `PaneType`/`PANE_CONFIGS` or in `COMPONENT_MAP` - both carry a comment saying so. The `dictOpenTabs` / `dictActiveTabIndex` / `dictEntriesByTab` payload is read by `BookPane`'s `useDictionaryDetachedInit`, so `'book'` is the only pane type that can receive it, and `paneKind: 'dictionary'` in the payload is what makes the window a dictionary.
- The return leg exists too: `BookSinglePanel` / `DictionarySinglePanel` can move a module back into the Books pane (`BookPane/moveIntoBooksPane.ts`).

## Extension Panel Pop-Out

An extension-contributed panel detaches like any other pane, but by a different route, because it is not in `POP_OUT_PANE_TYPE` and cannot be.

- An extension panel's content type is `ext:<extensionId>.<panelTypeId>`, so there is one per contributed panel and none of them is known until an extension registers. A record lookup therefore always missed and `handlePopOut` returned early, which is why extension panes could not be popped out at all. `popOutPaneTypeFor(contentType)` checks the `ext:` prefix first and maps every extension panel to the single `'extension'` pane type; everything else falls through to the record as before.
- `parseExtensionContentType()` splits the identity back out on the **last** dot. Extension ids contain dots (`ext.bible-app.word-count`), so splitting on the first would hand back `ext` as the extension id for every panel in existence.
- **Only the identity travels**: `{ extensionId, panelTypeId, panelId, panelTitle }`. The panel's state lives inside a sandboxed iframe on the extension's own origin, so the host cannot read it and must not try. The popped-out panel reloads from whatever its worker persisted - which is what happens when the user reopens it in the docked layout too, and is part of why `api.panels` exists.
- One `PANE_CONFIGS` entry covers every extension panel. The panel is an iframe the host does not look inside, so there is nothing type-specific to configure; the default 900x700 is deliberately generous because an extension panel owns its whole rectangle with nothing else to fill the space.

**Do not give detached windows their own session partition.** `registerExtUiProtocol` is called in `main.ts` with no session, which registers on the global protocol module and so serves `session.defaultSession`. Detached windows inherit that session precisely because `WindowManager` sets no `partition`, and that is the only reason a popped-out extension panel can load its iframe. Add a partition without registering the handler on that session and every extension panel window goes blank with no error at all, because a protocol with no handler simply fails the request. `registerExtUiProtocol` takes an optional `Session` for exactly this case.

**No status bar in a detached window.** A popped-out pane is a single document surface; a second copy of the app's global status would be noise. See [Status Bar](status-bar.md).

## Notes Pane Specifics

- Notes navigation state (view, side tab, currentPath, currentNotePath) lives in `useFileNotesStore.panelNavStates`, keyed by dockview panel id, because it is local React state rather than store-driven pane state.
- When a note is being edited and the pane is popped out, a `notes-pane-popped-out` custom event is dispatched. The original pane listens for this and exits editor mode to prevent dual-editing conflicts.
- The detached notes pane re-reads the note file from disk on mount (not serialized through IPC).
- There are **two independent triggers** for popping a notes pane out, and both use pane type `'verse-notes'` (the only notes entry in `PaneType`) with the `{ initialView, initialCurrentPath, initialCurrentNotePath }` payload shape `UserNotesPane`/`useNotesInit` expect:
  1. The dockview tab's right-click context menu (`DockviewTabRenderer.tsx`), which reads the nav registry and also passes `initialSideTab`.
  2. The pop-out button at the end of the breadcrumb header while a note is open (`UserNotesEditorView.tsx` -> `useNotesNavigation.ts`'s `handlePopOut`), which reads the same state directly from the pane's own render scope.

  `handlePopOut` awaits the `detachPane()` result and surfaces a failure through `setFileError`, so a refused detach reports rather than appearing to do nothing.

## Content types that cannot be popped out

`POP_OUT_PANE_TYPE` is a `Partial<Record<PanelContentType, PaneType>>`, and a content type it does not answer for gets no "Pop Out to Window" item at all rather than a gesture that does nothing.

`search` and `newtab` are deliberately absent: search results live in a store the new window does not share (it would open empty), and the "+" page is a way to create a pane rather than a pane worth keeping.

Extension panels (`ext:*`) are absent from the record too, but for a different reason and with a different outcome: they are keyed per contributed panel, so they could never have been enumerated in it. `popOutPaneTypeFor()` answers for them instead, and they *can* be popped out - see "Extension Panel Pop-Out" above.

`paneConfig.test.ts` and `DetachedWindow.test.tsx` between them keep `PaneType`, `PANE_CONFIGS` and `COMPONENT_MAP` in sync, so removing one half of a pane type alone will fail the tests.

## Verse Sync

Verse changes travel **between all windows**, not just outward from the main one.

- `useBibleStore.setSelectedVerse` calls `window.electron.window.broadcastVerseChange(verseId)` from whichever window the click happened in.
- `main.ts`'s `window:broadcast-verse-change` handler fans it out to every *other* window: `windowManager.broadcastVerseChange(verseId, event.sender.id)` for the linked detached windows, plus a direct send to the main window when it was not the sender. `excludeWebContentsId` is what stops a window being told to navigate to where it already is.
- In the main window, `storeSync.ts` listens for `verse-changed` and calls `syncPanesWithVerse(verseId)` - the same four-way fan-out (Commentary, Notes, Study, Topics) a click in a docked Bible pane performs. It also records the verse in `detachedBibleVerseId`, which `resolvePrimaryBibleVerseId` returns when this window has no Bible panel of its own.
- That last part is what makes a commentary openable while the Bible is popped out. `openCommentary` loads nothing until it has a verse, so without a resolvable verse a commentary tab would open and sit empty.
- Detached Commentary panes listen for `verse-changed` directly (`CommentaryPane.tsx`).

## Dictionaries pop out as Books

`DockviewTabRenderer`'s `POP_OUT_PANE_TYPE` sends both `book` and `dictionary` to the `'book'` pane type: the two share one tab strip in the docked layout, and `BookPane` renders either. A detached dictionary therefore reports `data-pane-type="book"`, which is correct - the dictionary is the pane *inside* it.

The window's **title** comes from `book.titleFormat`, which reads `paneKind` to decide between "Dictionary - {name}" and "Book - {name}" and takes the name off the handed-over tab list.

`paneKind` is what separates the two: a `BookPane` with `paneKind: 'dictionary'` shows dictionary tabs only, one with `paneKind: 'book'` book tabs only. The pop-out payload carries it alongside the dictionary state (`popOutModule.ts` and `DockviewTabRenderer`), and `PanelContentRenderer` sets the same prop from the panel's content type for the docked case.
