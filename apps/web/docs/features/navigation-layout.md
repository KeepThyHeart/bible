# Navigation & Layout

**Last verified:** 6e80a84 (2026-09-04)

Header, URL hash routing, history navigation, resizable panes, and keyboard shortcuts.

## Files

### Components

| File | Description |
|---|---|
| `index.html` | App shell: boot splash, error fallback, boot-loop detector, and an inline script that applies the saved theme before anything paints |
| `src/main.tsx` | Boot sequence — provider wiring, active-tab resolution, first `render()`, splash teardown (see "Boot sequence") |
| `src/App.tsx` | Thin router that detects mobile vs desktop (768px breakpoint) and renders the appropriate layout |
| `src/DesktopApp.tsx` | Desktop layout with side-by-side resizable panes, resize handle, right-pane tabs; resolves `paneMode` (see "Right-pane mode") |
| `src/MobileApp.tsx` | Mobile layout with bottom nav, single-pane view switching, auto-hiding header on scroll |
| `src/components/Header.tsx` | Top bar with logo, dual-purpose search/reference input, theme dropdown, settings button |
| `src/components/HomeScreen.tsx` | Home screen with verse of the day and the Read / Search action buttons, shown when Home tab is active |
| `src/components/common/ResizeHandle.tsx` | Draggable divider between Bible pane and right pane (desktop only) |
| `src/components/common/DialogLayer.tsx` | Single mount point for the app-wide overlays (settings, help, feedback, copy, Strong's popup/tooltip, the semantic-search progress overlay), rendered once by both layouts |
| `src/components/common/ContextMenuPopup.tsx` | The right-click menu itself; positioned by `src/hooks/useViewportPosition.ts` |
| `src/components/ErrorBoundary.tsx` | Preact error boundary wrapping the app tree — see [PWA & Offline](pwa-offline.md) |
| `src/components/ConnectionBanner.tsx` | Dismissible banner for transient connection errors (`connectionStore`) |
| `src/components/PullToRefresh.tsx` | Mobile pull-to-refresh wrapper used by `MobileApp` |
| `src/panes/paneRegistry.ts` | Self-registration for right-side panes: the `paneRegistry` singleton takes `PaneRegistration` records (id, label, icon, order, component). Core panes and plugin panes both go through it, so the shell renders whatever is registered |
| `src/utils/apiUrl.ts` | `API_BASE` — origin + Vite's `BASE_URL`, so a sub-path deployment resolves API calls correctly |

### Shared Hooks

| File | Description |
|---|---|
| `src/hooks/useAppShared.ts` | Shared state and logic used by both DesktopApp and MobileApp (strongs, settings, keyboard shortcuts, hash nav) |
| `src/hooks/useContextMenu.ts` | Right-click verse context menu logic shared by both layouts |

### Desktop Layout Structure

```
.app
+-- Header
+-- .main-layout
    +-- .main-layout__bible (resizable, ~60% default)
    |   +-- BiblePane
    +-- ResizeHandle (draggable)
    +-- .main-layout__right-pane (~40% default)
        +-- Right-pane tabs (Commentary / Search)
        +-- Content area
```

### Mobile Layout Structure

```
.app.app--mobile
+-- Header (auto-hides on scroll)
+-- .main-layout
|   +-- HomeScreen OR BiblePane OR SearchResultsPanel OR MobileStudyPane OR MobileCommentaryView (one at a time)
+-- .mobile-nav (bottom tab bar: Home / Search / Study / Cmntry / Read)
    (left-handed mode reverses order: Read / Cmntry / Study / Search / Home)
```

### Mobile Study Pane

| File | Description |
|---|---|
| `src/components/MobileStudyPane/MobileStudyPane.tsx` | Single scrollable page with Cross-refs, Topics, Interlinear sections; Topics browser overlay |
| `src/components/MobileStudyPane/MobileCommentaryView.tsx` | Dedicated Commentary bottom tab — card list / detail with verse header |
| `src/components/MobileStudyPane/StudyHomePage.tsx` | (Legacy) 2×2 icon grid, no longer used in mobile nav |
| `src/components/MobileStudyPane/StudyTabBar.tsx` | (Legacy) Icon tab bar, no longer used in mobile nav |
| `src/components/MobileStudyPane/StudyVerseHeader.tsx` | Verse header with full text, pin, prev/next, history, clickable reference |
| `src/components/MobileStudyPane/VerseHistory.tsx` | Recent cross-chapter verse history dropdown |
| `src/components/MobileStudyPane/MobileCommentary.tsx` | List-based commentary view with star/mute, slide-to-detail view |
| `src/components/MobileStudyPane/MobileDictionary.tsx` | Simplified dictionary with search bar and entry display |

## Boot sequence

`index.html` + `src/main.tsx`. The goal is that the first painted frame is the
finished app, not a shell that fills in pane by pane.

1. An inline script applies the saved theme (`bible-reader-settings` →
   `theme`, mirroring `settingsStore.getResolvedTheme()` for `'auto'`) to
   `data-theme` **before the splash paints**. `settingsStore` only sets the
   attribute once the bundle runs, so without this a dark-theme user got a white
   flash for the whole boot.
2. `#app-loading` is a **sibling** of `#app`, not a child. Nested, Preact's
   `render()` treated it as excess DOM in its container and removed it, so it
   could not outlive the first paint. It is a fixed, full-viewport overlay
   painted in theme colours.
3. `main.tsx` resolves the active tab's chapter (`navigateFromHash`, cached
   session verses, or `navigateTo`) **before** `render()`. This used to run
   after, so a returning user saw the home screen — `showHome` defaults to true
   and `restoreSession` never clears it — painted and then swapped for the Bible
   pane. Each awaited step is wrapped in `withBootTimeout()` (8s) so a hung
   socket cannot strand the user on the spinner; `navigateTo` swallows its own
   errors into `tab.loadError`, so rendering early is always safe.
