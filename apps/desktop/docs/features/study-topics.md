# Study Pane & Topics Pane

**Last verified:** 2026-09-08

The Study Pane is a verse-centric hub that brings together topics, commentary summaries, cross-references, interlinear data, and Strong's definitions for a selected verse. The Topics Pane provides full topical index browsing with hierarchy, verse lists, and cross-index exploration.

## Core Data Layer (`@bible/core`)

### Module Types
- `packages/core/src/Data/Core/Types.ts` - the `ModuleType` union includes `'topical_index' | 'cross_reference'`

### Topical Index Models
- `packages/core/src/Data/Models/TopicalIndex/Topic.ts` - Topic entity
- `packages/core/src/Data/Models/TopicalIndex/TopicVerse.ts` - Topic-verse association
- `packages/core/src/Data/Models/TopicalIndex/TopicalIndexModuleInfo.ts` - Module info

### Cross-Reference Models
- `packages/core/src/Data/Models/CrossReference/CrossReferenceGroup.ts` - Phrase-grouped cross-reference group
- `packages/core/src/Data/Models/CrossReference/CrossReferenceEntry.ts` - `ModuleCrossRefEntry` class (individual entry)
- `packages/core/src/Data/Models/CrossReference/CrossReferenceModuleInfo.ts` - Module info

### Repositories
- `packages/core/src/Data/Repositories/ITopicalIndexRepository.ts` - Interface
- `packages/core/src/Data/Repositories/TopicalIndexRepository.ts` - Implementation (FTS5 search via `toTopicFtsQuery`, hierarchy via recursive CTE, `rootsOnly` paging, batched `getChildCounts`, and the shared `ROOT_PREDICATE`). Topic-to-verse links are read from the unified `verse_link` table (`source_type = 'topic'`) where a module has one, and from a `topic_verses` table otherwise; the shape is resolved once per connection
- `packages/core/src/Data/Repositories/TopicalIndexRepository.test.ts` - Browse-list options against an in-memory fixture (the suite in `packages/core/src/__tests__/` needs a real `topical_nave.db` and skips without it)
- `packages/core/src/Data/Repositories/ICrossReferenceRepository.ts` - Interface (includes `CrossReferenceGroupWithEntries`, `ReverseReference`)
- `packages/core/src/Data/Repositories/CrossReferenceRepository.ts` - Implementation

## Electron Handlers

- `apps/desktop/electron/ipc/topicalIndexHandlers.ts` - IPC handlers for `topical:*` channels: `getAvailable`, `getTopicsForVerse`, `getTopic`, `getChildren`, `getParentChain`, `getVersesForTopic`, `searchTopics`, `browseTopics`, `getAlsoIn`. `topical:getTopic` returns **both** counts, `verse_count` (`getRecursiveVerseCount`) and `reference_count` (`getRecursiveReferenceCount`) - see "Topic verse paging" below - plus `source_abbreviation` / `source_name`. `topical:getVersesForTopic` takes `limit` and `offset`; `topical:browseTopics` takes `rootsOnly`; `topical:searchTopics` takes `limit` and `offset`. Both list channels return a `child_count` per row
- `apps/desktop/electron/ipc/crossReferenceHandlers.ts` - IPC handlers for `xref:*` channels (`getAvailable`, `getGroupsForVerse`, `getGroupsForRange`, `getReverseReferences`, `getReverseReferencesForRange`, `getEntryCount`)
- `apps/desktop/electron/main.ts` - Registers all three handler sets (`registerTopicalIndexHandlers`, `registerCrossReferenceHandlers`, `registerTagGraphHandlers`); closes their databases on quit
- `apps/desktop/electron/preload.ts` - `topical`, `crossReference` and `tagGraph` namespaces in ElectronAPI
- `apps/desktop/electron/config/paneConfig.ts` - `'study'` and `'topics'` pane type configs

## Zustand Stores

