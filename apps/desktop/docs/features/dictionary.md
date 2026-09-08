# Dictionary

**Last verified:** 2026-09-08

Dictionary/lexicon pane for Strong's numbers and other reference lookups.

> **Note:** `'dictionary'` is a first-class `PanelContentType` with its own pane slot, entry point and store. It *shares a component* with Books - `BookPane` is registered for both content types and renders `DictionaryPane` inside itself (with the `hideTabs` prop) - but the two are otherwise **segregated**: a Dictionary pane lists dictionary tabs only, a Books pane book tabs only. See "One kind per pane" below and [books.md](books.md).

## The Dictionary pane slot

Dictionaries are core to Bible study; study books are opened occasionally. The layout reflects that:

- **Default layout.** `createDefaultLayout` opens `dictionary_default` as a tab in the right-hand group beside Study and Commentary. Books and Notes stay one click away via the "+" menu.
- **Study Mode.** `presets/studyMode.ts` lists `dictionary` in both `autoOpen` and the group's `order`, so the study column reads Study -> Commentary -> Topics -> Dictionary -> Notes on every profile.
- **A Strong's-number click** goes through `revealDictionaryPanel`, which finds a `'dictionary'` panel and otherwise creates one, titled Dictionary. A Books pane is never used as a host: it lists no dictionary tabs, so a lexicon sent there would open as a tab nothing displays.

A dictionary is *detached* as a Books window (`POP_OUT_PANE_TYPE`, `popOutModuleToWindow`), because `BookPane` is the component behind both; `electron/config/paneConfig.ts` has no `dictionary` entry and `COMPONENT_MAP` no `DictionaryPane`. What makes the new window a dictionary rather than an empty bookshelf is `paneKind: 'dictionary'` in the detach payload - `popOutModule.ts` and `DockviewTabRenderer` both set it, and `paneConfig.ts` reads it to title the window. See [sidebar-layout.md](sidebar-layout.md) -> Detached Windows.

## One kind per pane

`BookPane` takes a **`paneKind`** prop (`'book' | 'dictionary'`), supplied by `PanelContentRenderer` from the panel's content type. It is fixed for the pane's lifetime and every list in the pane filters by it: the tab strip, the Overview shelf, the "+" selector, and the empty state. Dictionaries are the common case and have lookup-shaped controls; books are rarer and read straight through. They are two panes.

What that means in practice:

- `BookModuleSelectorModal` has no Books/Dictionaries tab header and lists one kind.
- `LibraryHome` takes a `kind` and renders one section, not both.
- `moveIntoBooksPane` looks for a pane of the module's **own** kind, and creates one of that kind when there is none.
- `revealDictionaryPanel` never falls back to a Books pane.
- The Overview shelf opens on a pane with nothing in it and stays out of the way on one that already has a tab. "Navigating to Dictionary should land on Overview" is a statement about an empty pane: the shelf is how you *find* a module, so it is the right first thing to see when you have none open and the wrong one when you already have the module you came for.

## The toolbar

`DictionaryPane`'s toolbar is built from `shared/PaneToolbar.tsx` - the Bible pane's shape: a full-height band of flush cells separated by 2px borders, with `overflow-hidden` so the row never spills out of a narrow pane.

| Cell | Notes |
|---|---|
| Back / Forward | `goBack` / `goForward` on the pane's own lookup trail (see below) |
| History (clock) | The `recentLookups` menu, rendered through `bible/ToolbarPopover` so it portals out of the toolbar's own overflow clip |
| Search box | `DictionaryLiveSearch` |
| Settings (gear) | `bible/PassageSettingsMenu` with `paneKey="dictionary"`, passed as the toolbar's `trailing` cell |

The pane offers no "browse the whole dictionary" control: for a Strong's lexicon that is thousands of entries in an order nobody navigates by, and it would sit beside the search box reading as a second, competing way in. The Browse dialog itself survives as the disambiguation surface - `handleLookup` opens it when a term matches several entries. The empty state names the dictionary and points at the search box.

## The lookup trail (back / forward)

`DictionaryPanelState` carries `navHistory: DictionaryNavEntry[]` and `navIndex` (`-1` when nothing has been looked up yet). Distinct from `recentLookups`, which is a global, de-duplicated, most-recent-first list shown in a menu; this is a per-pane **sequence with a cursor in it**. The same entry can appear twice, order is the order visited, and going back removes nothing.

