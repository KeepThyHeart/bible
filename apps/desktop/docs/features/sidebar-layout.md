# Sidebar & Layout

**Last verified:** 2026-09-09

Flexible docking layout using `dockview-react`, with drag-and-drop tab rearrangement, panel splitting, pop-out windows, and session-persistent layout.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/DockviewLayout.tsx` | Main dockview wrapper; initializes the default or a saved layout, registers the dockview API in `useLayoutStore`, tracks panel add/remove, and lays out the workbench row (dockview container + collapsed-panes reveal rail) |
| `src/ui/components/PanelContentRenderer.tsx` | Maps the `contentType` param to a React component. `CONTENT_COMPONENTS` covers `bible`, `commentary`, `book`, `dictionary` (both -> `BookPane`), `notes`, `prayer`, `search`, `study`, `topics`, `newtab`; an `ext:<extensionId>.<panelTypeId>` content type is routed to `extensions/ExtensionPanelHost` instead. A `contentKey` on a commentary/book/dictionary panel renders the lightweight `*SinglePanel` variant. Every panel is wrapped in `PaneErrorBoundary` |
| `src/ui/components/PaneErrorBoundary.tsx` | Per-pane error boundary, so one crashing pane cannot take the workbench with it |
| `src/ui/components/DockviewTabRenderer.tsx` | Custom tab header with close button, icons, optional two-line display (title + subtitle), and right-click context menu (split/pop-out/close). All of its chrome is sized from `--ui-control-font-size` via `controlScaled()` - see "Tab strip sizing and icons" below |
| `src/ui/components/paneIcons.ts` | The one icon source of truth for panel content types: `PANEL_CONTENT_ICONS` (the vocabulary), `BOOK_PANE_TAB_ICONS` (the Books pane's own two-kind strip), `ICONLESS_TAB_CONTENT_TYPES` (the four staple study surfaces), `tabIconFor()` for tab strips and `chooserIconFor()` for the "+" page and watermark |
| `src/ui/components/DockviewHeaderActions.tsx` | Per-group header actions: the "+" button that adds a "New Tab" panel to that group, the horizontal `« Show hidden panes` text button shown in every non-collapsed group's header while any group is collapsed, the tab-strip overflow scroll chevrons, and the right-facing chevron that collapses *this* group (see "Collapsing a group by hand" below). The collapse chevron is portaled to the far end of `.dv-tabs-and-actions-container` (`order: 2` in `dockview-overrides.css`) so it sits against the panel's outer edge, while the "+" and scroll chevrons stay next to the last tab |
| `src/ui/components/CollapsedPanesRevealBar.tsx` | Vertical (rotated-text) reveal rail laid out **beside** the dockview container - a flex sibling in `DockviewLayout`'s `.app-workbench-row`, not an overlay, so the panes end where it begins instead of running underneath it. Opaque for the same reason. It sits against the **physical** right edge (`borderLeft`, never the logical `border-inline-start`: dockview's grid does not mirror for RTL, so `.app-workbench-row` flips to `row-reverse` under `dir="rtl"` to keep this last child on the right in every locale). Shown whenever `useLayoutStore.collapsedGroups` is non-empty, labelled "Show Study Panes" (`layout.showStudyPanes.label`) after a `‹` glyph, and styled as an opaque accent-tinted sliver (`color-mix`) with a solid `--theme-accent-primary` rule and accent text. It is a second, persistent affordance alongside `DockviewHeaderActions`'s horizontal button - kept deliberately, because it lives in fixed outer chrome rather than inside a specific pane's tab row, so it stays visible however the visible pane's header is scrolled. Names the hidden panes in its tooltip when dockview's live group data makes that cheap, else a generic label. Clicking it calls the same `expandCollapsedGroups()` action as the header button |
| `src/ui/components/NewTabPage.tsx` | "New Tab" page with quick reference input and category buttons (Bible, Commentary, Books, etc.) |
| `src/ui/components/DockviewWatermark.tsx` | Shown when all panels are closed; provides buttons to add panels back |
| `src/ui/components/LayoutDropdown.tsx` | Dropdown button for applying built-in layout presets (Study Mode, Reading Mode, etc.); checkmarks the currently-applied preset via `layoutPresetService.currentPresetId`, which clears once the user manually rearranges the layout (see "Preset checkmark invalidation" below) |
| `src/ui/components/AdvancedPaneManagerGateDialog.tsx` | Modal shown when the user tries to drag a pane while `usePreferencesStore`'s `advancedPaneManagerEnabled` is off. Explains the opt-in, reminds the user the Layout button can restore the default arrangement, and requires a checkbox before enabling the preference. See "Advanced Pane Manager drag gate" below |
| `src/ui/components/PaneOptionsMenu.tsx` | Menu for pane-level options (font size, detach, etc.) |
| `src/ui/App.tsx` | Main layout using `DockviewLayout` in the content area; passes the saved layout from session data. Also mounts `StatusBar` as a sibling of the `<main>` element, so the strip sits below the whole workbench rather than inside a pane - and renders nothing at all until an extension contributes an item (see [Status Bar](status-bar.md)) |
| `src/ui/components/ErrorBoundary.tsx` | React error boundary wrapping the app; catches rendering crashes and shows a fallback UI with a reload button |

### Stores

| File | Description |
|---|---|
| `src/ui/stores/useLayoutStore.ts` | Zustand store holding the dockview API ref, panel registry, add/remove/serialize operations, preset application, collapsed-group state, and the active-panel tracking used to target navigation actions (`activePanelId`, `lastActiveBiblePanelId` - see "Active panel tracking" below). Also exports the pure helpers `canCollapseGroup()`, `resolveStalePosition()` and `isLeftRightTwoPaneLayout()` |

### Services

| File | Description |
|---|---|
| `src/ui/services/LayoutPresetService.ts` | Applies/undoes built-in presets; remembers the arrangement each preset was left in so returning to it round-trips |
| `src/ui/services/ILayoutPresetService.ts` | Interface for the layout preset service (`list`, `apply(id, { forceRebuild })`, `undo`, `reset`, `notifyManualLayoutChange`, `currentPresetId`) |
| `src/ui/services/PresetApplier.ts` | Pure layout maths: bucket panes into preset groups (`bucketTabs`), collect the live tabs (`collectTabsFromLayout`), build and reconcile the serialized grid (`buildPresetLayout`, `reconcileRememberedLayout`), and collapse/expand/measure groups (`collapseGroups`, `expandGroups`, `measureGroup`, `zeroSizedGroupIds`, `DEFAULT_GROUP_MIN_SIZE`, `EXPANDED_GROUP_FRACTION`) |
| `src/ui/services/dockviewSerializedLayout.ts` | Minimal restatement of dockview's serialized grid shape plus the walks over it, shared by `LayoutStateSanitizer` and `stripTransientPanels` (dockview does not re-export those interfaces) |
| `src/ui/services/stripTransientPanels.ts` | Removes panels that exist only for the current sitting (`newtab`) from `toJSON()` output, so a chooser left open is not restored on the next launch |
| `src/ui/services/LayoutStateSanitizer.ts` | Validates a saved layout before `fromJSON()`: repairs or drops panel entries whose `contentComponent` is not the registered `panelContent` (see "Saved-layout sanitizing" below) |
| `src/ui/services/AdvancedPaneManagerGate.ts` | Pure gate logic for the drag-and-drop opt-in (`shouldGateDrag`, `gateDragEvent`, `exceedsDragThreshold`, `DRAG_GATE_THRESHOLD_PX`) - see "Advanced Pane Manager drag gate" below |

### Presets

| File | Description |
|---|---|
| `src/ui/presets/index.ts` | `BUILT_IN_PRESETS` and `DEFAULT_LAYOUT_PRESET_ID`; re-exports the four preset definitions |
| `src/ui/presets/studyMode.ts` | Study Mode (`study-mode`), the default layout preset |
| `src/ui/presets/readingMode.ts` | Reading Mode (`reading-mode`) |
| `src/ui/presets/writerMode.ts` | Writer Mode (`bible-notes`) |
| `src/ui/presets/studyModeQuad.ts` | Study Mode (Quad) (`study-mode-quad`) |
| `src/ui/types/LayoutPreset.ts` | TypeScript types for layout presets and groups (`LayoutPreset`, `PresetGroup`, `PresetAcceptValue`) |

### Commands

| File | Description |
|---|---|
| `src/ui/commands/layoutCommands.ts` | Registers one `layout.applyPreset.<id>` command per built-in preset for the command palette; also owns the shared `layoutPresetService` singleton |

### Locale

| File | Description |
|---|---|
| `locales/en/layout.json` | English strings for layout presets, dropdown, collapse/expand controls, advanced-mode row and undo toast |

### Styles

| File | Description |
|---|---|
| `src/ui/styles/dockview-overrides.css` | Maps dockview's CSS vars onto the app's `--theme-*` system; also the tab-header chrome, the tab-strip drop zone, the RTL/workbench-row geometry, and the resize-handle hit area and hover feedback (see "Pane resize handles" below) |

### Layout Architecture

The app uses `dockview-react` for a flexible docking layout:

```
App
+-- SearchBar (top)
+-- FindBar (conditional)
+-- DockviewLayout (main content)
    +-- DockviewReact
        +-- Group (Bible panel) [+ button, custom tabs]
        +-- Group (Commentary panel) [+ button, custom tabs]
        +-- ... (user can split, merge, drag tabs between groups)
