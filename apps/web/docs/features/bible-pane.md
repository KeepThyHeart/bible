# Bible Pane

**Last verified:** 6e80a84 (2026-09-04)

The core Bible reading and display feature. Supports multi-tab navigation, three display modes, chapter navigation, verse selection, and session persistence.

## Display Modes

- **Reading** - Inline verse flow without verse numbers
- **Standard** - Block-style verses with verse numbers
- **Study** - Includes interlinear data (see [Interlinear & Strong's](interlinear-strongs.md))

## Files

### Components

| File | Description |
|---|---|
| `src/components/BiblePane/BiblePane.tsx` | Main container; orchestrates interlinear loading in study mode, syncs with commentary |
| `src/components/BiblePane/BibleContent.tsx` | Renders all verses for a chapter; handles verse selection, the inline reference box, and the study-mode toggle bar / interlinear loading state |
| `src/components/BiblePane/BookChapterPicker.tsx` | Modal dialog for book/chapter selection with inline reference textbox for direct passage entry; optionally shows the target translation with a "Select Translation" link |
| `src/components/BiblePane/VerseRenderer.tsx` | Individual verse renderer for all three display modes; in study mode builds interlinear cells from the verse text and renders the inline or stacked layout |
| `src/utils/verseHtml.ts` | Display-side handling of the formatted `text_html`: `applyRedLetterSetting` (the `wordsOfChristInRed` switch), `tuckTrailingPunctuation`, and `toPreviewHtml`, which reduces a verse to one inline run keeping only the `christ-words` / `divine-name` spans. Shared with the hover preview in `src/hooks/useVersePopup.tsx` so the two cannot drift |
| `src/components/BiblePane/BibleTabBar.tsx` | Tabbed interface for multiple open passages; tab switching, closing, adding, drag-to-reorder (via `@dnd-kit`), **double-click a tab to change its passage** |
| `src/components/BiblePane/TranslationDialog.tsx` | Translation picker, shared by the toolbar's version button and the passage picker's "Select Translation" link |
| `src/components/common/SortableTab.tsx` | Shared drag-and-drop tab wrapper using `@dnd-kit/sortable` |
| `src/components/BiblePane/BibleToolbar.tsx` | Toolbar with display mode selector, translation dropdown, history nav (back + **recent-passages menu**; no forward button), chapter nav buttons |
| `src/components/BiblePane/ChapterNav.tsx` | Bottom chapter navigation; handles book boundary transitions |
| `src/components/BiblePane/BackBar.tsx` | Transient "Back to \<passage\>" bar shown after a link/cross-reference jump (`tab.showBackBar`, set by `navigateTo(..., { fromLink })` and `navigateToPreview`). Auto-fades after 30s; `bibleStore.getBackLabel()` names the target, `dismissBackBar()` clears it. Suppressed when `BiblePane` is rendered with `hideBars` |
| `src/components/BiblePane/interlinearPending.ts` | `isInterlinearPending()` — whether the interlinear spinner has replaced the verses. Shared by `BibleContent` (what to render) and `BiblePane` (whether there is anything to scroll to); see [Navigation & Layout → Scrolling to the selected verse](navigation-layout.md) |

### State

| File | Description |
|---|---|
| `src/stores/bibleStore.ts` | State for tabs, active tab, navigation (`navigateTo(..., { fromLink?, endVerse?, replace? })`), display modes, verse selection, URL hash syncing, history (50 entries max), tab reordering, memoized verse of the day, session persistence via localStorage. Every chapter load is stamped with a per-tab `loadSeq` (`beginLoad` / `isSupersededLoad`) and writes `versesModule` alongside `verses` — see "Which translation the text is actually in" below |

### Server

| File | Description |
|---|---|
| `server/routes/bibleRoutes.ts` | `GET /api/bible/:module/:book/:chapter` (all verses), `GET /api/bible/:module/verse/:verseId` (single verse), `GET /api/bible/votd` (verse of the day, `?module=` defaults to KJV), `GET /api/bible/topics/:book` (section headings from the enrichments DB), `POST /api/bible/:module/verses` (batch verse text, max 500 ids) |

## Verse selection

**A chapter always arrives with a verse selected.** When navigation names no
verse, `bibleStore` selects the chapter's first verse from the data it just
loaded, and `ensureStudyVerse()` covers entry points that skip `navigateTo`
(notably a cold start rendering verses cached in the session, where the restored
tab carries `studyVerse: null`).

This must stay in the store. It was previously left null and back-filled by an
effect in `CommentaryContent` that measured the DOM for the first visible verse;
that effect runs before the Bible pane has mounted its verses, so on a chapter
change or cold start it found nothing, its deps never changed again, and the
commentary and study panes sat on "select a verse" until the user clicked one.
Covered by `src/stores/bibleStore.studyVerse.test.ts`.

Three distinct highlight states, which are easy to confuse:

| State | Tab field | Class | Meaning |
|---|---|---|---|
| Study (anchor) | `studyVerse` | `verse--study` | The one verse the study panes follow. Click toggles it. |
| Passage range | `selectionEndVerse` | `verse--in-range` | Shift-clicked extension of the anchor. Copy-only. |
| Preview | `previewVerse` / `previewVerseEnd` | `verse--preview` | Transient target of a link, search result, or cross-reference. Cleared on navigation. |

**Shift-click** extends the selection from the anchor out to the clicked verse
(`bibleStore.extendSelectionTo`). Only one verse can be truly selected — the
anchor does not move, so the study panes keep showing what the reader chose, and
no commentary reload is triggered. The extension renders as a washed-out version
of the anchor's own highlight, deliberately the same colour family: these verses
are the same kind of thing as the anchor, just not the one being studied.

**A typed range produces the same pair.** `navigateTo(book, chapter, verse,
{ endVerse })` sets the anchor and `selectionEndVerse` together, so
"John 3:16-18" entered in the header, the reference box or the book picker
highlights and copies exactly as a shift-click would. See
[Navigation & Layout → Reference parsing and verse ranges](navigation-layout.md).

`selectionEndVerse` may sit on either side of the anchor — shift-clicking
upwards is allowed — so anything consuming it must order the pair.
`bibleStore.getSelectedRange()` returns it ordered low-to-high. A plain click,
chapter navigation, or `goBack` clears it.

Ctrl+C then Enter copies the whole range: `CopyDialog` prefills its reference
input from the ordered pair. See [Copy & Export](copy-export.md).

**Text selection still works.** Shift-click calls `preventDefault()` on
*mousedown* in `VerseRenderer`, because the browser would otherwise extend the
native text selection across verses — which fights the range highlight visually
and, worse, leaves `window.getSelection()` non-empty, so Ctrl+C would run a
native text copy instead of opening the dialog. Plain clicks and drags are left
completely alone, so selecting a phrase and copying just that is unchanged.

## Changing the open passage

Deliberately reachable several ways, because it is the single most common thing
a reader does:

- the chapter heading (`BibleContent`),
- the inline reference box,
- the header search/reference field,
- **double-clicking the tab** (`SortableTab`'s `onDblClick` → `BibleTabBar`'s
  `editingTabId` → a `BookChapterPicker` bound to that tab), which is what a
  tab's own label looks like it should do.

When the picker is opened this way it is passed `moduleAbbr` and
`onChangeTranslation`, so it prints the translation the passage will open in and
offers a **Select Translation** link. That link opens the same
`TranslationDialog` the toolbar's version button uses — extracted from
`BibleToolbar` rather than duplicated. The picker's Escape handler stands down
while that dialog is up, or one keypress would close the dialog *and* step the
picker back a level.

`TranslationDialog` is a **single**-select: the list is a `role="radiogroup"`,
each row a `role="radio"` with `aria-checked`, and the glyph is a radio
(`fa-circle-dot` / `fa-circle`) under a `module-card--single` modifier. It wears
the same `.module-dialog` / `.module-card` clothes as the genuinely multi-select
`common/ModuleSelectDialog`, which keeps its checkboxes — so the shared
`.module-card__check` rule in `_module-dialog.scss` must stay shared, and
anything specific to the single-select belongs on the modifier.

## Recent passages

`BibleToolbar` renders a clock button between the back arrow and the version
selector, listing the active tab's history newest-first with the current entry
marked. Backed by `bibleStore.getHistory()` / `getHistoryIndex()` /
`goToHistoryEntry(index)`.

**There is no forward button** (and no `bibleStore.goForward`). Back is the
common gesture; everything else is reachable from this menu, which says where it
is going by name rather than leaving the reader to guess. Entries ahead of the
cursor stay in the list after a Back until a new visit branches off them.

Entries are per *passage*, not per click. Three rules keep it that way, all in
the pure reducer `addHistoryEntry` (exported from `bibleStore.ts`, mirroring the
desktop app's `navigationHistory.ts`):

- **Re-visiting a chapter moves its existing entry to the end**, carrying the
  newest verse, instead of adding a second row. John 7 → John 3 → John 7 lists
  two passages, not three. Keyed on (module, book, chapter) — a tab can change
  translation without changing passage.
- **A sequential step modifies the current entry** instead of appending:
  `navigateTo(book, chapter, verse, { replace: true })`, passed explicitly by
  the prev/next chapter buttons (`BibleToolbar`, `ChapterNav`, `BibleContent`),
  the swipe handlers (`BiblePane`, `MobileApp`) and nothing else. A jump — typed
  reference, search result, cross-reference, book picker — appends. It is a flag
  at the call site rather than an adjacency test, because "John 4 after John 3"
  is a page for the chapter buttons and a jump when it was typed.
- **A verse click updates the current entry in place** (`setStudyVerse` →
  `rememberVerseInCurrentEntry`), so the menu names the last verse actually
  visited in a chapter rather than the one it was opened at.

The list is capped at `MAX_HISTORY_ENTRIES` (50), matching what `saveSession`
persists.

The back arrow uses `fa-reply`. It previously used `fa-rotate-left`, which is
the universal *reload* mark and not what the button does.

### Tests

Component tests sit beside each component (`BiblePane.test.tsx`,
`BibleContent.test.tsx`, `BibleTabBar.test.tsx`, `BibleToolbar.test.tsx`,
`BookChapterPicker.test.tsx`, `ChapterNav.test.tsx`, `VerseRenderer.test.tsx`,
`TranslationDialog.test.tsx`, `BackBar.test.tsx`). Store tests live at
`src/stores/bibleStore.history.test.ts`,
`src/stores/bibleStore.passageSelection.test.ts`,
`src/stores/bibleStore.studyVerse.test.ts` and
`src/stores/bibleStore.translationRace.test.ts`.

### Related Features

- [Interlinear & Strong's](interlinear-strongs.md) - Study mode display
- [Commentary](commentary.md) - Auto-syncs when chapter changes
- [Navigation & Layout](navigation-layout.md) - URL hash, history
- [Copy & Export](copy-export.md) - Consumes the passage selection


## Which translation the text is actually in

`moduleAbbr` is updated **synchronously** when the reader picks a translation,
because the selector has to respond to the click. The verses arrive later. So
`moduleAbbr` alone cannot answer "is the text on screen this translation's?",
and two things went wrong because it was treated as though it could:

1. **Out-of-order loads.** A tab is a shared mutable object and every loader
   wrote `tab.verses` after an `await` with nothing identifying which load it
   belonged to, so the last promise to *resolve* won regardless of which was
   asked for last. The two are routinely different: `OfflineBibleProvider`
   answers from OPFS in about a millisecond for a downloaded module and from
   the server in about a hundred for one that is not. Clicking a search result
   and changing translation in the same moment therefore left the selector
   saying KJV over WEBBE's text.

2. **A failed switch.** `setTabTranslation`'s catch set `loadError` and left
   `verses` alone — but `BibleContent` renders the error only when there are no
   verses to render instead, so a 404 (or being offline) showed the *previous*
   translation under the *new* name with no error at all.

The fixes, all in `bibleStore.ts`:

- `beginLoad(tab)` claims a monotonic `loadSeq` before each
  `bible.getChapter(...)`; `isSupersededLoad(tab, seq)` is checked before
  anything is written back. Applied in `navigateTo`, `navigateToPreview`,
  `setTabTranslation`, `_loadHistoryEntry` and `loadRestoredTabs`.
- `tab.versesModule` records which translation the verses in hand came from.
- The failure path clears `verses` and `versesModule` so the error is what the
  reader sees.
- `saveSession` persists `versesModule` beside the cached verses, and
  `restoreSession` drops cached verses whose module does not match the tab's —
  a cold start renders that cache **without re-fetching**, so a mismatched pair
  would otherwise survive reloads. A session written before the field existed
  is assumed to match, which it did whenever no load was in flight at save time.

Caches keyed by verse id alone had the same blindness and now include the
module: `src/hooks/useVersePopup.tsx` keys its tooltip cache `module:verseId`.

Covered by `src/stores/bibleStore.translationRace.test.ts`.
