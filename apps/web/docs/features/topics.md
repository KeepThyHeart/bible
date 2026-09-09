# Topics & Tag Graph

**Last verified:** 6e80a84 (2026-09-04)

Topical index browsing (Nave's, Torrey's) and tag graph entity display (people, places, themes, objects).

## Key Files

### UI Components

| File | Purpose |
|---|---|
| `src/components/StudyPane/TopicsPane.tsx` | Standalone Topics pane wrapper; passes providers and the store's pending topic request straight through (it does **not** consume it — see "Opening a topic from another pane") |
| `src/components/StudyPane/TopicsBrowser.tsx` | Full-featured topic browser with search, navigation stack, topic detail, and verse listing. Owns the request token, the load-generation guard, and the nav stack that survives remounts (`resetTopicsBrowserNav()` clears it for tests) |
| `src/components/StudyPane/StudyTopics.tsx` | Verse-specific topics display in the Study pane; clickable topics navigate to TopicsPane |
| `src/components/StudyPane/VerseRefList.tsx` | Reusable compact+expandable verse reference list (used by TopicsBrowser, could be used by cross-refs) |

The Study pane these live in has no doc of its own; its host components are:

| File | Purpose |
|---|---|
| `src/components/StudyPane/StudyPane.tsx` | Desktop Study pane. Composes, in order, `StudyCrossRefs`, `StudyTopics`, `StudySynthesis` and `StudyHome` (interlinear), each inside a `StudySection` |
| `src/components/StudyPane/StudySection.tsx` | Collapsible titled section; expanded state persisted per id under `bible-study-section-<id>` in localStorage |
| `src/components/StudyPane/StudyCrossRefs.tsx` | TSK cross-references for the study verse, with an optional table view (`bible-reader-crossrefs-show-table`) |
| `src/components/StudyPane/StudySynthesis.tsx` | The `SYNTHESIS` (Combined Summary) commentary entries for the study verse, with an "open in Commentary" action |
| `src/components/MobileStudyPane/StudyBreadcrumb.tsx` | Breadcrumb trail used by the mobile study views |

### State & Providers

| File | Purpose |
|---|---|
| `src/stores/studyStore.ts` | Loads verse topics + tag graph entities; caches by verseId |
| `src/stores/commentaryStore.ts` | Manages `rightPaneMode` and `pendingTopicNav` for cross-pane topic navigation |
| `src/providers/interfaces.ts` | `ITopicalDataProvider` and `ITagGraphDataProvider` interfaces |
| `src/providers/ServerDataProvider.ts` | HTTP implementations: `TopicalDataProvider`, `TagGraphDataProvider` |

### Server Routes

| File | Purpose |
|---|---|
| `server/routes/topicalRoutes.ts` | `GET /api/topical/modules`, `/verse/:verseId`, `/:module/topic/:topicId`, `/:module/topic/:topicId/children`, `/:module/topic/:topicId/verses`, `/search` |
| `server/routes/tagGraphRoutes.ts` | `GET /api/taggraph/verse/:verseId`, `/entity/:category/:entityId` (+ `/associations`, `/verses`, `/facets`, `/topic-links`), `/search`, `/topic-link/:sourceModule/:topicId`. The router is constructed with `enabled: deps.extra.showTagGraph`, from `features.tagGraph` in `site-config.json` — off (the default), every endpoint short-circuits to `[]` |

### Core Repositories

| File | Purpose |
|---|---|
| `packages/core/src/Data/Repositories/TopicalIndexRepository.ts` | FTS5 search, topic hierarchy (parent chain, children), verse associations |
| `packages/core/src/Data/Repositories/TagGraphRepository.ts` | Tag graph entity queries |

### Styles

| File | Purpose |
|---|---|
| `src/styles/main.scss` | `.study-topics`, `.topics-browser`, `.topic-card`, `.entity-card` styles |

## Data Flow

1. **Study pane (verse topics):** `studyStore.loadTopics()` calls both `topicalProvider.getTopicsForVerse()` and `tagGraphProvider.getEntitiesForVerse()` in parallel
2. **Topics pane (search):** `TopicsBrowser.handleSearch()` calls both `topicalProvider.searchTopics()` and `tagGraphProvider.searchEntities()` in parallel
3. **Cross-pane navigation:** Clicking a topic in `StudyTopics` calls `commentaryStore.navigateToTopic()`, which sets `pendingTopicNav` (carrying a `token`) and switches to the topics pane. `TopicsPane` reads it and passes it down as `topicRequest`; `TopicsBrowser` opens it and calls `onTopicRequestHandled` to clear it. See "Opening a topic from another pane".
4. **Entity detail:** Clicking an entity card navigates to entity detail view showing notes, topic links (Nave's/Torrey's), associations (clickable → navigate to that entity), and verses (clickable → navigate Bible pane). Uses `tagGraphProvider.getEntity()`, `.getAssociations()`, `.getVersesForEntity()`, `.getTopicLinksForEntity()` in parallel.
5. **Entity → Topic bridge:** Entity detail shows linked Nave's/Torrey's topics via `entity_topic_links` table. Clicking a topic link navigates to the topic detail view with breadcrumbs.
6. **Topic breadcrumbs:** Topic detail view shows the parent chain as clickable breadcrumbs for navigating the Nave's/Torrey's hierarchy.

