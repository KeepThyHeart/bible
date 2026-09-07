# Search

Two independent search stacks live in `@bible/core`: a complete, self-contained keyword/FTS5 engine (`BibleSearchService`), and the *contracts and pure scoring functions* for semantic search - whose embedder, vector index, and reranker implementations live in the platform packages, not here.

## Files

### Keyword search (FTS5)

| File | Purpose |
|---|---|
| `src/Services/ISearchService.ts` | The contract `BibleSearchService` implements: `search`, `parseQuery`, `getSuggestions`, `getIndexStatus`, `buildIndex`. |
| `src/Services/BibleSearchService.ts` | The engine (1,800 lines). Routes by parsed query type, runs FTS5, highlights, dedups, ranks, limits. |
| `src/Services/BibleSearchService.test.ts` | Runs against a real KJV fixture via `KJVTestHelper`; covers each search type, highlighting, dedup, ranking, auto-fuzzy, character variants. |
| `src/Services/SearchQueryParser.ts` | Pure syntax classifier: Strong's, regex, `~Nv`, `~N`/`~Nw`, `~fuzzy`, boolean, phrase, multi-word. Also `validate`, `isReference`, `extractPhrases`, KJV spelling suggestions. |
| `src/Services/SearchQueryParser.test.ts` | Query-type detection, term extraction, proximity/boolean parsing, validation, reference detection. |
| `src/Services/FtsQuery.ts` | `escapeFts5Term` / `escapeFts5Query` - quote the terms FTS5 would otherwise read as syntax. |
| `src/Services/FtsQuery.test.ts` | Escaping rules, including reserved words and embedded quotes. |
| `src/types/search.ts` | `SearchResult`, `Match`, `MatchType`, `ParsedQuery`, `BooleanExpression`, plus re-exports of `SearchOptions`/`SearchScope`/`BibleRange`/`SavedSearch` from the `SavedSearch` model. |
| `src/Data/Repositories/IBibleSearchRepository.ts` | Interface for the search tables: index metadata, verse positions, saved searches. |
| `src/Data/Repositories/BibleSearchRepository.ts` | Implementation over `bible_search_index`, `bible_search_index_metadata`, `bible_search_verse_positions`, `saved_search`. |
| `src/__tests__/BibleSearchRepository.test.ts` | Repository-level tests against a full `main.db` schema. |
| `src/__tests__/BibleSearchHighlightColumns.test.ts` | Guards `searchVersesWithHighlighting` against modules whose `bible_verse` and `bible_verse_fts` column shapes disagree (silent empty-text results). |
| `src/Controllers/SearchController.ts` | Stateful wrapper for UI: in-flight guard, saved searches, index build progress. See [Controllers](controllers.md). |

### Semantic search

| File | Purpose |
|---|---|
| `src/Services/SemanticSearchService.ts` | Brute-force in-memory cosine search over a `semantic_embeddings` SQLite table. Also exports `cosineSimilarity`. |
| `src/Services/SemanticSearchService.test.ts` | Covers `cosineSimilarity` only. |
| `src/Services/SearchOrchestrationService.ts` | Framework-agnostic orchestration on top of an `ISearchPipeline`: fuse -> consolidate -> tag-rerank -> topic-expand -> enrich -> min-score -> optional hybrid merge. |

### Pipeline contracts and pure functions - `src/Services/Search/`

| File | Purpose |
|---|---|
| `src/Services/Search/index.ts` | Barrel for everything below. Re-exported wholesale from `src/index.ts`. |
| `src/Services/Search/IEmbedder.ts` | `initialize` / `embedQuery(query): Float32Array` / `dispose`. |
| `src/Services/Search/IVectorSearch.ts` | `search(queryVector, {topN, minScore, levels}): SearchCandidate[]`. |
| `src/Services/Search/IReranker.ts` | `rerank(query, candidates, topN): RerankResult[]`. |
| `src/Services/Search/ISearchPipeline.ts` | The composed embed -> search -> rerank operation. |
| `src/Services/Search/SearchTypes.ts` | `SearchCandidate`, `RerankResult`, `VectorSearchOptions`, `PipelineSearchOptions`, `PipelineTimings`, `PipelineSearchResult`. |
| `src/Services/Search/SearchPipelineConfig.ts` | Discriminated-union config a factory switches on: embedder (`api` / `local-onnx` / `browser-onnx`), vector search (`sqlite` / `native-cli` / `browser` / `usearch`), reranker (`api` / `local-onnx` / `none`), plus `ScoringConfig` and `TopicSourcesConfig`. |
| `src/Services/Search/ScoringUtils.ts` | Scoring defaults + `resolveScoringConfig`, `resolveTopicSources`, `filterTopicEntries`, `applyMainFacetPreference` (and a plain-object variant for CLI scripts). |
| `src/Services/Search/ScoreFusion.ts` | `minMaxNormalize`, `linearBlend` (default alpha 0.4), `reciprocalRankFusion` (k=60), `fuse`. |
| `src/Services/Search/Consolidation.ts` | `rangesOverlap` + `consolidate`: cluster overlapping verse ranges, pick a representative (prefers paragraph > chapter > verse within 5% of best), boost by cluster size. |
| `src/Services/Search/TopicExpansion.ts` | `expandTopics`: turn matched topic embeddings into scored verse lists, cap them below the best non-topic score ("leapfrog cap"), merge and dedup. |
| `src/Services/Search/TagReranking.ts` | `tagRerank`: add `boost * tagStrength` (default 0.10) to verses carrying a matched enrichment tag. |
| `src/Services/Search/StopWords.ts` | `ENGLISH_STOP_WORDS` + `extractMeaningfulTerms`. English-only by design; see the file's own note. |
| `src/Services/Search/SearchQueryLimits.ts` | `MAX_SEARCH_QUERY_CHARS` (512) and `clampSearchQuery`, with the measured O(n^2) attention cost that motivates it. |

