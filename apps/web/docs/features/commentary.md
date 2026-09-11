# Commentary

**Last verified:** 6e80a84 (2026-09-04)

Displays commentary entries in the right pane, synced to the current Bible chapter and selected verse. Supports multiple commentary tabs, per-tab pin/unpin, and auto-linking of Bible references.

## Files

### Components

| File | Description |
|---|---|
| `src/components/CommentaryPane/CommentaryPane.tsx` | Main container; passage header with pin and verse nav buttons, verse text preview, collapsed/expanded state |
| `src/components/CommentaryPane/CommentaryTabBar.tsx` | Tab interface for multiple commentaries; permanent Home tab, add/close tabs, drag-to-reorder (via `@dnd-kit`), pin button, collapse toggle. The "+" opens the shared `ModuleSelectDialog`; this file supplies the module order, the digest's display name, and the per-passage availability badges |
| `src/components/common/ModuleSelectDialog.tsx` | Shared centered module picker: filter box, sectioned checkbox list, keyboard nav, Cancel/Apply. Used by the Commentaries and Dictionaries "+" buttons; callers pass labels, the selected set, and optional description / extra-row renderers |
| `src/components/common/SortableTab.tsx` | Shared drag-and-drop tab wrapper using `@dnd-kit/sortable` |
| `src/components/CommentaryPane/CommentaryContent.tsx` | Displays entries filtered to highlighted verse; auto-links Bible references with click-to-navigate; shows prev/next navigation when no verse content |
| `src/components/CommentaryPane/CommentaryHome.tsx` | Home tab content: lists all commentaries with content for the current verse (sorted by length with previews), plus chapter-level commentaries |
| `src/components/CommentaryPane/DigestDisclaimer.tsx` | Reusable per-module disclaimer banner with dismiss/restore, keyed on module abbreviation via `src/moduleDescriptions.ts` (`getModuleDisclaimer`, `DIGEST_DISCLAIMER`) and `settingsStore.isDisclaimerDismissed`. Despite the name it is not digest-only — it falls back to the digest text when no `moduleAbbr` is given |
| `src/utils/commentaryEntries.ts` | `isPassageEntry()` / `filterCommentaryEntries()` — splits a chapter's entries into verse-specific and passage-level for the highlighted verse. Tested by `src/utils/commentaryEntries.test.ts` |
| `src/hooks/useVersePopup.tsx` | Shared hook for verse reference hover tooltips (desktop) and click-to-preview popups (mobile); used by CommentaryContent, CommentaryHome, and StudyCrossRefs. Caches the raw `text_html` and renders it through `utils/verseHtml.toPreviewHtml`, so previews carry red-letter/divine-name styling and follow the `wordsOfChristInRed` setting live |

### State

| File | Description |
|---|---|
| `src/stores/commentaryStore.ts` | Active commentary tabs, entries for current chapter, sync state, per-tab pin/unpin, right-pane mode (study / commentary / topics / dictionary / search). Exports `RESTORABLE_PANE_MODES` — see [Navigation & Layout → Right-pane mode](navigation-layout.md). Uses StudyOverviewProvider for home data when available. |

### Providers

| File | Description |
|---|---|
| `src/providers/StudyOverviewProvider.ts` | Client-side provider that fetches chapter-level pre-generated study cache (commentary overview, topics, cross-refs, entities) and serves per-verse data locally. Eliminates per-verse server round-trips. |

### Server