+-- Dialogs (Preferences, ModuleManager, etc.)
```

Default layout (`createDefaultLayout` in `DockviewLayout.tsx`): Bible on the left, Study + Commentary + Dictionary tabbed together on the right at a 50/50 split, with Study active (panel ids `bible_default`, `study_default`, `commentary_default`, `dictionary_default`). Books and Notes stay one click away via the "+" menu rather than opening as empty tabs on first launch.

**Why Dictionary is in the default set.** It is a first-class pane slot, not a variant of Books. Looking a word up is a core study gesture, and a Strong's-number click in the Bible pane is the app's commonest route out of the text: `revealDictionaryPanel` finds the standing Dictionary pane, falls back to an open Books pane (which hosts dictionary tabs too), and only creates one if neither exists. Study Mode's `autoOpen`/`order` list the same slot, so the preset and the first-run layout agree.

Note that `'dictionary'` and `'book'` are two content types rendered by one component (`BookPane`, which shows one interleaved tab strip and opens on the half its content type names). They are not aliases: each has its own entry point, its own store, and its own place in the layout. See [books.md](books.md) and [dictionary.md](dictionary.md).

**React StrictMode compatibility:** Layout initialization is done in a `useEffect` triggered by a state counter (`apiVersion`), not directly in the `onReady` callback. This ensures the layout is properly created after StrictMode's unmount/remount cycle in dev mode, since `onReady` may not re-fire but effects always re-run.

### Layout Presets

Built-in presets (Study Mode, Reading Mode, Writer Mode, Study Mode Quad) are applied from `LayoutDropdown` or the command palette. Three rules govern them:

**1. Rearrange, don't recreate.** Applying a preset *moves* the panes that are already open. It never disposes and re-creates them. `PresetApplier` builds a serialized grid whose panel entries are copied **verbatim** out of the live `api.toJSON()`, and hands it to `api.fromJSON(layout, { reuseExistingPanels: true })`. dockview then relocates the existing panel objects instead of rebuilding them.

Why it matters:

- Every pane's state lives in a per-panel slice of a content store (`useBibleStore`, `useNotesStore`, ...) that is torn down by `destroyPanel` on unmount. Re-creating a pane silently wipes its open passages, scroll position, and the document being edited.
- Panel entries must carry `contentComponent` - the field dockview's deserializer reads. A synthesised `{ component: 'panelContent' }` resolves to the literal string `'unknown'`, which the React binding cannot map, and that value is then written into the saved session by the next `toJSON()`. Copying the live entries avoids the whole class of problem (it also preserves `params.subtitle`, size constraints and titles).

**2. Round-trippable.** `LayoutPresetService` remembers the arrangement in force when a preset is *left*, keyed by preset id. Returning to that preset restores it - including any manual splits or drags made while in it - via `reconcileRememberedLayout`, which:

- drops panes closed while away,
- removes groups left with nothing in them,
- files panes opened while away into the group the preset would have chosen (`bucketTabs`),
- uses the *current* panel entries, so a Bible pane navigated elsewhere comes back where it now is, not where it was.

Re-applying the preset that is already current deliberately skips the remembered arrangement - that is the "reset this layout" gesture. The dropdown's **Reset to default layout** goes further and passes `{ forceRebuild: true }`, which also forgets the remembered arrangement.

`layoutPresetService.reset()` is called whenever a new dockview instance is created (mount, session restore), because remembered arrangements name group ids that no longer exist.

**3. No empty groups.** A preset group with nothing to hold is omitted entirely. Materialising it would produce a pane whose only affordance is a "+", and replacing the New Tab placeholder it created - the group's only panel - would remove the group out from under the replacement.

### What else is in the Layout menu

- **Advanced layout mode**, a checkbox on the same `advancedPaneManagerEnabled` preference the Preferences > General switch writes. It is duplicated here because this is the menu people are already in when they want it, and a **?** beside it opens the full setting (via the `command:app:openPreferences` event) rather than trying to fit the explanation into a dropdown row.
- **Escape closes the menu**, and returns focus to the button that opened it. The handler is registered in the capture phase so a global shortcut cannot consume the key first. `PaneOptionsMenu` does the same; `useOverlayDismissal` covers the rest.

#### `autoOpen`: the one carve-out from rule 1

Rule 3 has a cost: a preset named after a *shape* could not deliver that shape. Study Mode (Quad) applied to a session holding only Bible + Study/Commentary has nothing for its dictionary cell or its notes cell, so both would be pruned, row 2 would disappear, and "Quad" would produce two panes.

`LayoutPreset.autoOpen` lists pane types to open - only if nothing of that type is already open - before bucketing. `LayoutPresetService.openDeclaredPanes` does it through the same `useLayoutStore.addPanel` path as the "+" menu, with `genericEnglishTitle()` for the title (a localized title would bake the creating locale into the saved layout). Three presets set it: `STUDY_MODE` (`['study', 'commentary', 'topics', 'dictionary', 'notes']`), `STUDY_MODE_QUAD` (`['dictionary', 'notes']`) and `WRITER_MODE` (`['notes']`) - `READING_MODE` purely rearranges.

Study Mode needs it for the plainest reason of the three: it *is* the study column, and applied to a session missing one of those five panes it would deliver a column with a gap in it.

Writer Mode needs it for the same reason Quad does: with no notes pane to place, its second group fills with the study/commentary panes instead and the preset delivers no writing surface at all.

#### `activate`: opening a pane is not showing it

`autoOpen` adds a panel, but bucketing can file it into a group *behind* the tabs already there - so Writer Mode could open a notes pane the user never sees, sitting behind the commentary tab it now shares a group with.

`LayoutPreset.activate` names one content type to bring to the front of its group; `LayoutPresetService.activateDeclaredPane` calls `panel.api.setActive()` after `applyPresetLayout`. It runs *after* because `fromJSON({ reuseExistingPanels: true })` can move a panel into a different group than the one `autoOpen` created it in. If no panel of that type survives, nothing happens. `WRITER_MODE` sets it (`'notes'`) and `STUDY_MODE` sets it (`'study'`).

#### `order`: which tab comes first

`accepts` says which panes land in a group; on its own it says nothing about the order they land in, which would be whatever order the session happened to have them open in - so the same preset would look different on every profile.

`PresetGroup.order` lists content types in the order they should appear in that group. `bucketTabs` applies it as a **stable** sort: listed types come first in the declared order, everything else keeps its relative order behind them. Study Mode's study group declares `['study', 'commentary', 'topics', 'dictionary', 'notes']` - the same list as its `autoOpen`, because they are the same statement about what that column is.

It applies when a preset is built **fresh**. `reconcileRememberedLayout` leaves order alone: a tab order the user set by hand while they were in that layout is theirs, and rule 2 says returning to a preset restores what they had. Re-picking the preset you are already in (or **Reset to default layout**) rebuilds, and so re-asserts the declared order.

Guard rails:

- The "nothing open at all" early return is checked **before** auto-open, so a preset never populates an empty workbench.
- If a pane can't be opened, rule 3's pruning still applies and the preset degrades to the panes it has.
- Quad's group order is Bible first (row 1, col 1), matching Study Mode / Reading Mode / Writer Mode. Degrading must not slide Bible to the other side of the window.

#### Collapsed groups (Reading Mode, and on demand)

Reading Mode marks its study group `collapsed: 'right'`. dockview refuses to size a group below ~100px, so a small `sizeWeight` would only ever produce an unreadable sliver. `collapseGroups()` therefore lifts the constraint (`setConstraints({ minimumWidth: 0 })`) and sets the size to 0. The panes and their tabs are all still there - the group just has no width.

Ways back:

- a **`« Show hidden panes`** button rendered by `DockviewHeaderActions` in every non-collapsed group header (Reading Mode leaves exactly one),
- a **vertical reveal bar** (`CollapsedPanesRevealBar`) beside the dockview container, rendered by `DockviewLayout` whenever `collapsedGroups` is non-empty - kept alongside the header button rather than replacing it, since the two live in different chrome (inline pane header vs. fixed outer edge),
- the same action in the `LayoutDropdown` menu,
- switching to any other preset.

`useLayoutStore.collapsedGroups` holds the current collapsed set; `expandCollapsedGroups()` restores the normal minimum and the group's size. Because the zero-width constraint is not part of `toJSON()`, `DockviewLayout` re-applies it on session restore for any group serialized at size 0 (`zeroSizedGroupIds` -> `restoreCollapsedGroups`).

**Expanding restores the width the pane had, not a fixed share.** `CollapsedGroup.size` records the group's extent along its axis, and `expandGroups` prefers it over `EXPANDED_GROUP_FRACTION` (clamped to the workbench, so a size captured at a larger window doesn't overflow a smaller one).

The size is captured **only on the by-hand path** - `useLayoutStore.collapseGroup` calls `measureGroup()` before zeroing, which is the last moment the user's chosen width is observable. It is deliberately *not* captured when a preset collapses a group or when a session restore re-collapses one: on both of those paths `applyPresetLayout`/`fromJSON` has already sized the group at or near zero, so measuring returns dockview's 100px minimum clamp rather than anything the user picked, and recording it would pin the pane to 100px forever. `measureGroup` returns `undefined` at or below `DEFAULT_GROUP_MIN_SIZE` for the same reason, and `size` is optional so those paths simply fall back to the fraction.

#### Collapsing a group by hand

Collapsing is not only a Reading Mode side effect. A group header can carry a **right-facing chevron** (`DockviewHeaderActions`) that collapses *that* group via `useLayoutStore.collapseGroup(groupId)`. It reuses `PresetApplier`'s `collapseGroups`/`expandGroups`, so a manual collapse and a preset collapse are the same state and the same restore controls bring both back.

- **Only in the plain two-pane, left/right split.** `isLeftRightTwoPaneLayout` (exported from `useLayoutStore`) reads the *serialized* grid - a `HORIZONTAL` root branch with exactly two leaf children, which is what `PresetApplier`'s single-row grid builder emits - rather than measuring the DOM, so it is pure and answers the same in a test as in the app. Outside that shape the gesture has no meaning: nothing to collapse towards with one pane, the wrong axis for a vertical stack (collapse/restore only understand `width`), and no single answer in Study Mode (Quad)'s 2x2.
- **Never the last visible group.** `canCollapseGroup(allGroupIds, collapsedGroupIds, groupId)` is a pure exported predicate: a group can be collapsed only while another visible one remains, isn't already collapsed, and actually exists. The header button hides itself when it would be refused (an inert button is worse than none), and the store re-checks at click time. Collapsing hides rather than closes, so the only genuinely destructive case is emptying the workbench.
- **Always the `width` axis.** Nothing in `toJSON()` records which way a group was collapsed, and the restore path assumes width - a height collapse would come back as a width one after a restart.
- **Persistence rides the existing mechanism.** A collapsed group serializes at size 0 inside `SessionData.dockviewState`; restore re-applies the constraint through `zeroSizedGroupIds` -> `restoreCollapsedGroups`. No separate storage key.
- **Preset reconciliation.** A preset applied afterwards is authoritative: it rebuilds the grid from its own definition, so manual collapses are expanded again unless the preset asks for a collapse. The round-trip rule still holds in the other direction - a collapse made *while in* a preset is part of that preset's remembered arrangement (`reconcileRememberedLayout` re-collapses leaves remembered at size 0), so returning to it restores the collapse.

### Tab strip sizing and icons

**The strip sizes to its text.** dockview hard-codes `height: var(--dv-tabs-and-actions-container-height)` (35px) on `.dv-tabs-and-actions-container`. At the upper end of Preferences > General > "UI Control Font Size" a two-line Bible tab needs ~50px, so a fixed strip height slices the translation name off the bottom. `dockview-overrides.css` sets `height: auto` with a *scaled* minimum instead:

- `--app-tab-control-font-size` - `--ui-control-font-size` x `--global-font-scale`, the same value `DockviewTabRenderer`'s `controlScaled()` computes.
- `--app-tab-strip-min-height` - that size x 38/14, so it still resolves to exactly 38px at the default setting.
- `--app-tab-strip-border-width` - 4px. The tab strip baseline, the inactive-tab line and the active-tab indicator all read from it (as inset box-shadows, so an `overflow: hidden` ancestor cannot clip them), and `DockviewTabRenderer` adds it to the tab's bottom padding so no descender ever sits on the rule.

The tab's own padding, gap, icon size and close-button box are inline styles computed with `controlScaled()` for the same reason: an inline style outranks any stylesheet, so a literal there would defeat the CSS.

**Staple study tabs carry no icon.** `paneIcons.ts` exports `ICONLESS_TAB_CONTENT_TYPES` - `study`, `commentary`, `topics`, `dictionary` - and `tabIconFor()` returns `undefined` for them. These are the app's fixed study surfaces; as words they read faster than a row of near-identical glyphs and leave more room in a narrow pane. `book` keeps its glyph because a Books tab is one of many possible module tabs rather than a fixed landmark.

This is a *tab presentation* rule, not a change to the icon vocabulary: `PANEL_CONTENT_ICONS` still holds a glyph for every type, so `BookPane`'s internal tab strip and `LibraryHome` mark dictionaries as usual.

**Choosers are the exception, and say so.** `paneIcons.ts` exports a second helper, `chooserIconFor()`, which returns the glyph for *every* type. It is what `NewTabPage`'s category tiles and `DockviewWatermark`'s button row use. The iconless rule exists to keep a crowded horizontal strip readable, where the four staples are fixed landmarks the user already knows; a chooser is the opposite situation - a grid of equal-weight tiles scanned cold, where a tile with no icon reads as unfinished beside seven that have one. Two named helpers rather than an inline map at the call site, so which rule a surface follows is a decision in `paneIcons.ts` and not an accident of what someone imported.

**Chooser tile order.** `NewTabPage` renders a four-column grid whose array order is the row order: row 1 is Bible, Notes, Prayer, Books - Scripture, then the two places the user writes, then their library; row 2 is Study, Commentary, Dictionary, Topics - the study apparatus that hangs off a verse. `DockviewWatermark` offers a subset of the same kinds and follows the same order, so the two chooser surfaces cannot disagree about where "Notes" sits.

**Cursor.** `cursor: pointer` is a stylesheet rule on `.dv-tab`, on the tab-content wrapper, and on dockview's overlay `.dv-scrollbar`, rather than an inline style on the label. The inner content box is `height: 100%` of a tab whose height is `auto`, so it does not cover the tab's full `min-height`; and `.dv-scrollbar` is a sibling of the tabs pinned over their bottom 4px, so it inherits the document cursor unless told otherwise.

### Active panel tracking

`DockviewLayout` subscribes to `api.onDidActivePanelChange` and forwards it to `useLayoutStore.setActivePanelId()`, which records both `activePanelId` (whatever dockview panel currently has focus) and `lastActiveBiblePanelId` (the most recent *Bible* panel to have been active - sticky across focus moving to a non-Bible pane, or to the search bar, which lives outside dockview and never becomes the active panel at all).

`navigateToVerseInPrimary` (in `stores/bible/slices/sharedSlice.ts`, called by search results and reference navigation) prefers `lastActiveBiblePanelId`, so search results land in whichever Bible pane the user was actually reading. It falls back to `DEFAULT_PANEL_ID`, else the first Map key, when no Bible panel has ever been focused.

### The search-results panel

`useLayoutStore.openSearchResultsPanel()` is the one place a panel is opened *on the user's behalf* rather than by a click on "+" or a preset. Called through the `showSearchResultsPanel` cross-store bridge whenever a search produces results (see [search.md](search.md)), it focuses an existing `search` panel wherever the user has since dragged it, and only creates one - split below `lastActiveBiblePanelId` - when none exists. "Focus, never move" is what makes the placement feel remembered: dockview's serialized layout is the memory, so nothing extra is persisted.

### Preset checkmark invalidation

`LayoutDropdown` checkmarks the preset named by `layoutPresetService.currentPresetId`. Manually rearranging the layout (drag, split, resize) has to clear that checkmark - `DockviewLayout`'s `onDidLayoutChange` subscription (the same one that calls `markDirty()`) also calls `layoutPresetService.notifyManualLayoutChange()`.

The trap: applying a preset itself goes through `api.fromJSON(...)`, which fires that same `onDidLayoutChange` event - dockview buffers it via `queueMicrotask` rather than firing synchronously, so a naive listener would immediately un-check the preset `apply()` just set. `LayoutPresetService` guards against this with an `_applyingPreset` flag set around its own `apply()`/`undo()` calls, reset via its own `queueMicrotask` (queued after dockview's own, so it stays `true` for exactly as long as it needs to). `notifyManualLayoutChange()` is a no-op while the flag is set.

### Advanced Pane Manager drag gate

Dragging a pane (move/split/re-dock) is opt-in, gated by `usePreferencesStore`'s `advancedPaneManagerEnabled` (default `false`, toggled in Preferences > General). While it's off, `DockviewLayout` intercepts the drag before it visibly starts:

- `api.onWillDragPanel` / `api.onWillDragGroup` fire *before* the drag begins and are canceled via `event.nativeEvent.preventDefault()` - preferred over letting the drag start and rejecting the drop.
- `api.onWillDrop` is a backstop for any drop path that doesn't route through the will-drag events, canceled via `event.preventDefault()`.

All three call `services/AdvancedPaneManagerGate.ts`'s `gateDragEvent()` - the pure decision (`shouldGateDrag`) is factored out from the event-specific cancel mechanics so it's unit-testable without a real `DragEvent`.

**Movement threshold.** dockview owns the native HTML5 drag, whose own threshold is a pixel or two, so without a threshold of its own the gate fires on a twitch. `exceedsDragThreshold(origin, current, thresholdPx = DRAG_GATE_THRESHOLD_PX)` (8px, straight-line distance, strictly greater; `false` when `origin` is `null`) decides whether an intercepted drag has earned the modal. `DockviewLayout` records the origin from a capture-phase `pointerdown` on the workbench container and passes the drag event's own `clientX/clientY` as `current`. Below the threshold the drag is still canceled, just silently - and because the native drag never started, `pointermove` keeps firing for that same button-down gesture, so a window-level listener raises the dialog the moment the movement becomes deliberate. Without that second half, an 8px gate against the browser's ~3px native one would mean the dialog essentially never appeared. A gated attempt opens `AdvancedPaneManagerGateDialog`, which requires an explicit checkbox before calling `setAdvancedPaneManagerEnabled(true)`; canceling leaves the preference and the layout untouched. The preference is read fresh from the store on every drag attempt (not captured once at effect-setup time), so flipping it from the dialog or from Preferences takes effect on the next attempt without a new dockview instance.

#### Adding a panel safely

`useLayoutStore.addPanel` runs its `position` through `resolveStalePosition` first. dockview does **not** validate a `referenceGroup`/`referencePanel` passed as an *object*: given one it has already removed, it opens the new panel into a group that is no longer in the grid - no error, no panel, and the pane is gone. The guard drops such a position so the panel lands in the active group instead.

`NewTabPage` also creates the replacement panel **before** closing the New Tab placeholder, for the same reason: closing first can remove the group the replacement is about to be positioned against.

### Pane resize handles (sashes)

dockview gives the splitter between two docked panes a 4px grab strip, painted transparent and with no hover feedback - under half of the ~9px most pointing guidelines ask for, and with nothing to aim at. `dockview-overrides.css` fixes both halves:

- **A `::before` overlay widens the hit area to 12px without moving the sash.** The element itself cannot simply be made wider: dockview positions it by its own 4px width, so a 12px sash would sit 4px off the boundary it resizes. The overlay hangs 4px past each edge instead (`inset-inline: -4px` on a horizontal split-view container, `inset-block: -4px` on a vertical one), leaving the geometry alone. VS Code's splitter does exactly this.
- **Hover and drag paint the boundary** in `--theme-accent-primary` at 45%, with `transition-delay: 0s` so the feedback is immediate. `!important` plus the doubled theme class is the same specificity fight the rest of the file wages - dockview's own `.dv-sash:hover` rule is injected after this stylesheet.

**The selector matters.** Docked splitters live at `.dv-split-view-container > .dv-sash-container > .dv-sash`; `.dv-resize-container > .dv-sash` is the *floating group* resize frame, which keeps its own simpler treatment under that selector.

### User Interactions

- **Drag tabs** between groups to reorganize
- **Drop tabs at edges** to create new splits (horizontal/vertical)
- **Drop a tab on the empty part of a tab strip** (dockview's `.dv-void-container`) to append it after the last tab, in this group or another one. That container is `flex-grow: 1` with a `min-width` in `dockview-overrides.css` and the "+" is positioned with `order` rather than by starving the void, because `voidContainer.onDrop` is the only code path that yields "after the last tab"
- **Resize groups** by dragging separators - the handle has a 12px grab area and lights up in the accent colour on hover (see "Pane resize handles" above)
- **Collapse chevron** at the right edge of a group header collapses that group out of the way (offered only in the two-pane left/right split, and never for the last visible pane); the "Show Study Panes" rail beside the workbench or `« Show hidden panes` in another header brings it back
- **"+" button** positioned right next to the last tab in each group header; opens a "New Tab" page where users can type a verse reference or category name, or click a quick action button
- **Right-click top-level tab** for context menu: Split Right, Split Down, Pop Out to Window, Close
- **Right-click internal tab** (commentary, book/dictionary) for context menu: Pop Out to Window, Split Right, Split Down, Close tab. (`BookSinglePanel`/`DictionarySinglePanel` offer the return leg back into the Books pane - see [pop-out.md](pop-out.md#single-module-pop-out).)
- **Two-line tabs** for standalone module panels show title (bold) + subtitle (e.g., "Commentary", version abbreviation)
- **Middle-click tab** to close
- **Close panels** via the X button - hidden while the pane is down to its *last* tab, since closing that one takes the whole pane with it (right-click > Close still offers it). The count is per *group*, not per workbench, and is re-read on every layout change
- **Watermark** shows when all panels are closed, with buttons to add them back

### Session Persistence

Layout state is serialized via `useLayoutStore.serializeLayout()` - `dockviewApi.toJSON()` run through `stripTransientPanels()` - into `SessionData.dockviewState`. On restore, the saved layout is passed from `App.tsx` to `DockviewLayout`, which calls `dockviewApi.fromJSON()` to recreate the panel arrangement. If `dockviewState` is missing, the default layout is used.

#### Saved-layout sanitizing

`dockview-react`'s `components` map has exactly one registered entry (`panelContent` -> `PanelContentRenderer`), so any other `contentComponent` in a saved layout resolves to `undefined` and the pane renders blank. `DockviewLayout` therefore runs `sanitizeDockviewState()` (`LayoutStateSanitizer.ts`) on `savedLayout` before calling `fromJSON()`:

- A panel whose `contentComponent` isn't the registered `panelContent` is repaired using its own `params.contentType`.
- If `params.contentType` is missing, the panel id is used as a fallback signal (ids are always `${contentType}_...`; see `generatePanelId()` in `useLayoutStore.ts`). A repair logged with `viaPanelIdInference: true` is worth investigating - it means `params` did not survive.
- A panel that still can't be attributed to a content type is dropped (its id removed from the panel map and from every group's `views`; groups left empty are pruned) rather than left to render as `undefined`.
- If nothing recoverable survives, `sanitizeDockviewState()` returns `null` and `DockviewLayout` falls back to the default layout - the same fallback used when `fromJSON()` throws on unreadable state. A user never gets a blank window.
- Repairs are logged via `window.electron.log.warn` (falling back to `console.warn` if the log bridge isn't available) so a field report of a blank pane is diagnosable.
- The sanitizer only rewrites `savedLayout` in memory, and the repaired state is what feeds the *next* `toJSON()` too, so a session file that needed repair is overwritten with a healthy one the first time it saves. On a healthy layout it is a no-op and returns the same object reference.

Note that `AppInitService.ts` reads bible panel ids out of the *raw*, pre-sanitized `sessionData.dockviewState` (via `biblePanelIdsFromLayout`) to seed `useBibleStore`, before `DockviewLayout` ever sees the sanitized version. If the defensive drop path fires for a bible panel, that store can briefly reference an id the sanitized layout no longer has.

**Save-on-close:** The main process (`electron/main.ts`) sends a `session:save-requested` IPC message to the renderer before closing. `AppInitService.registerSaveBeforeCloseHandler()` registers the handler via `window.electron.session.onSaveRequested`; it flushes any in-progress note edit, then gathers session data from all stores and saves it. The main process waits up to `SESSION_SAVE_SHUTDOWN_TIMEOUT_MS` (5 seconds) for a `session:save-result` response before destroying the window. Auto-save also runs on a 30-second interval via `useSessionAutoSave`.

### Detached Windows

Pop-out functionality is available via the tab right-click context menu ("Pop Out to Window"). This uses the Electron BrowserWindow detach mechanism (`window.electron.window.detachPane()`). The detached window renders the same pane component via `DetachedWindow.tsx`'s `COMPONENT_MAP`.

**The detachable pane types are not the panel content types.** `electron/config/paneConfig.ts`'s `PaneType` is `'bible' | 'commentary' | 'book' | 'verse-notes' | 'prayer' | 'study' | 'topics'` - there is no `dictionary` entry, and `COMPONENT_MAP` has no `DictionaryPane`. Both pop-out paths (`POP_OUT_PANE_TYPE` in `DockviewTabRenderer` and `popOutModuleToWindow`) rewrite a dictionary to `'book'`, because the docked pane the user is detaching *is* the Books/Dictionary pane and `BookPane` opens on its dictionary half when the payload's `paneKind` says so. A bare `DictionaryPane` window would have no tab strip - a different window from the one it replaced. `paneConfig.test.ts` and `DetachedWindow.test.tsx` pin both halves of that agreement.

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/default-layout.spec.ts` | Tests default layout (Bible + right-side tabs) and commentary auto-sync on fresh start |
| `e2e/tests/narrow-window.spec.ts` | Tests for responsive layout behavior at narrow window widths |

