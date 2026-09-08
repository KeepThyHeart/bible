# Interlinear & Study Mode

**Last verified:** 2026-09-08

Study mode view with interlinear Greek/Hebrew display, cross-references, footnotes, and verse links.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/study/StudyModeView.tsx` | Main study mode layout orchestrating interlinear, cross-refs, footnotes. Owns the **single** chapter-wide data load (`useChapterStudyData`) and the `studyDataPending` gate that withholds the verses until it lands - see "One load, one paint" below. Takes `panelId` and reads its study options through `useBiblePanel(panelId)` - study options are per-panel *and* per-tab, so defaulting to `DEFAULT_PANEL_ID` looks up a panel nothing writes to and makes the study controls inert. Selecting a verse works from the text as well as the verse number, but a click that merely ends a drag-selection must not steal it, or every highlight drag would re-select the verse |
| `src/ui/components/study/InterlinearDisplay.tsx` | Renders interlinear cells: the English words on top, then original language, transliteration and Strong's numbers. Each English word is its own `<span class="word" data-word-index=N>`, so highlighting, underlining and find-in-page work here exactly as in the other display modes (see "Word alignment" below). Takes `verseId` / `moduleId` and subscribes to `useHighlightStore` the same way `HighlightedVerse` does. Sanitizes `englishText` with `stripOsisTags` (`@bible/core`) before tokenizing - raw OSIS/SWORD markup (e.g. `<divineName>`) would otherwise show up literally, since these are text nodes, not HTML; `<divineName>` becomes a `divine-name` class on the word span. In stacked layout, the hover handlers that drive `StrongsPreviewTooltip` live on the whole per-word block, not just the conditionally-rendered original-word line, since every shipped KJV-family module has `original_word = NULL`. Each `StrongsChip` **also** carries its own `onMouseEnter`, and that is the one that decides which number the tooltip previews: a cell can hold several numbers (Genesis 1:1 "created" is H01254 plus the accusative marker H0853), the block-level handler can only ever name the first, and React synthesises `mouseenter` up its own tree. Layout is flex in both modes: the stacked container is a `flex flex-wrap items-start` row of `flex flex-col` cells, and an inline cell is an ordinary inline `<span>` rather than `inline-flex` (an inline-flex box sits on a *synthesised* baseline that moves with the annotation's metrics, so cells with and without an annotation drift vertically against each other). The tooltip's `parseStrongsDefinition` splits the raw definition blob into description/glosses and strips header boilerplate before truncating, and surfaces transliteration/pronunciation/part-of-speech from the IPC entry. The tooltip also carries the **Search all occurrences** action (`data-testid="strongs-search-occurrences"`), which calls `useSearchStore.searchStrongsNumber()`; that sets the query and awaits `performSearch`, which sets `isResultsVisible`, so the results panel opens itself. It renders once the lookup settles whether or not the dictionary had an entry, since a Strong's search reads the interlinear index rather than the lexicon. Clicking the chip opens the dictionary instead |
| `src/ui/components/study/interlinearCells.ts` | Pure cell assembly: turns the English word list plus the verse's `interlinear_word` rows into contiguous, non-overlapping cells covering every English index exactly once. No React, no DOM. `cellsPartitionWordSpace()` is the postcondition the renderer checks before trusting the result |
| `src/ui/components/study/CrossReferenceDisplay.tsx` | The compact cross-reference line under a verse: one row per module, **TSK phrase groups rendered inline** (`TSK: Yea. Rom 5:8; 8:32  hath God said. Ps 19:1`) with the keyword in bold and its own `+N more` budget per group (`MAX_COLLAPSED_REFS`, 12, module-private). Hovering any reference opens `VersePreviewTooltip`. Exports `useVerseHoverPreview`, the hover/deferred-hide state machine `VerseLinksDisplay` shares |
| `src/ui/components/study/useChapterStudyData.ts` | The one chapter-wide load: cross-reference phrase groups and verse links, keyed per verse. See "One load, one paint" |
| `src/ui/components/study/FootnoteDisplay.tsx` | Displays footnotes associated with verses |
| `src/ui/components/study/VerseLinksDisplay.tsx` | Rows of linked resources under a verse: **Commentaries**, **Books**, **My content**. Purely presentational - `links` arrives as a prop from `useChapterStudyData`. The Commentaries row is governed by `showCommentaryLinks` (the "Show Commentary Links" checkbox in `StudyControls`, default on); switching it off also drops it from the `hasLinks` test, so a verse whose only adornment was commentary links renders no bordered block rather than an empty one - the same rule cross-references follow. `hasLinks` also counts `links.userRefCount`, the verse's user cross-references. Cross-references are NOT here; see "One cross-reference surface" |
| `src/ui/components/study/StudySection.tsx` | A collapsible titled section with an optional subtitle and item count, hidden when the count is zero |
| `src/ui/components/study/StudyRichText.tsx` | Renders a module's body content: `sanitizeHtml`, `reprocessCommentaryLinks`, scripture-link hover previews via `useScriptureTooltip` + `VersePreviewTooltip`, and a Markdown path for modules that ship Markdown |
| `src/ui/components/study/markdown.ts` | The small Markdown renderer (`markdownToHtml`, `looksLikeMarkdown`) for modules declaring `content_format: "markdown"` - the bundled `SYNTHESIS` digest is one. Deliberately hand-written rather than pulling in `marked` for the handful of constructs the shipped modules use |
| `src/ui/utils/moduleNaming.ts` | `crossReferenceModuleLabel()` - the one place a cross-reference module is named to the user (`TSKxref` -> `TSK`) |
| `src/ui/services/studyOverviewProvider.ts` | Renderer client for the study cache (`study:getOverview`): chapter-keyed in-memory cache, in-flight de-duplication, per-verse getters |
| `src/ui/utils/tskPhrase.ts` | Splits a raw TSK phrase into keyword and editorial aside (`"locusts.The word {arbeh,}..."`) |
| `src/ui/components/study/LinkButton.tsx` | One entry in a verse-links row. An inline **text link**, not a bordered chip - a study verse can carry eighteen commentaries, and as chips that row wraps to four lines. Still a real `<button>`, since these activate in-app navigation rather than a URL |
| `src/ui/components/study/MultiReferenceDialog.tsx` | Dialog for selecting from multiple cross-reference targets |
| `src/ui/components/study/StudyControls.tsx` | The checkbox strip at the top of the chapter, and **the only surface** for these switches: footnotes, cross-references, user cross-references (nested under cross-references), the commentary-links row, interlinear and its inline/stacked layout. `onOptionsChange` goes to `setStudyOptions(tabId, ...)`, which writes both `studyOptionsByTab` and the passage record (`tab.showInterlinear` / `tab.showNotes` / `tab.showCommentaryLinks`) - the latter is what the session persists. See [Bible Pane -> chapter toggles](bible-pane.md) |
| `src/ui/components/StudyPane.tsx` | The dockview Study pane: a dedicated scrolling column of cross-references, headed per group |
| `src/ui/components/bible/revealDictionaryPanel.ts` | Makes the Dictionary pane visible - an open `'dictionary'` panel only, otherwise it creates one (`LOOKUP_HOST_TYPES = ['dictionary']`) - and returns its real dockview panel id. A pane on screen is never assigned `DEFAULT_PANEL_ID`, so a lookup written there lands on a panel-state entry nothing renders. Also exports `activateDictionaryPanel`. Mirrors `revealNotesPanel.ts` |
| `src/ui/components/bible/openStrongsInDictionary.ts` | The app's one "open this Strong's entry" gesture, so surfaces other than the Bible pane can reach the full entry. Chains `revealDictionaryPanel()` -> `useDictionaryStore.lookupStrongsNumber` -> `SHOW_DICTIONARY_PANE_EVENT` through `activateWhenContentReady` |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/studyHandlers.ts` | Verse links (`study:getVerseLinks`, `study:getBatchVerseLinks`), the chapter overview (`study:getOverview`), `study:getCommentaryMentions`, the interlinear reads (`bible:getInterlinearWords`, `bible:getInterlinearWordsForChapter`, `bible:hasInterlinearData`), user cross-references (`bible:getUserCrossReferences`, the add handler, `bible:deleteUserCrossReference`) and `bible:getVerseTexts` |
| `electron/services/StudyCacheService.ts` | The study-overview cache: user-local, lazily created, write-through on miss. See "The study cache" below |
| `electron/services/StudyCacheSweeper.ts` | Background fill of the rest of the canon, one chapter per event-loop turn |
| `electron/utils/moduleDetector.ts` | Boot-time module registration, including the rule that a `commentary_<slug>.db` beside an `xref_<slug>.db` is not registered. See "Cross-reference sources are not commentaries" |
| `electron/ipc/crossReferenceHandlers.ts` | `xref:getAvailable`, `xref:getGroupsForVerse`, `xref:getGroupsForRange`, `xref:getReverseReferences`, `xref:getReverseReferencesForRange`, `xref:getEntryCount` |

