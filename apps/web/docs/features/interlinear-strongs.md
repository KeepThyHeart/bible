# Interlinear & Strong's Dictionary

**Last verified:** 6e80a84 (2026-09-04)

Displays original Greek/Hebrew words with transliteration and Strong's numbers alongside English Bible text, in one of two layouts (inline prose or stacked columns). Includes clickable Strong's tags with tooltip (hover) and popup (click) for dictionary entries.

This feature is a child of [Bible Pane](bible-pane.md) and only active in Study display mode.

## Files

### Components

| File | Description |
|---|---|
| `src/components/BiblePane/InterlinearLayouts.tsx` | The two layouts (`InlineInterlinear`, `StackedInterlinear`) and the pieces they share (`CellEnglish`, `CellOriginal`, `StrongsChip`). Shared by the Bible pane and the Study pane's Interlinear section |
| `src/components/BiblePane/InterlinearLayoutToggle.tsx` | Stacked / Inline switch, rendered beside each interlinear |
| `src/components/BiblePane/VerseRenderer.tsx` | Builds the cells from the verse text and picks a layout; falls back to the plain verse (loudly) when `buildVerseInterlinearCells` returns null |
| `src/components/StudyPane/StudyHome.tsx` | Study pane → Interlinear section. Builds cells from the selected verse's own text — the Bible pane's copy when it has one, otherwise the copy `studyStore` fetched. Fails soft to the plain verse, never to a gloss list (see "The English is the translation's, always") |
| `src/components/BiblePane/BiblePane.tsx` | Fetches interlinear data for the chapter (per-tab cache), tracks `interlinearLoading` / `interlinearResolved`, and derives `interlinearUnavailable` |
| `src/components/BiblePane/BibleContent.tsx` | Study-mode toggle bar (Interlinear / Notes) and the loading state that replaces the verse list while interlinear is in flight |
| `src/components/Dialogs/StrongsPopup.tsx` | Modal popup showing full Strong's entry (word, transliteration, part of speech, definition, etymology), plus the **Search all occurrences** action. The popup is a flex column: header and action row are pinned (`flex: none`) and only `.strongs-popup__body` scrolls. It used to be a single `overflow-y: auto` box with `max-height: 400px`, which pushed the action button below the fold for any entry with a long definition — most of them — so the button looked like it did not exist |
| `src/components/Dialogs/StrongsTooltip.tsx` | Hover tooltip with an abbreviated Strong's entry. Each parsed field gets its own budget — the description 200 characters, the gloss list 120 — cut at a word boundary by `truncateAtWordBoundary` (`@bible/core/browser`). The gloss needed one of its own: it is a few words for most entries and 564 characters for `G1722` (ἐν), which made the tooltip taller than the verse under it |

### Utilities

| File | Description |
|---|---|
| `src/utils/wordIndexing.ts` | `extractWordsWithFormatting(verse.text_html)` — splits a verse into whitespace-separated tokens, carrying each word's `isChristWords` / `isDivineName` / trailing-space flags. This token sequence is the index space the interlinear rows address. Ported from the desktop app's `src/ui/utils/wordIndexing.ts` (extraction half only) and hand-synced — no desktop package is imported into this repo, so that source is not present here |
| `src/utils/interlinearCells.ts` | `buildInterlinearCells()`, `cellsPartitionWordSpace()`, `cellStrongsNumbers()` — pairs English token runs with the interlinear rows that claim them. Ported from the desktop app's `src/ui/components/study/interlinearCells.ts` and hand-synced (sharing it via `@bible/core` would mean touching that package's barrel exports) — no desktop package is imported into this repo, so that source is not present here |
| `src/utils/interlinearRows.ts` | The whole API-row → cell decision, shared by both renderers: `toCellRow()`, `normalizeStrongsNumber()`, `rowsHaveEndPositions()` (the stale-response shape check), `warnInterlinearFallback()` (once per verse + reason) and `buildVerseInterlinearCells()`, which returns `null` to mean "render the plain verse instead" |

### Data Flow

