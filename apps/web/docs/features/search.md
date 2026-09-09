# Search

**Last verified:** 6e80a84 (2026-09-04); distribution sparkline + fuzzy grouping added 2026-09-05

Keyword and semantic search across Bible modules, with results displayed in the right pane.

## Files

### Components

| File | Description |
|---|---|
| `src/components/Search/SearchResultsPanel.tsx` | Right-pane panel showing search results with query, result count, search type icon, and close button |
| `src/components/Search/SearchResultItem.tsx` | Individual result row with reference, module, and snippet text. Ctrl/Cmd-click routes to `onCtrlClick` (new Bible tab); plain click to `onClick`. Carries the amber "Approximate" badge and the sunk `--fuzzy` styling when `result.type === 'fuzzy'`, and writes its `resultId` to `data-result-id` so the distribution chart can scroll to it |
| `src/components/Search/SearchDistributionChart.tsx` | The 66-bar distribution sparkline drawn above the first result — see "Search distribution sparkline" below |
| `src/components/Search/SearchDistributionChart.test.tsx` | Tests for the sparkline: 66 equal cells, section colouring, the empty-book hairline, fuzzy exclusion, click-to-select, the capped caption |
| `src/components/common/SemanticSearchLoadingOverlay.tsx` | Non-blocking progress popup for the one-time browser semantic-search setup (metadata → vectors → model), driven by `searchStore.semanticInit`. Also renders the "Ideas Search unavailable" error state. Mounted from `src/components/common/DialogLayer.tsx` |
| `src/utils/focusSearchField.ts` | Focuses (and selects) the header search field by DOM query on `.header__search-field`; no-ops on mobile where the field is not rendered |

### Styles

| File | Description |
|---|---|
| `src/styles/_search.scss` | Results panel, result rows, the distribution sparkline (`.search-distribution`), and the approximate-match divider/badge |
| `src/styles/_bible-sections.scss` | The ten canonical section hues as `--section-<key>` / `--section-<key>-text` custom properties, plus the `section-colors()` mixin and the amber `--warn-*` pair. Shared by the passage picker and the sparkline; `[data-dark-theme]` swaps in lighter shades |

### State

| File | Description |
|---|---|
| `src/stores/searchStore.ts` | Search query, results list, search type (keyword/semantic), loading state, visibility. `setSearchType()` toggles between modes. `searchSeq` counts launched searches — see "Revealing the results panel" below. Strong's paging lives here too: `loadMoreStrongs()`, `loadAllStrongs()`, `strongsTotalAvailable`, `strongsRemaining` — see "Paging Strong's occurrences". Also `wordFamily` / `includeRelated` for Strong's, and `semanticInit` / `dismissSemanticInit()` for the browser-search setup overlay |
| `src/stores/searchStore.searchSeq.test.ts` | Regression for the panel-reveal edge |
| `src/stores/searchStore.strongsPaging.test.ts` | Regression for `loadMoreStrongs` / `loadAllStrongs` / `totalAvailable` |
| `src/stores/searchStore.truncation.test.ts` | Regression for `resultsTruncated` — how each mode tells "capped" from "that is all of them" |

### Server

