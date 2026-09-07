# Controllers

The stateful layer between a UI and the stateless services/repositories: controllers hold in-flight flags, tab lists, history stacks, and pin state, and are constructed with injected interfaces so they can be unit-tested with no database. Reach for this doc before adding logic to an Electron IPC handler or a Preact store that other platforms would also need.

## Files

| File | Purpose |
|---|---|
| `src/Controllers/SearchController.ts` | Wraps `ISearchService` + `IBibleSearchRepository`: query-vs-reference detection, single-flight guard, saved searches, history, index build progress. |
| `src/Controllers/SearchController.test.ts` | Uses a hand-rolled `ISearchService` mock plus `MockBibleSearchRepository`. |
| `src/Controllers/NotesController.ts` | All user-note business logic over `IUserNoteRepository`: typed constructors, hierarchy, tags, filtering, statistics. |
| `src/Controllers/NotesController.test.ts` | Runs against `MockUserNoteRepository`. |
| `src/Controllers/ModuleController.ts` | Module discovery -> download -> install -> update -> uninstall, plus download queue control. |
| `src/Controllers/ModuleCatalogController.ts` | Catalog *source* management: add/remove/enable/refresh a catalog and read its module list. |
| `src/Controllers/VerseNavigationController.ts` | Browser-style back/forward history stack for verse navigation, with serialize/restore. |
| `src/Controllers/VerseNavigationController.test.ts` | Full coverage of the stack semantics. |
| `src/Controllers/BibleTabController.ts` | Bible tab lifecycle: open/close/switch/reorder, per-tab display mode and study options, per-tab navigation controller, parallel-view state. |
| `src/Controllers/BibleTabController.test.ts` | Full coverage of tab lifecycle and serialization. |
| `src/Controllers/CommentaryCoordinationController.ts` | Commentary panel state *collectively*: verse sync, pinning, tabs, per-tab browse mode. |
| `src/Controllers/index.ts` | Barrel over all seven controllers. Re-exported wholesale by `src/index.ts` - a controller missing here is missing from the package's public surface. |
| `src/__tests__/helpers/MockRepositories.ts` | `MockBibleSearchRepository`, `MockUserNoteRepository` used by the controller tests. |

`ModuleController`, `ModuleCatalogController`, and `CommentaryCoordinationController` have no test files.

## The layer's role

Services are stateless and repositories are per-database; a controller is where the state that outlives a single call lives. Three shapes appear here:

1. **Guarded orchestration** - `SearchController` holds `isSearching` / `currentQuery`, rejects a second concurrent search, and clears the flag in a `finally` so a thrown search cannot wedge the UI permanently. It delegates all actual searching to `ISearchService`.
2. **Domain logic over one repository** - `NotesController` and `ModuleController`. `NotesController` adds typed constructors (`createVerseNote`, `createSermon`, `createJournalEntry`, `createPrayer`, `createDocument`), hierarchy helpers (`getChildNotes`, `countDescendants`), and a `getFilteredNotes(NoteFilter)` front end that the raw repository does not offer.
3. **Pure UI state machines** - `VerseNavigationController`, `BibleTabController`, `CommentaryCoordinationController`. No repository at all: they were extracted from the desktop Zustand store so any UI framework could reuse them, and they each expose `serializeState()` / `restoreState()` for session persistence.

Dependencies arrive as interfaces via the constructor:

```ts
new SearchController(searchService /* ISearchService */, searchRepo /* IBibleSearchRepository */);
new NotesController(noteRepository /* IUserNoteRepository */);
new ModuleController(moduleMetadataRepo, downloadQueueRepo, downloadService, installationService, catalogService, tempDownloadPath);
```

`ModuleCatalogController` is the exception - it takes a raw `ISql` and constructs a concrete `ModuleCatalogRepository` internally.

## Who constructs them

Core constructs no controller itself. Each is instantiated by the consuming application - typically once per database connection, at the point where that application wires up its IPC handlers, HTTP routes, or UI stores - and handed the repository interfaces it declares.

## Exports

`src/Controllers/index.ts` is the barrel, and `src/index.ts` re-exports it:

```ts
// src/index.ts
export * from './Controllers';
```

*Fixed 2026-09-05.* The barrel used to export only `ModuleController` and
`ModuleCatalogController` while `src/index.ts` listed all seven files
individually. The package's runtime surface was therefore complete and nothing
broke - no TypeScript source imports `./Controllers` - but the generated API
reference under `developer/api/core/Controllers/` documented just those two.
Collapsing `src/index.ts` onto the barrel removes the duplicated list that let
the two drift; add a new controller in one place now, not two.

## Gotchas

- **`VerseNavigationController` and `BibleTabController` are specifications as much as code.** A client is free to re-implement navigation history as pure reducers in its own store rather than instantiate these; both are exported and fully tested, so they remain the written statement of the intended behavior even where a client does not call them.
- **`ModuleCatalogController` breaks the injection rule.** It accepts `ISql` and does `new ModuleCatalogRepository(mainDb)` in its constructor, so it cannot be tested without a real database - which is likely why it has no test file. Every other repository-backed controller takes interfaces.
- **`SearchController.cancelSearch()` does not cancel anything.** It clears `isSearching` so the UI can start a new search; the in-flight promise keeps running and its results are simply dropped by the caller. The comment marks a cancellation token as future work.
- **`SearchController` has no search-history methods.** It used to carry `getSearchHistory`, `clearSearchHistory` and `deleteOldHistory`, which routed to an `ISearchService` that never wrote history; the whole surface has been removed rather than left as no-ops - see [Search](search.md).
- **Two names collide across layers.** `SearchController` imports `SearchOptions` and `SavedSearch` from `src/types/search.ts` (which re-exports them from the `SavedSearch` model). `src/Api/ApiTypes.ts` declares a *different, unrelated* `SearchOptions` and `SearchResult`. See [API contracts](api-contracts.md).
- **`NotesController` has two overlapping query front ends.** `getAllNotes(RepositoryQueryOptions)` and `getFilteredNotes(NoteFilter)` both list notes with different option shapes; the doc comment on `getAllNotes` points at the other. Pick `getFilteredNotes` for anything type/tag/date-scoped.
- **`CommentaryCoordinationController` coordinates commentaries collectively, not per instance.** `pin(commentaryId?)` records `pinnedCommentaryId`, but `getEffectiveVerseId()` ignores it - a pin from any tab freezes the verse for all of them. `unpin(commentaryId)` does respect it and refuses to unpin when a different tab holds the pin.
- **`BibleTabState` and `SerializedBibleTab` are deliberately different types.** The live state holds a `VerseNavigationController` *instance*; the serialized form holds a plain `NavigationState` object. Do not merge them.

## See also

- [Search](search.md) - what `SearchController` delegates to.
- [Repositories](repositories.md) - the interfaces controllers are injected with.
- [Data layer](data-layer.md) - model classes such as `UserNote`, `ModuleMetadata`, `SavedSearch`.