### Utilities

| File | Description |
|---|---|
| `src/ui/utils/wordIndexing.ts` | `extractWordsWithFormatting()` - the one tokenizer that defines the word index space, carrying `isChristWords` / `isDivineName` / `hasTrailingSpace` per token |
| `electron/utils/verseIndexing.ts` | Server-side verse indexing utilities |

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/interlinear.spec.ts` | Interlinear display and interaction tests. Its `beforeEach` selects Study mode and waits for `study-controls`; a dedicated case asserts the Interlinear checkbox is already ticked on arrival |
| `e2e/tests/study-pane.spec.ts` | The dockview Study pane |
| `e2e/tests/reference-links.spec.ts` | Cross-reference and link navigation tests |

### Unit Tests

| File | Description |
|---|---|
| `src/ui/components/bible/studyOptionsWiring.test.tsx` | The chapter-top checkboxes reach `StudyModeView` through the study options of the panel they were written for, and write through to the passage record the session saves |
| `src/ui/components/study/InterlinearDisplay.test.tsx` | Word-index emission (exact index sets, in both layouts), highlight/underline painting, unclaimed-word rendering, OSIS/SWORD markup sanitization, Strong's hover-tooltip reachability in both layouts (including `original_word = NULL`), previewing the number of the chip actually hovered when a cell carries two, tooltip content parsing, and the search-all-occurrences action (fires with the hovered number, closes the tooltip, survives a missing dictionary entry, absent while the lookup is in flight) |
| `src/ui/components/study/interlinearCells.test.ts` | Cell assembly on fixtures taken verbatim from `bible_kjv.db` (John 3:16, Gen 1:2, Gen 1:9) plus overlap/out-of-range/no-gloss edge cases. The partition postcondition is the load-bearing assertion |
| `src/ui/components/study/StudyModeView.test.tsx` | Study-mode composition: which adornment rows render for a verse |
| `src/ui/components/study/StudyModeView.highlights.test.tsx` | Study mode's DOM contract with interlinear both off and on |
| `src/ui/components/study/StudyModeView.preface.test.tsx` | Verse-0 chapter prefaces (no verse-number affordance, italic/secondary styling) and `verse.formatting.sectionHeading`, Module Format v2's carrier for Psalm superscriptions, attached to the verse that follows |
| `src/ui/components/study/StudyModeView.studyRow.test.tsx` | The Study-mode verse row: cross-references sourced from the cross-reference modules over `xref:*` (not `verse.formatting.crossReferences`, which no shipped Bible module populates), the interlinear gate, and verse selection from the text without a drag-release stealing it |
| `src/ui/components/study/FootnoteDisplay.test.tsx` | Footnote markers and expansion |
| `src/ui/components/study/markdown.test.ts` | The Markdown subset the shipped modules use |
| `src/ui/components/study/VerseLinksDisplay.digest.test.tsx` | The Commentaries row never shows the raw `SYNTHESIS` abbreviation |
| `src/ui/components/study/StudyModeView.singleLoad.test.tsx` | The single-load gate: verses withheld until every source lands, adornments present in the verse's first frame, no per-verse loading block, and toggling Interlinear re-fetches nothing |
| `src/ui/components/study/useChapterStudyData.test.tsx` | The IPC budget per chapter (asserted as a number), the study-cache path vs. the live-range fallback, and per-verse attribution |
| `src/ui/components/study/CrossReferenceDisplay.test.tsx` | Inline phrase groups, the "Overall" label for a NULL-phrase group, per-group `+N more`, aside splitting, and hover previews (including a collapsed range's end verse) |
| `src/ui/components/StudyPane.test.tsx` | The dockview Study pane's full-run rendering |
| `src/ui/services/studyOverviewProvider.test.ts` | Chapter cache, in-flight de-duplication, and the unavailable fallback |
| `electron/services/StudyCacheService.test.ts` | Cold start with no file, write-through, cache hits across processes, fingerprint invalidation, corrupt/deleted-file recovery, adopting a generated cache as a seed, and the five cases in "what a row is allowed to claim" |
| `electron/services/StudyCacheSweeper.test.ts` | One chapter per turn, yields counted, cancellation mid-walk, size budget, and survival of a failing chapter |
| `packages/core/src/__tests__/ModuleRegistrationPolicy.test.ts` | The cross-reference-source rule, over filenames and over registry paths |
| `src/ui/utils/tskPhrase.test.ts` | Keyword/aside splitting on phrases taken from `xref_tsk.db` |
| `packages/core/src/__tests__/RangeBatchQueries.test.ts` | The range queries reproduce their single-verse counterparts exactly, verse by verse, against the real Barnes and TSK modules |
| `src/ui/components/bible/revealDictionaryPanel.test.ts` | Reveals an existing Dictionary pane, refuses to send the lookup to a Books pane, and creates one when the layout has none; mirrors `revealNotesPanel.test.ts` |
| `src/ui/stores/useDictionaryStore.strongsLookup.test.ts` | `lookupStrongsNumber` writes to the panel id it is given, not `DEFAULT_PANEL_ID` |
| `src/ui/stores/__tests__/useBibleStore.studyInterlinearDefault.test.ts` | A new Study-mode tab defaults interlinear on (both `BibleTab.showInterlinear` and `studyOptionsByTab`); Standard/Reading tabs and restored sessions are unaffected |
| `src/ui/stores/__tests__/useBibleStore.chapterToggles.test.ts` | The chapter toggle state the study options write through to |
| `src/ui/stores/__tests__/sessionMigration.test.ts` | Includes the tri-state `tab.showInterlinear` case |

## Interlinear defaults

`showInterlinear` is seeded on for a passage in Study mode. `DEFAULT_DISPLAY_MODE` is `standard`, so a passage is born standard and switched with the toolbar's display-mode dropdown; `tabOptionsSlice.setDisplayMode` therefore seeds the study defaults when the passage has no recorded preference, and `tabSlice.openBible` does the same for a tab created in Study mode. See [Bible Pane -> chapter toggles](bible-pane.md) for the tri-state `tab.showInterlinear` this depends on. Pinned by `stores/__tests__/useBibleStore.studyInterlinearDefault.test.ts` (switching in seeds it; a preference the reader set is never overridden; a restored passage that never recorded one still gets the default) and by the tri-state case in `stores/__tests__/sessionMigration.test.ts`.

The chapter-top `StudyControls` strip is the only surface for the switch; the Bible toolbar carries no duplicate.

If the *module* has no interlinear data the failure is graceful: `StudyControls` hides the checkbox and says "Interlinear data not available for this translation." `hasInterlinearData` comes from the `bible:getChapter` payload, so there is no extra round trip to decide it; an `interlinearCheckComplete` flag distinguishes "still checking" from "checked, and there is none".

## One load, one paint

`useChapterStudyData` loads a chapter's adornments once, *above* the subtree the interlinear gate unmounts, so toggling Interlinear re-fetches nothing.

- Cross-refs come from the study cache when it is usable, else from `xref:getGroupsForRange` (one call per module for the whole chapter); verse links from `study:getBatchVerseLinks`. Reverse references are not fetched.
- **`studyDataPending`** = `interlinearPending || !studyData.resolved`. While it holds, the verses are not rendered at all, and `useDeferredLoading` keeps the skeleton from flashing on a fast load. The pane then paints fully adorned, in one frame.
- **`VerseLinksDisplay` fetches nothing.** `links === null` means "this verse has no links", not "not loaded yet".

Measured by `useChapterStudyData.test.tsx`: **3 IPC round trips per chapter** - `xref:getAvailable`, `study:getOverview`, `study:getBatchVerseLinks` - independent of verse count, and the same cold or warm (a cache miss is computed inside `study:getOverview`, so it costs latency, not traffic). A fourth call, `xref:getGroupsForRange`, appears only when the main process cannot produce the chapter at all; one call total when cross-references are toggled off. `VerseLinksService.getBatchVerseLinks` issues one RANGE query per module rather than one per verse per module, which is what keeps the main-process SQL to a few dozen statements per chapter instead of thousands.

## The study cache

A **user-local, runtime-built, entirely optional accelerator**. Every chapter it serves can be computed from the installed modules on demand, and is, whenever the cache does not have it. Nothing about the app requires the file: not startup, not correctness, not the first visit to a chapter.

- **Location:** `<userData>/data/cache/study-cache.db` - built from `getUserDataPath()`, the writable per-user root that downloaded modules already use, **never** `resources/data`, which is installer-laid-down and read-mostly (and on Windows usually under Program Files). Created lazily on first write; a missing file is a normal state. In development the two paths coincide, which is what lets a developer's generated cache act as a seed.
- **Never shipped.** `scripts/stage-build-data.js` does not copy it and must not. An artifact generated against a developer's module set would be stale on the first launch of every real install, and its installer weight buys something the app then discards.
- **Write-through.** A miss computes the chapter live (via the `@bible/core` `Services/StudyOverview/*` aggregation), returns it immediately, and persists it. The first visit to a chapter is therefore never slower than having no cache at all, and it warms exactly what the reader reads.
- **Only `crossrefs` is stored** - see "Which sections are cached" below.
- **Background sweep** (`StudyCacheSweeper`) fills the rest of the canon. It starts 60 s after module detection (`STARTUP_DELAY_MS`) and does **one chapter per event-loop turn**, 500 ms apart (`CHAPTER_INTERVAL_MS`) - about ten minutes for the full canon. `better-sqlite3` is synchronous, so this is the load-bearing detail: one chapter's aggregation is the same order of work as the `study:getBatchVerseLinks` the app already runs synchronously on every navigation, and between units a real timer lets IPC replies and window events through. A `utilityProcess` would remove even that, at the cost of a second writer on one SQLite file, native-module loading in a child process, and a cancellation protocol - not justified until a measurement says the yields are not enough. Cancelled on quit (`stopStudyCacheSweep()` in `electron/main.ts`).
- **Invalidation is per row, and never serves stale.** Each row stores the `fingerprint` of the module set it was computed from (the abbreviations of every commentary, cross-reference and topical-index module whose file resolves, sorted and comma-joined), and a read requires an exact match. Installing or removing a module cannot produce a stale answer: non-matching rows simply stop matching and are recomputed as they are visited. Opening the DB also runs one `DELETE` of them to reclaim the space.
- **Damage is never an error.** A file that is not a SQLite database (checked by its 16-byte header *before* opening - better-sqlite3's constructor pragma throws on a bad file and orphans the OS handle, which makes the recovery `rmSync` fail with EBUSY on Windows) is discarded and recreated. A corrupt row is recomputed. A cache that cannot be opened at all means live-only for the session. No dialog, ever.
- **Size.** A full-canon cache measures about **28 MB**, against roughly 89 MB for the same 1,189 chapters with all four sections. Because only `crossrefs` is stored, and cross-references come from TSK alone, that figure does not scale with the number of installed commentaries - a 23-commentary library costs the same as a stock install. The sweep stops at a `MAX_CACHE_BYTES` budget of 256 MB, which is headroom against a future widening rather than a live constraint; **write-through is never blocked by the budget**, since a chapter the reader is looking at is worth caching whatever the file weighs.

### Which sections are cached

A chapter overview has four sections - `commentary`, `topics`, `crossrefs`, `entities` - and the desktop UI reads exactly one of them. Computing and storing the other three costs about 33 MB of a 60 MB cache for data nothing reads.

**One constant decides:** `CACHED_SECTIONS` in `electron/services/StudyCacheService.ts`.

```ts
export const CACHED_SECTIONS: readonly StudyOverviewSection[] = ['crossrefs'];
```

Re-enabling a section is an edit to that line **and nothing else**. What makes that safe is the per-row marker:

- Every row stores a `sections` column beside its `fingerprint`, listing what was actually computed for it.
- A read is a hit only when the row's fingerprint matches **and** the row contains every section the caller asked for. A row written under a narrower set therefore reads as a **miss**, not as a chapter that happens to have no topics. That distinction is the whole point: an empty field must never be mistaken for an empty answer.
- So widening the constant needs no migration and no cache wipe. Existing rows simply stop satisfying the contains-check and refill on demand.
- Containment, not equality: a row holding *more* than was asked for is still a hit, which is why a cache computed with all four sections satisfies any request.
- The payload carries its `sections` list to the renderer for the same reason. `studyOverviewProvider` deliberately exposes a getter only for `crossrefs`; if you widen the constant, add the getter too, so no getter can ever answer "this chapter has no topics" when the truth is "topics were never computed".

`StudyCacheService.test.ts`'s "what a row is allowed to claim" block pins all of it - a row stores only the enabled sections, a narrower row reads as a miss for a wider request, a widened request refills with no intervention, a wider row serves a narrower request, and an externally seeded full cache is treated as complete.

An externally generated cache is treated as a **seed**: the schema migration adds the per-row `fingerprint` column and backfills it from the file's `cache_metadata.module_fingerprint`, so such a cache is adopted if it matches the installed modules and lazily replaced if it does not. The web app serves the same overviews from a prebuilt DB through `apps/web/server/routes/studyOverviewRoutes.ts`, a different deployment model that is unaffected by any of this.

## Cross-reference sources are not commentaries

Module type is inferred from the filename prefix, and a cross-reference source such as TSK exists as two files: `commentary_tsk.db` (the SWORD import's input) and `xref_tsk.db` (its output, and what the app queries). Registering both would give one body of references three renderings under a single verse, one of them inside `Commentaries:`, where clicking it opens a raw import the user was never meant to browse.

The rule, in `@bible/core`'s `Services/ModuleRegistrationPolicy.ts` and stated over filenames rather than over any particular module's name:

> **A `commentary_<slug>.db` is not registered when an `xref_<slug>.db` is installed alongside it.**

The commentary file stays on disk and stays usable as an import source; it just never becomes a browsable module. `electron/utils/moduleDetector.ts` applies it on every app boot, both skipping such a file (`isCrossReferenceSourceCommentary`) and **de-registering** a row an existing install already carries (`isCrossReferenceSourceCommentaryPath`), so every install converges on the same registry.

## Verse links rows

`VerseLinksDisplay` renders under the verse text, after the footnotes and the compact `CrossReferenceDisplay` row: **Commentaries**, **Books** and **My content**.

The Commentaries row navigates itself: `openCommentaryModule` finds (or creates) a Commentary panel through `useLayoutStore`, brings it to the front, points it at the verse with `syncWithBibleVerse`, then `openCommentary`s the module's tab. An `onNavigateToCommentary` prop is honoured when a caller supplies one. Because `overviewActive` is local state inside `CommentaryPane`, that pane also carries an effect that drops Overview whenever its tab count grows - otherwise the tab opened from here would sit behind the Overview the user did not ask for.

There is deliberately no "cited in" row. The only source that could feed one is the reverse cross-reference lookup, and a list that can only ever mean "TSK points here" is a cross-reference index read backwards, not a citation index. The v2 commentary format offers nothing better: every `verse_link` row with `source_type='commentary_entry'` is `link_type='primary_passage'` (the entry's own anchor passage), so `CommentaryRepository.getVerseMentions` returns nothing for any verse that starts an entry. The data layer is kept for a properly-built citation index to use later - `CrossReferenceRepository.getReverseReferences` / `getReverseReferencesForRange`, and the `xref:getReverseReferences*` IPC - and `VerseLinksSummary` still declares the `mentions` field.

## Word alignment

`interlinear_word.word_position_start` / `word_position_end` are 0-based, **inclusive** indices into the verse's whitespace-separated *English* word sequence - the same index space that `user_text_markup.text_start` / `text_end` (highlights and underlines) and `bible_verse.formatting.spans` (words-of-christ, supplied) use. There is one word index space in this project, and interlinear positions live in it.

The invariant, across all eight shipped modules that have interlinear data (abp, asv, bsb, darby, kjv, kjva, rlt, rwebster - about 2.9M rows), is:

1. `tokens(formatVerseText(verse).textHtml).length === bible_verse.word_count`
2. `word_position_end < tokens.length`
3. `tokens.slice(start, end + 1).join(' ') === gloss` for every row with a gloss

All three hold with zero violations for the shipped set. Anything that imports or regenerates a module must re-check them; a break there shows up as highlights painting the wrong words. (The one-off verification script that established this is not part of this repo, and the comments in `interlinearCells.ts` and `packages/core/src/Data/Models/Bible/BibleVerse.ts` that name it are stale.)

Because of that invariant, `InterlinearDisplay` renders the **English tokens themselves** rather than the stored gloss string, one addressable `.word` span each. Only the English line carries `data-word-index`; the original-language, transliteration and Strong's lines deliberately do not, so a drag across Greek text can never be mapped onto English indices.

### Cells

A *cell* is one column of the stack: a contiguous run of English tokens plus the interlinear row backing them. Rows with no gloss (John 3:16 pins three rows to index 0, two of them glossless) become extra Strong's chips on the cell rather than extra copies of the word. Overlapping or out-of-range rows are demoted the same way - first row wins.

Runs of English words that **no** row claims become `source: null` cells and are rendered as plain text. Without that, a renderer emitting one block per interlinear row silently drops them - 5.7% of KJV, including every italicised supplied word and whole trailing clauses such as Gen 1:9's "and it was so.", and over half of RWebster.

## Cross-references: phrase groups and previews

TSK does not list a verse's references as one flat run. It groups them under the phrase they belong to, and a group with no phrase covers the verse as a whole. `targetVerseIdsFromGroups` reads `group.phrase` as well as `entries`, so a reader can tell which words of the verse a reference belongs to.

Groups render **inline**, the way TSK itself prints a verse:

```
TSK:  Overall. Ps 19:1   Yea. Gen 3:1; Rom 1:20   hath God said. Ps 33:9
```

- Whole-verse groups are hoisted first and labelled with `crossReferenceDisplay.overall` ("Overall"). The test is for an *absent* phrase, not `=== null`: the repository maps a NULL phrase column to `undefined` on the way through the DTO.
- Inline, not a heading per group (which is what the dockview `StudyPane` uses): a heading block is right for a dedicated pane but triples the height of a row that sits under every verse.
- The `MAX_COLLAPSED_REFS = 12` "+N more" budget applies **per group**, and **only to this inline row**. Applied per module, a verse with eight phrases would show its first phrase and hide the rest behind one counter.
- The dockview **Study pane** (`src/ui/components/StudyPane.tsx`) shows **every** reference: it passes `maxRefs={null}` to `ReferenceRun`, which renders the full run and draws no toggle. The two callers want opposite things - this row sits under the verse in the Bible text, where a 60-target TSK verse would push the next verse off the screen, whereas the Study pane is a dedicated scrolling column the reader opened in order to read cross-references, so collapsing two thirds of the answer behind a counter is the wrong trade there.
- TSK phrases routinely carry an editorial aside run together with the keyword (`"locusts.The word {arbeh,} Locust, is derived from..."`). `tskPhrase.ts` splits it; only the keyword goes in the reading flow, and the aside stays reachable as the element's `title`. Printed raw it reads as corrupted data.

Hovering any reference in the cross-reference row opens the same `VersePreviewTooltip` used by the Study pane, commentary views and note editors. `useScriptureTooltip` cannot serve these: it keys on `tagName === 'A'` plus the `scripture-link` class, and every reference here is a `<button>` (they drive in-app navigation, not a URL). `useVerseHoverPreview` in `CrossReferenceDisplay.tsx` is the shared state machine instead - pointer-anchored position, about 100 ms deferred hide so the pointer can travel into the popup. `CollapsedSegment.endVerseId` is passed through, so a collapsed range like `1 John 4:9-10` previews the whole passage.

## One cross-reference surface

A verse in Study mode carries exactly one cross-reference rendering: the inline phrase-group row. `VerseLinksDisplay` does not render cross-references, and `hasLinks` does not count them, so a verse whose only adornment is cross-references renders no verse-links block rather than an empty bordered box. `VerseLinksService` still *returns* `crossReferences.modules` - it is a general service with other potential consumers - Study mode simply does not render it.

The `xref` suffix on an abbreviation is an artefact of the importer deriving it from the `xref_` filename prefix that marks the module's TYPE. It is stripped at the display boundary by `crossReferenceModuleLabel()` in `src/ui/utils/moduleNaming.ts`, used by `CrossReferenceDisplay` and by `StudyPane`'s source list. Deliberately **not** fixed at rest: the stored abbreviation is a lookup key - `xref:getGroupsForRange(abbreviation)`, the study cache's `crossrefs[].src`, and the cache fingerprint all resolve through it - so rewriting it would invalidate caches and break lookups to fix a spelling.