- Each successful `lookupEntry` / `lookupEntryById` appends through `pushNavEntry`, unless the step is the one already showing (a retry or a session restore must not stack a duplicate that then takes two Backs to get past).
- `goBack` / `goForward` move the cursor and replay the lookup with `{ fromNavigation: true }`, which is what stops the replay appending to the trail it is walking.
- The abbreviation travels with each step, because a trail crosses dictionaries: following a cross-reference out of one lexicon and stepping back has to return to the other one, tab and all.
- Closing a tab does not rewrite the trail, so a step can name a dictionary that is no longer open. The cursor still moves past it - otherwise a second Back would jam on the dead step forever.
- Looking something new up after stepping back truncates the forward branch, the same rule a browser uses.
- Capped at 50 steps (`MAX_NAV_HISTORY`): a trail is a convenience, not a record, and an unbounded one is a slow leak in a pane that stays open for a long reading session.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/DictionaryPane.tsx` | Main dictionary display pane showing entries. A Strong's lexicon entry also carries a **Search all occurrences** button (`data-testid="dictionary-search-occurrences"`) under the entry header, calling `useSearchStore.searchStrongsNumber()`. The number comes from `strongsNumberFor(moduleAbbr, entry_key)` - Strong's keys are 5-digit zero-padded and carry no prefix (`"00025"`), so the G/H is taken from which lexicon the tab is showing; it returns null for an ordinary dictionary, which has no Bible-wide occurrences. Mirrors the web app's `apps/web/src/components/DictionaryPane/DictionaryContent.tsx` |
| `src/ui/components/shared/PaneToolbar.tsx` | The shared reading-pane toolbar shape (band, flush icon cells, the shared icon set), exporting `PaneToolbar` and `PaneToolbarButton` |
| `src/ui/components/shared/PaneOverlay.tsx` | Portalled modal backdrop for a dialog opened inside a dockview pane - see "Dialogs and the pane splitter" in [books.md](books.md) |
| `src/ui/components/bible/PassageSettingsMenu.tsx` | The settings gear, taking a `paneKey` so every pane uses one component |
| `src/ui/components/bible/ToolbarPopover.tsx` | Portalled popover used for the toolbar's history menu |
| `src/ui/components/dictionary/DictionaryLiveSearch.tsx` | The pane's search box: one large field whose matches appear underneath it as the user types (200ms debounce, `DEBOUNCE_MS`; arrow-key/Enter selection, `role="combobox"`) |
| `src/ui/components/dictionary/DictionarySinglePanel.tsx` | Lightweight single-dictionary panel (one module, no tab bar). Uses the submit-then-find-out lookup flow rather than `DictionaryLiveSearch` |

### Shared formatting

| File | Description |
|---|---|
| `packages/core/src/Services/DictionaryDefinitionFormatter.ts` | The render-time filter for definitions: reads the module's `newline_handling` declaration (`readNewlineHandling`, `NEWLINE_HANDLING_KEY`), falls back to per-entry HTML detection (`definitionHasHtmlMarkup`), resolves the two (`resolveNewlineHandling`), escapes prose and turns significant newlines into `<br />` (`dictionaryDefinitionToHtml`, `newlinesToLineBreaks`). Shared by desktop and web - see "Rendering a definition" below |

### State

| File | Description |
|---|---|
| `src/ui/stores/useDictionaryStore.ts` | Zustand store for dictionary state (per-panel via `panels` Map), lookups, the back/forward trail, and available dictionaries |
| `src/ui/stores/hooks/useDictionaryPanel.ts` | Hook returning per-instance dictionary state + actions bound to a panelId. Its "panel not initialised yet" fallback calls `createDefaultDictionaryPanelState()` rather than inlining a copy of that literal |
| `src/ui/stores/helpers/panelStateHelpers.ts` | Shared helpers for per-panel state management |
| `src/ui/stores/helpers/createPanelTabsSlice.ts` | The tab-strip actions (`setActiveTab`, `reorderTabs`, `closeTab` -> `closeDictionary`, `clearError`) and per-tab `Map` helpers, shared with `useBookStore` - see [books.md](books.md) -> "One tab strip, one implementation" |
| `src/ui/components/bible/revealDictionaryPanel.ts` | Finds or creates the pane a lookup should land in, and returns its real dockview panel id |
| `src/ui/components/BookPane/showDictionaryPane.ts` | `SHOW_DICTIONARY_PANE_EVENT` (`bible:show-dictionary-pane`) - dispatched after a Strong's-number click so the pane's Overview shelf gets out of the way |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/dictionaryHandlers.ts` | Channels: `dictionary:getAvailableDictionaries`, `dictionary:getDictionaryInfo`, `dictionary:getEntry`, `dictionary:getEntryByKey`, `dictionary:searchEntries`, `dictionary:getAllEntries`, `dictionary:getOccurrences`, `dictionary:getOccurrencesForVerse`. Also resolves and caches each module's `newline_handling` declaration per abbreviation |
| `electron/services/installedModules.ts` | Filters `module_metadata` rows down to those whose `.db` file is actually on disk - shared by `dictionary:getAvailableDictionaries` and `book:getAvailableBooks` |
| `electron/utils/validation.ts` | `validateAbbreviation` - the IPC-boundary check every dictionary/book/commentary channel runs on the module abbreviation |

