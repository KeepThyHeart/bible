# Search

**Last verified:** 2026-09-11

Keyword search, advanced search dialog, semantic search, Strong's word-family pills, and find-in-page.

## Feature notes

- **Semantic search toggle**: A text link (`Semantic Search` / `Back to Keyword Search`), not an icon button. It appears in two places, both calling `useSearchStore.toggleSemanticMode()`: the header of the `LiveSearchSuggestions` dropdown under the search box, and `SearchResultsPane` (in the results header and again in the zero-results block). `toggleSemanticMode` flips `useSearchStore.isSemanticMode`, persisted to `localStorage` under `bible.search.semanticMode`. Both links are rendered only when `semanticAvailable === true`.
- **A keyword search that finds nothing switches itself to semantic**, when a pack is installed and the query is not a Strong's number. `performSearch` sets `isSemanticMode` and `autoSwitchedToSemantic`, runs the semantic pass, and `SearchResultsPane` renders a notice above the results saying so with a "Back to Keyword Search" link. The flag is what keeps that switch temporary: the next brand-new query resets the mode, while a mode the *user* chose persists across searches.
- **Semantic search ships as an optional feature pack, not in the installer.** The embedding index and model together run to hundreds of megabytes, so the app ships the *runtime* (`@huggingface/transformers` + ONNX Runtime) but no index and no model. Users add it from **Module Manager -> Features**, which downloads a pack over the existing catalog/`DownloadService`/`NetworkGateway` path, verifies a SHA-256 per artifact, and swaps it into place atomically. Until a pack is installed, `search:semanticAvailable` returns `false` and the semantic-mode links are simply absent - no error, no dead button.
  - Installed layout: `<userData>/data/feature-packs/semantic_search/` containing `semantic_index.db`, `models/...`, and `pack.json` (the install manifest). Resolved by `resolveSemanticIndexPath()` / `resolveSemanticModelsPath()` in `electron/utils/appPaths.ts`, which prefer an installed pack over any bundled copy.
  - Install and uninstall both call `resetSemanticSearch()` (exported from `searchHandlers.ts`) so a pack becomes usable - and a removed one stops being used - without restarting the app. It is also what releases the open SQLite handle; Windows will not rename or delete an open file, so the swap would fail without it.
  - A distributable pack is a folder or archive holding `feature-pack.json` (the package manifest, `FEATURE_PACK_MANIFEST_FILENAME` in `@bible/core`) beside the artifacts it declares. The catalog form of the same thing is an entry in a catalog's `feature_packs` array. Both shapes and their validators live in `packages/core/src/Data/Core/FeaturePackTypes.ts`.
- **A pack can also be sideloaded from a local file or folder** - Module Manager -> Features -> "Choose file... / Choose folder...". That is what makes the feature reachable with no catalog to download from, on a machine that never goes online, or when testing a pack you built yourself. A sideloadable package is a folder holding `feature-pack.json` plus the artifacts, installable as-is or zipped to a single `.biblepack` file.
  - Same validator core as a catalog entry (`parseLocalFeaturePack`), same path rules, same digests, same atomic swap. It differs only in having no URLs and in requiring a `format` tag. Digests here catch a damaged copy, not a hostile one - sideloading trusts whoever supplied the file, and the panel says so.
  - The renderer never supplies a path: `featurePack:install-from-file` takes `'file' | 'folder'` and the native dialog is shown by the main process, so the only installable paths are ones the user picked in person.
  - Archive entries are read *by name from the manifest* rather than enumerated and written, so an entry like `../../evil.exe` is never looked up. A single wrapping top-level folder is stripped; an archive with two packs in it is rejected.