4. After `render()`, two nested `requestAnimationFrame`s call the
   `hideAppLoading()` global defined in `index.html`, which removes the splash
   once the browser has actually painted that frame.
5. Background work — restored background tabs, plugin activation, cleanup —
   stays after the splash comes down.

The boot-loop detector and `showAppError()` fallback in `index.html` are
unchanged.

**Product name:** "Keep Thy Heart Bible Reader" (short: "Keep Thy Heart"),
sourced from `admin/brand/branding.json` at the repo root (a gitignored
`admin/brand/branding.local.json` beside it overrides individual keys, so a fork
never edits a tracked file). The header wordmark stacks
`app.name` over `app.tagline` ("Bible Reader") in a small, letter-spaced
subtitle, so the full product name reads without claiming a second column of a
header that has none to give. The UI reads them from
`app.name` / `app.tagline` in `src/locales/en/ui.json`; the `<title>`, splash and
error copy in `index.html` are `%BRAND_*%` placeholders substituted at build time
by `brandingPlugin()` in `vite.config.ts`, which also fills the PWA manifest's
name, description and colours from the same file. The service worker's offline
page (`src/sw.ts`) still carries a hardcoded copy that must be updated alongside
it.

## Right-pane mode

`DesktopApp` derives a **`paneMode`** from `commentaryStore.rightPaneMode`
rather than using it directly, and falls back to `'study'` when the stored mode
has no renderable tab (`RENDERABLE_PANE_MODES`: study, commentary, topics,
dictionary — plus `'search'` only while `searchStore.isOpen`). An effect writes
the resolved value back, so a bad id does not survive another reload.

`commentaryStore` refuses to restore a non-renderable mode from the session at
all (exported `RESTORABLE_PANE_MODES`, which deliberately excludes `'search'`).

Why: `'search'` was persisted, but search results are not, so the Search tab
does not exist on a cold start. The pane came back with no active tab and no
content. `pane:show` also lets a plugin put an arbitrary id in
`rightPaneMode`, which had the same effect.

## URL Hash Navigation

- Format: `#/MODULE/BOOK/CHAPTER` or `#/MODULE/BOOK/CHAPTER/VERSE`
- Example: `#/KJV/40/3` for Matthew 3 in KJV
- Bi-directional sync: URL updates on navigation, hash changes trigger navigation

## Reference parsing and verse ranges

Three places parse a typed reference, each with its own `parseReference()`:
`src/components/Header.tsx` (with fuzzy book-name matching),
`src/components/BiblePane/BookChapterPicker.tsx` (with partial book names) and
`src/components/BiblePane/BibleContent.tsx` (the inline reference box).

All three accept a **verse range**: `"John 3:16-18"`, en/em dashes
(`3:16–18`), the bare form in single-chapter books (`"Jude 5-7"` = Jude
1:5-7), and the quick-jump forms (`"16-18"`, `"3:16-18"`) relative to the open
chapter. Header's fuzzy pre-filter had to learn the range tail too, or
`"jonh 3:16-18"` was rejected before the range-aware pattern saw it.
`BookChapterPicker` treats a bare chapter range (`"John 3-5"`) as "land on the
first chapter" — only verses can be selected.

The parsed `endVerse` is passed to `bibleStore.navigateTo(book, chapter, verse,
{ endVerse })`, which sets `studyVerse` (anchor) and `selectionEndVerse` — the
same pair a click-then-shift-click produces, so the range highlight and the copy
dialog pick it up with no further wiring. See
[Bible Pane → Verse selection](bible-pane.md).

Covered by `src/components/Header.parseReference.test.ts` and
`src/stores/bibleStore.passageSelection.test.ts`.

## Scrolling to the selected verse

`navigateTo` now **always** sets `pendingScrollVerse`. When no verse is named it
selects the chapter's first verse and scrolls to it; previously it left the
field null, so a prev/next chapter step kept the previous chapter's scroll
offset and the reader landed mid-chapter. `goBack`/`goForward` follow the same
invariant — a history entry with no stored `scrollTop` selects and scrolls to
the first verse rather than leaving `studyVerse` null.

`BiblePane`'s scroll effect waits for the verse nodes: it defers while the tab
has no verses and while the interlinear is pending, since `BibleContent` renders
the interlinear spinner *instead of* the verses and there is nothing in the DOM
to measure. That second condition comes from
`src/components/BiblePane/interlinearPending.ts`, shared with `BibleContent` — the
pane used to spell it out itself, omitting `studyShowInterlinear`, and the two
copies disagreeing is how the first "John 3:16" landed on the chapter without
scrolling.

