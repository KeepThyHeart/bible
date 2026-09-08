# Books & Dictionaries

**Last verified:** 2026-09-08

Reading panes for book modules and dictionaries. (Devotional modules are recognized by the module registry and the Module Manager, but no pane reads them - see "Not implemented".)

**Two content types, one component, two panes.** `'book'` and `'dictionary'` are both first-class `PanelContentType`s with their own entry points, their own stores and their own pane slots - Dictionary is in the default layout and in Study Mode's column, Books is opened on demand. What they share is the *component*: `BookPane` is registered for both, rendering book content or delegating to `DictionaryPane`.

They are **segregated**. `BookPane` takes a `paneKind` prop (`'book' | 'dictionary'`), fixed for the pane's lifetime and supplied by `PanelContentRenderer` from the panel's content type; every list in the pane filters by it. See "One kind per pane" below. The data models genuinely differ (books are hierarchical sections with a reading position, dictionaries a flat key -> record lookup) and so do their IPC channels. See [dictionary.md](dictionary.md).

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/BookPane.tsx` | The pane behind both content types. `paneKind` decides which it is; the tab strip, shelf, selector and empty state all filter by it |
| `src/ui/components/BookPane/BookHome.tsx` | A book's Home page: full-text search over the book plus its table of contents inline |
| `src/ui/components/BookPane/BookSectionTree.tsx` | The expandable contents tree, shared by `BookHome` and the `BookTreeView` dialog |
| `src/ui/components/BookPane/BookNavigationToolbar.tsx` | The book toolbar: previous/next/up section arrows with destination-naming tooltips, and the text-settings gear |
| `src/ui/components/BookPane/BookModuleSelectorModal.tsx` | The "+" module picker, listing this pane's kind only |
| `src/ui/components/shared/PaneToolbar.tsx` | The shared band of flush icon cells and its icon set, worn by the Bible, Books and Dictionary toolbars |
| `src/ui/components/shared/PaneOverlay.tsx` | Portalled modal backdrop - see "Dialogs and the pane splitter" below |
| `src/ui/components/BookPane/tabOrder.ts` | Pure ordering model for the unified tab strip: `mergeTabOrder` reconciles a stored order against what is open, `moveTab` moves an entry, `indexWithinType` translates a strip position into a per-store index |
| `src/ui/components/BookPane/moveIntoBooksPane.ts` | Moves a module out of a single-module panel and back into the multi-tab Books pane as a tab, carrying its reading position |
| `src/ui/components/paneIcons.ts` | Per-content-type glyphs, shared by the dockview panel header and the Books pane's own tab strip |
| `src/ui/components/LibraryHome.tsx` | Overview shelf listing every installed module of the pane's own `kind`, filterable, marking those already open |
| `src/ui/components/book/BookSinglePanel.tsx` | Lightweight single-book panel (one module, section navigation, no tab bar) |
| `src/ui/components/BookTreeView.tsx` | The contents dialog, used by `BookSinglePanel`. `BookPane` shows the same tree inline on its Home page |
| `src/ui/components/DictionaryPane.tsx` | Dictionary entry display (rendered inside `BookPane` when a dictionary tab is active, with `hideTabs`) |
| `src/ui/components/dictionary/DictionaryLiveSearch.tsx` | The dictionary half's search box - as-you-type matches under the field. See [dictionary.md](dictionary.md) |
| `src/ui/components/BookPane/showDictionaryPane.ts` | The `bible:show-dictionary-pane` DOM event (`SHOW_DICTIONARY_PANE_EVENT`), which lets an outside caller (a Strong's-number click) dismiss the Overview shelf covering a lookup it just routed there |
| `src/ui/stores/helpers/panelDisposal.ts` | `destroyPanelState` - clears both stores for a panel dockview has actually removed (it also has a `'search'` branch; see [search.md](search.md)) |
| `src/ui/stores/helpers/sessionPanelSelection.ts` | `sessionPanelState` - resolves which panel the session serializers should save, via the layout |
| `src/ui/stores/helpers/bookDictPanelTypes.ts` | `BOOK_DICT_PANEL_TYPES`, the `['book', 'dictionary']` content-type pair, shared by save and restore |
| `src/ui/components/dictionary/DictionarySinglePanel.tsx` | Lightweight single-dictionary panel (one module, lookup/browse, no tab bar) |
| `src/ui/components/DraggableTabBar.tsx` | Reorderable tab bar (shared with BiblePane) |
| `src/ui/components/ModuleSelector.tsx` | Module selector (used with embedded mode for book/dictionary selection) |
| `src/ui/components/bible/revealDictionaryPanel.ts` | Reveals the on-screen Dictionary pane, creating one when the layout has none, and returns its real dockview panel id. A Strong's number click routes `useDictionaryStore.lookupStrongsNumber` through this rather than the fixed `DEFAULT_PANEL_ID`, since a pane on screen is always keyed by dockview's generated panel id. It does not fall back to a Books pane, which lists no dictionary tabs. Mirrors `src/ui/components/bible/revealNotesPanel.ts` |

### State

| File | Description |
|---|---|
| `src/ui/stores/useBookStore.ts` | Zustand store with per-panel-instance state (`panels: Map<panelId, BookPanelState>`) |
| `src/ui/stores/hooks/useBookPanel.ts` | Hook returning per-instance state + bound actions for a given panelId |
| `src/ui/stores/useDictionaryStore.ts` | Zustand store with per-panel-instance state (`panels: Map<panelId, DictionaryPanelState>`) |
| `src/ui/stores/hooks/useDictionaryPanel.ts` | Hook returning per-instance dictionary state + actions for a given panelId |
| `src/ui/stores/helpers/panelStateHelpers.ts` | Shared utilities for per-panel state management |
| `src/ui/stores/helpers/createPanelSlice.ts` | The panel *lifecycle* slice: `initPanel` / `detachPanel` / `destroyPanel` / `getPanelState`, plus the `retainOnDetach` contract |
| `src/ui/stores/helpers/createPanelTabsSlice.ts` | The panel *tab strip* slice, shared by both stores: `setActiveTab`, `reorderTabs`, `closeTab` (re-exported as `closeBook` / `closeDictionary`) and `clearError`, plus `withTabValues` / `withoutTabValues` for the per-tab `Map` bookkeeping. See "One tab strip, one implementation" below |

### Architecture

**Dual-mode panels:** Users can add either a full `BookPane` (multi-tab with books + dictionaries) or a lightweight `BookSinglePanel`/`DictionarySinglePanel` (one specific module). A single-module panel is created by the "Open in own panel" / "Split right" / "Split down" actions described below - dockview panel headers have no per-module submenu.

**Per-panel state isolation:** Each book/dictionary panel instance has its own open tabs, active section, and content state.

**One tab strip, one implementation:** the two stores model different content but present it through the same strip, so everything *about the strip* is shared rather than written twice. `createPanelTabsSlice` owns selecting a tab, reordering one, closing one (including the index arithmetic for what becomes active, and clearing every per-tab cache keyed to the closed module) and dismissing a tab's error. Each store spreads it under its own names, so call sites read `closeBook` / `closeDictionary`.

Two details worth knowing:

- The maps a close clears are **discovered from the store's default panel state** (any field that is a `Map`), not listed by hand. A hand-written list is a second place to remember, and a map added later without a matching edit leaks a closed tab's content into the next module opened under the same abbreviation.
- `withTabValues(state, abbreviation, { loadingByTab: true, errorByTab: null })` is how a fetch sets its per-tab flags. It is typed against the panel state, so naming a field that is not a per-tab map - or writing the wrong value type into one - is a compile error.

What is *not* shared stays unshared: opening a tab, loading content, and session restore all differ per content type.

**One kind per pane:** `paneKind` is what separates Books from Dictionary. A pane holds one kind for its whole lifetime, so somebody who opened "Dictionary" is never two clicks from a bookshelf with nothing to tell them which pane they are in. Dictionaries are the common case and have lookup-shaped controls; books are rarer and read straight through.

Every surface filters:

| Surface | How it filters |
|---|---|
| Tab strip | `mergeTabOrder` is passed this pane's kind only, so refs for the other kind are never rendered (both panes share one `BookPanelState`, so those refs do survive in `tabOrder`) |
| `BookModuleSelectorModal` | Lists one kind, with no Books/Dictionaries switcher |
| `LibraryHome` | Takes a `kind` and renders one section |
| Empty state | Offers a book *or* a dictionary, not both |
| `moveIntoBooksPane` | Looks for - and creates - a pane of the module's own kind |
| `revealDictionaryPanel` | No Books-pane fallback |
| `popOutModule` / `DockviewTabRenderer` | Put `paneKind` in the detach payload, so a popped-out dictionary is a dictionary window |

**Tab strip order:** The order is held per panel in `BookPanelState.tabOrder` (a list of `{type, abbreviation}` refs) rather than derived from the content store, so a module opened by any route lands where the reader put it. `BookPane` reconciles it against what is actually open each render (`mergeTabOrder`): refs for closed modules are dropped and open modules with no ref yet - one opened by a Strong's-number click, a session restore, a detached window - are appended. So only drag-reorder maintains it explicitly. A drag writes the new strip order and mirrors the move into the content store, keeping the store's array matching the screen. `tabOrder` is persisted with the session.

**Panel lifecycle - detach vs. destroy:** A pane component unmounting is *not* the pane closing, and the two must not be conflated: `DictionaryPane` is rendered conditionally inside `BookPane`, so switching to a book tab unmounts it, and the session serializers read the same live state map that a delete would empty. Layout-preset rebuilds and React StrictMode's double-invoked effects unmount panes the same way.

The lifecycle is therefore split:

- **`detachPanel`** (unmount) keeps what identifies the pane - open tabs, which is active, `tabOrder`, and each tab's reading position (`currentSectionByTab` for books, `entriesByTab` for dictionaries, both of which the session persists). It resets caches (browse pages, search results, section bodies, table of contents) and *every* loading/error flag, so a pane that unmounted mid-fetch cannot come back stuck on a spinner nothing will clear. A store opts in by passing `retainOnDetach` to `createPanelSlice`; without it `detachPanel` is a no-op, so adopting the call is never lossy.
- **`destroyPanel`** deletes the entry and is called only from dockview's `onDidRemovePanel` in `src/ui/components/DockviewLayout.tsx`, via `destroyPanelState`. Both stores are cleared together, because one dockview panel owns an entry in each.

**Session save picks the panel the layout has:** `sessionPanelState` resolves which panel to serialize through the layout store, matching the restore side's `panelIdFromLayout` (`src/ui/services/AppInitService.ts`). Note this does **not** make two Books panes both persist: `SessionData` still holds one blob per content type. It only makes *which* one deterministic.

**Overview shelf:** A fixed tab sits ahead of the module tabs (rendered as the tab bar's `prefixContent`, so it owns no `role="tab"` and deselects every real tab while showing). It lists every installed module of the pane's kind, filterable, marking the ones already open - picking one of those switches to its tab rather than opening a duplicate. This mirrors Commentary's Overview tab.

It is labelled **Overview** on a Dictionary pane and **New Tab** on a Books pane. What the Books shelf holds is a list of books you have not opened yet, which is what pressing + is for; on the Dictionary pane the shelf is the pane's home, and the one a reader lands on.

The shelf **opens by default on a pane with nothing in it**, and stays out of the way on one that already has a tab (lazy initial state, not an effect - correcting it after the first render would flash the other view). "Navigating to Dictionary should land on Overview" is a statement about an empty pane: the shelf is how you *find* a module, so it is right when you have none open and wrong when you already have the one you came for. The onboarding empty state is what shows if the shelf is then dismissed with nothing open.

**A book's Home page:** A book with no section showing is on its Home page - `BookHome`, which is a search box over the book's full text plus its table of contents as an expandable tree (root level only to start; a large reference work has thousands of sections). A book is the one study module you cannot navigate by reference, so the way in is its structure and its text: `openBook` loads only the section summaries and leaves the reading position null, and `navigateToHome` is how the breadcrumb Home returns there.

Search runs against `book_section_fts` (`packages/core/src/Data/Repositories/BookRepository.ts#searchSections`) through the `book:searchSections` channel. Hits are listed with their section titles, and the contents tree below opens the path down to each one, so "which chapter mentions this" is one query rather than a manual walk. Responses are sequenced against the query that asked for them, so a slow search for `gr` cannot land after a fast one for `grace`.