### Unit / component tests

| File | Description |
|---|---|
| `src/ui/services/PresetApplier.test.ts` | Pure layout maths: bucketing, building a preset layout, reconciling a remembered one, zero-sized group detection, and Quad's 2x2 grid shape (Bible in row 1 col 1; unchanged when the bottom row degrades away) |
| `src/ui/stores/useLayoutStore.collapse.test.ts` | `canCollapseGroup` boundary cases - never the last visible group, never an already-collapsed or unknown one |
| `src/ui/stores/useLayoutStore.panels.test.ts` | The panel registry and `addPanel`/`removePanel` bookkeeping |
| `src/ui/stores/useLayoutStore.searchPanel.test.ts` | `openSearchResultsPanel` against a real `DockviewComponent`: splits below the last-active Bible pane (not the active panel), generic English title, focuses rather than duplicating, leaves a relocated panel where it was dragged, re-creates after a close, and falls back to default placement with no Bible pane open |
| `src/ui/services/LayoutStateSanitizer.test.ts` | Repairs a panel via `params.contentType`, infers a content type from the panel id when params are missing, drops a genuinely unrecoverable panel while keeping the rest, falls back to `null` when nothing survives, and is a true no-op (same object reference) on an already-healthy layout |
| `src/ui/services/__tests__/layoutPresetIntegration.test.ts` | Drives a **real** `DockviewComponent` in jsdom: panel reuse, preset round-trip, Reading Mode collapse, New Tab replacement, stale-position guard, `currentPresetId` tracking (set on apply, not self-cleared by `fromJSON`'s own buffered `onDidLayoutChange`, cleared by a genuine manual change), Quad's `autoOpen` (four groups, Bible first, no duplicate panes, nothing opened on an empty workbench, graceful degradation), and manual collapse (zero width, last-group refusal, session round-trip, preset supersession) |
| `src/ui/components/DockviewLayout.test.tsx` | Layout init, saved-layout restore, listener registration, corrupted-layout repair and all-unrecoverable fallback to default |
| `src/ui/components/DockviewHeaderActions.test.tsx` | The "Show hidden panes" restore control, and the collapse control (shown in the two-pane left/right split, hidden for three groups, for a vertical stack, when it would hide the last visible pane, or when this group is itself collapsed; collapses its own group on click) |
| `src/ui/components/CollapsedPanesRevealBar.test.tsx` | Renders only when a group is collapsed, names the hidden panes in its tooltip when titles are supplied, calls the expand handler when clicked, uses physical (not logical) edge properties, and is laid out beside the workbench with an opaque fill |
| `src/ui/components/DraggableTabBar.dropZone.test.tsx` | The inner tab strip's "drop at the end" target: `resolveReorderTarget` maps the strip background to `length - 1` (which the remove-then-insert reorder sinks treat as "last"), leaves a drop on a tab alone, no-ops for an already-last or unknown tab, and the strip background renders as a real droppable scoped to the bar's `droppableId` |
| `src/ui/styles/paneTypography.contract.test.ts` | Source-level contracts for cascade/layout bugs jsdom cannot observe: `.prose` sizing is neutralized inside every pane wrapper, `--global-font-scale` still multiplies through, no component puts `prose` and `pane-content-*` on one element, dockview's void container is not starved to 0px, and the parallel-version popup is width-capped with shrinkable selects |
| `src/ui/components/DockviewTabRenderer.test.tsx` | Pop-out payload gathering, plus the close "x" (hidden on a pane's last tab, counted per *group* not per workbench, re-read on layout change) and the staple/Books icon rule |
| `src/ui/components/NewTabPage.test.tsx` | The "+" page: every category tile takes its icon from `chooserIconFor()`, the tab strip's `ICONLESS_TAB_CONTENT_TYPES` rule is left intact, and the tiles render in the documented row order |
| `src/ui/components/LayoutDropdown.test.tsx` | Preset dropdown rendering and interaction |
| `src/ui/stores/bible/slices/sharedSlice.navigateToVerseInPrimary.test.ts` | Targets the last-active Bible panel over the first-created one; falls back correctly when no Bible panel has been focused; ignores focus moving to a non-Bible panel |
| `src/ui/services/AdvancedPaneManagerGate.test.ts` | Pure gate logic: `shouldGateDrag`, `gateDragEvent` cancels + reports gated only when the preference is off, and `exceedsDragThreshold` (below / above / exactly at the threshold, diagonal travel, null origin, custom thresholds) |
| `src/ui/components/AdvancedPaneManagerGateDialog.test.tsx` | Confirm button disabled until the checkbox is checked; Cancel/overlay-click leave the preference untouched |

The integration file uses the real dockview rather than a fake because every behaviour it covers is a contract between what the app tells dockview and what dockview does with it (which panel field it deserializes, what it does with a removed group passed as a position, how small it lets a group get). A faked API cannot catch those.

## Not implemented

`src/ui/components/Sidebar.tsx` (bookmarks list + `CollectionTree`, with a collapse toggle) is **not mounted** - nothing imports it, and there is no sidebar in the running app. The layout is dockview groups only. Do not document sidebar navigation as a feature until something renders it.

What `Sidebar.tsx` and `CollectionTree.tsx` draw that nothing else does is the collection *hierarchy* - folders - which the v1 UI deliberately does not offer; bookmarks otherwise ship through the Bible toolbar's star and jump list and the Manage Bookmarks dialog (see [bookmarks-collections.md](bookmarks-collections.md)). They are the obvious starting point if folders are ever wanted. Both carry a header comment describing the wiring: a fixed-width flex column rendered from `App.tsx` beside the dockview layout, not a dockview panel.