- **The index describes itself, and the query side follows it.** `SemanticSearchService` reads `index_metadata` to learn how the vectors are stored and what a query must go through to match them:
  - **Format 1** (no `index_format` key) is the original full-width float32 index (768-d, ~1.65 GB, ~1.2 GB resident). It is queried with `Xenova/nomic-embed-text-v1` at fp32 - the directory name those packs lay the nomic v1.5 weights out under - and a 0.3 similarity floor.
  - **Format 2** declares `vector_encoding` (`float32` or `int8`), `embedding_dim` (a Matryoshka truncation of the model's 768-d output), an optional `mean_vector` it was centred on, its own calibrated `min_similarity`, and the query model it was built for (`query_model`, `query_model_dtype`, `query_prefix`). The compact official pack is 256-d int8 with the q8 model, roughly a sixth of the original's resident memory.
  - `search()` takes the model's raw output and applies the index's truncation and centring itself, so a caller cannot get the transform wrong; the handler asks `getQueryModel()` which model to load and never names one. Results are collapsed to one per passage (`collapsePassages`), since an index holds several rows - chunks and facets - for each verse.
  - Vectors load into flat typed arrays (paged by rowid), not one object per row; a blob whose width disagrees with `embedding_dim`, or a format/encoding the reader does not know, is an error rather than a guess.
- **Building a pack**: `npm run build-feature-pack -w @bible/desktop -- --index=<semantic_index.db> --models=<models root>` (`scripts/build-feature-pack.js`; needs `npm run build:core` first and Node 22.5+ for `node:sqlite`). It picks the model files from the index's own `query_model`/`query_model_dtype` rather than from a flag, stages the index with `VACUUM INTO`, optionally gzips it (`--gzip-index`), writes `feature-pack.json`, validates it with the installer's `parseLocalFeaturePack` and `FEATURE_PACK_ALLOWED_EXTENSIONS`, and emits the folder plus a stored-method `.biblepack` under `dist/feature-packs/`. The compact index itself is built from the full float32 one by `scripts/semantic/build-compact-index.mjs` at the repo root.
- **Strong's word family**: When the search query matches a Strong's number (e.g. `G25`, `H7225`), `SearchResultsPane` renders a `WordFamilyBar` above the results: primary word summary, clickable pills for related Strong's numbers with per-number occurrence counts, and an "Include related words" checkbox that re-runs the search across the family via `SearchOptions.includeRelatedWords`. Word-family data is fetched client-side via `dictionaryAPI.getEntryByKey` against installed Strong's Greek/Hebrew dictionaries and parsed with the same rules as `WordFamilyService`; on the main process, `WordFamilyService` is also wired into `BibleSearchService` in `searchHandlers.ts` so `includeRelatedWords` expands the FTS query.
- **The gloss in that summary is truncated.** The "gloss" is the KJV usage list parsed out of the lexicon entry - everything after the `:--` separator. There is no separate short-definition column in a Strong's module to prefer: it is one `definition` blob, and the gloss is a slice of it. For most entries that slice is a few words (the median across `dictionary_strongsgreek`'s 5,742 entries is 11 characters), but nothing bounds it: `G1722` (ἐν) runs to 564 characters and the longest entry to 765, so a header that printed it whole would become a paragraph. `WordFamilyBar` cuts it at `GLOSS_PREVIEW_LENGTH` (120) on a word boundary via `truncateAtWordBoundary` from `@bible/core`, keeps the full text in the span's `title`, and - only when something was cut - renders a **Full entry** button (`data-testid="strongs-full-entry"`) that opens the number in the Dictionary pane. The same budget applies to the interlinear hover tooltip's gloss line in `study/InterlinearDisplay.tsx`.
- **"Full entry" reuses the Bible pane's own gesture.** `components/bible/openStrongsInDictionary.ts` holds the three steps a Strong's click takes - `revealDictionaryPanel()` for the real dockview panel id, `lookupStrongsNumber`, then `SHOW_DICTIONARY_PANE_EVENT` to dismiss the Overview shelf. It reveals without activating and holds the switch until the entry has loaded, so the pane does not come to the front still showing the previous lookup. Both call sites share it, so there is one definition of where a Strong's number opens.
- **Zero-result retry in another open translation**: When a keyword search returns no results, `SearchResultsPane` reads `useBibleStore`'s `panels` map (read-only) to find every Bible translation currently open across Bible panels, excludes the active panel's translation and any module already retried for this query, and renders a "Try in {module}" button per remaining one. Clicking it calls `useSearchStore.retrySearchInModule(moduleAbbr)`, which re-issues the same query scoped via `{ scope: 'allOpenModules', openModules: [moduleAbbr] }` - that scope (not a bare `modules` list) is what makes `searchHandlers.ts` register the module with `BibleSearchService` on demand, so the retry works even for a translation that has never been searched yet this session. Retried modules accumulate in `retriedModules` (reset on the next brand-new top-level query) so a translation isn't re-offered after it's been tried. The "Semantic Search" link is shown alongside this.
- **Search results are their own dockview panel.** `SearchResultsPane` is registered as the `search` content type in `PanelContentRenderer`. `useSearchStore` calls the `showSearchResultsPanel` cross-store bridge whenever a search produces results; `storeSync.ts` wires that to `useLayoutStore.openSearchResultsPanel()`, which:
  - **focuses an existing search panel wherever it now is** - that single rule is the whole of "the app remembers where I put the results". Once the user drags the tab into the study group, dockview's own layout state is the memory, and the next search must not yank it back;
  - otherwise splits the Bible pane top/bottom with the results **below**, targeting `lastActiveBiblePanelId` (not `activePanelId` - the search bar lives outside dockview and never becomes the active panel);
  - otherwise lets dockview place it in the active group (no Bible pane open is a legitimate state).
  The panel is created with `genericEnglishTitle('search')`, because `addPanel` bakes the title into the serialized layout and a localized one would freeze the creating locale; `localizePaneLabel` translates it at render time. Closing the panel is harmless - the next search re-creates it at the default position - and the pane's own X closes the dockview panel too (via the optional `dockviewPanelApi` prop) rather than emptying the tab in place. Because the panel survives in the saved layout, the pane has an **idle state** (`data-testid="search-results-idle"`) for the restored-with-no-query case instead of announcing "0 results for `""`". Presets list `'search'` in their `accepts` arrays (`studyMode`, `studyModeQuad`, `writerMode`).
