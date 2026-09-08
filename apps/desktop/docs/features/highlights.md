# Highlights

**Last verified:** 2026-09-08

Verse highlighting with color selection, floating annotation toolbar, and highlight rendering.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/highlights/HighlightSelector.tsx` | Passthrough wrapper around the verse list. It does no context-menu handling of its own: each verse row calls `stopPropagation()` on its own `onContextMenu`, so an ancestor handler could never fire, and a second copy of the selection -> word-index mapping would only diverge from `capturedSelection.ts` |
| `src/ui/components/highlights/capturedSelection.ts` | The one implementation of "map a DOM Selection to verse/word indices", plus the snapshot taken when a verse context menu opens. Reading `window.getSelection()` *after* a menu click can find it collapsed, which would silently degrade "highlight these 3 words" into "highlight the whole verse" |
| `src/ui/components/highlights/FloatingAnnotationToolbar.tsx` | Toolbar that appears on text selection with highlight/note/copy actions. Portalled to `<body>` and placed *below* the selection, left-aligned to it - see [Bible Pane -> overlays must portal](bible-pane.md). Also holds the "More" escalation and the "Recent" row (below) |
| `src/ui/components/highlights/HighlightMenu.tsx` | Menu for managing existing highlights (change color, remove). Portalled to `<body>` for the same containing-block reason as the toolbar |
| `src/ui/components/highlights/HighlightRenderer.tsx` | `highlightAttrsForWord()` - the single resolver for a word span's classes, inline styles and markup ids - plus the things built on it: `applyHighlightsToVerse()` (HTML string, used by Standard/Reading and Study's plain text), `getVerseHighlightInfo()` and the `HighlightedVerse` component. The JSX renderer in `study/InterlinearDisplay.tsx` calls the same resolver, so the two paths cannot diverge. Stored colours are canonical hex, but `highlights.css` is keyed by the six palette *names*, so classes come from `UserTextMarkup.getColorName()` / `markupColorName()` (`@bible/core`) and a non-palette colour is painted inline |
| `src/ui/components/highlights/UnderlineSwatch.tsx` | One swatch of the underline-colour grid: a bold line in that colour, in the style selected above. SVG rather than `text-decoration` on invisible text, because `wavy` has no CSS border equivalent and a decoration needs a text run to paint over. Strokes `var(--underline-color-<name>)`, the same token `.word.underline-color-<name>` uses (see below) |
| `src/ui/components/highlights/IntegrationExample.tsx` | Example/reference for highlight integration |
| `src/ui/components/highlights/index.ts` | Barrel exports (`HighlightedVerse`, `applyHighlightsToVerse`, `getVerseHighlightInfo`, `HighlightSelector`, `HighlightMenu`, `UnderlineSwatch`, `FloatingAnnotationToolbar`) |
| `src/ui/components/highlights/highlightFlowHarness.tsx` | Shared test harness that mounts the real verse list + hooks in jsdom, used by the flow tests below |
| `src/ui/components/highlights/README.md` | Component-level notes for this folder |

### Hooks

| File | Description |
|---|---|
| `src/ui/hooks/useBibleHighlights.ts` | The apply paths: `handleSelectHighlight` (a fully-specified style, from the full menu or the Recent row), `handleFloatingHighlight` and `handleFloatingUnderline` (the toolbar's one-click actions). Also the read/refresh of a chapter's markup |

### State

| File | Description |
|---|---|
| `src/ui/stores/useHighlightStore.ts` | Zustand store for highlights state, CRUD operations, `lastUsedColor`, plus `recentMarkupStyles` / `recordMarkupStyle` / `clearRecentMarkupStyles` (the Recent row's list, hydrated from localStorage at store creation) |

### Services

| File | Description |
|---|---|
| `src/ui/services/highlightsAPI.ts` | API wrapper for highlights IPC calls |
| `src/ui/services/recentMarkupStyles.ts` | The remembered styles: `normalizeMarkupStyle` / `markupStyleKey` identity, the dedup-and-cap ordering rule (`withRecentMarkupStyle`, `RECENT_MARKUP_STYLES_LIMIT = 3`), and the validated localStorage read/write under `bible-desktop-recent-markup-styles` |

### Utilities

| File | Description |
|---|---|
| `src/ui/utils/highlightHelpers.ts` | Query, grouping, statistics, sorting and export helpers over a set of `UserTextMarkup` rows (`findOverlappingHighlights`, `isWordHighlighted`, `groupByColor`, `getHighlightStats`, `exportToJSON` / `exportToCSV`, and the rest) |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/highlightHandlers.ts` | `highlights:*` channels - `create`, `update`, `delete`, `get-by-id`, `get-for-verse`, `get-for-verse-range`, `get-for-module`, `get-by-color`, `get-by-note`, `find-overlapping`, `count-for-module`, `delete-for-verse`, `delete-for-verse-range` |
| `packages/core/src/Data/Repositories/UserTextMarkupRepository.ts` | The user-DB layer behind those channels; highlights and underlines are rows in `user_text_markup` (interface: `IUserTextMarkupRepository.ts`) |
| `electron/extensions/api-impl/highlightsApiImpl.ts` | The highlights surface exposed to extensions |