- `apps/desktop/src/ui/stores/useStudyStore.ts` - Per-panel state (nav stack, pin, suggestion banner, section collapse)
- `apps/desktop/src/ui/stores/useTopicsStore.ts` - Per-panel state (browse/topic/verse-topics/entity views, nav stack, source filters, `browseFilter`, `liveVerseId`); actions `syncAllPanelsWithVerse`, `suggestPanelsWithVerse`, `navigateToTopic`, `navigateToEntity`, `goHome`
- `apps/desktop/src/ui/stores/useTopicalIndexStore.ts` - Shared store for available topical index modules
- `apps/desktop/src/ui/stores/hooks/useStudyPanel.ts` - Hook binding panelId to the Study store
- `apps/desktop/src/ui/stores/hooks/useTopicsPanel.ts` - Hook binding panelId to the Topics store

## React Components

### Pane Components
- `apps/desktop/src/ui/components/StudyPane.tsx` - Study Pane (verse mode, commentary detail, collapsible sections)
- `apps/desktop/src/ui/components/TopicsPane.tsx` - Topics Pane shell: nav header (Back/Forward/Pin/**Home**), suggestion banner, view switch, click handlers

### Topics Pane Views (`components/TopicsPane/`)
- `apps/desktop/src/ui/components/TopicsPane/BrowseView.tsx` - The Topics home page: one prominent search box, source filter chips, and one list (top-level topics, or search results) with paging. Carries its own row renderer, `BrowseTopicRow`, because the list needs a sub-topic count that `shared/TopicListItem` has no slot for
- `apps/desktop/src/ui/components/TopicsPane/TopicView.tsx` - Topic detail: breadcrumb, counts, sub-topic cards, "also in", verse list
- `apps/desktop/src/ui/components/TopicsPane/VerseTopicsView.tsx` - "Topics for {reference}"; delegates the list itself to `shared/VerseTopicsList`
- `apps/desktop/src/ui/components/TopicsPane/EntityDetailView.tsx` - Tag graph entity detail
- `apps/desktop/src/ui/components/TopicsPane/RelatedTagGraphSection.tsx` - "Related (Tag Graph)" block inside `TopicView`
- `apps/desktop/src/ui/components/TopicsPane/types.ts` - View result types, `PAGE_SIZE` (50), `VERSE_PAGE_SIZE` (100), category/source labels
- `apps/desktop/src/ui/components/TopicsPane/hooks/useTopicsPaneData.ts` - All data-loading effects for the pane, including topic verse paging. Topic detail, first-page passages, and also-in go through `services/topicalContentCache.ts`; the `loading` it returns is run through `hooks/useDeferredLoading.ts`
- `apps/desktop/src/ui/services/topicalContentCache.ts` - TTL + in-flight cache over `topical:getTopic` / `getVersesForTopic` / `getAlsoIn`, shared by the Topics pane and the Study pane's prefetch
- `apps/desktop/src/ui/services/paneHandoff.ts` - `activateWhenContentReady`: holds a cross-pane tab switch until the target's content has loaded, capped at `PANE_HANDOFF_CAP_MS` (50 ms)

### Study Pane Building Blocks (`components/study/`)
- `apps/desktop/src/ui/components/study/StudySection.tsx` - Collapsible section with tinted sticky header, caps title, optional subtitle and count
- `apps/desktop/src/ui/components/study/StudyRichText.tsx` - Module prose renderer: Markdown-or-HTML detection -> `reprocessCommentaryLinks` -> `sanitizeHtml` -> `dangerouslySetInnerHTML`, with scripture-link tooltips
- `apps/desktop/src/ui/components/study/markdown.ts` - Minimal Markdown -> HTML renderer (`markdownToHtml`), plain-text flattener (`markdownToPlainText`) and format sniffer (`looksLikeMarkdown`)
- `apps/desktop/src/ui/components/study/CrossReferenceDisplay.tsx` - `ReferenceRun`, the shared collapsed-reference renderer, and the inline cross-reference row used under a verse
- `apps/desktop/src/ui/components/study/useChapterStudyData.ts` - Chapter-level study data, and `targetVerseIdsFromGroup`
- `apps/desktop/src/ui/services/studyOverviewProvider.ts` - The shared `XrefGroupWithEntries` type and the cross-module study overview fetches
- `apps/desktop/src/ui/utils/tskPhrase.ts` - `tskPhraseKeyword` / `tskPhraseAside` / `splitTskPhrase`, which split a raw TSK phrase into its keyword and its editorial aside

### Hooks
- `apps/desktop/src/ui/hooks/useScriptureTooltip.ts` - Reusable hook for verse link click navigation + hover tooltip on `<a href="#verse-...">` elements

### Shared Components
- `apps/desktop/src/ui/components/shared/SuggestionBanner.tsx` - "See study/topics for X [Go] [Dismiss]" banner
- `apps/desktop/src/ui/components/shared/TopicListItem.tsx` - Single topic entry (name, source, verse count) - used in browse list
- `apps/desktop/src/ui/components/shared/TopicCard.tsx` - Card component for sub-topics and related entities (shows relationship labels, category badges, strength). The count badges are localized (`topicsPane.verseCount` / `verseCountOne`, `topicsPane.subtopicCount` / `subtopicCountOne`) and the verse badge says **"verses"**, matching the `verse_count` value fed into it, which expands ranges
- `apps/desktop/src/ui/components/shared/TopicSearchBar.tsx` - Debounced typeahead search across topical indexes, rendered as a small absolutely-positioned dropdown
- `apps/desktop/src/ui/components/shared/VerseListWithPreview.tsx` - Verse list with Show/Hide verses, truncation and [Show all], a last-clicked mark, and Load more
- `apps/desktop/src/ui/components/shared/VerseTopicsList.tsx` - "What is this verse about?" - the topics a verse belongs to, grouped by source, each rendered as its full clickable ancestry ("Salvation (412) > Repentance (58) > Godly Sorrow (9)"). Shared by `StudyPane` and `TopicsPane/VerseTopicsView`
- `apps/desktop/src/ui/components/shared/PaneNavHeader.tsx` - Back/Forward/**Home**/Pin controls (`onHome` / `canGoHome`, `data-testid="pane-nav-home"`)

## Cross-pane hand-off (no flicker)

Dockview mounts a pane's content the moment its tab is activated, so a cross-pane navigation that activated the tab *before* pointing the target at its new subject would show the reader the previous subject and then blink over.

Three pieces prevent that, and any new cross-pane gesture should use the same shape:

1. **Point first, switch second.** `StudyPane.handleTopicClick` calls `useTopicsStore.navigateToTopic` before it touches `panel.api.setActive()`. Same for `study/VerseLinksDisplay.tsx` (commentary) and `bible/openStrongsInDictionary.ts`, which reveals the Dictionary pane with `revealDictionaryPanel({ deferActivation: true })` and activates it itself.
2. **Hold the switch, but not for long.** `activateWhenContentReady(activate, work, capMs)` in `services/paneHandoff.ts` runs `activate` when `work` settles or after 50 ms, whichever is first, and only ever once. Past the cap the reader gets the tab regardless and sees the pane's own loading state - a switch that waits on a slow query stops reading as a switch.
3. **Make the wait short enough to be worth holding.** The Study pane prefetches through `services/topicalContentCache.ts`, whose entries the Topics pane then reads instead of refetching. Topic content comes from read-only module databases, so the TTL (5 minutes) exists only to bound memory, not for freshness.

`useDeferredLoading` (80 ms) covers the remainder: a load that resolves from cache never flips a loading placeholder on at all.

## Panel Registration

- `apps/desktop/src/ui/stores/useLayoutStore.ts` - `PanelContentType` includes `'study' | 'topics'`
- `apps/desktop/src/ui/components/PanelContentRenderer.tsx` - Maps `study` -> `StudyPane`, `topics` -> `TopicsPane`
- `apps/desktop/src/ui/components/NewTabPage.tsx` - Study and Topics in the category tiles

## Verse Sync Integration

Choosing a verse fans out to the four panes that follow the Bible pane through one helper rather than through each caller:

- `apps/desktop/src/ui/stores/syncPanesWithVerse.ts` - `syncPanesWithVerse(verseId)` calls `syncAllPanelsWithVerse` on the commentary, notes, study and topics stores. It is deliberately read through `getState()` rather than hooks so store actions and event handlers can use it too.
- `apps/desktop/src/ui/components/bible/hooks/useVerseInteractionHandlers.ts` - `handleVerseClick` calls it (used by `BiblePane.tsx`). Any other "the reader picked this verse" path - typing a reference into the search bar, for instance - calls the same helper, so the workbench agrees however the verse was reached.

Previewing is not navigating: a scripture link goes through `previewVerseInPrimary` (`stores/crossStoreBridge.ts`) and deliberately leaves the panes where they are.

### Study Pane sync behaviour

- **Unpinned panes follow the Bible pane.** `useStudyStore.syncAllPanelsWithVerse` navigates an unpinned panel straight to the selected verse, matching the web app's `studyStore.loadForVerse`, which only returns early when pinned.
- **Pinned panes stay put** and get the suggestion banner instead - the desktop equivalent of the web's "Pinned to X - Sync to Y" bar. `acceptSuggestion` releases the pin and then navigates, like the web's `handleSync`.
- **Fresh open.** `StudyPane` computes the Bible pane's anchor verse (its selected verse, else the first verse of the chapter on screen) and calls `seedInitialVerse`. That action prefers the verse the panel was last showing, read from `localStorage` under `study-pane-verses`; a panel that already has a verse is left alone, and with nothing to seed from the pane shows its empty state. The verse is *not* in `SessionData` - that interface lives in `@bible/core` and has no Study slot; the web app also keeps Study pane state in `localStorage`.

## Study Pane Presentation

The pane mirrors the web Study pane (`apps/web/src/components/StudyPane/`):

- Section order is Cross-References -> Topics -> Combined Summary -> Commentaries.
- **The topic search box lives inside the Topics section**, not above the sections. At the top of the pane it would sit over the cross-references and commentaries as much as the topics and read as a search of the whole pane, when all it searches is topical indexes; inside the section its scope is stated by where it is, and it collapses with the section. The **empty state keeps its own copy** at the top - with no verse selected there are no sections to put it in, and it is the only thing to do there.
- The `SYNTHESIS` digest module is shown as **"Combined Summary"** (`studyPane.combinedSummaryTitle`), never under its database name "Commentary Synthesis", and gets its own section rendering the entry in full with a `DigestDisclaimer` above it. It is excluded from the plain Commentaries list.
- Digest content is Markdown (`content_format: "markdown"` in the module's metadata). The commentary IPC surface does not carry that field, so `looksLikeMarkdown` sniffs the text; Markdown is converted before linking and sanitizing. Commentary list previews use `markdownToPlainText` so `===` rules and asterisks do not leak into the preview.
- Every section has an explicit empty state; all copy goes through the catalog (`studyPane.*`, `ui.suggestionBanner.*`, `ui.verseList.showAll`).

## Topics Pane Behaviour

### The home page lists the top level, not everything

The Topics home page shows **root topics only**. The indexes are mostly sub-topics, and out of context most of those are meaningless on their own - a gloss such as "(A penalty)" means nothing without the parent it hangs under.

- `getAllTopicsPaginated` and `getTopicCount` take a `rootsOnly` option, sharing `TopicalIndexRepository.ROOT_PREDICATE` (`parent_topic_id IS NULL`) with `getRootTopics` so the two can never disagree about what a root is. The browse list passes it; nothing else does.
- **`rootsOnly` does not apply to a filtered/FTS page.** Browsing wants the top level; searching wants every level, because a reader who types "(A penalty)" is asking for exactly that sub-topic. The exception is asserted in `TopicalIndexRepository.test.ts`.
- Hiding sub-topics from the top level makes "does this row go anywhere?" the reader's problem, so every row carries a sub-topic count and a `›` cue. `getChildCounts(topicIds)` answers that in **one grouped query per page** rather than a `getChildren` call per row - at thousands of top-level rows the per-row version is not an option.

### One search box, and its results in the list

The browse view has a single input. It is sized to be the way into tens of thousands of topics, and its results render **inline in the list beneath it**, replacing the browse list while a query is active. Clearing the box restores the browse list immediately (no debounce - waiting for the list to come back reads as the box being stuck).

- `TopicSearchBar` is used as a dropdown elsewhere: `StudyPane` (inside its Topics section, and in its empty state) and `TopicsPane/TopicView`. The browse view calls `window.electron.topical.searchTopics` directly instead.
- The store calls the state `browseFilter` (`useTopicsStore`); it is the search query, and `TopicsPane` renames it at the prop boundary. Keeping one piece of state is what lets search reuse the browse list's `browseOffset` / `hasMore` / **Load more** paging unchanged - which is also why `topical:searchTopics` takes `limit`/`offset` rather than a fixed cap. A capped list is fine for a dropdown; it silently truncates when it *is* the list.
- `hasMore` is `results.length >= PAGE_SIZE`, not `===`. Both list channels page each *module* separately and the main process concatenates them, so two installed indexes return up to `2 x PAGE_SIZE`, and an equality test would hide **Load more** exactly when there was most left to load.
- FTS input is escaped and prefix-matched (`toTopicFtsQuery` in `TopicalIndexRepository`). Raw input reaching `MATCH` makes "(A penalty)" an FTS *syntax error* rather than a query, and leaves "jeri" matching no token at all - fatal for a box that answers as you type.

### Which index a topic came from

`topical:getTopic` returns `source_abbreviation` / `source_name` (via the `getModuleInfo()?.fullName ?? abbreviation` idiom the sibling handlers use), and `TopicView` renders it under the heading as "From {source}" (`data-testid="topic-source"`). "Jericho" and "Faith" exist in both indexes and say different things; without this a reader following an "Also in" link - whose whole purpose is to cross between them - has nothing on screen telling them they had. The source is a **sibling** of `topic-name`, not part of it: the heading stays the topic's identity for navigation and for the e2e suite. Both fields are optional on `TopicDetail`, like `reference_count`, so a main process that does not supply them degrades to showing nothing rather than guessing.

### Topic verse paging

- **A topic's passages are a page, not a ceiling.** `VERSE_PAGE_SIZE = 100` (`TopicsPane/types.ts`) is a page size: `useTopicsPaneData` returns `hasMoreVerses` / `loadingMoreVerses` / `loadMoreVerses`, and `TopicView` passes them to `VerseListWithPreview` as `hasMore` / `loadingMore` / `onLoadMore`.
- **Two counts, and only one of them can bound the list.** `verse_count` expands ranges - John 3:16-18 counts three - while `reference_count` counts the stored links, so the same passage counts one. `getVersesForTopic` returns one row per stored reference, so `reference_count` is exactly how many rows exist; comparing loaded rows against the *expanded* count would leave a Load more button that never goes away. `topical:getTopic` returns both (`repo.getRecursiveVerseCount` and `repo.getRecursiveReferenceCount`).
- **Fallback when no reference count arrives.** `reference_count` is optional on `TopicDetail`. When it is absent the hook falls back to "the last page came back short" (`versesExhausted`) - the same signal the browse list uses. The flag is reset when a new topic loads, and set on a failed fetch so the button stops offering a query that is failing.

### Verse count wording

`TopicView` prefers `reference_count` and renders "{count} verses/passages" (`topicsPane.passageCount`, singular `topicsPane.passageCountOne`), falling back to `verse_count` and `topicsPane.verseCount` when no reference count arrived. `shared/TopicCard.tsx` is fed `verse_count` and therefore says "verses".

### One rendering of "topics for this verse"

Both panes render `shared/VerseTopicsList`, so a topic appears as its full ancestry in the Study pane and in the Topics pane alike. The hook's `verseTopics` state is typed `VerseTopic[]` rather than `BrowseTopicResult[]`, which is what preserves the `ancestors` array `topical:getTopicsForVerse` returns.

### Home

`PaneNavHeader` carries an optional house button (`onHome` / `canGoHome`, `data-testid="pane-nav-home"`). Behind it, `useTopicsStore` tracks `liveVerseId` - where the *reader* is, as opposed to `currentVerseId`, where the *pane* is - recorded on every verse broadcast even when the pane is pinned, because pinning says "do not follow me around", not "forget where I am". `goHome(panelId)` navigates to the topics for `liveVerseId ?? suggestionVerseId ?? currentVerseId`, so a reader who has drilled into a subject can get back to "topics for the verse I am reading" in one click.

### Clicking a passage previews it

`TopicsPane.handleVerseClick` calls `previewVerseInPrimary` (`stores/crossStoreBridge.ts` -> `stores/bible/slices/previewSlice.ts`), not the select path. Working down a list of a topic's passages is browsing, not choosing a new subject, so the commentary and notes panes that follow `selectedVerseId` stay where they are. `storeSync.ts` wires the preview to offer the verse to the Study and Topics panes via `suggestPanelsWithVerse` - a banner, not a jump - so adopting a side trip as the new subject is still one click away. Notes are deliberately not offered.

### Verse list controls (`shared/VerseListWithPreview`)

- **Show verses / Hide verses** toggle, persisted per `storageKey` in `localStorage` under `bible.verseList.showVerses.` (`TopicView` passes `topic-verses-{abbreviation}`). While hidden, verse text is not fetched at all.
- **Marks** the last-clicked row and the row containing the current verse.
- **The leading accent bar is drawn on every row**, transparent when the row is unmarked, so marking a row cannot shift its text or move the rows below it.
- **Load more** (`onLoadMore` / `hasMore` / `loadingMore`) appears once local truncation is exhausted.

## Tests

### Unit / component
- `apps/desktop/src/ui/components/StudyPane.test.tsx` - Sections, empty state, the in-section topic search box, digest rendering
- `apps/desktop/src/ui/components/TopicsPane.test.tsx` - Pane shell: nav header, Home, suggestion banner, verse-click preview
- `apps/desktop/src/ui/components/TopicsPane/BrowseView.test.tsx` - Roots-only browse list, inline search results, paging, sub-topic counts
- `apps/desktop/src/ui/components/TopicsPane/TopicView.test.tsx` - Breadcrumb, source line, counts wording, verse paging
- `apps/desktop/src/ui/components/shared/TopicCard.test.tsx`, `TopicListItem.test.tsx`, `TopicSearchBar.test.tsx`, `PaneNavHeader.test.tsx`, `SuggestionBanner.test.tsx` - The shared building blocks
- `apps/desktop/src/ui/components/study/CrossReferenceDisplay.test.tsx` - `ReferenceRun` collapsing, formats and navigation callbacks
- `apps/desktop/src/ui/components/study/useChapterStudyData.test.tsx` - Chapter study data and `targetVerseIdsFromGroup`
- `apps/desktop/src/ui/components/study/markdown.test.ts` - The Markdown renderer, plain-text flattener and format sniffer
- `apps/desktop/src/ui/utils/tskPhrase.test.ts` - Keyword/aside splitting of raw TSK phrases
- `apps/desktop/src/ui/services/topicalContentCache.test.ts` - TTL, in-flight dedupe and failure handling
- `apps/desktop/src/ui/services/paneHandoff.test.ts` - `activateWhenContentReady`: fires once, on settle or at the cap
- `apps/desktop/src/ui/services/studyOverviewProvider.test.ts` - Cross-module study overview aggregation
- `apps/desktop/src/ui/stores/__tests__/useStudyStore.test.ts` - Follow/pin/suggest behaviour and the nav stack
- `packages/core/src/Data/Repositories/TopicalIndexRepository.test.ts` - Browse-list options against an in-memory fixture

### E2E
- `apps/desktop/e2e/tests/study-pane.spec.ts`
- `apps/desktop/e2e/tests/topics-pane.spec.ts`

## Tag Graph

Entity relationship graph for people, places, objects, and themes. It uses `entity_topic_links` for direct `topic_id` bridges to Nave's/Torrey's, and `entity_facets` for structural subtopic groupings. It provides the "Related (Tag Graph)" section in the Topics pane and a dedicated entity detail view.

**It is optional.** `tagGraphHandlers.ts` opens `tag_graph.db` from the app's data directory (`getDataPath()`), and when that file is not there `getTagGraphRepository()` returns `null` and every `tagGraph:*` channel degrades gracefully - the pane simply renders no Related block. The database is not part of the repository, is in no module catalog, and nothing depends on it yet, so on every current install the feature is dormant and the suites that exercise it (`TagGraphRepository.test.ts`, the `EntityAggregationService` block of `StudyOverview.test.ts`, the enabled half of the web `tagGraphRoutes.test.ts`) skip themselves.

### Core Data Layer
- `packages/core/src/Data/Models/TagGraph/TagGraphEntity.ts` - Entity interfaces (PersonEntity, PlaceEntity, ObjectEntity, ThemeEntity, PeopleRelationship)
- `packages/core/src/Data/Models/TagGraph/TagAssociation.ts` - Cross-entity association + AssociationPassage (supporting verse ranges)
- `packages/core/src/Data/Models/TagGraph/EntityTopicLink.ts` - Direct entity-to-`topic_id` bridge
- `packages/core/src/Data/Models/TagGraph/EntityFacet.ts` - EntityFacet + EntityFacetMember interfaces
- `packages/core/src/Data/Models/TagGraph/EntityVerse.ts` - EntityVerse interface (verse references per entity)
- `packages/core/src/Data/Repositories/ITagGraphRepository.ts` - Repository interface (includes `getTopicLinksForEntity`, `getEntityForTopic`, `getFacetsForEntity`, `getVersesForEntity`)
- `packages/core/src/Data/Repositories/TagGraphRepository.ts` - Implementation (ISql injection, category dispatch)

### Electron Handlers
- `apps/desktop/electron/ipc/tagGraphHandlers.ts` - IPC handlers for `tagGraph:*` channels: `getEntity`, `getEntityByName`, `getEntityAliases`, `searchEntities`, `getAssociationsForEntity`, `getPeopleRelationships`, `getTopicLinksForEntity`, `getEntityForTopic`, `getVersesForEntity`, `getFacetsForEntity`. The entity category is narrowed to `people | places | objects | themes` before it reaches the repository
- `apps/desktop/electron/main.ts` - Registers the handlers; closes the database on quit
- `apps/desktop/electron/preload.ts` - `tagGraph` namespace in ElectronAPI

### Store Wiring
- `apps/desktop/src/ui/stores/useTopicsStore.ts` - `TopicsNavEntry` includes `{ type: 'entity' }`, plus the `navigateToEntity` action and `currentEntityId`/`currentEntityCategory` state
- `apps/desktop/src/ui/stores/hooks/useTopicsPanel.ts` - Exposes `navigateToEntity`, `currentEntityId`, `currentEntityCategory`

### UI Components
- `apps/desktop/src/ui/components/TopicsPane/RelatedTagGraphSection.tsx` - "Related (Tag Graph)" block rendered inside `TopicView`
- `apps/desktop/src/ui/components/TopicsPane/EntityDetailView.tsx` - Entity detail view (entity nav type), strength indicator dot

## Study Pane cross-references

`StudyPane.tsx`'s `CrossReferencesSection` renders each phrase group as one line, keyword and references together:

```
"Verily" - Mt 5:18; Jn 1:51; 2Co 1:19-20; Re 3:14
```

- `collapseReferencesStructured` from `@bible/core` (via the shared `study/CrossReferenceDisplay.tsx` `ReferenceRun`) sorts canonically, collapses consecutive verses into ranges, and elides a repeated book or chapter. `ReferenceRun` takes a `format` prop: the Study pane passes `'short'` for parity with the web pane, while the inline row under each verse keeps its deliberate `'medium'`.
- `targetVerseIdsFromGroup` (`study/useChapterStudyData.ts`) pre-expands same-chapter ranges so the collapser can re-render them as `1:19-20`.
- `tskPhraseKeyword` / `tskPhraseAside` (`utils/tskPhrase.ts`) split the raw TSK phrase; the keyword runs inline before a dash with its trailing period stripped, and the aside becomes the `title` attribute.
- The Study pane passes `maxRefs={null}` - it is the surface the reader opened *to* read cross-references, and it scrolls - while the inline row under a verse keeps its 12-reference budget so it stays out of the reading.
- `ReferenceRun`'s `onNavigateToVerse` also passes the range end, so previewing a collapsed range shows the whole passage. Both the run and its hover tooltip preview rather than select, so the commentary and notes panes do not move.

`XrefGroupWithEntries` is declared once, in `services/studyOverviewProvider.ts`, and imported by `StudyPane` and `study/useChapterStudyData.ts`. `CrossReferenceRepository` maps a NULL phrase to `undefined`, so `phrase` is optional rather than `string | null` - whole-verse grouping turns on that one field.