## Lookup behaviour

The search box runs an as-you-type search (`DictionaryLiveSearch`), debounced at 200ms and normalised the same way an exact lookup is, so typing `G25` searches for the stored key `00025`. Results land in the store's `searchResultsByTab` - the same slot the Browse dialog reads, which is why the dialog opens showing whatever was last searched for.

Enter (or the "Look up" button) opens whichever match is highlighted. With no match to open - a term submitted before the debounce fired, or one the search genuinely misses - it falls back to the cascade: exact key -> text search -> open a single unambiguous hit, or open the Browse dialog on the matches. That cascade is the **only** way into the Browse dialog, which is why the dialog is the disambiguation surface rather than a general list.

"Look up" is styled as a quiet secondary control rather than a filled accent button: it is the visible form of Enter, and the thing a reader who typed an exact Strong's number reaches for rather than arrowing into a list.

## Tab persistence

`DictionaryPane` unmounts on an ordinary tab switch, so its unmount cleanup calls `detachPanel` rather than deleting the panel's state; that keeps `openTabs`, `activeTabIndex` and `entriesByTab` across a switch and out of the persisted session as empty. The mechanism is documented in **[books.md](books.md) -> Panel lifecycle - detach vs. destroy**.

A Strong's-number click also dispatches `bible:show-dictionary-pane` (`BookPane/showDictionaryPane.ts`) after opening the tab, because the Overview shelf covers the pane's content and a lookup arriving underneath it would be invisible; the event dismisses the shelf.

## Rendering a definition: newlines are content

A dictionary `definition` is **plain text**, not HTML. The SWORD importer runs every rendered entry through `SwordCommon::stripMarkupClean`, which strips all markup - whatever the source module was (TEI, ThML, OSIS), what lands in the column is prose. A survey of the 25 installed dictionary modules (~300k entries) found zero HTML tags and one lone `<`, in Webster 1913's *inequality* entry ("the inequality 2 < 3").

Plain text pushed straight into `dangerouslySetInnerHTML` is the wrong filter twice over. HTML collapses newlines to spaces - so Nave's Topical Bible, which separates the numbered senses under a heading with a blank line (14,586 newlines across 1,137 of its 5,320 entries), would reach the reader as one unbroken wall of text. And a stray angle bracket would be at the mercy of the HTML parser rather than being shown as written.

The filter is applied at render time rather than to the stored data: **`packages/core/src/Services/DictionaryDefinitionFormatter.ts`**.

### Who decides

1. **The module, if it says.** `module_info.metadata` may carry `"newline_handling": "significant" | "insignificant"` - the same place commentaries keep `content_format`. A string rather than a boolean so a third case (say a "paragraph" mode where a blank line opens a paragraph and a single newline is a soft wrap) can be added without a migration. An absent or unrecognised value means *not declared*.
2. **The text, per entry, otherwise.** `definitionHasHtmlMarkup` looks for a recognisable HTML tag from an allow-list - an allow-list rather than a generic `<...>` so that "2 < 3" is not mistaken for markup. Tags present means the newlines are HTML whitespace and are left alone; no tags means they are the only structure the entry has.

The fallback is not merely a bridge for undeclared modules. It is what makes a *mixed* module - some entries prose, some carrying markup - render correctly, which no module-level flag can describe. None of the 25 installed modules is mixed today (each is 100% prose), so the flag could carry them all; the per-entry path is what keeps that from being an assumption.

Escaping and break-insertion are kept separate: whether text must be escaped depends only on whether it is prose, while whether its newlines become breaks is what the module gets to declare.

### Plumbing

The declaration travels **with the entry**, so a render site needs no extra fetch or store state: `dictionary:getEntry` / `dictionary:getEntryByKey` add `newline_handling` to the DTO (cached per abbreviation in `dictionaryHandlers.ts`), and the web route `GET /api/dictionary/:module/entry/:key` does the same.

### Render sites