| File | Description |
|---|---|
| `src/providers/ServerDataProvider.ts` | `IInterlinearDataProvider` and `IStrongsProvider` interfaces + fetch implementations. `getInterlinear(book, chapter, module?)` appends `?module=` |
| `src/stores/studyStore.ts` | Loads interlinear for the mobile/desktop study pane; keys its cache on `module-book-chapter`, passes the active tab's module through, and **skips the request entirely when there is no tab** (the server would answer with KJV's rows). Also fetches the selected verse's `text_html` when the Bible pane is on another chapter — `getVerseHtml()` / `verseHtmlLoading`, keyed `module-verseId` so it can never hand back another verse's or another translation's text |
| `src/stores/bibleStore.ts` | `fetchVerse(module, verseId)` — a single verse without changing the active tab, through the same offline-first provider as everything else. This is what `studyStore` uses above |
| `src/offline/OfflineBibleProvider.ts` | Remembers per module whether the *server* reported interlinear data and ORs it back into locally-served chapters (`withKnownInterlinear`) |
| `src/stores/settingsStore.ts` | `interlinearLayout` (`'inline'` \| `'stacked'`, **default `stacked`**), persisted to localStorage; see [Settings](settings.md) |

### Server

| File | Description |
|---|---|
| `server/routes/interlinearRoutes.ts` | `GET /api/interlinear/:book/:chapter?module=KJV` - returns word position map and Strong's entries. Each word carries both `position` (`word_position_start`) and `positionEnd` (`word_position_end`); without the end index the client cannot align a row against the English text. A module it cannot resolve answers with **no words** (never another module's) and logs a warning, since an empty response otherwise looks identical to "this translation has no interlinear data" |
| `server/routes/strongsRoutes.ts` | `GET /api/strongs/:number` - returns Strong's dictionary entry (Hebrew or Greek) |

## Two Strong's surfaces, not two popups

There are exactly two components, and the difference between them is the
trigger, not a duplicated design:

| | `StrongsTooltip` | `StrongsPopup` |
|---|---|---|
| Trigger | hover, in the desktop layout | click, in the mobile layout |
| Dismissal | mouse-leave | Escape / backdrop / close button |
| Body | one abbreviated field set, per-field budgets | the full entry, in a scrolling `__body` |
| Actions | none | **Search all occurrences** |

The tooltip carries no action *because* it dismisses on mouse-leave — a button
in it could not be reached. That is why the desktop layout routes a Strong's
*click* to the Dictionary tab (`DesktopApp.handleStrongsClick`) instead of
opening the popup, and why the occurrence search lives on the dictionary entry
there. Both are wired up in `DialogLayer` and driven from `useAppShared`.

The website's study-tools page screenshots both — `study-tools-strongs-tooltip`
(captured on the desktop viewport) and `study-tools-strongs-popup` (mobile) —
which is what makes them look like two versions of one thing. They are not.

The one thing genuinely duplicated between them is `parseDefinition`, a
near-identical copy in each file (and a third copy in desktop's
`useSearchStore`, a fourth in core's `WordFamilyService`). Worth consolidating;
it is a parser, not a layout.

## Cells, not rows

The renderer builds **cells** from the verse's own `text_html`, not from the
interlinear rows. `interlinear_word.word_position_start` / `word_position_end`
are 0-based inclusive indices into the verse's whitespace-separated English
words, so a cell is a contiguous run of those English tokens plus the row (if
any) that claims them.

This replaced iterating the interlinear rows and printing their glosses. That
approach rendered rows sharing a position in arbitrary order and **silently
dropped every English word no row claimed** — 5.7% of KJV, including every
italicised supplied word, and over half of RWebster. A `source: null` cell for
each unclaimed run is what puts those words back.

Rows that cannot own tokens (no gloss, out-of-range or inverted positions,
ranges another row already claimed) are demoted to `extraSources` on the
overlapping cell, so their Strong's numbers stay reachable as extra chips
without duplicating the English.

`cellsPartitionWordSpace()` asserts the postcondition — cells cover
`[0, wordCount)` contiguously, in order, exactly once. If a module's data
violates it, both renderers fall back to the plain verse rather than showing a
verse with words missing or duplicated, and `warnInterlinearFallback()` says so
in the console (naming the verse id and the row/word counts, matching desktop's
`InterlinearDisplay`) — a fallback nobody can see is a module quietly changing
what the page says. Tokenisation happens *before* footnote markers are appended
so those markers cannot be mistaken for verse words. Covered by
`src/utils/interlinearCells.test.ts` and `src/utils/interlinearRows.test.ts`.

`verify-interlinear-alignment.js` (**not in this repo**; it lived in a
repo-root `scripts/` directory that has not been imported) checks the assumption
against every shipped module: token count equals `word_count`, and
`tokens.slice(start, end+1).join(' ') === gloss`. All eight modules that carry
interlinear rows pass with zero mismatches, so a partition failure in the app
means a client-side problem — a stale response, or the wrong verse text — not
bad module data.

## The English is the translation's, always

The interlinear **adds** an original-language line under the translation's own
words. It never restates them, reorders them, or substitutes the module's
wording for them. Everything below follows from that one rule.

A row's `gloss` is the *module's* English, and modules disagree — for John 3:16
position 10–11, `bible_kjv` says "only begotten" and `bible_abp` says "only
born". Some rows have no gloss at all (KJV's John 3:16 carries two `G3588`
article rows at position 0 with an empty gloss), and the same Greek word can
back two different English words (`G622` ἀποληται is both "should" at 18 and
"perish," at 20). Printed as a row list, that reads as: a bare Strong's number
with no English, a word the reader's Bible does not contain, and a duplicated
Greek word — which is exactly what was reported. Rendered as cells, none of it
can happen: the English is the verse's own tokens, so it is right by
construction.