| File | Description |
|---|---|
| `server/routes/searchRoutes.ts` | `GET /api/search/keyword` - FTS5 keyword search; results carry the real `MatchType` (`exact` / `stem` / `fuzzy`) rather than a single flattened constant. `GET /api/search/semantic` - Semantic search via configurable pipeline; `?modules` names the reader's active translation and decides which repository **hydrates** the matched verses (falling back to KJV when it is absent or unresolvable). The embeddings are KJV-derived and matching is unaffected, but without that parameter a result renders in, and is labelled, KJV even while the reader sits in another translation. `GET /api/search/strongs` - occurrences of a Strong's number, paged via `maxResults` (default 100, ceiling `MAX_STRONGS_RESULTS` = 5000) and reporting `totalAvailable`. `POST /api/search/semantic/warmup` - returns `{ status: 'ready' \| 'unavailable' \| 'error' }` so the client can tell whether a server-side pipeline exists |
| `server/search/SearchPipeline.ts` | Orchestrator: wires embedder + vector search + reranker into a single search call |
| `server/search/SearchPipelineFactory.ts` | Creates pipeline from config (switches on `provider` discriminant) |
| `server/search/ApiEmbedder.ts` | Embedding via OpenAI-compatible API (negligible RAM) |
| `server/search/LocalOnnxEmbedder.ts` | Embedding via local ONNX model (~1-1.5GB RAM). Supports mean-centering via `meanVectorPath` config |
| `server/search/SqliteVectorSearch.ts` | In-memory brute-force search from SQLite embeddings. Auto-detects float32 or int8 precision from `index_metadata` |
| `server/search/NativeCliVectorSearch.ts` | Spawns C binary for mmap-based vector search (~5-15MB RAM) |
| `server/search/UsearchVectorSearch.ts` | **Preferred.** HNSW approximate nearest neighbor via `usearch` (<1ms search, ~260MB RAM: mmap'd index plus a ~207MB in-heap metadata Map) |
| `server/search/ApiReranker.ts` | Reranking via Jina/Cohere API |
| `server/search/NoOpReranker.ts` | Pass-through reranker (uses embedding scores as-is) |
| `server/search/index.ts` | Re-exports all search implementations |
| `server/DatabaseManager.ts` | Loads `semantic_nomic-v1.5.db` for semantic search service |
| `server/__tests__/filterTopicEntries.test.ts` | Tests for topic source filtering (`filterTopicEntries`, `resolveTopicSources`) |

### Browser-Side Search (opt-in)

| File | Description |
|---|---|
| `src/search/searchWorker.ts` | Web Worker: loads ONNX model + int8 vectors, runs embedding + brute-force search entirely in browser. Points `env.backends.onnx.wasm.wasmPaths` at our own `/ort/` copy — see "Self-hosting the ONNX Runtime backend" |
| `src/search/BrowserSearchProxy.ts` | Main-thread proxy: lazy-initializes worker, posts search messages, returns promises. A worker `'error'` event (how a wasm compile failure arrives) is reported through `onProgress` as `stage: 'error'` — the "Ideas Search unavailable" overlay is driven only by that callback — and clears the memoized init promise so a later search can retry |
| `src/search/BrowserSearchProvider.ts` | Implements `ISearchProvider`: browser semantic search + server keyword search |

### Data

The index files below live under `apps/web/data/` and are **generated build
artifacts, not repo content** — `apps/*/data/` is gitignored, so a fresh
checkout has none of them and must build or copy them in. The build scripts are
in the same table.

| File | Description |
|---|---|
| `semantic_128d_int8.db` | Compact centered embeddings (128-dim int8, ~195 MB) for server-side search |
| `semantic_128d_int8.bin` | Flat binary int8 vectors (~47 MB) for browser-side search |
| `semantic_128d_int8.meta.json` | Row metadata + mean vector (~60 MB) for browser-side search |
| `semantic_browser.db` | Legacy truncated embeddings (384-dim float16) — superseded by compact index. Still served by `GET /api/modules/semantic-index/download` |
| `search/build-compact-index.js` | **Not in this repo** — it lived in a repo-root `scripts/` directory that has not been imported, and its final location is not settled. Builds all compact index files from the full 768-dim source DB |
| `search/compute-mean-vector.js` | **Not in this repo** — it lived in a repo-root `scripts/` directory that has not been imported, and its final location is not settled. Computes mean embedding vector for centering (anisotropy correction) |
| `search/build-usearch-index.js` | **Not in this repo** — it lived in a repo-root `scripts/` directory that has not been imported, and its final location is not settled. Builds `.usearch` HNSW index from int8 compact DB for UsearchVectorSearch |
| `scripts/fetch-embedding-model.mjs` | Build-time download of the ONNX embedding model into `data/models/` for self-hosted (offline) browser search. Run via `npm run fetch:model`; also runs automatically as `prebuild`. Idempotent (skips existing files; `FORCE_MODEL_FETCH=1` to re-download) |
| `data/models/nomic-ai/nomic-embed-text-v1.5/` | Self-hosted q8 ONNX model + tokenizer, served at `/data/models/...`. Populated by `fetch:model` |
| `vite.config.ts` (`ortWasmPlugin`) | Copies `ort-wasm-simd-threaded.jsep.{mjs,wasm}` out of `node_modules/@huggingface/transformers/dist` into `dist/client/ort/`, and serves them from node_modules in dev |

### Header Integration

| File | Description |
|---|---|
| `src/components/Header.tsx` | Search input with keyword/semantic toggle button (magnifying glass / brain icon); parses as Bible reference or search query |
| `src/components/HomeScreen.tsx` | The home screen's Search button is an entry point into the results panel: it calls `searchStore.open()`, switches the right pane to search mode, expands it, then focuses the header field on the next frame. `open()` is required because the desktop right-pane Search **tab** is gated on `searchStore.isOpen` — without it the pane switched to a mode with no matching tab and the click read as doing nothing. On mobile the header field is hidden, `focusSearchField()` no-ops, and the panel's own inline input stays the entry point |

### Strong's Search (Core)

| File | Description |
|---|---|
| `packages/core/src/Data/Core/StrongsNumberHelper.ts` | Strong's number format normalization (parse, dictionary key, interlinear variants) |
| `packages/core/src/Services/WordFamilyService.ts` | Parses Strong's dictionary cross-references to build word family relationships |
| `packages/core/src/Services/BibleSearchService.ts` | `searchStrongs()` implementation, `setWordFamilyService()`, `getWordFamily()` |
| `packages/core/src/Data/Repositories/BibleRepository.ts` | `searchByStrongsNumber()`, `getGlossesForStrongs()` methods |

## Revealing the results panel

`DesktopApp` and `MobileApp` each watch the search store and switch the right
pane to search mode when a search runs. They depend on **`searchSeq`** as well
as `isOpen`, because `isOpen` stays true for as long as results exist: a user
who clicks a Strong's number (which swaps the right pane to Dictionary) and then
types a new query gets no false→true edge on `isOpen`, so Enter would appear to
do nothing. `performSearch()` and `performStrongsSearch()` bump the counter on
every launched search, which gives the effects an edge to fire on.

Covered by `src/stores/searchStore.searchSeq.test.ts`.

## Paging Strong's occurrences

Strong's results must not be hard-clamped with no way to reach the rest, and
`total` has to report what exists rather than the size of the page returned —
otherwise the client cannot tell whether there is more.

- `searchRoutes` honours a `maxResults` query param (default 100, floored/clamped
  to `MAX_STRONGS_RESULTS` = 5000; garbage or negative input falls back to the
  default rather than propagating `NaN`). The ceiling has to clear the busiest
  numbers — H3068 "LORD" runs to ~6.5k occurrences — or "Load all" could never
  reach the end.
- The response adds **`totalAvailable`**, the true unclamped count. It is
  counted straight from the interlinear index (the same lookup `groupedCounts`
  uses, minus the cap), summed per module per number *without* de-duplication so
  that `results.length < totalAvailable` reliably means "the cap truncated
  something". It is never reported lower than `results.length`.
- `searchStore.loadMoreStrongs()` grows the page by 100; `loadAllStrongs()` asks
  for the ceiling. The endpoint has no offset, so — as with semantic paging — a
  larger page simply replaces the list. Both are guarded by `searchSeq`, so a
  response for a superseded search is dropped, and `canLoadMore` is cleared when
  a page comes back no larger than the previous one.
- `SearchResultsPanel` shows the existing "Show more" button in Strong's mode
  plus a second **"Load all (N more)"** button driven by `strongsRemaining`.

Covered by `src/stores/searchStore.strongsPaging.test.ts`,
`server/__tests__/searchRoutes.test.ts` and
`src/components/Search/SearchResultsPanel.test.tsx`.

## Search distribution sparkline

`SearchDistributionChart` draws a row of **66 equal-width bars**, one per book,
as the first thing inside the results scroll area — so it scrolls away with the
results rather than sticking.

- **Equal widths, not width-by-length.** A bar is a click target as much as a
  datum, so Obadiah gets the same slice as Psalms. `flex: 1 1 0` on every cell,
  no gap; measured at 7.1px per bar in the desktop right pane (481px plot) and
  5.4px on a Pixel 5 (368px plot).
- **Height is the count**, scaled to the busiest book, with a **12% floor**
  (`MIN_BAR_PERCENT`) so a single match is unmistakable next to a fifteen-match
  neighbour. Heights are percentages, which is what lets the plot grow from 34px
  to 44px on a phone without the component knowing.
- **Colour is the canonical section**, from the same scheme the passage picker
  uses (`_bible-sections.scss`). Books with **no** matches keep a 2px hairline in
  their own section's hue, so the canon's shape and its divisions read across the
  full width. **No legend** — a legend costs a row of vertical space and its
  swatches would not line up with the bars they describe; the tooltip names the
  bar instead.
- **A testament break** — a 9px gap with a dashed rule — sits between Malachi and
  Matthew, and the testament labels below are laid out on the *same* flex
  proportions (39 / break / 27) so "New Testament" starts under Matthew rather
  than drifting to the right-hand end. Measured alignment: 0.13px on desktop,
  0.05px on mobile.
- **Hover and keyboard focus both name the bar**, including the empty ones
  ("Obadiah — no matches"). A `useLayoutEffect` clamps the tip inside the plot so
  bars at either end are not clipped. Bars with matches are `<button>`s with an
  `aria-label`; empty ones are `role="img"` with the same label and are not
  focusable.
- **Clicking a bar selects that book's first match and scrolls it into view** —
  `searchStore.setLastClickedId()` plus `scrollIntoView({ block: 'nearest' })` on
  the row's `data-result-id`. It deliberately does **not** navigate the Bible
  pane, so a mis-click on a 5px bar costs nothing.

### What the chart counts, and how it knows it is capped

The chart counts **the rows the panel is currently holding**, never the Bible —
every bar has to correspond to a row the click can scroll to. **Fuzzy results are
excluded** (they are close spellings, not occurrences of the searched term);
**stem results count**, and the caption says so. The exclusion is gated on the
search mode, because a semantic row's `type` is its retrieval level
(`verse` / `paragraph` / `chapter`), not a `MatchType`.

`searchStore.resultsTruncated` decides whether the caption adds "only the results
loaded so far are counted", and each mode has to answer it differently because
each endpoint bounds itself differently:

| Mode | Signal | Why |
|---|---|---|
| Keyword | `results.length >= KEYWORD_PAGE_SIZE` (50) | `GET /api/search/keyword` has no offset and reports `total` as `results.length`, so the response carries no truncation signal at all. The store now asks for an explicit `pageSize` so the limit is a constant it owns rather than the server's default (the route caps at 100). A page that came back exactly full cannot be told apart from one the cap cut short — hence a caption that hedges rather than claiming a Bible-wide tally. |
| Semantic | `canLoadMore` | The store asks for a page (20, growing by 20) and infers more from a full one; the route caps `maxResults` at 50. |
| Strong's | `results.length < strongsTotalAvailable` | The only endpoint that reports a true unclamped count. |

## Approximate (fuzzy) matches in the list

`SearchResultData.type` is now a union (`SearchResultType`) rather than `string`,
and keyword/Strong's results carry the real `MatchType` from `@bible/core`. Before
this, `searchRoutes` mapped every keyword result with a hardcoded `type: 'bible'`,
so the browser could not tell an approximate spelling from a real occurrence.

- Fuzzy rows get an amber **"Approximate"** badge, matching the desktop app's
  `warning-soft` / `warning-text` pair (the web themes had no warning colour, so
  `--warn-soft` / `--warn-text` / `--warn-border` were added alongside the section
  hues).
- **One labelled divider** ("Approximate matches" plus a line explaining they are
  close spellings and related word forms, not counted in the chart) is inserted
  before the first fuzzy row, and the rows below it take a sunk background and a
  quieter reference colour.
- `SearchResultsPanel` **partitions the list itself** rather than trusting the
  order it arrives in. `BibleSearchService.rankResults` does currently sort every
  exact match ahead of every fuzzy one, but that is an incidental property of a
  relevance comparator, and the `search:results` server hook can reorder the list
  afterwards.

Covered by `SearchDistributionChart.test.tsx`, `SearchResultItem.test.tsx`,
`SearchResultsPanel.test.tsx`, `searchStore.truncation.test.ts` and
`server/__tests__/searchRoutes.test.ts`.

## Key Behaviors

- Click result navigates to verse in current module
- Ctrl+Click opens result in new Bible tab
- Auto-switches right pane to search mode when search executes
- Close button returns right pane to commentary mode
- Keyword search uses SQLite FTS5 with snippet context
- Semantic search uses 128d int8 mean-centered embeddings with score fusion (0.4 embedding + 0.6 reranker)
- Results are consolidated: facets deduped, sub-verses absorbed into passages (unless verse scores higher), consecutive verses merged
- Passage titles from enrichments DB shown below reference
- Search type toggle button in header switches between keyword (magnifying glass) and semantic (brain icon)
- Semantic search pipeline is configurable via `search-pipeline.json` in `apps/web/data/` (env `SEARCH_CONFIG` overrides the path; upstream the schema is at `/schemas/search-pipeline.schema.json` in the repo root and the example alongside the search tooling as `search-pipeline-config.example.json`, but **neither the root `schemas/` nor the root `scripts/` directory is imported into this repo**). The file is gitignored along with the rest of `apps/*/data/`, so it is deployment configuration rather than repo content — a fresh checkout has none and must create one to use `search.mode: "server"`.
- Hybrid search (optional): strict AND-mode keyword search with stopword removal, merged with semantic results
- Minimum score threshold filters noise (default 0.15, configurable)
- Topic sources are individually configurable via `scoring.topicSources` in `search-pipeline.json`: enable/disable Nave's topics, Torrey's topics, and custom enrichment tags independently
- Supports API-based embedding/reranking (negligible RAM) or local ONNX models
- **Server-mode RAM, measured** (only applies when `search.mode` is `'server'`; `'browser'` costs the server nothing):
  - Embedder: `+317MB` at the default `dtype: 'q8'`, or `+1,053MB` at `'fp32'` — q8 is also faster (13ms/embed vs 28ms). Set `embedder.dtype` in `search-pipeline.json` to override
  - Vector search: `+207MB` metadata Map plus ~50-60MB mmap'd HNSW index
  - Reranker: 0 for none/API, ~90-120MB for local ONNX MiniLM-L-6
  - So: ~265MB with API embedder + usearch + API reranker; ~700MB fully local at the q8 default, ~1.4GB fully local at fp32
- **Embedder/reranker `dtype` is configurable** via `embedder.dtype` / `reranker.dtype` in `search-pipeline.json`. Embedder defaults to `q8`, reranker to `fp32`. Measured on the 128d index, q8 vs fp32 query embeddings agree on top-1 for 10/10 sample queries but only ~7.9/10 of the top-10 — acceptable because the reranker rescores the candidate set and the shipped index is int8-quantized anyway, but benchmark before relying on it for ranking-sensitive work. The chosen dtype's ONNX file must exist in the model directory, which matters for self-hosted setups running `allowRemoteModels: false`
- Native CLI vector search uses mmap C binary for ~5-15MB resident RAM vs ~90MB+ in-memory
- **Preferred (web app): ANN index via `usearch`** — HNSW graph index gives <1ms search vs ~120ms brute-force, with 99%+ recall
- **Query length is capped at 512 chars**, defined once as `MAX_SEARCH_QUERY_CHARS` in `@bible/core` (`packages/core/src/Services/Search/SearchQueryLimits.ts`) and enforced on every embedding path: HTTP routes reject with 400 (`validateSearchQuery`), and `LocalOnnxEmbedder`, the desktop handler, and the browser worker each clamp via `clampSearchQuery` as a backstop. Transformer attention is O(n²) and the tokenizer's own `model_max_length` is 8192, so an unbounded query is a CPU/RAM amplifier: 15,000 chars measured at 10.5s and ~1.5GB transient RSS before the cap, ~370ms and +6MB after. The browser worker duplicates the constant because Vite's worker build cannot import the CJS core package (same constraint as `src/offline/bibleWorker.ts`)
- **Semantic requests are gated** to 2 concurrent with a 10-deep queue (`server/utils/semaphore.ts`); overflow returns 503 `SERVICE_BUSY` with `Retry-After` rather than queueing behind the 15s timeout
- Compact index: 128d int8 mean-centered embeddings (~48 MB vectors vs ~1.1 GB for 768d float32)
- Browser-side Ideas Search: runs ONNX q8 model + int8 vector search in a Web Worker. One-time download of ~180 MB (model + vectors + metadata)
- **Search mode is server-controlled** via `search.mode` in `site-config.json` (or `searchMode` in legacy `server-config.json`): `'server'` (server builds the embedding pipeline — high RAM), `'browser'` (**default** — clients search locally, server stays lean), or `'off'`. The server only builds the in-process pipeline when mode is `'server'`; the mode is advertised to clients via `/api/config` (`search.semantic`). `main.tsx` selects `BrowserSearchProvider` when the server declares `'browser'`, else honors the per-user `settingsStore.browserSemanticSearch` opt-in.
- **Self-hosting the ONNX Runtime backend**: the model is only half the download. transformers.js also pulls ort's wasm backend (`ort-wasm-simd-threaded.jsep.mjs` and its 21 MB `.wasm`) from `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<version>/dist/` unless `env.backends.onnx.wasm.wasmPaths` says otherwise. Our CSP is `default-src 'self'`, so that import is refused and the pipeline fails with `no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/...`, surfaced as the "Ideas Search unavailable" overlay. `ortWasmPlugin` in `vite.config.ts` emits both files to `dist/client/ort/` (and serves them from `node_modules` in dev); `main.tsx` passes `${baseUrl}/ort/` down through `BrowserSearchProvider` → `BrowserSearchProxy` → the worker's `init` message. `numThreads` is pinned to 1 because COEP is deliberately off, so there is no `SharedArrayBuffer` for the threaded build to use. **If the transformers.js version changes, the file names must still match** — they are hard-coded in the plugin, which warns rather than failing the build when they do not.
- **Self-hosted model**: the browser worker loads the ONNX model from `/data/models/` on our own server (via transformers.js `env.remoteHost`), not the HuggingFace CDN — offline-capable and no external dependency. `BrowserSearchProvider` receives the model host (`${baseUrl}/data/models`) and passes it through the proxy to the worker.
- Server serves data files at `/data/` route for browser-side access (vectors, metadata, and the model under `/data/models/`)
- **Strong's search**: Auto-detects `G25`, `H7225`, or `strongs:G25` patterns in the search bar
- Strong's results show word info header (number, original word, transliteration, gloss)
- **The gloss in that header is truncated.** The gloss is the KJV usage list the server parses out of the lexicon entry (`WordFamilyService.parseGlossAndRefs`, everything after `:--`). A Strong's module has no separate short-definition column to prefer — it is one `definition` blob — and the gloss is unbounded: a few words for most entries (median 11 characters across Strong's Greek) but 564 for `G1722` (ἐν) and 765 at worst. `SearchResultsPanel` cuts it at `GLOSS_PREVIEW_LENGTH` (120) on a word boundary with `truncateAtWordBoundary` from `@bible/core/browser`, keeps the full text in the span's `title`, and — only when something was cut — renders a **Full entry** button (`data-testid="strongs-full-entry"`). The same budget now applies to `StrongsTooltip`'s gloss line, which sat beside an already-truncated description
- **"Full entry" goes wherever that layout already sends a Strong's click.** `SearchResultsPanel` takes an optional `onOpenStrongsEntry` prop rather than picking a destination itself: `DesktopApp` passes its `handleStrongsClick` (Dictionary tab), `MobileApp` passes `useAppShared`'s (the `StrongsPopup`). With no prop the affordance is not rendered
- Word family pills show related words with occurrence counts; clicking searches that number
- "Include related words" toggle expands search to include word family members (e.g., G25 agapao + G26 agape + G27 agapetos)
- Strong's popup (interlinear study mode, mobile layout) has a "Search all occurrences" button
- The desktop layout routes an interlinear Strong's click to the Dictionary tab rather than the popup, so the same action lives on the dictionary entry: `DictionaryContent` renders a "Search all occurrences of G25" button whenever the open tab is a Strong's lexicon. `strongsNumberFor()` derives the number from the entry key, which is zero-padded and prefixless (`00025`), taking the G/H from which lexicon the tab is showing
- `GET /api/search/strongs?number=G25&includeRelated=true&maxResults=100` endpoint returns entry info, word family, results, `total` (this page) and `totalAvailable` (all occurrences)
