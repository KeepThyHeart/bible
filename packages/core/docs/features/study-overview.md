# Study Overview

Four aggregation services that collapse *every installed module of a given kind* into one per-chapter payload - commentary entry metadata, topical-index hits, cross-references, and tag-graph entities - in the exact wire shape the study cache stores. Reach for this when you are changing what the study pane shows for a chapter, or anything about `study_cache.db`.

## Files

| File | Purpose |
|---|---|
| `src/Services/StudyOverview/index.ts` | Barrel: types plus the four interface/implementation pairs. Re-exported from `src/index.ts` and `src/Services/index.ts`. |
| `src/Services/StudyOverview/types.ts` | The wire shapes (`ChapterCommentaryOverview`, `TopicsByVerse`, `CrossRefsByVerse`, `EntitiesByVerse`), the `AggregationModule<TRepo>` wrapper, and the `chapterStart` / `chapterEnd` verse-ID helpers. |
| `src/Services/StudyOverview/ICommentaryAggregationService.ts` | `getChapterOverview(book, chapter, modules)`. |
| `src/Services/StudyOverview/CommentaryAggregationService.ts` | Calls `ICommentaryRepository.getEntriesForRange` per module; emits metadata only (module, range, level, word count) - no body text. |
| `src/Services/StudyOverview/ITopicAggregationService.ts` | `getChapterTopics(book, chapter)`, plus the `Precomputed*` shapes and an `ITopicAggregationServiceFactory` declaration. |
| `src/Services/StudyOverview/TopicAggregationService.ts` | Bulk-reads every topic and topic-verse link once via `static from(modules)`, precomputes ancestor chains and recursive verse counts, then slices per chapter. |
| `src/Services/StudyOverview/ICrossRefAggregationService.ts` | `getChapterCrossRefs(book, chapter, modules)`. |
| `src/Services/StudyOverview/CrossRefAggregationService.ts` | Calls `ICrossReferenceRepository.getGroupsWithEntriesForRange`; groups keyed by source verse. |
| `src/Services/StudyOverview/IEntityAggregationService.ts` | `getChapterEntities(book, chapter, tagGraph)` - a single repo, not an array. |
| `src/Services/StudyOverview/EntityAggregationService.ts` | Calls `ITagGraphRepository.getEntityRangesForVerseRange`; keys each row under its `startVerseId`. |
| `src/__tests__/StudyOverview/StudyOverview.test.ts` | Runs against real fixtures (`commentary_barnes.db`, `xref_tsk.db`, `topical_nave.db` under `packages/desktop/data/modules/`, and `tag_graph.db` under `packages/desktop/data/`), auto-skipping when they are absent. Asserts wire shape, module ordering, and that optional fields are *omitted* rather than serialized as null. |

## What "aggregate across modules" means here

A user has, say, Barnes and Matthew Henry installed as commentaries, Nave's and Torrey's as topical indexes, and TSK as cross-references. Each of those is a separate SQLite file with its own schema and its own ID space. Asking "what study material exists for John 3?" therefore means querying five databases and merging the answers.

These services do that merge, and only that merge. Each takes an array of `AggregationModule<TRepo>` - a repository instance plus the `abbreviation` and `moduleName` to tag its output with - and returns one plain object for the `(book, chapter)`:

```ts
const start = chapterStart(43, 3);   // 43_003_000
const end   = chapterEnd(43, 3);     // 43_003_999

new CommentaryAggregationService()
  .getChapterOverview(43, 3, [
    { abbreviation: 'barnes', moduleName: "Barnes' Notes", repository: barnesRepo },
    { abbreviation: 'mhc',    moduleName: 'Matthew Henry',  repository: mhcRepo },
  ]);
// -> [{ m: 'barnes', mn: "Barnes' Notes", s: 43003016, e: 43003016, l: 'verse', w: 412 }, ...]
```

Modules are visited in array order and output preserves it, so the caller controls display precedence. Commentary bodies are deliberately excluded - the overview is a table of contents, and the body is fetched from the originating module when the user opens an entry.

## How it is meant to be consumed