**Toolbars:** `BookNavigationToolbar` and the Dictionary toolbar are both built from `shared/PaneToolbar.tsx`, the same band of flush icon cells the Bible pane uses. `bible/PassageSettingsMenu` takes a `paneKey` and is the single text-settings ("Aa") button across every pane.

**Dialogs and the pane splitter:** Dockview's `.dv-dockview` sets `contain: layout`, which makes it both a stacking context *and* the containing block for `position: fixed` descendants. A `fixed inset-0 ... z-50` backdrop rendered inside a pane therefore never reaches the document, and its z-index competes with `.dv-sash { z-index: 99 }` - dockview's own splitter - inside that same context. 99 wins, so the drag handle paints over the dialog and lights up on hover *through* it.

`shared/PaneOverlay.tsx` is the answer: it portals the backdrop to `<body>`, where an ordinary modal z-index is enough again - the same approach `bible/ToolbarPopover` uses for the toolbar menus. `BookTreeView`, `BookModuleSelectorModal`, `ModuleSelector` and the dictionary Browse dialog all go through it.

**Tab markers:** Each tab carries its type glyph (`paneIcons.ts`, the same glyphs the dockview header uses) and is shaded once its content has loaded. The type is announced through the tab's accessible name (`"{label} {subtitle}"`), not the glyph, which is decorative.