## Topic Sources

- **Nave's Topical Bible** (`topical_nave.db`) — hierarchical topic tree with verse associations
- **Torrey's Topical Textbook** (`topical_torrey.db`) — similar structure
- **Tag Graph** (`tag_graph.db`) — entities (people, places, themes, objects) with verse links and associations

## Opening a topic from another pane

`commentaryStore.pendingTopicNav` (and `studyStore.pendingTopicNav`, for the
mobile overlay) carries a **`token`** that is bumped on every request. Three
things depend on it:

- **A request raised while the Topics pane is already open still navigates.**
  Calling `consumePendingTopicNav()` from `TopicsPane`'s render body would only
  run when something remounts it. With the Topics tab already selected, clicking
  a topic in the Study pane sets the request and changes `rightPaneMode` to a
  value it already holds, so nothing remounts and nothing reads it — the click
  does nothing at all. `TopicsBrowser` watches the token in an effect instead.
- **The request is not lost to a repeated render.** Consuming during render is a
  side effect in render: any re-render between the read and the child's mount
  effect threw the request away.
- **The same topic can be requested twice in a row.** Without the token, a
  second request for a topic already showing is indistinguishable from no
  request.

The request is cleared by `onTopicRequestHandled`, called from the browser once
it has actually opened the topic — never by the pane that merely passes it along.

## No blank panes

Every failure in `loadTopic` / `loadEntity` used to render as an empty pane
under a topic title, which is indistinguishable from "this topic is empty" and
from the app having hung. Three changes:

- **A load generation counter.** Two overlapping loads could interleave — the
  slower one's `clearDetail()` landing after the faster one's `setTopicDetail()`
  — leaving a titled, permanently blank pane. Stale responses are now dropped.
- **`loadTopic` no longer returns silently** when no provider is wired up. That
  early return left `detailLoading` false and `topicDetail` null, with nothing
  in the console.
- **An explicit empty/error state.** `detailError` renders in place of the
  detail whenever there is none, so a 404, a dropped connection, and a genuinely
  empty topic each say so.

## Breadcrumb ancestors need ids, not names

The verse-topic chain in `StudyTopics` (and the same block in the browser's
home view) renders each ancestor as a link. Opening one needs its **topic id**:
a name identifies nothing — hundreds of Nave's topics are called "History of",
one under each parent.

Two paths supply that chain, and only one of them used to carry ids:

- `/api/topical/verse/:verseId` (`topicalRoutes.ts`) builds `ancestors` from
  `repo.getParentChain()`, so every entry has a real id and recursive count.
- The **study cache** (`generate-study-cache.js` — **not in this repo**; it lived in a repo-root `scripts/` directory that has not been imported, and its final location is not settled) is what actually
  serves the study pane whenever `study-cache.db` exists. It stored the chain
  only as the pre-joined display string `p` ("Jesus, The Christ > HISTORY OF"),
  so `StudyOverviewProvider` split it and emitted `topic_id: 0` for every
  ancestor. Clicking one called `navigateTo` with a falsy `topicId`, which
  skips the load entirely — leaving the pane on `topicsBrowser.topicUnavailable`
  ("This topic could not be loaded. It may not exist in this topical index.").
  The missing counts were the visible tell: an ancestor rendered without its
  `(n)` because its `verse_count` was 0 too.

`VerseTopicEntry` now also carries `a`: ancestors root-first as
`[topicId, name, recursiveVerseCount]` tuples (`packages/core/src/Services/StudyOverview/types.ts`).
`p` stays for display and backward compatibility. **A cache generated before
`a` existed keeps working, and its ancestors are clickable too**:
`studyOverviewRoutes.ts` resolves the chain from the topical module
(`getParentChain` + `getRecursiveVerseCount`) and injects `a` on the way out,
so the reader does not have to regenerate the cache to get a working
breadcrumb. A cache that already carries `a` costs two property checks per
topic and no queries at all. An ancestor whose topical module is not installed
stays id-less on purpose — it could not be opened — and both chain renderers
show a `topic_id` of 0 as plain text (`.study-topics__chain-name`) rather than
a link that cannot resolve. Note the endpoint sets
`Cache-Control: max-age=86400`, so browsers may hold a previously served
payload for a day. Covered by `server/__tests__/studyOverviewRoutes.test.ts`.

## The nav stack survives a pane switch

The Topics pane is mounted only while its tab is selected (`{paneMode ===
'topics' && <TopicsPane/>}`), so switching to Commentary and back used to drop
the reader back at the verse-topic list. `TopicsBrowser` keeps the stack in a
module-level `savedNav`, keyed by layout (`mobile` / `desktop`), and re-loads
whatever the restored entry points at rather than restoring stale content.