## How it works

### Keyword path

```
SearchController.performSearch(query, options)
  -> BibleSearchService.search()
      -> SearchQueryParser.validate() / .parse()   ->  ParsedQuery.searchType
      -> switch -> searchMultiWord | searchPhrase | searchProximity
                | searchVerseProximity | searchBoolean | searchFuzzy
                | searchRegex | searchStrongs
      -> (0 results?) retry with generateCharacterVariantQuery()   // "Aenon" -> "Ænon"
      -> (1..9 results?) addFuzzyMatches()
      -> filter by options.range
      -> deduplicateResults() -> rankResults() -> slice(maxResults ?? 200)
```

Modules are held in a `Map<abbreviation, IBibleRepository>` passed to the constructor; `addBibleModule` registers more at runtime, which is what a "try in another translation" path needs. Per-module FTS work goes through `IBibleRepository`, not `IBibleSearchRepository`:

- `searchVersesWithHighlighting(fts5Query, {limit})` - verse-level FTS5 with `highlight()`, returning `<strong><u>...</u></strong>` markup. `extractMatchesFromHighlightedText` walks that markup to recover match offsets in plain text, which is how stemmed matches ("walk" -> "walked") get highlighted correctly.
- Proximity uses a **book-level** index inside the module DB: `ensureSearchTablesExist()`, `isBookIndexed(book)`, `buildBookIndex(book)`, then `searchBookFTS5(book, "NEAR(a b, 10)")`. When FTS5 returns no `offsets()` for the NEAR query, the service falls back to `searchProximityInBook(book, terms, distance)`; otherwise it maps character offsets back to verses via `getVerseIdAtPosition` / `getVersePosition`.
- Strong's search goes to `searchByStrongsNumber(variants, range)` on the interlinear table, with the range pushed into SQL. `WordFamilyService` (injected via `setWordFamilyService`) supplies related numbers when `options.includeRelatedWords` is set; relatives score 0.8 against the primary's 1.0.

### Semantic paths

There are two, and they do not share code past the interfaces.

**Direct**, skipping the pipeline entirely - the shape a consumer uses when it embeds a query itself:

```
consumer's semantic-search entry point
  -> getQueryEmbedding()            // @huggingface/transformers, Xenova/nomic-embed-text-v1, fp32
  -> SemanticSearchService.search(queryEmbedding, {maxResults, levels, minSimilarity: 0.3})
      -> loadEmbeddings() once (all rows into a Map of Float32Array views)
      -> cosineSimilarity against every entry at the requested levels
  -> formatSemanticReference() + verse-text enrichment by the caller
```

**Via `ISearchPipeline`**, the full path:

```
SearchPipelineFactory(config) -> ISearchPipeline
SearchOrchestrationService.semanticSearch({query, pipeline, ...})
  1. pipeline.search()              // embed -> vector search -> rerank; 3x candidate over-fetch
  2. fuse(results, 'linear', {alpha: 0.4})
  3. consolidate(scored, maxResults)
  4. tagRerank(...)                 // only when topic entries survive filterTopicEntries()
  5. expandTopics(...)              // topic embeddings -> their verse lists
  6. enrich                         // real verse text via IBibleRepository, reference via VerseIdHelper
  7. filter score >= minScore (default 0.15)
  8. hybrid? fuseHybridResults(semantic, keyword)   // +0.05 boost, keyword-only appended
```

Topic data is *pre-fetched by the caller* - `fetchTagStrengths` and `prefetchTopicData` on the orchestration service hit `IEnrichmentRepository` and an `ITopicalRepoProvider`, then hand plain arrays to the pure functions. The pure functions never touch a database.