The token is **consumed only once the scroll has actually happened** (via
`bibleStore.clearPendingScrollVerse(verseId)`, which notifies just as
`scrollToVerse` does). If the verse element is not in the DOM when the deferred
frames run, `pendingScrollVerse` stays armed and a later render retries; the
effect keys on `verses[0].verse_id` as well as the length, so the *new*
chapter's verses mounting re-runs it. The one case that clears without
scrolling is a token the loaded chapter cannot satisfy (a typed "John 3:99"),
which would otherwise leak into a later render.

Covered by the "pending-verse scroll" block in
`src/components/BiblePane/BiblePane.test.tsx`.

## Verse context menu

`useContextMenu.ts`. Right-clicking a verse opens `ContextMenuPopup`; each item
maps to a right-pane target through the exported **`CONTEXT_MENU_TARGETS`**
table:

| Action | Desktop pane | Mobile view | Loads |
|---|---|---|---|
| Copy Passage... | — (opens the copy dialog) | — | — |
| Study | study | study | `study:load-verse` |

The menu used to carry one item per study target — Cross-References, Topics,
Commentary, Dictionary — and every one of them landed the reader on a pane
still showing the *previously* selected verse: the Topics pane restores its own
saved navigation stack on becoming visible, and Cross-References did not even
reach a cross-references view. They are one **Study** item, on both desktop and
mobile: it selects the right-clicked verse and opens the Study pane, where
cross-references, topics and the rest live as sections.

Order is the whole point of the action, and is asserted in the tests: adopt the
right-clicked verse as the study verse, emit the verse load, *then* show the
pane. The verse load is emitted explicitly rather than left to the `studyVerse`
effect in `useAppShared`, which only fires when the selection *changes* —
right-clicking the already-selected verse would otherwise open an empty pane.

`CONTEXT_MENU_TARGETS` stays a data table for one entry because that ordering,
and the desktop-pane/mobile-view split, is what it encodes.

Covered at three levels: `src/hooks/useContextMenu.test.ts` (the action → event
mapping), `src/stores/paneModes.test.ts` (every target is a renderable pane, and
`pane:show` reaches `rightPaneMode`), and `e2e/tests/ui-e2e.spec.ts` (the
document-level listener is attached and the tab visibly changes).

## History

- Back/forward navigation stack (max 50 entries), per Bible tab
- Entry format: `{ moduleAbbr, book, chapter, verse?, scrollTop?, fromPreview? }`
- A **recent-passages menu** in `BibleToolbar` lists it — see
  [Bible Pane → Recent passages](bible-pane.md)

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `/` | Focus search input and select its contents |
| Ctrl+K (Cmd+K) | Focus search input and select its contents |
| Ctrl+G (Cmd+G) | Focus search input and select its contents (verse jump) |
| Ctrl+C (no selection) | Open copy dialog |
| Enter (copy dialog) | Copy and close |
| ESC | Close any open dialog |

All three focus shortcuts route through `src/utils/focusSearchField.ts`, which
focuses **and selects**. Plain `.focus()` leaves the caret in the middle of the
previous query, so pressing `/` and typing appends to the old search instead of
replacing it — the slash-type-Enter gesture then searches for both queries
concatenated.

`/` is ignored while an `<input>` or `<textarea>` has focus, so it can still be
typed into a field.

**Discoverability:** the shortcut was previously invisible. `Header.tsx` renders
a `<kbd class="header__search-hint">/</kbd>` chip inside the search field,
shown only when the field is empty and hidden on `:focus-within` so it never
crowds what is being typed. It swaps with the clear button, so the two never
contend for the same corner. Clicking the chip focuses the field. The input also
carries a `title` and `aria-keyshortcuts="/ Control+K"`.

## Home screen

- **Verse of the day** renders into a fixed-height slot
  (`.home-screen__votd-slot`, `min-height: 172px`) with a pulsing skeleton card
  while it loads. The old spinner→card swap changed the column's height and
  re-centred the whole screen when the verse arrived. Animations are disabled
  under `prefers-reduced-motion`.
- `bibleStore.getVerseOfTheDay()` memoizes its promise for the session (two
  components ask for it: `HomeScreen` and `BibleContent`'s `VerseOfTheDay`), so
  remounting the home screen resolves instantly instead of flashing the skeleton
  again. A failed fetch clears the cache so a retry is possible.
- The **Search** button opens the search UI and focuses the header field — see
  [Search → Header Integration](search.md).

## Resize

- Bible pane width constrained to 30-80%
- Right pane hidden in Reading display mode, and **re-expanded on any switch
  back to Standard or Study** (`useAppShared`). Only real transitions act, never
  the first effect run — on mount the persisted collapsed state is the user's.
  Leaving it collapsed made the mode switch look half-applied: the study tools
  silently stayed gone, and the only way back was the collapsed pane's own
  narrow toggle.
- Collapsed commentary shows as a narrow bar