### Styles

| File | Description |
|---|---|
| `src/ui/styles/highlights.css` | Highlight color styles and visual effects, and the `--underline-color-*` tokens |

### Tests

| File | Description |
|---|---|
| `e2e/fixtures/highlight-utils.ts` | The shared Electron gestures and probes both e2e specs use: `setDisplayMode`, `enableInterlinear`, `dragAcross`, `getSelectionInfo`, `getHighlightInfo`, `isVisiblyPainted` |
| `src/ui/components/highlights/floatingAnnotationFlow.test.tsx` | Drag-select -> floating toolbar -> create highlight/underline -> rendered classes, driving the real hooks end to end in jsdom |
| `src/ui/components/highlights/recentStylesFlow.test.tsx` | "More" escalating to the full menu with the selection intact (including after the selection collapses), and the Recent row: ordering, dedup, the three-item cap, one-click re-apply, clearing, and surviving a restart |
| `src/ui/services/recentMarkupStyles.test.ts` | The persistence layer on its own: identity of a style, ordering, and every way a hand-edited or corrupt store can come back |
| `src/ui/components/highlights/contextMenuHighlightFlow.test.tsx` | The other way in: right-click -> "Highlight/Underline" -> colour swatch. Asserts a partial selection stays partial even when the selection collapses before the menu item is clicked |
| `src/ui/components/highlights/HighlightRenderer.test.tsx` | `highlightAttrsForWord` class/style/markup-id derivation, and that `applyHighlightsToVerse` emits exactly what the resolver returns - the guard against the two renderers drifting apart |
| `src/ui/components/highlights/capturedSelection.test.ts` | Element run -> verse/word range mapping, including the `data-word-index-end` preference on the last element |
| `src/ui/components/highlights/HighlightSelector.test.tsx` | The passthrough wrapper's contract (no ancestor context-menu handling) |
| `src/ui/components/highlights/removeFormattingFlow.test.tsx` | Removing an existing mark through the menu |
| `src/ui/utils/highlightHelpers.test.ts` | Colour-name/hex helpers |
| `src/ui/components/study/StudyModeView.highlights.test.tsx` | Study mode's DOM contract with interlinear off **and** on |
| `src/ui/components/study/InterlinearDisplay.test.tsx` | Exact word-index emission and highlight/underline painting inside the interlinear stack |
| `e2e/tests/highlights.spec.ts` | The context menu really opening the highlight menu with real colour swatches, word-boundary expansion (a part-word drag selects whole words), and a highlight surviving navigation away and back - the case `highlight-diagnosis.spec.ts` does not cover, since it reloads instead |
| `e2e/tests/highlight-diagnosis.spec.ts` | Drives Electron with real mouse events in all four renderers (standard / reading / study / study+interlinear) and asserts the highlight's **computed** `background-color` and the underline's **computed** `text-decoration-line`/`-style`/`-color` are actually painted, and that both survive a reload. A class can be applied while no CSS rule matches, which renders invisibly and looks exactly like "highlighting doesn't work". Also covers find-in-page in study+interlinear. Screenshots every step to `e2e/highlight-diag-screenshots/` |

## Display modes

Highlighting works in every display mode, and in Study mode with the interlinear view on or off. Standard, Reading and Study's plain text render verses through `HighlightedVerse`, which emits one `<span class="word" data-word-index=N>` per word inside a `[data-verse-id]` wrapper - the two attributes everything in this feature keys off. Standard and Reading go through `BibleVerseList` directly; Study mode goes through `StudyModeView`, which is wrapped in the same `HighlightSelector`. The interlinear view builds its own JSX spans but honours the identical contract (below). The `[study mode]` case in `e2e/tests/highlight-diagnosis.spec.ts` guards it.

### The interlinear view