- **"Show All Matches" / "Show {n} More"** - the affordance shown at the foot of a truncated result list. The two modes are deliberately asymmetric because they know different things about their own completeness:
  - **Keyword** has no server-side total. `search:performSearch` returns a bare array capped at `SearchOptions.maxResults` (`KEYWORD_DEFAULT_MAX_RESULTS`, 200), so the only honest evidence of truncation is "the page came back full": `searchResults.length >= keywordResultLimit`. That is why the control is the generic **"Show All Matches"** with no number - there is no number that could be stated truthfully. Clicking re-runs the *same* query (same scope, same module list, same Strong's `includeRelatedWords` - all built by the shared `buildKeywordRequestOptions`) at `KEYWORD_SHOW_ALL_MAX_RESULTS` (5000) and sets `isShowingAllKeywordResults`, which retires the button for good. The heuristic can only over-offer: a query with exactly 200 matches shows the button once and the re-fetch then hides it.
  - **Semantic** does have a real remaining count, because the whole ranked page is fetched up front (`SEMANTIC_FETCH_LIMIT`, 150 - the similarity pass already scores every embedding before slicing, so a bigger slice costs only the extra rows' reference/verse formatting) and paged in the renderer via `semanticVisibleCount` (`SEMANTIC_INITIAL_VISIBLE`, 30). `semanticResults.length - semanticVisibleCount` is exactly what a click reveals, so the label states it: **"Show 120 More"**. Known limit: if more than 150 passages clear the index's similarity floor, the count under-reports rather than over-reports, and the button disappears at 150.
  - Both are plain `<button>`s (Tab/Enter, no extra key handling - the rows' Arrow-key navigation stops at the last row and does not swallow them). The header's count summary reports the *rendered* row count, not the store's, so it can never contradict the button. An always-mounted `role="status"` sr-only region announces the new length after an expansion - the header's own live region unmounts while `isSearching`, and a live region that is not in the DOM when its text changes announces nothing - and focus moves to the first newly-revealed row, since the control the user just activated is gone.
- **The search bar's count badge only shows while its count is still true.** It is gated on three things at once, and each leak is closed in the store rather than papered over in the badge:
  - **The pane is open** (`isResultsVisible`), and **the box still holds the query the results came from** (`normalizeSearchQuery(query) === normalizeSearchQuery(resultsForQuery)` - `normalizeSearchQuery` strips the explicit `?` search prefix and whitespace, so `?grace` and `grace` are the same query, not an edit).
  - **It counts what the pane counts**: `semanticResults` in semantic mode, `searchResults` otherwise.
  - **Closing the pane clears the results.** `useSearchStore.clearResults()` empties every result set and hides the pane while leaving the query text alone (narrower than `clearSearch`, which would also retype the box out from under the user). Both close routes reach it: the pane's own X calls it directly, and closing by the dockview tab x reaches it through `destroyPanelState`, whose `'search'` branch does the same.
  - **Editing the text drops the results it produced.** `setQuery` compares the new text against `resultsForQuery` and empties the result sets when they diverge. It deliberately does *not* clear `isResultsVisible`: typing empties a pane, it does not close one the user opened.
- **Result distribution sparkline.** A row of 66 equal-width bars sits above the first result, inside the pane's scroll area, in both keyword and semantic mode (`SearchDistributionGraph`). It scrolls away with the list rather than being pinned, and there is no toggle.
  - **Equal widths, height for count.** Every book gets the same slice, so Obadiah is as clickable as Psalms; height is the raw match count scaled to the largest book, floored at `MIN_BAR_PERCENT` (12 %) of the 34px plot. The floor has to clear the 2px hairline drawn for an empty book, or a one-match book would come out shorter than a no-match one.
  - **Colour is the canonical section**, from `src/ui/constants/bibleSections.ts` - the same `SECTION_COLOR_TOKEN` map `BookChapterPicker` uses, so a book is the same hue wherever it is met. Books with **no** matches keep a 2px hairline in their own section's hue, so the shape of the canon and its divisions read across the whole width. A dashed rule (`data-testid="testament-divider"`) marks the Malachi/Matthew break, and the two testament labels below sit on the same 39 / gap / 27 flex proportions as the bars, so "New Testament" starts under Matthew and marks the division. There is deliberately **no section legend**: it costs a row of vertical space in a pane that has little, and the swatches do not line up with the bars they describe. The tooltip is what names a bar.
  - **Every bar is named** - hover *and* keyboard focus raise the tooltip, and the same text is the `aria-label`, including for empty books ("Obadiah - no matches"). Bars with matches are `<button>`s; empty ones are `role="img"` and take no tab stop, since there would be nothing to activate. The tip pins to the chart's leading/trailing edge for the first and last `EDGE_ANCHOR_BOOKS` (10) books instead of centring, so it cannot spill out of the pane - no measurement, which also means it behaves the same on first paint as after layout.
  - **A click selects, it does not navigate.** It sets `lastClickedId` to that book's first match and `scrollIntoView({ block: 'nearest' })`s the row; the Bible pane does not move. The bars are a few pixels wide and a mis-click has to cost nothing. Rows carry `data-result-id` (the same `searchResultId()` / `semanticResultId()` the marker uses) so the pane can find the row without interpolating module-supplied text into a selector.
  - **It counts the rows the pane is holding**, never the whole Bible - a bar has to correspond to a row the click can scroll to. Keyword mode counts `searchResults`; semantic mode counts `visibleSemanticResults` (the rendered page, matching the header's own count), not the whole fetched `semanticResults`. **Fuzzy results are excluded**; `'stem'` results are not, because a stem hit is a real occurrence in another inflection while a fuzzy hit is a different word that merely looks like the query. The caption says so whenever anything was actually excluded.
  - **The caption says when the count is not a full tally.** "Capped" is `searchResults.length >= keywordResultLimit` - the same evidence "Show All Matches" runs on, minus its already-expanded guard, so 5000-out-of-5000 after the uncapped re-fetch still reads as capped. There is no server-side total to compare against, so a full page is the only honest signal; it can over-warn (exactly 200 matches reads as capped) but never under-warn. Semantic mode has its own caption, since a semantic page is by nature the closest results rather than every one.

- **Approximate matches are one labelled group, not a badge per row.** `rankResults` sorts *exact* before everything else, but `stem` and `fuzzy` share its second tier and interleave there by verse ID - so "exact before fuzzy" is not the boundary the UI needs, and trusting the sort would scatter fuzzy rows through the stem ones. `SearchResultsPane` therefore **partitions explicitly** on `result.type === 'fuzzy'` (each group keeping the ranker's order) and renders one "Approximate matches" divider between them (`data-testid="search-results-approximate"`), with a line saying they are close spellings and related word forms and are not counted in the chart. Rows below it get a sunk background and a quieter reference colour (`data-approximate="true"`). The per-row "Fuzzy" badge stays - it names *which* word matched, which the divider cannot.

- **Where the approximate group comes from.** `BibleSearchService.addFuzzyMatches` (core) supplements a thin result set: it runs when `options.autoFuzzy` is not `false` and the exact pass returned 1-9 results. Zero results are deliberately left alone - nothing at all suggests a bad query rather than a spelling variant. Each term parsed out of the query is searched as an FTS5 prefix (`term*`, `buildFuzzyPattern`), capped at 20 rows per term; the hits are marked `type: 'fuzzy'` and any verse already in the exact set is dropped. Because the terms are searched separately, the supplement is an OR over the query rather than an AND, so an approximate row need not contain every word the user typed.

- **Last-clicked result marker**: `useSearchStore.lastClickedId` holds a stable, kind-namespaced ID (`searchResultId()` / `semanticResultId()`) for whichever keyword or semantic result the user most recently clicked, set via `setLastClickedId()` in `SearchResultsPane`'s click handlers and reset whenever a new top-level query starts. Both `SearchResultItem` and `SemanticResultItem` render a persistent accent-colored marker (dot + left border stripe, all via `--theme-*`/Tailwind tokens - no hardcoded color, so it stays correct across every theme) when their result matches, distinct from the `:hover` and focus states and without touching `aria-current` or the existing arrow-key navigation.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/TopSearchBar.tsx` | Top search bar with reference parsing and search triggering. A typed **range** selects the whole span - `handleReferenceNavigation` reads the parser's `endVerse`/`endChapter` and passes an end verse to `navigateToVerseInPrimary`, which applies it with `extendSelectionTo` after the navigation, giving the same anchor + far-end pair a click-then-shift-click produces. Focus shortcut is **Ctrl+L** (what the badge advertises) with Ctrl+K and F6 also bound; the box shows the shortcut on a `kbd` badge (`data-testid="search-shortcut-hint"`) while it is idle and unfocused. The drop-out panels below the input (error, "type at least 3", shortcut hint) use opaque `bg-surface-elevated` + `shadow-lg` + `z-50` so the pane content cannot read through them |
| `src/ui/components/SearchResultsPane.tsx` | Pane displaying search results with verse snippets; the `search` dockview panel's content, including the `WordFamilyBar`, the "Show All Matches" / "Show {n} More" footer, the auto-switch notice and the idle (restored-with-no-query) state |
| `src/ui/components/PanelContentRenderer.tsx` | Maps the `search` content type to `SearchResultsPane` |
| `src/ui/components/SearchDistributionGraph.tsx` | The distribution sparkline: 66 equal-width, section-coloured bars above the result list, in both keyword and semantic mode |
| `src/ui/components/AdvancedSearchDialog.tsx` | Dialog for advanced search options (scope, filters, etc.) |
| `src/ui/components/FindBar.tsx` | In-page find bar (Ctrl+F) for searching within displayed text |
| `src/ui/components/LiveSearchSuggestions.tsx` | Live suggestions as user types in search bar |
| `src/ui/components/FeaturePackPanel.tsx` | Module Manager "Features" tab - install/cancel/remove the semantic search pack, with polled progress |
| `src/ui/constants/bibleSections.ts` | `SECTION_COLOR_TOKEN` / `sectionColorToken` / `sectionButtonStyle` - the canonical-section to theme-token map, shared by the sparkline and `BookChapterPicker` |

### Commands

| File | Description |
|---|---|
| `src/ui/commands/searchCommands.ts` | Find-in-pane and advanced search commands |
| `src/ui/commands/searchBarCommands.ts` | Focus search bar (Ctrl+L) and open command mode (Ctrl+Shift+P / F1) commands |

### Locale

| File | Description |
|---|---|
| `locales/en/searchBar.json` | English strings for unified search bar modes, placeholders, and recent items |

### State

| File | Description |
|---|---|
| `src/ui/stores/useSearchStore.ts` | Zustand store for search query, results, type, loading state; also owns `retrySearchInModule`/`retriedModules` (zero-result retry-in-translation), `lastClickedId`/`setLastClickedId` (last-clicked result marker), the semantic-mode flag and its `autoSwitchedToSemantic` companion, the truncation/paging state (`keywordResultLimit`, `isShowingAllKeywordResults`, `showAllKeywordResults`, `semanticVisibleCount`, `showMoreSemanticResults`), and the result-lifecycle pieces the count badge depends on (`clearResults`, the stale-result drop inside `setQuery`, and the exported `normalizeSearchQuery`) |
| `src/ui/stores/helpers/panelDisposal.ts` | `destroyPanelState` - the `'search'` branch clears the results when the panel is removed by its dockview tab |
| `src/ui/stores/crossStoreBridge.ts` | Holds the `showSearchResultsPanel` bridge the search store calls to surface the results panel |
| `src/ui/stores/storeSync.ts` | Wires that bridge to `useLayoutStore.openSearchResultsPanel()` |
| `src/ui/stores/useLayoutStore.ts` | `openSearchResultsPanel()` - open below the last-active Bible pane, or focus the existing panel wherever it now lives |
| `src/ui/stores/useFindStore.ts` | State for find-in-page feature |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/searchHandlers.ts` | IPC handlers for keyword search, semantic search, and search indexing; owns the search/semantic database singletons and the embedder, and exports `resetSemanticSearch()` and `closeSearchDb()` |
| `electron/ipc/searchHelpers.ts` | The pure decisions behind `search:performSearch`, split out of the handler so they can be unit-tested without the module's database singletons: `resolveSearchScope` (which modules a scope covers, and which of them the handler must register with `BibleSearchService`), `applySearchHighlighting`, and `formatSemanticReference` (the reference label for a semantic hit, including ranges that cross a chapter or a book) |
| `electron/schema/searchSchema.ts` | `initializeSearchSchema` - the FTS5 virtual table, index metadata and the rest of the search tables, applied to `main.db` |
| `electron/ipc/featurePackHandlers.ts` | `featurePack:*` IPC - list available packs, status/progress, install, install-from-file (native picker), cancel, uninstall |
| `electron/services/SemanticPackService.ts` | Downloads or reads a local package, verifies and atomically installs the semantic pack; owns the install manifest |
| `electron/utils/appPaths.ts` | `getFeaturePackRoot()` / `resolveSemanticIndexPath()` / `resolveSemanticModelsPath()` |

### Core services

| File | Description |
|---|---|
| `packages/core/src/Services/BibleSearchService.ts` | The keyword engine: query parsing, phrase/boolean/proximity/regex/Strong's passes, the auto-fuzzy supplement, range scoping, dedup and `rankResults` |
| `packages/core/src/Services/SemanticSearchService.ts` | Similarity search over the embedding index: reads the index format (float32 or int8, width, centring, threshold, query model) from `index_metadata`, applies the matching query transform, filters by level, and collapses facet rows to passages |
| `packages/core/src/Services/WordFamilyService.ts` | Strong's word-family expansion behind `includeRelatedWords` |
| `packages/core/src/Data/Core/FeaturePackTypes.ts` | Catalog + package schemas and fail-closed validators (artifact path safety, digests, size ceilings), and `FEATURE_PACK_ALLOWED_EXTENSIONS`, the data-only allowlist shared by the installer and the build script |

### Scripts

| File | Description |
|---|---|
| `scripts/build-feature-pack.js` | Stages, hashes, validates and archives a sideloadable semantic pack (`npm run build-feature-pack`) |

### Unit / component tests

| File | Description |
|---|---|
| `src/ui/components/SearchResultsPane.test.tsx` | Result rendering, counts, retry-in-translation, last-clicked marker, the idle state, the distribution chart being mounted, the single approximate-matches divider, and the show-more affordance (hidden on a complete set, shown with the right label/count when truncated, results appended on click, expansion announced) |
| `src/ui/stores/useSearchStore.resultLifecycle.test.ts` | The three ways a result count stops being true: `clearResults` empties the sets without retyping the box, `setQuery` drops results the text no longer matches (and keeps them when only the `?` prefix changed), and `destroyPanelState('...', 'search')` clears on tab close |
| `src/ui/components/TopSearchBar.test.tsx` | Search-bar rendering, plus the count badge's honesty gate (hidden once the pane is closed or the text is edited, kept across a `?`-prefix-only change, counts semantic results in semantic mode) |
| `src/ui/stores/useLayoutStore.searchPanel.test.ts` | `openSearchResultsPanel` against a real `DockviewComponent`: splits below the last-active Bible pane, generic English title, focuses rather than duplicates, leaves a relocated panel where it was dragged, re-creates after close, falls back when no Bible pane exists |
| `src/ui/stores/__tests__/useSearchStore.test.ts` | Store-level search behavior (query/mode/results state) |
| `src/ui/components/AdvancedSearchDialog.test.tsx` | Advanced search dialog rendering and option wiring |
| `src/ui/components/LiveSearchSuggestions.test.tsx` | Live suggestion dropdown, including the semantic-mode toggle link in its header |
| `src/ui/components/TopSearchBar.referenceRace.test.tsx` | Reference navigation vs. search race (a slow reference parse must not be overtaken by a later keystroke) |
| `src/ui/components/TopSearchBarCommandResult.test.tsx` | Command-mode (`>`) result rows in the search bar |
| `src/ui/components/SearchDistributionGraph.test.tsx` | The sparkline: 66 equal-width bars, section colouring, fuzzy exclusion, the empty-book hairline, the tooltip (hover, focus, edge clamping), the capped caption, and the semantic label |
| `src/ui/components/FeaturePackPanel.test.tsx` | The Features tab: listing, install/cancel/remove, progress polling, sideload entry points |
| `electron/ipc/__tests__/searchHelpers.test.ts` | `resolveSearchScope`, `applySearchHighlighting`, `formatSemanticReference` |
| `electron/services/__tests__/SemanticPackService.test.ts` | Digest verification, path safety, archive handling, the atomic swap |

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/search.spec.ts` | Keyword search tests |
| `e2e/tests/semantic-search.spec.ts` | Semantic/AI search tests |

## Not implemented

- **No official catalog entry yet.** `build-feature-pack.js` produces a sideloadable package; publishing one to a catalog's `feature_packs` section (hosting each artifact and listing its URL) is not scripted here.
- **The full-width index's source text is not rebuilt here.** The compact index is derived from an existing float32 index; the enrichment and embedding pipeline that produced that one lives outside this repository.