## What core does not provide

`src/Services/Search/` contains **no runtime search code**. Every file there is an interface, a config type, or a pure function; nothing in `@bible/core` constructs an embedder, opens a vector index, or loads a reranker model.

A consumer that wants semantic search supplies its own `IEmbedder`, `IVectorSearch` and `IReranker` - typically ONNX/transformers.js locally or a hosted API - and wires them into an `ISearchPipeline`. Core's job is to define those seams and to own the pure ranking stages behind them.

When chasing a ranking bug, trace where the target verse sits after each stage - that is the fastest way to tell a bad embedding from a bad fusion weight from an over-eager consolidation.

## Gotchas

- **`IBibleSearchRepository`'s index and proximity methods are dead weight on the live path.** They are keyed `(document, division)` against `main.db`; `BibleSearchService` indexes at *module* level through `IBibleRepository` instead. `BibleSearchService` no longer takes an `IBibleSearchRepository` at all - saved searches belong to `SearchController`.
- **Core does not record what users search for.** Query logging had already been disabled for privacy, leaving a history API that always returned nothing; the whole surface - `addSearchHistory`, `getSearchHistory`, `clearSearchHistory`, `deleteOldHistory`, and the service and controller wrappers over them - has since been removed. `getSuggestions()` returns KJV spelling variants only. The `search_history` table remains declared in the schemas but is never written.
- **`getIndexStatus` never populates `lastIndexed`.** The local is declared and returned but never assigned.
- **Boolean queries need parentheses.** `SearchQueryParser.hasBooleanOperators` returns true only when the query contains one, so `faith OR hope` is a literal multi-word search while `(faith OR hope)` is a boolean one. That is deliberate - it keeps `believed not` from being read as an operator - but it is not discoverable, and the operators are matched case-insensitively so `(love and peace)` works too.
- **Bare negation returns nothing.** FTS5's `NOT` is binary, so `(NOT wicked)` has no left-hand match set to subtract from and `searchBoolean` returns `[]` rather than scanning the whole Bible. Use the binary form, `(faith NOT works)` or `(faith AND NOT works)`. (Until this was fixed, `(NOT wicked)` returned the verses that *contain* "wicked" - the exact opposite of the query.)
- **Proximity search silently skips read-only modules.** The book index is written *into the module database*, so a bundled module inside a macOS `.app` or a mounted AppImage cannot be indexed. `ensureSearchTablesExist()` returning true is not sufficient - a shipped module can carry empty index tables - so `buildBookIndex` is wrapped and `isReadOnlyDatabaseError` failures `continue` rather than throw. That module contributes no proximity results at all, with no user-visible signal.
- **"Fuzzy" is wildcard prefix matching, not edit distance.** `buildFuzzyPattern` emits `term*`. `levenshteinDistance` exists but is only used by `findFuzzyMatchedWords` to decide what to *highlight*. Auto-fuzzy only fires when the result count is between 1 and 9 - zero results deliberately skip it.
- **Regex search is O(whole Bible) in JavaScript.** FTS5 cannot do it, so `searchRegex` calls `repo.getBook()` for every book in scope and tests each verse.
- **Deduplication is by `verseId` alone, across modules.** Searching KJV and ESV together yields each verse once, from whichever module the `Map` iterated first. Insertion order therefore decides which translation the user sees.
- **`score` is nearly decorative for keyword results.** Almost every path assigns `1.0` (Strong's word-family relatives get `0.8`). Ordering comes from `rankResults`: exact before fuzzy, then an exact-phrase boost for multi-word queries, then canonical verse order.
- **Two different `SemanticSearchResult` types exist.** `SemanticSearchService` exports one and `SearchOrchestrationService` exports another; `src/index.ts` re-exports the latter as `OrchestrationSearchResult` to keep the root barrel from colliding.
- **`SemanticSearchService` assumes float32 blobs.** It builds `Float32Array` views over `embedding_blob` with `byteLength / 4`. Int8-quantized indexes are the platform vector-search implementations' business, not this class's.
- **Nothing in `src/Services/Search/` has a unit test.** `ScoreFusion`, `Consolidation`, `TopicExpansion`, `TagReranking`, and `ScoringUtils` are pure and trivially testable, and are currently not covered at all.
- **Query length is capped at three layers on purpose.** HTTP routes reject over 512 chars with a 400; each embedder calls `clampSearchQuery` as a backstop for non-route callers. Do not "simplify" this to one layer.

## See also

- [Controllers](controllers.md) - `SearchController`'s state and saved-search handling.
- [Repositories](repositories.md) - `IBibleRepository`'s FTS and interlinear methods.
- [Verse identity](verse-identity.md) - `VerseIdHelper`, used for ranges, dedup, and reference formatting.