Glosses may still be shown as *supplementary* information — a chip's tooltip, or
the clearly-labelled lexicon list described below — never in the slot where the
translation's word belongs.

### Failing soft

`buildVerseInterlinearCells()` returns `null` when the rows cannot be trusted
against this verse's words. Both renderers then show **the plain verse**, not a
degraded copy of it:

| Reason | What happens |
|---|---|
| Rows do not partition the word space | Plain verse + `console.warn` naming the verse and counts |
| Rows carry no `positionEnd` | Plain verse + `console.warn`; see below |
| Verse tokenises to nothing | Plain verse (nothing to annotate) |
| No verse text at all (Study pane, fetch failed) | The lexicon list — original word first, gloss labelled `studyHome.lexiconGloss`, Strong's chips still clickable |

### A missing `positionEnd` is unusable, not "one word"

`/api/interlinear/:book/:chapter` is in `CACHEABLE_API_PATHS`
(`server/index.ts`), so it is served `private, max-age=3600,
stale-while-revalidate=86400` — a browser can hold a response from before the
`positionEnd` field existed for up to a day after a deploy. (The service worker
does *not* cache this endpoint, so there is no SW cache version to bump; the
browser HTTP cache is the whole exposure.)

Reading a missing end as a one-word span is silent and wrong: every multi-word
row collapses onto its first token, the rest become unclaimed `source: null`
cells, and the result still *partitions* the word space — so the postcondition
check cannot catch it. `rowsHaveEndPositions()` rejects the response outright
instead, and the next revalidation fixes it. `positionEnd` is therefore
**optional** in `InterlinearWordData`.

## Layouts

Two layouts, chosen by `settingsStore.interlinearLayout` (Settings → Text Size):

| Layout | Value | Rendering |
|---|---|---|
| Stacked (default) | `stacked` | One column per cell: English on top, then original word, transliteration, Strong's chips |
| Inline | `inline` | Prose: the translation reads normally, each word trailed by its original-language word and Strong's chip in a small parenthetical |

**Stacked is the default.** With the English on top in translation order, the
verse still reads as the verse and each original-language word sits under the
word it renders. Inline puts a parenthetical after every word, which turns a long
verse into something you have to pick apart before you can read it at all.

**The switch lives next to the interlinear**, via `InterlinearLayoutToggle`: in
the Bible pane's study toggle bar (shown only when Interlinear is on, since
otherwise it controls nothing) and above the Study pane's Interlinear section.
It is still in Settings → Text Size as well, but a setting that only exists
several clicks away from the thing it changes does not, in practice, exist.

Both share `CellEnglish` (English tokens, keeping Words-of-Christ and
divine-name formatting), `CellOriginal` (original word + transliteration) and
`StrongsChip`. All three live in `InterlinearLayouts.tsx` rather than
`VerseRenderer.tsx`, because the Study pane renders the same thing.

### The Study pane uses the same cells