| File | Description |
|---|---|
| `server/routes/commentaryRoutes.ts` | Commentary API routes: chapter entries, home data, chapter verses, availability. Sets Cache-Control headers for browser caching. |
| `server/routes/studyOverviewRoutes.ts` | Bundled study overview endpoint serving pre-generated cache data per chapter |

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/commentary/:module/:book/:chapter` | Returns all unique entries for a chapter |
| `GET /api/commentary/:module/verse/:verseId` | Entries for a single verse in one module |
| `GET /api/commentary/all/:book/:chapter` | Bulk: full chapter text for every active module. `?modules=a,b,c` narrows it — see [Server & API → Commentary payload budget](server-api.md) |
| `GET /api/commentary/chapter-overview/:book/:chapter` | Per-module word counts for the chapter, no content. Drives the prefetch budget |
| `GET /api/commentary/info/:module` | `module_info` row, for the About section |
| `GET /api/commentary/availability/:book/:chapter?verse=N` | Checks which modules have content for passage |
| `GET /api/commentary/home/:book/:chapter?verse=N` | Returns all modules' entries for a verse (sorted by length) plus chapter-only modules |
| `GET /api/commentary/:module/chapter-verses/:book/:chapter` | Verse numbers with content in the chapter. **The web client no longer calls this** — see below |

## What a chapter change costs

Three things used to happen on every chapter navigation, whether or not a
Commentary view was on screen. Only one right-hand pane is mounted at a time
(`DesktopApp.tsx`) and the mobile nav shows one view at a time, so a reader in
the Study pane was paying for all of it and seeing none of it.

| Was | Now |
|---|---|
| One full-chapter request per open tab | The **visible** tab on its own, plus **one** `/api/commentary/all?modules=…` for the rest |
| A `chapter-verses` request per active module | Derived from the chapter overview, which is already fetched |
| Both of the above fired from `bibleStore.navigateTo` regardless of pane | Started only while a view is mounted |

`commentaryStore.viewMounted(true/false)` is the signal, called from
`CommentaryPane` and `MobileCommentaryView`. Mounting also calls
`ensureChapterContent()`, because the chapter change may have happened while the
pane was hidden — that is what stops switching to the Commentary tab showing an
empty pane.

**Why the visible tab is not in the batch.** A batch can only land when its
slowest member does, and members differ by two orders of magnitude (Matthew
Henry's John 3 is ~2 MB against Barnes' 74 KB). Putting the tab the reader is
looking at in with the background ones would make the pane wait on content that
is not on screen — a worse trade than the round trip it saves.

**Why `chapter-verses` is gone from the client.** It returned "which verse
numbers does this module cover in this chapter", derived server-side from the
entry rows. `chapter-overview` already carries
`[moduleIdx, startVerse, endVerse, level, wordCount]` — verse *numbers* — for
**every** module, and is fetched on every chapter change and cached for a day.
`commentaryStore.chapterVersesFromOverview()` computes the same answer from it.
The endpoint remains for API compatibility.

`_chapterLoadsInFlight` keys de-duplication on `module@book-chapter`, not on
module alone: `ensureChapterContent()` can be called twice (chapter change, then
view mount), but a request still out for the chapter the reader *left* must
never suppress the new chapter's.

## Loading is per module, not per store

`loading` is a **getter**, not a stored flag: the visible tab is loading when a
request for *its own module* is in flight (`_inFlightByModule`) and there is
nothing in `entries` to read meanwhile.

One store-wide boolean cannot do this. If any tab may raise the flag but only
the *active* tab's response may lower it (`_backgroundLoadTab` clearing inside
`if (activeTab?.moduleAbbr === moduleAbbr)`), then switching tabs while a fetch
is out leaves the response arriving for the wrong module, declining to clear the
flag, and the pane spinning forever — "Loading commentary…" that never resolves
after opening a module from the Overview tab. Nor can `setActiveTab` early-return
on "a load is already in progress, it will pick up the new activeTabId when it
completes": a response can only paint the module it fetched, so the newly active
tab would get neither data nor a request.

The pieces that keep it honest:

- **`_inFlightByModule`** counts requests per module rather than flagging them,
  so a superseded chapter's response retires its own claim and not the fresh
  one's.
- **`_backgroundLoadTab()`** registers itself on entry and clears in `finally`
  — success, failure, or superseded-by-generation — keyed by module, never by
  "am I the active tab".
- **`_ensureTabContent()`** is the single answer to "who starts the load?".
  Every path that makes a tab active (`setActiveTab`, `addTab`,
  `openTemporaryTab`, `removeTab`) goes through it: use the cache if there is
  one, defer only to a request for *this* module, otherwise start one.
- The **generation counter** still discards a previous chapter's entries, and a
  pinned tab passes `null` for it so a later chapter change cannot discard the
  passage the reader pinned.

`_loadChapter()` drops the active tab's stale `entries` and starts each unpinned
tab's request **before** it notifies, so the spinner and the cleared entries land
in the same paint. Left in place, the previous chapter's entries were filtered
against a verse id from the new chapter, matched nothing, and
`CommentaryContent` flashed "No commentary for this verse" on every chapter
change. The Home tab is excluded (it has its own `homeLoading`/`homeData`
cycle), so `homeLoading` is raised in the same breath as clearing `homeData`,
for the same reason.

Covered by `src/stores/commentaryStore.chapterLoading.test.ts` and
`src/stores/commentaryStore.tabLoading.test.ts`.

## Key Behaviors

- **Home Tab**: Permanent first tab showing an overview of all available commentaries for the current verse, sorted by content length with previews, in three sections: verse-level, passage-level, and chapter-level (see "Chapter-level commentaries"). Click to open the full commentary tab.
- **Empty Verse Navigation**: When a commentary tab has no content for the selected verse, shows Previous/Next buttons linking to nearby verses with content, plus a grid of all verse numbers in the chapter that have entries.
- **Per-Tab Pin/Unpin**: Each commentary tab can be independently pinned to a specific passage (e.g., Barnes pinned to Gen 1 while MHC follows the Bible pane). Pinned tabs show a thumbtack indicator in the tab bar. **The Home (Overview) tab pins too** — see "Pinning the Overview tab".
- **Reference Auto-linking**: Detects Bible references in commentary text (e.g., "John 3:16", "Rom 8:28", bare "3:4")
- **Reference Hover**: Shows verse text tooltip when hovering over linked references
- **Ctrl+Click**: Opens referenced verse in a new Bible tab
- **Tab Reordering**: Drag-and-drop to reorder commentary tabs (Home tab stays fixed at position 0); uses `rectSortingStrategy` for multi-row wrapping layout
- **Verse Filtering**: Shows only entries relevant to the selected verse

## The digest is named once, at the source

The AI-synthesized commentary ships as `SYNTHESIS` (`DIGEST_MODULE_ABBR`) and is
shown to readers as **"Combined Summary"** (`DIGEST_DISPLAY_NAME`). Individual
render sites used to guard with `isDigestModule` one at a time, and several did
not — a tab tooltip, the empty-verse "No commentary in {module}." line, the
mobile card's second line, the "Verse-level notes: …" chips.

The name is now resolved where the data is built, so a render site cannot
forget:

- `resolveTabName(moduleAbbr, moduleName)` (module-scope helper in `src/stores/commentaryStore.ts`) replaces the
  `moduleName ?? moduleAbbr` fallback in `addTab`, `openTemporaryTab` and
  `restoreSession`. That single change covers the tab label, its `title`
  tooltip, and the empty-verse message, and it makes a tab restored from an
  older session correct too.
- `commentaryStore.getHomeDataFromOverview` and
  `src/providers/StudyOverviewProvider.ts` resolve `moduleName` as they build the
  home-data modules, so every card, chip and back-bar derived from them agrees.

Two consequences follow, and both are deliberate: the chips in
`CommentaryContent`'s empty-verse block still guard on the *abbreviation* they
render (identity, not name), and the second-line "full name" in
`CommentaryHome` / `MobileCommentary` is suppressed for the digest with
`isDigestModule` rather than a `name !== abbr` string comparison — now that the
name resolves, comparing against the raw abbreviation let it through as a
duplicate of the line above.

## Pinning the Overview tab

`pinTab()` used to bail out on `tabId === HOME_TAB_ID` before touching anything,
so the Overview tab's pin button rendered, highlighted on hover, and did nothing
— while the identical button on every module tab worked.

Two things were needed to make it real:

- `pinTab` no longer excludes the Home tab.
- `CommentaryHome` derives its passage from the pinned book/chapter when pinned
  (`pinned ? (pinnedBook ?? liveBook) : liveBook`), rather than always reading
  the live synced passage. It also stops auto-selecting the first visible verse
  while pinned — the pin exists precisely so the Bible pane's selection stops
  driving this pane.
- `_loadChapter` leaves `homeData` alone when the Home tab is pinned, the same
  way it already left pinned module tabs' entries alone.

Covered by `src/stores/commentaryStore.overviewPin.test.ts`.

## Chapter-level commentaries

`homeData.chapterModules` — commentaries that cover the chapter but say nothing
about the selected verse, which is where chapter-level works like Matthew Henry
spend most of their length — was computed by both the server (`/api/commentary/home`)
and the client (`commentaryStore.getHomeDataFromOverview`), and **rendered by
neither**. The only reference to it in `CommentaryHome` was to seed the
random-sort map.

The result: a commentary that is plainly installed — the tab bar's "+" picker
offers it, and it opens fine as its own tab — was simply absent from the
Overview with no explanation. It now renders as its own "Commentary on <Book>
<Chapter>" section below the passage section, sharing the mute/star/expand
behaviour of the other two. The "no commentaries" empty state counts it too.

Covered by `src/components/CommentaryPane/CommentaryHome.test.tsx`.