Within Study mode, `showInterlinear` swaps the verse text for `InterlinearDisplay`'s per-word stack (original / transliteration / English / Strong's). It emits the same contract as every other renderer: one `<span class="word" data-word-index=N>` per English word, over the same 0-based index space. `interlinear_word.word_position_start` / `word_position_end` index that very sequence. See [`interlinear-study.md`](interlinear-study.md#word-alignment) for the invariant.

This matters because `showInterlinear` defaults to `true` when a tab enters Study mode (`stores/bible/slices/tabSlice.ts`) and every verse in the shipped KJV has interlinear data, so that is the default Study experience.

Practical consequences:

- A highlight created in Standard mode paints on the same words in Study+interlinear, and vice versa. Granularity is per word, not per interlinear cell, so a highlight can start and end inside a multi-word cell.
- Underline needs no separate implementation. It flows through the identical `.word` span contract, so it works in the interlinear view for free.
- A "continuous" wash joins adjacent words within one interlinear cell but deliberately does not bridge two cells - in the stacked layout the next word is in a different column, so there is no space between them to paint.
- If a module's interlinear positions ever contradict its own text, the partition postcondition fails, the verse logs once and falls back to the plain `HighlightedVerse` renderer rather than showing words missing or duplicated.

### Word render attributes

Both renderers resolve a word's appearance through `highlightAttrsForWord(verseId, wordIndex, highlights, context)` in `HighlightRenderer.tsx`. It returns the class list, an optional `React.CSSProperties` for colours the stylesheet cannot express, the comma-joined markup ids, and whether the trailing space belongs inside the span. `applyHighlightsToVerse` serialises that style object back to CSS text; the interlinear JSX path spreads it directly.

Keeping one resolver is deliberate: a renderer with its own rendering path drifts out of step with the rest, and `capturedSelection.ts` exists for the same reason on the selection side.

## Choosing a style: three surfaces, one apply path

There are three ways to put a mark on selected text, and they differ only in how much of the style the user gets to name:

- **The floating toolbar's quick swatches** - four of the six colours (`yellow`, `blue`, `green`, `red`), always a plain highlight; plus a one-click solid underline in the last-used colour.
- **The "Recent" row** under them - the last three *whole* styles actually applied, most recent first, each re-applied in one click. An "x" at the end of the row forgets them.
- **The full `HighlightMenu`** - every colour, the markup type, and the four underline styles. Reached from the verse context menu, or from the toolbar's **"More"** button.

**The underline-colour grid previews the colour, not the mark.** A swatch is a bold line in its own colour, drawn in the style selected above (`UnderlineSwatch.tsx`), with no sample glyph: a sample letter wearing the real `.word.underline-*` classes fills the 40px button with glyph and leaves the 2px rule as the only coloured pixels, so red and orange become a guess. The style row above it keeps its text labels - they name the styles, and the swatches below already show what the chosen one looks like. The six underline colours live in `--underline-color-*` custom properties in `highlights.css` (dark-theme brightening redefines the *token*, not the rules), so the picker and the applied mark cannot drift apart. Covered by the swatch case in `recentStylesFlow.test.tsx`.

`useBibleHighlights.handleSelectHighlight` is the single apply path for a fully-specified style, so both the full menu and the Recent row go through it. It takes its word range from `highlightMenu.selection` when the menu is open and falls back to `floatingToolbar.selection` otherwise - a recents click fires while no menu exists.

### The "More" handoff

The toolbar and the menu are siblings under `BiblePaneOverlays`, so the escalation is arranged there: the toolbar reports its own viewport position, overlays dismisses it and opens `HighlightMenu` at that position **with the toolbar's selection passed through as data**.

Passing the range rather than re-reading `window.getSelection()` is the whole trick. The click that opens the menu collapses the browser selection, and a collapsed selection reads as "nothing selected", which would degrade into "highlight the entire verse". Same root cause as `capturedSelection.ts`; pinned by the collapse case in `recentStylesFlow.test.tsx`.

### What "recent" remembers

A remembered style is the whole mark - markup type, colour, underline style and underline colour - not a colour. "Wavy red underline" and "red highlight" are therefore two entries, which is the point: someone whose habit is a particular underline never sees it among the fixed quick swatches.

Entries are normalised before comparison (`normalizeMarkupStyle`), because the full menu keeps its underline state in local React state even while "Highlight" is selected, so the same visible mark can arrive with and without stray underline fields. Re-using a style promotes it to the front rather than duplicating it; the list is capped at three (`RECENT_MARKUP_STYLES_LIMIT`), which is what fits under a toolbar already as wide as a short phrase selection.

Recording happens on *success* in all three apply paths (`handleFloatingHighlight`, `handleFloatingUnderline`, `handleSelectHighlight`) - a mark that failed to save is not worth offering back.

### Where it is persisted, and why not the session

`localStorage`, one key: `bible-desktop-recent-markup-styles`. It follows `services/copyFormats/passageMarkupPreferences.ts` - best-effort writes, full validation on read, so malformed JSON, a colour that is no longer in the palette, or a `localStorage` that throws (private mode, quota) all degrade to "no recents yet" rather than taking the toolbar down with them.

The session DB is the alternative, and it is the wrong home: this is a per-machine UI convenience, not study state, so putting it in `SessionData` would mean touching a type shared with `@bible/core` and carrying it through every session save for something the user experiences as "the toolbar remembers what I like". `lastUsedColor` is deliberately separate - it is a colour-only value that the Ctrl+Shift+H / Ctrl+U shortcuts read.