**Open in own panel:** Available two ways - the pane options menu in the tab bar, acting on the active tab, and right-click on a tab (which also offers "Split right" / "Split down"). Either creates a standalone `BookSinglePanel` or `DictionarySinglePanel` dockview panel and removes the tab from the source multi-tab pane.

**Move into Books pane:** The reverse gesture, a toolbar button in `BookSinglePanel` and `DictionarySinglePanel` (`moveIntoBooksPane.ts`). It reopens the module as a tab in the multi-tab Books pane - joining an existing one, or creating one when none is open - and closes the single-module panel. The reading position travels with it: the book reopens on its current section, the dictionary on its current entry.

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/bookHandlers.ts` | IPC handlers for fetching book content, including `book:searchSections`, the full-text search over `book_section_fts` that backs the Home page's search box |
| `electron/services/installedModules.ts` | Filters `module_metadata` down to modules whose `.db` file is on disk, so the Library shelf and the module selector never offer a book or dictionary that cannot be opened. See [dictionary.md](dictionary.md) |

### Unit tests

| File | Description |
|---|---|
| `src/ui/components/BookPane.test.tsx` | The pane: one kind per strip, the shelf's default, the tabpanel wiring, drag-reorder, pop-out, tab markers |
| `src/ui/components/BookPane/BookHome.test.tsx` | The Home page: contents collapsed to root, expansion, full-text search (hits, no-match, rejected FTS query, the tree opening the path to each hit), retry |
| `src/ui/components/BookPane/BookNavigationToolbar.test.tsx` | Arrow enable/disable and tooltips, the always-available Up action, the settings gear, and that the toolbar wears the shared pane toolbar |
| `src/ui/components/BookPane/BookModuleSelectorModal.test.tsx` | Lists one kind, no Books/Dictionaries switcher |
| `src/ui/components/LibraryHome.test.tsx` | One section per pane kind, filtering, install prompts |
| `src/ui/components/shared/PaneOverlay.test.tsx` | Portals to `<body>` and outranks dockview's sash |

## Not implemented

- **Devotional reading.** `devotional` is a valid `module_type` in `main.db` (`electron/utils/initMainDatabase.ts`), `electron/utils/moduleDetector.ts` classifies devotional module files, and the Module Manager filter offers the type - but there is no `devotional` `PanelContentType`, `bookHandlers.ts` loads only `ModuleLoader('book', ...)`, and `LibraryHome` lists only `book` and `dictionary`. A devotional module can be installed and never opened.