`StudyHome` used to iterate the raw `interlinear_word` rows and print their
glosses — the pre-cell approach, still on screen one pane away. That prints the
English in *row* order rather than translation order, drops every English word
no row claims, and shows the module's wording instead of the translation's. It
now builds cells from the verse's `text_html`, exactly as `VerseRenderer` does.

The verse text no longer has to come from the Bible pane. It is read from the
active tab when that tab is on the verse's chapter, and otherwise
`studyStore`'s private `loadVerseText()` fetches it through `bibleStore.fetchVerse()` using
the tab's own translation. The old code just set `cells = null` whenever the
pane was elsewhere and fell through to the gloss list — which is why the bug was
so easy to hit: any pinned verse, any navigation away, and the section stopped
showing the translation.

The layout toggle is only rendered when cells are what is on screen; it selects
between the two cell layouts and controls nothing in the fallbacks.

## Availability is decided by the fetch

`interlinearUnavailable` comes from a **completed fetch** — `interlinearResolved
&& !interlinearLoading && interlinearWords.length === 0` — not from
`tab.hasInterlinearData`.

The downloaded offline "lite" module DB carries only `module_info` /
`bible_verse` and has no `interlinear_word` table, so once a module was
downloaded every locally-served chapter reported `hasInterlinearData: false`
and the pane wrongly claimed the translation had no interlinear data — while
`/api/interlinear` was still happily serving that module's words from the full
DB. `OfflineBibleProvider` additionally remembers what the server said per
module and re-asserts it on locally-read chapters.

## The module follows the tab

Interlinear requests pass `?module=`. The server defaults to KJV, so before
this every translation displayed KJV's interlinear data. `BiblePane` passes
`tab.moduleAbbr`; `studyStore` does the same and includes the module in its
cache key, so switching translations no longer re-serves the previous one's
data for the same chapter — and it does not request at all when there is no tab
to name a module, rather than accepting the KJV default.

`DatabaseManager.resolveAbbreviation()` matches case-insensitively against
`module_metadata`. When it cannot resolve the requested module the route logs
and returns an empty word list; the pane then reports "not available for this
translation", which is at least true, instead of quietly showing another
translation's original-language words.

## Key Behaviors

- English words come from the verse text itself, in translation order; every word renders exactly once (see "Cells, not rows" and "The English is the translation's, always")
- When the cells cannot be built, the fallback is the plain verse — never the module's glosses in row order
- Two-tier UI: tooltip on hover (300ms leave delay), then a click action that differs by layout:
  - **Mobile** opens `StrongsPopup`, whose "Search all occurrences" button runs a Strong's search and switches the right pane to search mode. It stays visible regardless of definition length (see `StrongsPopup.tsx` above)
  - **Desktop** does *not* open the popup — `DesktopApp.handleStrongsClick` sends the number to the Dictionary tab instead (`dictionaryStore.openStrongs`). That layout therefore never sees `StrongsPopup`, and the occurrence search lives on the dictionary entry itself; see the Strong's entry action in [Search](search.md). The hover tooltip deliberately carries no action — it dismisses on mouse-leave, so a button in it could not be clicked
- The original-language word and the transliteration are clickable too, opening the same dictionary entry as the `<sup>` Strong's chip. They used to be inert, which made the one thing a reader is most likely to click in an interlinear do nothing
- In the stacked layout, clicking the English cell still runs a Strong's occurrence search and switches the right pane to search mode
- Multiple key format lookups (G2316, 02316, 2316); `strong:G2316` prefixes are normalized away
- Client-side cache of looked-up Strong's entries, plus a per-tab cache of chapter interlinear data
- Study mode toggle bar at top of chapter: Interlinear on/off, Notes on/off. The Notes checkbox is disabled (with an explanatory `title`) when the chapter carries no publisher footnotes — no installed module currently ships any, and a checkbox that can never reveal anything reads as broken
- While interlinear data is loading, the loading indicator **replaces** the verse list rather than sitting above it. Painting the plain text first and then swapping in the taller interlinear rows made the whole chapter jump under the reader. For the same reason the pending-scroll effect in `BiblePane` waits for verses to exist *and* for interlinear to finish before measuring
- Footnotes rendered below each verse in study mode (letter markers a, b, c as superscripts)
- Study mode settings persisted in localStorage