All four HTML sinks for a definition go through the shared helper. Two shapes, because of what else runs on the string:

| Site | Call |
|---|---|
| `src/ui/components/DictionaryPane.tsx` | `sanitizeHtml(dictionaryDefinitionToHtml(...))` - also `etymology`, `usage_notes`, `semantic_range` |
| `src/ui/components/dictionary/DictionarySinglePanel.tsx` | same, for `definition`, `etymology`, `usage_notes` |
| `apps/web/src/components/DictionaryPane/DictionaryContent.tsx` | decide on the raw text, then `processCommentaryLinks` -> `linkStrongsRefs` -> `newlinesToLineBreaks` |
| `apps/web/src/components/MobileStudyPane/MobileDictionary.tsx` | same as above |

The web pair must not use `dictionaryDefinitionToHtml`: `processCommentaryLinks` already HTML-escapes each text segment as it inserts anchors, so escaping again would double-encode. They take the decision on the *raw* definition - before any anchors exist, so the HTML fallback cannot see markup this code just generated - and apply only the break step afterwards. `newlinesToLineBreaks` keeps the newline after each `<br />` so that pass's line-context resolution still sees the lines.

The Strong's surfaces (`study/InterlinearDisplay.tsx`, the web `StrongsPopup` and `StrongsTooltip`) parse a definition into fields and render them as text nodes, never as HTML, so they are unaffected - and the Strong's lexicons contain no newlines anyway.

### Sanitisation

`dictionaryDefinitionToHtml` is **not** a sanitiser. The desktop sites keep their `sanitizeHtml` (DOMPurify) wrapper; `<br>` is in DOMPurify's default allow-list, so the inserted breaks survive it. See the escaping contract at the top of `DictionaryDefinitionFormatter.ts`.

> **Known gap (web).** `apps/web` has no sanitiser at all - no `dompurify` dependency - and `DictionaryContent`/`MobileDictionary` inject their processed string with no DOMPurify pass. `processCommentaryLinks` escapes *text* segments but passes through any tag it finds, so raw markup in a module would reach `innerHTML`. Escaping prose on every path narrows the exposure but does not close it, and the same gap covers `StudySynthesis` and `verseHtml`. Closing it is a web-wide change, not a dictionary one.

## Module availability and abbreviations

Two rules a module such as `Webster's Dictionary 1828` - registered but absent, with an abbreviation containing a space - depends on:

- **`module_metadata` is a registry, not an inventory.** A row outlives its file. `listInstalledModules` stats each `database_path` so a picker only ever offers modules that can actually be opened; the Module Manager remains the place that lists what *could* be installed.
- **An abbreviation is module data, not an identifier this app mints.** It is read out of the module's own `module_info` row, so it carries whatever the publisher wrote - spaces, dots, apostrophes, non-Latin script. `validateAbbreviation` rejects only control characters, path separators and the Windows-reserved set. It is safe to be permissive because the abbreviation is bound as a SQL parameter and the file path comes back *from* the matched row rather than being built out of the abbreviation.

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/dictionary.spec.ts` | Dictionary lookup and display tests |

### Unit tests

| File | Description |
|---|---|
| `src/ui/components/bible/revealDictionaryPanel.test.ts` | Prefers an open Dictionary pane; does **not** send a lookup to a Books pane; creates a `'dictionary'` pane titled Dictionary in the right-hand group when the layout has none |
| `src/ui/stores/useDictionaryStore.navigation.test.ts` | The back/forward trail: order, no self-duplicates, cursor movement, forward-branch truncation, cross-dictionary steps, closed-tab steps, per-pane independence |
| `src/ui/components/shared/PaneOverlay.test.tsx` | The dialog backdrop portals to `<body>` and outranks dockview's sash |
| `packages/core/src/Services/DictionaryDefinitionFormatter.test.ts` | The definition filter: a real Nave's entry's sub-entry breaks, prose escaping (including Webster's "2 < 3"), HTML left alone, mixed content, and the declared-value-wins cases |
| `src/ui/stores/useDictionaryStore.strongsLookup.test.ts` | Routes the lookup to the given panel id rather than `DEFAULT_PANEL_ID`, and brings the Dictionary tab forward |
| `src/ui/stores/useDictionaryStore.tabsAndPaging.test.ts` | Tab open/close/reorder and browse paging |
| `src/ui/components/DictionaryPane.test.tsx` | Pane rendering, the Search-all-occurrences button, toolbar cells |
| `src/ui/components/dictionary/DictionarySinglePanel.test.tsx` | The single-module panel's lookup flow |
