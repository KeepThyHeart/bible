# Bible Pane

**Last verified:** 2026-09-08

Core Bible reading and display. Supports parallel Bible view, display modes, verse selection, and context menus.

**One panel = one passage.** A passage is a top-level dockview tab, not a sub-tab inside the pane; opening another passage adds a panel.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/BiblePane.tsx` | Main Bible pane orchestrator: wires hooks, context, and sub-components |
| `src/ui/components/BiblePaneContext.tsx` | React context + shared types for BiblePane sub-components (replaces prop drilling) |
| `src/ui/components/BibleToolbar.tsx` | The pane's only persistent control band: back + history menu (no forward button), the bookmark menu, version selector, display mode, parallel toggle, passage settings, chapter nav |
| `src/ui/components/BibleHeader.tsx` | In-content chapter heading with prev/next arrows and book/chapter picker trigger - renders inside the scroll container, so it scrolls with the text rather than being chrome |
| `src/ui/components/BibleVerseList.tsx` | Verse rendering (reading/standard/study modes), search results split panel, parallel view |
| `src/ui/components/bible/PreviewBackBar.tsx` | "Back to John 3:16" - the way home from a cross-chapter preview. Rendered above the toolbar (outside the scroll region) and only when `backBarVerseId` is set; fades out after 30s |
| `src/ui/components/bible/PassageSettingsMenu.tsx` | Gear button in `BibleToolbar`; opens Text Settings directly (no menu) by dispatching `open-preferences-fonts` with its `paneKey`. Pop-out lives on the dockview pane tab |
| `src/ui/components/bible/BookmarkMenu.tsx` | The toolbar's bookmark menu: save the selection, jump to a saved bookmark, open the manager. See [Bookmarks & Collections](bookmarks-collections.md) |
| `src/ui/components/bible/ToolbarPopover.tsx` | Portals a toolbar menu to `<body>` and positions it from its anchor button, so the toolbar's `overflow-hidden` cannot clip it (used by the history dropdown) |
| `src/ui/components/bible/revealNotesPanel.ts` | Finds, activates, or creates the Notes pane for the note-indicator / "Add note" gestures |
| `src/ui/components/bible/SectionHeading.tsx` | Shared verse-0 preface / `formatting.sectionHeading` helpers (`isPrefaceVerse`, `getSectionHeading`, `PREFACE_TEXT_CLASSNAME`, `SectionHeadingBlock`) consumed by `BibleVerseList`, `StudyModeView` and `ParallelBibleView` so all four display modes (Standard, Reading, Study, Parallel) agree on what a preface/heading looks like |
| `src/ui/components/BiblePaneOverlays.tsx` | Overlay/modal components extracted from BiblePane (BookChapterPicker, ModuleSelector, the parallel picker, VerseContextMenu, CopyOptionsDialog, HighlightMenu, FloatingAnnotationToolbar, NotePreviewTooltip) |
| `src/ui/components/ParallelBibleView.tsx` | Side-by-side view of multiple Bible translations |
| `src/ui/components/ModuleSelector.tsx` | Bible module/translation selector dropdown (supports embedded mode) |
| `src/ui/components/BookChapterPicker.tsx` | Passage picker dialog for navigating this panel to a specific passage |
| `src/ui/components/VerseContextMenu.tsx` | Right-click context menu on verses (copy, highlight, note, bookmark) |
| `src/ui/components/VersePreviewTooltip.tsx` | Tooltip showing verse text on hover over references. Renders the formatted `text_html` (not the raw `text` column) and carries `.no-red-letter` when the Bible pane's "Show words of Christ in red" setting is off, so a preview matches the pane |
| `src/ui/components/LiveSearchSuggestions.tsx` | Reference/search suggestions as user types in search bar |

### State

| File | Description |
|---|---|
| `src/ui/stores/useBibleStore.ts` | Zustand store with per-panel-instance state (`panels: Map<panelId, BiblePanelState>`) |
| `src/ui/stores/bible/types.ts` | `BiblePanelState`, `BibleTab`, `DisplayMode` and `DEFAULT_DISPLAY_MODE` |
| `src/ui/stores/bible/slices/passageSlice.ts` | `openPassageInNewPanel` - opens a passage as its own dockview panel, inheriting the source panel's translation, display mode and group |
| `src/ui/stores/bible/slices/verseSlice.ts` | Chapter/verse loading, selection (`setSelectedVerse`, `extendSelectionTo`, `getSelectedRange`), scroll mode |
| `src/ui/stores/bible/slices/navigationSlice.ts` | History cursor, the Back button's visit stack, `goBackVisit`, `canGoBackVisit` |
| `src/ui/stores/bible/slices/tabSlice.ts` | The panel's single passage record (`openTabs`) |
| `src/ui/stores/bible/slices/tabOptionsSlice.ts` | `setDisplayMode`, `setStudyOptions` - writes both the passage record and `studyOptionsByTab` |
| `src/ui/stores/bible/slices/sessionSlice.ts` | Session serialize/restore (`studyOptionsFor`, `BiblePanelSession`) |
| `src/ui/stores/bible/slices/sharedSlice.ts` | Panel lifecycle plus `navigateToVerseInPrimary` |
| `src/ui/stores/bible/slices/previewSlice.ts` | Preview navigation: `navigateToPreview`, `adoptPreview`, `clearPreview`, `dismissBackBar`, `returnFromPreview` - "show me that verse, but don't move my study" (see below) |
| `src/ui/stores/bible/contentKey.ts` | Encode/decode the `abbr\|book\|chapter\|verseId\|displayMode` seed a new panel is created with. A typed reference must fill the verse slot (`NewTabPage` passes `parsed.verseIdStart`) or "John 5:5" opens John 5 with nothing selected |
| `src/ui/stores/bible/internals/navigationHistory.ts` | Pure helpers for the History dropdown's cursor-in-a-list model |
| `src/ui/stores/bible/internals/visitStack.ts` | Pure helpers for the **Back button's** temporal stack of chapters visited - a separate feature from the history (see below) |
| `src/ui/stores/bible/internals/verseRange.ts` | Pure helpers for shift-click passage selection: `computeSelectedRange` (orders the anchor/end pair) and `isInSelectedRange` (the swept verses, excluding the anchor) |
| `src/ui/stores/bible/sessionMigration.ts` | Reads a `sessionData.bible` blob into the current schema; best-effort and non-destructive |
| `src/ui/stores/hooks/useBiblePanel.ts` | Hook returning per-instance state + bound actions for a given panelId |
| `src/ui/stores/helpers/panelStateHelpers.ts` | Shared utilities for per-panel state management |
| `src/ui/stores/syncPanesWithVerse.ts` | `syncPanesWithVerse(verseId)` - points the four following panes (Commentary, Notes, Study, Topics) at a verse |
| `src/ui/stores/crossStoreBridge.ts` | `navigateToVerseInPrimary` / `previewVerseInPrimary` and the setters that wire them |
| `src/ui/stores/storeSync.ts` | `wireStoreSync()`, called once at startup, registers those bridge implementations |

### Architecture

**Per-panel state isolation:** Each Bible panel instance has its own passage, navigation history, verse cache, scroll state, parallel view settings, etc. Multiple Bible panels can show different passages simultaneously. `BiblePanelState.openTabs` is the per-passage record (it owns history, display mode and toggles and keys the verse caches) and holds at most one entry.

**Display modes:** `standard` (verse-per-line with verse number on the left), `reading` (book-like flowing prose with no verse numbers or per-verse boxes - paragraph breaks from `verse.is_paragraph_start` are preserved and non-first paragraphs get a first-line indent), and `study` (see [Interlinear & Study Mode](interlinear-study.md)). The mode is picked per-tab from the display-mode dropdown in the toolbar and persists in the session.

**Study mode gives the verse text its own size.** A study verse is ringed by its own apparatus - footnotes, the inline cross-reference row, the verse-links row - and all of it is `text-sm`. The verse itself carries `.study-verse-text` (globals.css), which is `--pane-font-size-bible` x `--global-font-scale` x `--study-verse-emphasis` (a theme token, themes.css, currently `1.08`). Expressing it as a multiple of the pane's own size is what keeps the emphasis constant as the reader changes the Fonts preferences or the Global Font Scale slider; a pixel value would not survive either. The inline interlinear layout's English line carries the same class, so turning interlinear on cannot shrink the scripture.

`DEFAULT_DISPLAY_MODE` (in `stores/bible/types.ts`) is **`standard`**, and it is the single source for every fresh-panel path: `openBible`, `loadInitialData`, `encodeBibleContentKey`/`decodeBibleContentKey`, the session migration, and the New Tab page's typed-reference seed. Verse numbers are visible out of the box because this is a study app. A restored session keeps whatever mode it saved, and `openPassageInNewPanel` inherits the source passage's mode rather than resetting it.

**Chapter toggles: there is one surface, and it is not the toolbar.** Interlinear and Footnotes are checkboxes in the strip at the top of the chapter (`src/ui/components/study/StudyControls.tsx`, rendered by `StudyModeView`). The strip is the richer control - it also carries cross-references, user cross-references and the inline/stacked interlinear layout choice - and two controls for one preference is one too many.

**Entering Study mode turns interlinear on, and `setDisplayMode` is where that happens.** Every passage is born standard and switched with the toolbar's display-mode dropdown, which goes through `tabOptionsSlice.setDisplayMode`, so that is where the seed lives.

The seed is conditional on `tab.showInterlinear === undefined`, which is why that field is **tri-state**: `undefined` means "never decided", `true`/`false` mean the reader said so. Session restore preserves the distinction (`sessionMigration.normalizeTab` keeps an absent value absent instead of normalising it to `false`), so a passage the reader turned interlinear off for stays off across restarts and across leaving and re-entering Study mode, while one that has never been in Study mode still gets the default the first time. `setDisplayMode` writes both sources of truth in one update - the passage record and `studyOptionsByTab` - for the same reason `openBible` does.

That matters because the session persists the *passage record* (`BibleTab.showInterlinear` / `BibleTab.showNotes`, via `sessionSlice.studyOptionsFor`), not the options map. `tabOptionsSlice.setStudyOptions` therefore writes through to `tab.showInterlinear` / `tab.showNotes` as well as the map, so the surface the reader uses is the one that persists. `StudyModeView` must be given the panel id it belongs to (`useBiblePanel(panelId)`); reading the default panel silently returns `DEFAULT_STUDY_OPTIONS` and makes the checkboxes inert.

**Toolbar menus:** The toolbar sets `overflow-hidden` so its buttons never spill out of a narrow pane, which also clips anything absolutely positioned inside it. The history dropdown and the bookmark menu therefore render through `ToolbarPopover`, which portals to `<body>` and positions itself from the anchor's `getBoundingClientRect()`. Any future toolbar menu must do the same or it will be invisible.

**The parallel toggle knows when there is nothing to compare against.** With fewer than two Bible modules installed, the toggle routes to the Module Manager filtered to Bibles rather than opening an empty picker. With two or more, it prefills slot 1 with this panel's translation and slot 2 with the next installed one, so the picker opens on a usable pair.

**Chapter prefaces and section headings:** Two distinct mechanisms carry Psalm superscriptions and section headings ("The Beatitudes"), and Standard, Reading, Study **and Parallel** mode all handle both:
- `verse.verse === 0` - a literal preface verse, as v1-style modules store it. No verse-number badge is rendered; the verse gets italic, secondary-colored ("preface") styling instead of ordinary body text.
- `verse.formatting.sectionHeading` - how Module Format v2 carries this content (`bible_verse.formatting.block.heading` in the database, projected to `sectionHeading` for the renderer). The heading rides on the verse that follows it (typically verse 1) rather than being stored as its own verse, so it renders as its own italic/secondary block immediately above that verse. Verified against real data: `bible_kjv.db` has no verse-0 rows anywhere - every Psalm superscription in the shipped KJV module arrives this way, attached to verse 1's `formatting`.

Both cases can coexist with no conflict: a preface verse (`verse === 0`) can itself also carry `formatting.sectionHeading` in principle, though no shipped module currently does.

**Book/Chapter picker - section color coding and search fallback:** `BookChapterPicker.tsx` tints each book button by its canonical section (Pentateuch, OT History, Wisdom, Major/Minor Prophets, Gospels, Acts, Pauline, General, Revelation) via `getBibleSection()`, deep-imported from `@bible/core/Services/BibleSections` rather than the `@bible/core` barrel - the barrel's `export * from './Data'` chain drags in modules that assume a filesystem/Node runtime (the same reason `tsconfig.json` maps `@bible/core/*` for the QuickJS guest bundle). Core also publishes `@bible/core/browser`, a barrel restricted to platform-free modules and enforced by `packages/core/src/__tests__/browserBarrel.test.ts`. The tint reuses existing theme-defined hue tokens (`--theme-highlight-*` plus the status colors `warning`/`info`/`danger`/`success`) as a background wash plus a leading accent border - button text is left uncolored so contrast is never at risk under any installed theme, and the book name (always rendered) remains the primary, always-present signal. Typing text that isn't a recognized reference does not fail silently: a "Search for ..." link appears live (once there's no digit in the input, since a digit usually means a reference is still being typed), and submitting unrecognized text runs the same search. Results stream into the same dialog by reading `useSearchStore` (read-only - the picker never mutates that store, only calls its exported `performSearch`); picking a result navigates via the normal `onSelect` path without ever leaving the dialog.

The preface/heading logic (`isPrefaceVerse`, `getSectionHeading`, the shared `PREFACE_TEXT_CLASSNAME` string, and a `SectionHeadingBlock` presentational component) is factored into `src/ui/components/bible/SectionHeading.tsx` rather than duplicated per view - `BibleVerseList` (Standard and Reading), `StudyModeView`, and `ParallelBibleView` all consume it, so the four renderers cannot drift on what counts as a preface or how a heading looks. Only the surrounding layout (paragraph grouping in Reading mode, the verse-number column in Standard/Study, the table cell in Parallel mode) stays per-view, since that markup genuinely differs.

**Parallel mode and section headings:** `ParallelBibleView` renders one `<table>` row per verse *number*, with one `<td>` per translation column, so that verses stay aligned across columns even when translations diverge slightly. A `formatting.sectionHeading` is rendered *inside* the `<td>` of whichever column's verse actually carries it - never as a separate `<tr>` - so a heading present in one translation and absent in another cannot shift that row out of alignment with its neighbors: every column still contributes exactly one cell per verse number, just of different heights. Verse numbers in Parallel mode use the same accent-colored, bold styling as Standard mode.

**The row, not the cell, is the verse in Parallel mode.** `verse_id` is derived from book/chapter/verse, so every column's cell in a `<tr>` carries the *same* id - selection here is verse-level, never translation-level, and `hasSelectedVerse` is computed per row. The `<tr>` therefore carries `.verse-row` and `.verse-selected`, so the hover wash and the selection fill paint as one horizontal band across every column; a per-`<td>` affordance would imply you can select "John 3:16 in the ESV column" as something distinct from the KJV column, and you cannot. Two consequences of putting those classes on a table row: `.verse-row`'s `padding-block`/`padding-inline`/`border-radius` are inert on a `display: table-row` box (harmless - the geometry stays on the `<td>`'s unconditional `px-md py-sm`, so nothing moves on selection), and Chromium refuses to paint a `box-shadow` on a `<tr>` under `border-collapse: collapse`, so the selected row's inset accent bar is grown from `tr.verse-selected > td:first-child` instead (a rule in `themes.css`, flipped for RTL on the same cell since RTL reverses the column order). The verse-number `<button>` uses a `w-9` gutter with `pe-2` - narrower than Standard's `w-11` and Study's `w-10`, because parallel columns are the narrowest surface in the app and gutter pixels come out of the translation text. Parallel mode renders no floating menu of its own (there is no `VerseContextMenu`/`HighlightSelector` around it - see `BibleVerseList`'s parallel branch), so the portal-to-`<body>` rule below has nothing to bite on here yet; any menu added to this view must follow it.

**Standard mode click target:** The whole verse row is the click target, not just the verse-number button, so Standard mode matches Reading mode's click-anywhere-to-select behavior. The row is a plain `<div onClick>` with no `role`/`tabIndex` - it stays out of the accessibility tree as a control, so it does not create a nested-interactive-element violation with the real `<button>` still used for the verse number (kept for keyboard access: Tab to it, Enter/Space fires a native click that bubbles to the row's handler, so there is exactly one place that selects the verse). The number has no `onClick`, `cursor-pointer` or hover fill of its own: a second affordance on the number would tell the reader it does something the rest of the row does not. Its column is `w-11`, narrow enough that the numeral does not read as floating away from its verse.

**The verse row's box is unconditional (`.verse-row` in `themes.css`).** Padding, radius, `cursor: pointer` and the hover wash live on every row whether it is selected or not; `.verse-selected` adds nothing but colour (a background fill and an inset bar). Two things follow:

- *Affordance.* Hovering scripture has to hint it is clickable, so `.word` takes `cursor: inherit` and the row supplies `pointer`; the wash is `--theme-verse-hover-fill`, derived from each theme's own `--theme-bg-hover-rgb` mixed into that theme's page background, so it reads identically in Light, Dark and Sepia rather than being a hardcoded tint. This is what the web app does (`.verse { cursor: pointer }` plus a `--bg-secondary` hover).
- *No layout shift on select.* Padding that arrived **with** the selection would grow the clicked verse's box and push every later verse down the page, and negative margins cannot cancel it because Tailwind's `space-y-*` sets both margins on the rows it separates at a higher specificity. Standard mode therefore uses `space-y-1` and Study mode carries no `space-y-*` at all, letting each row's own padding supply the rhythm.

**Reading mode's selection has no accent bar.** `.verse-selected` is a background fill plus `box-shadow: inset 3px 0 0 0` - a bar down the verse's leading edge. In Standard and Study the verse is a block, so that paints once and reads as a margin marker. Reading mode renders each verse as an inline `<span>` in a flowing paragraph, and the `box-decoration-break: clone` the fill needs (without it the fill paints only around the first line fragment) would clone the bar too, leaving stubby vertical ticks stranded mid-paragraph. `themes.css` therefore adds `.reading-mode .verse-selected { box-shadow: none }` (and the same rule under `[dir="rtl"]`, whose bar is `inset -3px`), leaving the fill alone to carry the selection - which is what the web app does in the same mode. Nothing about the geometry changes, so selecting a verse still cannot reflow the paragraph, and Standard, Study and Parallel are untouched.

**Shift-click selects a passage.** Clicking a verse anchors the selection; shift-clicking another verse widens it to everything between the two. The model is two numbers on the panel - `selectedVerseId` (the *anchor*) and `selectionEndVerseId` (the far end, `null` unless a shift-click set it) - and `internals/verseRange.ts` owns the ordering. Store API: `extendSelectionTo(panelId, verseId)` and `getSelectedRange(panelId)`, which returns an inclusive `{ start, end }` ordered low to high, or `null`.

- **The anchor never moves on shift-click.** Commentary, notes, study and topics panes all follow `selectedVerseId`; if the anchor slid to the far end, widening a passage would reload every dependent pane and read as a navigation. `handleVerseClick(verseId, extend)` therefore returns *before* `syncPanesWithVerse` when `extend` is set. Shift-clicking the anchor itself collapses the range back to one verse; shift-clicking with no anchor yet behaves as a plain click.
- **Ordered on the way out**, so shift-clicking *upwards* (an end numerically below the anchor) produces the same range as clicking down. Without this every `id >= start && id <= end` test downstream silently matches nothing.
- **The swept verses render at a reduced fill** - `.verse-in-range`, `--theme-verse-range-fill` - plus a washed-out leading bar in `--theme-verse-range-border`. The anchor keeps `.verse-selected` (stronger fill plus the full-strength inset accent bar), so the verse the study panes are following stays identifiable. See "Selection strength" below. `isInSelectedRange` excludes the anchor in JS rather than leaving the two CSS rules to out-specify each other. All four display modes carry the class; Parallel mode puts it on the `<tr>`, and its bar is grown from `td:first-child` for the same reason the selection's is.
- **`onMouseDown` preventDefaults, but only when shift is held.** Chromium reads shift+mousedown as "extend the caret selection to here", which sweeps the intervening text: that fights the range wash and, worse, leaves `window.getSelection()` non-empty, so Ctrl+C would do a native text copy instead of opening the copy dialog. A plain mousedown is untouched, so dragging out a phrase to highlight still works. For the same reason the `isTextSelectionActive()` drag guard is skipped for an extending click - a stale selection from an earlier drag must not make shift-click do nothing.
- **Ctrl+C copies the whole range**, and right-clicking *inside* an active range gives the context menu the whole passage with `isMultiple: true` (a live DOM text selection still wins, since a shift-click leaves none). Whole-verse multi-highlight works off `contextMenu.verses`.
- **The range is never persisted.** It lives on `BiblePanelState` only, not on `BibleTab` (which is what the session writes), and every path that sets a plain selection or changes the passage clears it: `setSelectedVerse`, `loadChapter`, `loadVerse`, `navigateToVerse`, `_navigateWithoutHistory`, `openBible` and session restore. Restoring into a half-washed chapter would look like a rendering bug. The web app writes `null` for the same field.
- **There is no Shift+Up/Down keyboard range growth.** The pane has no arrow-key verse cursor at all (the arrow shortcuts are Alt+Up/Down for *chapters*), so growing a range by keyboard would mean inventing a verse-level focus model and its scroll-following behaviour first. Out of scope here, and the web app has none either. Ctrl/Cmd-click non-contiguous selection is likewise deliberately absent, matching the web app.

**Note indicators:** A verse with notes shows a note icon (`versesWithNotes`). Clicking it selects the verse, reveals the Notes pane via `revealNotesPanel()` - activating an existing one, or adding one to the right-hand Study/Commentary group when the layout has none - then syncs the notes panes to the verse and dispatches `open-verse-note`. The verse context menu's "Add note" and the note preview tooltip's "click to view full note" go through the same helper.

**Opening another passage:** a passage is a dockview panel, so "open in a new tab" means "add a panel". Entry points: the dockview `+` (New tab) -> `NewTabPage`; Ctrl/Cmd-click on a scripture reference in a commentary or note; `openPassageInNewPanel(book, chapter, verse, sourcePanelId)` in the store. The new panel docks into the source panel's group so passages stay together. Splitting and moving passages is dockview's tab context menu (`DockviewTabRenderer`), not the pane's.

**Session restore:** `sessionData.bible` is schema v2 - `{ version, panels: { [panelId]: { tab, isParallelViewMode, parallelVersions } } }` - with the v1 `openTabs`/`current*` fields also written as a mirror of the primary panel for downgrade safety. `migrateBibleSession` expands a v1 blob so each sub-tab becomes its own panel: the passage that was in front takes the layout's primary Bible panel and the rest become `pendingPanelCreations`, which `DockviewLayout` materialises once dockview is ready. Anything unreadable degrades to "no panels", which falls through to the normal default layout rather than a blank window.

**Navigation history:** `stores/bible/internals/navigationHistory.ts` is the whole rule set. An entry is a *passage*: `addHistoryEntry` dedupes on (book, chapter), so re-visiting a chapter moves its entry to the end rather than listing it twice. `addHistoryEntry(slot, entry, { replace: true })` - reached via `loadChapter(panelId, book, chapter, { replaceHistory: true })` - modifies the entry the cursor is on instead of appending, and is used by the *sequential* paths only: the prev/next chapter buttons and Alt+Up/Down, wired through `pageToChapter` in `BiblePane`. Jumps (search result, reference, cross-reference) append. Replacing pops only the current entry, so no other chapter's remembered verse is disturbed.

**There is no forward button, and no Alt+Right.** Back is the common gesture; everything ahead of the cursor is reachable by name from the history menu. The store has `goForward` / `canGoForward` (the cursor genuinely can move forward, via the menu), but nothing in the pane's UI or context plumbing calls them. Because there is no Forward control there is also **no redo stack** for the Back button below - Back only ever pops.

**The Back button is not the history cursor.** `internals/visitStack.ts` is a second, independent record: a plain temporal stack of chapters actually viewed, newest last, capped at 50. Back means *undo my last view change*, which the history model cannot express, for three reasons - it dedupes by (book, chapter) so temporal order is lost, sequential paging replaces rather than appends, and appending truncates forward history so a backwards jump from the menu would be a one-way trip.

- **Every** chapter change pushes a visit: `loadChapter` (typed reference, picker, prev/next paging), `navigateToVerse` (search result, cross-reference, topic), and `_navigateWithoutHistory` - which means a pick from the history dropdown counts too. That last one is the point: jumping back by name is itself a visit, so Back afterwards returns the reader to where they were, even though that is "forward" in the menu's list.
- Consecutive duplicates are not stacked (navigating within the chapter already on top refreshes that entry instead), but **non-adjacent repeats are kept** - leaving a chapter and coming back later is genuinely two visits.
- `goBackVisit` pops, then navigates with `{ recordVisit: false }` so the navigation it performs does not push itself back on. The Back control is enabled from the visit stack (`canGoBackVisit`, i.e. more than one entry), not from the history cursor's `canGoBack`.
- The two features touch at exactly one point: after Back moves the panel, the history cursor is re-pointed at the chapter now on screen (moved to the matching entry when there is one, otherwise recorded over the current entry the way paging does) so the dropdown's "you are here" marker stays truthful. Back never grows the menu by a row per press.
- The stack persists with the session as `BiblePanelSession.visitStack`. The field is optional and additive, so no schema version bump: a session written without a stack restores with the single entry a freshly opened passage has (Back correctly disabled). `normalizeVisitStack` sanitizes entry by entry, so a corrupt stack degrades to that same seeded state instead of failing the restore.

**Scroll modes are sticky, so every navigation must set one.** `scrollMode` lives on the panel: `'center'` after a navigation, `'nearest'` after a verse click. `loadChapter` resets it to `'nearest'`, because a stale `'center'` would make the next plain verse click take the scroll-restore branch in `useBibleScrolling` and jump to an old offset. That branch additionally requires the current history entry to describe the chapter actually on screen, since a saved `scrollTop` is meaningless in another chapter. In `'nearest'` mode a click on a verse that is already *substantially* visible (half of it, or filling the viewport) scrolls nothing - requiring it to be *fully* visible would yank a long or edge-clipped verse into view even though the reader is looking right at it. `ParallelBibleView` honours the same `scrollMode` guard.

**Preview navigation - "show me that verse, but don't move my study."** `stores/bible/slices/previewSlice.ts` is the whole feature. A study session has one verse at the centre of it: the commentary, notes, study and topics panes all follow `selectedVerseId`. Reading, though, is full of side trips - a cross-reference, a passage in a topic list, a citation inside a commentary entry, a reference in a note - and following one of those must not relocate the whole workspace. The model is **two verses per panel**:

- `selectedVerseId` - what the reader *chose*. Every study pane follows it.
- `previewVerseId` - what they are *looking at*. Nothing follows it.

`previewVerseId`, `previewVerseEndId` (a link can point at a range: "Rom 8:28-30") and `backBarVerseId` live on `BiblePanelState` in `stores/bible/types.ts`, default to `null`, and are surfaced through `useBiblePanel` and `BiblePaneContext` like every other per-panel field.

- **Same chapter: mark and scroll, nothing else.** No history entry, no visit, no back bar - the verse the reader came from is still on screen, so a bar offering to take them back to it would be noise.
- **Different chapter: load it, and leave the selection behind.** `selectedVerseId` deliberately keeps pointing *outside* the loaded chapter - that is the state that says "the study is still back there", and it is what the back bar and the panes' suggestion banners read. The preview does push history and a visit, so Back works out of a preview even after the bar is gone. A **chain** of previews keeps naming the original verse (`backBarVerseId: ps.backBarVerseId ?? returnTo`), not the previous hop.
- **Any real selection ends it.** `setSelectedVerse`, `extendSelectionTo` and `navigateToVerse` all clear the three fields. Choosing a verse is exactly the decision the preview was withholding, and leaving the soft mark behind would leave two verses claiming to be current.
- `adoptPreview(panelId)` promotes the preview to the real selection (writing the passage record too) and **returns the verse id** rather than broadcasting it - the caller knows which panes it wants to move, and the slice knows nothing about them. `returnFromPreview` clears first, then navigates to `backBarVerseId`. `dismissBackBar` hides only the bar: the mark is still telling the truth about which verse the study panes are *not* on.

**The panes are offered the verse, not moved to it.** `storeSync.wireStoreSync` registers `setPreviewVerseInPrimary`, which calls `navigateToPreview` on the last active Bible panel and then `useStudyStore.suggestPanelsWithVerse` / `useTopicsStore.suggestPanelsWithVerse` - actions that raise those stores' suggestion banners instead of navigating. Notes are deliberately not offered: a note is something the reader wrote about a verse, and glancing at a cross-reference does not ask to open a different one. The Commentary pane's chapter-follow effect **stands down while a preview is active** (`if (biblePreviewVerseId !== null) return;`) and raises a `SuggestionBanner` ("Show commentary for ...") instead; taking it calls `adoptPreview` on the Bible panel as well, so the mark gives way to the selection and the bar comes down.

**Cross-panel navigation:** `navigateToVerseInPrimary(verseId)` is a convenience method used by search results and other deliberate jumps to navigate the primary Bible panel without needing to know its panelId. `previewVerseInPrimary(verseId, endVerseId?)` in `stores/crossStoreBridge.ts` is its soft counterpart and is what every scripture *link* calls - `commentary/CommentaryEntryView.tsx`, `notes/editor/NoteViewer.tsx`, `study/StudyRichText.tsx`, `StudyPane.tsx`, `TopicsPane.tsx` and `hooks/useScriptureTooltip.ts`. When the bridge is unwired (unit tests, the detached-window renderer) it falls back to `navigateToVerseInPrimary`: showing the verse is always better than doing nothing, and the fallback only loses the softness.

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/bibleHandlers.ts` | IPC handlers for fetching chapters, verses, and Bible data |

### Hooks

| File | Description |
|---|---|
| `src/ui/hooks/useOverlayDismissal.ts` | Reusable hook for closing overlays on outside click or Escape (used by tab context menus) |
| `src/ui/hooks/useBibleScrolling.ts` | Scroll position save/restore, verse centering, history navigation scroll helpers |
| `src/ui/hooks/useBibleHighlights.ts` | Highlight state, floating annotation toolbar, highlight menu, DOM selection builder |
| `src/ui/hooks/useBibleSelection.ts` | Owns "the selection is finished": schedules the word-boundary expansion and the floating toolbar on mouseup, and cancels both when a new gesture starts (see below) |
| `src/ui/hooks/useBibleKeyboard.ts` | All keyboard shortcuts (Ctrl+C, Alt+Left/Up/Down, Ctrl+G/D/U, Ctrl+Shift+H/N) and, via `useBibleFind`, find-in-page |
| `src/ui/hooks/verseScrollTarget.ts` | `findVerseElement` / `restartArrivalFlash`, shared by `useBibleScrolling` and `StudyModeView` |
| `src/ui/components/bible/hooks/useBiblePaneContextValue.ts` | Assembles the `BiblePaneContext` value from the hooks below |
| `src/ui/components/bible/hooks/useVerseInteractionHandlers.ts` | Verse click / shift-click / context-menu / note-indicator handlers |
| `src/ui/components/bible/hooks/useVersesWithNotes.ts` | Loads the `versesWithNotes` set for the visible chapter |
| `src/ui/components/bible/hooks/useNoteTooltip.ts` | Note-indicator hover tooltip |
| `src/ui/components/bible/hooks/useBibleNavigation.ts` | Chapter paging and reference navigation wiring |
| `src/ui/components/bible/hooks/useHistoryDropdown.ts` | The toolbar's history menu |
| `src/ui/components/bible/hooks/useContentKeyInit.ts` | Seeds a new panel from its `contentKey` |
| `src/ui/components/bible/hooks/useSessionPanelRestore.ts` | Restores a panel's passage from the session |
| `src/ui/components/bible/hooks/useDetachedInit.ts` | Init path for a popped-out Bible window |
| `src/ui/components/bible/hooks/useDockviewTitleSync.ts` | Keeps the dockview tab title on the current passage |
| `src/ui/components/bible/hooks/useBookPickerOverlay.ts`, `useModulePickerOverlay.ts`, `useParallelPickerOverlay.ts`, `useVerseContextMenu.ts`, `useCopyDialog.ts`, `useBibleTabActions.ts`, `useInitialDataLoader.ts` | The remaining overlay/action hooks `BiblePane` wires together |

### Utilities

| File | Description |
|---|---|
| `src/ui/utils/verseFormatting.ts` | Verse formatting helpers; book names come from `@bible/core`, the abbreviation table is local |
| `src/ui/utils/verseParser.ts` | Parses verse reference strings (strict: rejects chapter/verse 0 and reversed ranges) |
| `src/ui/utils/verseReference.ts` | Verse reference utilities; owns the module-language book-name cache |
| `src/ui/utils/wordIndexing.ts` | Word-level indexing for interlinear alignment |
| `src/ui/utils/selectionUtils.ts` | Text selection utilities for verse copying - a pure operation on the current selection, with no timers of its own |
| `src/ui/services/verseReferenceParser.ts` | Parses user-entered verse references |
| `src/ui/services/verseRangeService.ts` | Handles verse range resolution |

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/bible-pane.spec.ts` | Bible pane navigation, display, and interaction tests |

### Unit / Component Tests

| File | Description |
|---|---|
| `src/ui/components/BibleToolbar.test.tsx` | History dropdown and gear menu (including that both escape the toolbar's overflow clip), and that no Interlinear/Notes toggles render in any display mode - asserted so the duplicate surface cannot quietly appear |
| `src/ui/components/BiblePane.test.tsx` | Pane composition - no in-pane tab strip, one chrome band |
| `src/ui/components/bible/revealNotesPanel.test.ts` | Activating vs. creating the Notes pane, and where a new one is placed |
| `src/ui/components/bible/studyOptionsWiring.test.tsx` | The chapter-top Interlinear/Footnotes checkboxes reach Study mode through the correct panel's study options, and write through to the passage record the session saves |
| `src/ui/components/bible/PreviewBackBar.test.tsx` | The back bar: absent with nowhere to go, names the verse left behind, back and dismiss actions, the 30s fade-then-dismiss, and a fresh clock when the target changes |
| `src/ui/components/bible/hooks/useVerseInteractionHandlers.test.tsx` | Note-indicator click reveals the Notes pane and opens the verse note; an extending click widens the passage without re-anchoring or reloading the dependent panes; right-click inside a range acts on the range |
| `src/ui/components/BibleVerseList.test.tsx` | Standard-mode whole-row click target, verse-0 preface styling, `formatting.sectionHeading` rendering, accent-colored verse numbers; same preface/heading cases in Reading mode; shift-click passage selection in Standard and Reading (the shift key reaching the handler, the drag guard not swallowing it, the shift-only `preventDefault`, and `.verse-in-range` on the swept verses in both directions) |
| `src/ui/components/study/StudyModeView.preface.test.tsx` | Verse-0 preface styling and `formatting.sectionHeading` rendering in Study mode |
| `src/ui/components/study/StudyModeView.studyRow.test.tsx` | Study-mode cross-references, interlinear rendering, verse-text click selection, and shift-click passage selection from both click targets (text and verse number) plus `.verse-in-range` |
| `src/ui/components/ParallelBibleView.test.tsx` | Column headers, resize handles, loading state; verse-0 preface styling, `formatting.sectionHeading` rendering (including that a heading in one column's translation does not shift row alignment with the other columns), and accent-colored verse numbers in Parallel mode; the whole-row `.verse-row` affordance, the verse number as keyboard-only target, that selection changes colour without touching row/cell geometry, and shift-click range selection on the `<tr>` |
| `src/ui/stores/__tests__/useBibleStore.defaults.test.ts` | Fresh-profile display-mode defaults |
| `src/ui/stores/__tests__/useBibleStore.preview.test.ts` | Preview navigation in the store: same-chapter marks and scrolls without a back bar, a cross-chapter preview loads the chapter but leaves `selectedVerseId` where the reader put it, a chain keeps naming the original verse, ranges, and every way a preview ends (click, shift-click, deliberate navigation, adopt, back, dismiss, clear) |
| `src/ui/stores/bible/slices/verseSlice.chapterNav.test.ts` | Chapter paging resets the selected verse, and replaces the current history entry instead of appending one per chapter |
| `src/ui/stores/bible/slices/verseSlice.rangeSelection.test.ts` | Shift-click passage selection in the store: the anchor never moves, upward shift-clicks come back ordered, re-clicking the anchor collapses, every re-selecting/re-navigating path clears the range, and the range never reaches the persisted tab |
| `src/ui/stores/bible/internals/visitStack.test.ts` | The Back button's pure stack helpers: consecutive duplicates collapse, non-adjacent repeats are kept, the cap drops the oldest end, a persisted stack is sanitized |
| `src/ui/stores/bible/slices/navigationSlice.visitStack.test.ts` | Back through the store: a visit per navigation cause, paging walks back a chapter at a time, Back after a backwards dropdown jump returns to where you were, history-cursor sync, session round-trip and missing/corrupt-session fallback |
| `src/ui/stores/bible/contentKey.test.ts` | A parsed "John 5:5" seeds the panel with its verse |
| `src/ui/hooks/useBibleKeyboard.copy.test.tsx` | Which Ctrl+C the Bible pane answers (see "Ctrl+C" below) |

**Text selection.** Two rules live in `useBibleSelection`:

1. *Nothing touches the selection while a button is down.* `expandSelectionToWordBoundaries` calls `setBaseAndExtent`. Doing that mid-drag replaces the selection Chromium is actively extending, and Chromium goes on extending from *its* remembered anchor - the selection blows out to the end of the block and the re-render that follows freezes the pane with it. There is therefore no `onDoubleClick` handler on the scroll container: a double click ends in a mouseup, so the mouseup path covers it.
2. *A new gesture cancels the previous gesture's pending work.* The floating toolbar is scheduled 50ms after a mouseup, and pressing down again inside that window cancels it rather than popping it up over a drag that has barely started.

**Overlays must portal to `<body>`.** dockview's root (`.dv-dockview`) sets `contain: layout`, which makes it the containing block for every `position: fixed` descendant. Anything positioned from `getBoundingClientRect()` or `clientX/clientY` and rendered *inside* a panel therefore measures against the viewport but paints relative to the dockview root, landing off by exactly that root's offset. `VerseContextMenu`, `HighlightMenu` and `FloatingAnnotationToolbar` all `createPortal` to `document.body` for this reason. Note this is a *different* trap from the toolbar-menu one above (`overflow: hidden` clipping, solved by `ToolbarPopover`); a new overlay can hit either.

`FloatingAnnotationToolbar` also places itself **below** the selection by preference (flipping above only when there is no room below) and aligns to the selection's leading edge rather than centring on it - a centred toolbar is wider than most phrase selections and would overhang their left edge. It measures `range.getClientRects()`, not the bounding box: a wrapped selection's bounding box is as wide as the paragraph, and its left edge belongs to no line the reader actually selected.

## Choosing a verse, and following a link to one

Two different gestures, two different treatments.

### A verse the reader chose

`stores/syncPanesWithVerse.ts` points the four following panes (Commentary, Notes, Study, Topics) at a verse. None of them subscribes to `selectedVerseId`; each is *pushed* to. Every route to a verse has to make that push, or reaching a verse by that route would leave the study panes on the previous one. Callers are `useVerseInteractionHandlers.handleVerseClick`, `TopSearchBar` (`handleReferenceNavigation` and `handleSelectSuggestion`) and `SearchResultsPane` (both result kinds).

Shift-click deliberately skips it: the anchor has not moved.

### A verse a link landed on

`previewVerseId` (see `stores/bible/slices/previewSlice.ts`) marks a verse the reader is glancing at, and deliberately leaves `selectedVerseId` alone. `useBibleScrolling` therefore cannot scroll `selectedVerseRef`, which is attached only to the *selected* verse: same-chapter that would centre the verse the reader came FROM, and cross-chapter (where the selection points outside the loaded chapter and nothing carries the ref) it would scroll nothing at all. It prefers `previewVerseId`, found by `data-verse-id` inside the pane's own container - `hooks/verseScrollTarget.ts`, shared with `StudyModeView`, which runs its own scroll effect because Study mode withholds its verses until the chapter's study data lands. A preview also overrides a saved scroll offset, which would otherwise put the reader back where they were and leave the link looking broken.

The arrival mark: `.verse-preview` is a 2px solid accent outline with `outline-offset: -2px`, plus `verse-arrival-flash`, a light-blue background (`--theme-verse-flash-fill`) that fades to `transparent` over 1.6s. Deliberately not the selection treatment - fill plus solid bar means "this is the verse every pane is showing", which a glance is not. Two properties make it safe: `outline` occupies no space, so previewing cannot reflow the chapter, and ending the flash at `transparent` means a user highlight underneath is briefly tinted and then fully itself again. (That is also why it is not the web app's underline: Study mode puts the class on a block that contains footnote and cross-reference rows, and `text-decoration` would strike through all of them.) `restartArrivalFlash` re-arms the animation by toggling `.verse-flash` around a forced reflow, because a CSS animation only fires when its class is *applied* and two links to the same verse change no class. Suppressed under `prefers-reduced-motion`. `BibleVerseList` applies the preview class in Reading and Standard, `StudyModeView` in Study; both exclude the verse when it is also `selectedVerseId`, and `.verse-selected.verse-preview` drops the outline as a belt-and-braces rule.

## Ctrl+C

`useBibleKeyboard` decides whether a Ctrl+C belongs to the Bible pane. It cannot decide purely from where the DOM caret is, because that is wrong for this app's selection model: a shift-click passage is built *without* a DOM selection (the mousedown is preventDefaulted so the browser cannot sweep text across verse rows), and the Ctrl+L reference flow blurs the search box without planting a caret in the pane.

The order is: a text selection inside the pane copies that text; focus in an input/textarea/contenteditable yields; a text selection anywhere else yields; with several Bible panes open only `lastActiveBiblePanelId` answers; otherwise the verse selection is copied. Covered by `hooks/useBibleKeyboard.copy.test.tsx`.

## Selection strength

`--theme-verse-range-fill` is a 9% mix of the selection colour into the page background, and the swept verses carry a leading bar in `--theme-verse-range-border` (the accent washed 55% toward the page). The anchor is stronger - a 12% fill and a full-strength bar - which is the distinction that matters. The range bar needs the same two carve-outs `.verse-selected` has: none in reading mode (`box-decoration-break: clone` would clone it per line fragment), and grown from `td:first-child` in parallel mode (Chromium will not paint a box-shadow on a `<tr>` under `border-collapse: collapse`).

### Related Features

- [Interlinear & Study Mode](interlinear-study.md) - Study display mode
- [Commentary](commentary.md) - Syncs with Bible navigation
- [Highlights](highlights.md) - Verse highlighting integration
- [Bookmarks & Collections](bookmarks-collections.md) - The toolbar bookmark menu and verse ribbons