Aggregating a chapter touches several module databases, so it is too slow to do on every view. The intended shape is that a consumer holds an `AggregationContext` (the repositories plus one `TopicAggregationService`) built once per process, computes a chapter on cache miss, and writes the result through to a `study_cache` table it owns. Filling the rest of the canon in the background, a chapter at a time, keeps later views warm. Core provides the aggregation only - it owns no cache, no schedule, and no transport.

## How it works

```
getChapter(book, chapter)
  +- hit  -> row from study_cache, fingerprint must match the installed module set
  +- miss -> AggregationContext
              +- CommentaryAggregationService.getChapterOverview(book, chapter, commentaryModules)
              +- TopicAggregationService#getChapterTopics(book, chapter)      // precomputed at context build
              +- CrossRefAggregationService.getChapterCrossRefs(book, chapter, crossRefModules)
              +- EntityAggregationService.getChapterEntities(book, chapter, tagGraph)
            -> return, then persist
```

`TopicAggregationService` is the only one with a construction cost. `static from(modules)` runs `getAllTopicSummaries()` and `getAllTopicVerseLinks()` for each topical module, then builds, per module:

- `topicMap: Map<topicId, {name, description, ancestors, recursiveVerseCount}>` - ancestors root-first with ids and counts attached, recursive counts memoized bottom-up over the child index;
- `verseToTopics: Map<verseId, topicId[]>` - ranges expanded verse by verse, so a chapter query finds every verse a topic touches and not just the range start.

That is why a consumer should keep one `AggregationContext` for the process rather than constructing one per call.

## Gotchas

- **The short field names are a wire format, not a style choice.** `m`, `mn`, `s`, `e`, `l`, `w`, `id`, `n`, `p`, `a`, `vc`, `src`, `sn`, `d`, `tv`, `tve`, `so`, `g`, `eid`, `cat`, `eve` - renaming any of them invalidates every generated `study_cache.db` and breaks every consumer. `types.ts` says so at the top; believe it.
- **Optional fields must be omitted, never emitted as null.** All four implementations use `...(x ? {k: x} : {})` spreads, and the test asserts the JSON has no nulls. A cache written with nulls is larger and reads differently on the client.
- **`getChapterTopics` scans the whole `verseToTopics` map on every call**, filtering by verse-ID bounds inside the loop, rather than indexing by chapter. For Nave's this is roughly 100k+ iterations per chapter. It is fast enough for the write-through cache but is not the "cheap dictionary lookup" the interface doc claims, and it is the first thing to change if chapter aggregation ever shows up in a profile.
- **`ITopicAggregationServiceFactory` is not implemented by anything.** It declares `precompute(modules)`; `TopicAggregationService` exposes `from(modules)` and `precomputeOne(mod)` instead. The interface is unused and does not match the class.
- **Topic-verse counts are range-inclusive sums** (`SUM(end - start + 1)`), matching `ITopicalIndexRepository.getVerseCount` / `getRecursiveVerseCount`. Do not "fix" it to count link rows.
- **Prefer `a` (ancestor tuples) over `p` (joined string) when consuming topics.** `p` is a display-only `" > "` join that cannot be split back safely - a topic name may itself contain `" > "` - and carries no ids, which is what once left breadcrumb ancestors unopenable. Caches generated before `a` existed have `p` only, so readers must tolerate `a` being absent.
- **`EntityAggregationService` takes one repository, not an array**, because there is at most one `tag_graph.db` per installation. It returns `{}` for a null/undefined repo rather than throwing.
- **The test suite is fixture-dependent.** It skips itself when the four module databases are absent, so a green run in a bare checkout proves nothing about these services. The `lazyRepository` helper exists because Vitest evaluates a `describe.skipIf` body during collection, so opening a fixture at suite scope would throw before the skip applies.

## See also

- [Repositories](repositories.md) - `ICommentaryRepository`, `ICrossReferenceRepository`, `ITopicalIndexRepository`, `ITagGraphRepository`.
- [Verse identity](verse-identity.md) - the verse-ID arithmetic behind `chapterStart` / `chapterEnd`.
