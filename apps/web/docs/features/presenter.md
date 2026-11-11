# Presenter

**Last verified:** 5507718 (2026-11-10)

Drives a projected screen (or several) from the browser. The **Presenter** is a full page at `#/@present`, opened from the app switcher (rail on wide screens, the apps sheet or home-screen apps row on phones; a live dot shows while a session runs); the screen itself is the **viewer** at `/present/v/<code>`. A stripped-down **simple viewer** lives at `/present/solo`.

## Layout

Desktop: three panes with draggable splitters (sizes persist in `layoutPrefs.ts`).

| Pane | What it does |
|---|---|
| **Notes** (left) | Rich-text sermon notes with a Notes / Plan toggle. Each recognised item has a solid ▶ **Show** button before its text (Ctrl/Cmd+click on the linked text also shows it; a plain click edits); a green Play marker in the left gutter follows the last item shown. An empty document shows a placeholder hint. Notes menu (save / open) in the app bar. |
| **Control** (top right) | Status row (Live state, joined-screen count, Go live / End, **Open screen** while live, "..." menu), labelled transport buttons (Back, Hide screen / Show screen, Next), the command box, search results, a **Shown, not in notes** list, Verse / Hymn / Quote pickers. |
| **Preview** (bottom right) | The real viewer in an iframe. Interactive and presenter-only: double-click a word to highlight it. Before Go live it runs on an offline local session. |

The Control "..." menu holds screen settings (text size, theme, clicker keys), join code / QR / link, handoff link, "Open simple viewer" and Reset layout. Help is only the app bar's "?" button.

Going live starts with the screen hidden (hint: "The screen is hidden. Press Show screen when ready."). Anything shown from the command box or a picker that is not already in the notes goes to the **Shown, not in notes** list, each entry with Show and Add to notes. Every picker and search-result row has **Show** and **Add to notes** buttons; clicking a hymn row does not show it.

**Phone (<760px)** is a different layout, not the three panes: a frozen top (an **On screen** card, status, transport, Verse / Hymn / Quote buttons), a drag-reorderable **Plan** list (live item green, per-row menu, highlight chips), and the command bar pinned at the bottom. Anything shown (picker, search result, command bar) is added to the plan automatically; the picker buttons read "Add to list". There is no rich-text editor on phones.

## Notes smart parsing

Nothing is written back into the notes; items are decorations over the text (`src/modules/present/app/notes/detect.ts`).

- **References**: `John 3:16`, `Rom 8:28-30`, `Ps 23`, `Phil 4:6`, `Jn 3.16`, optional trailing translation, plain or in round or square brackets (`John 3:16 ESV`, `John 3:16 (ESV)`). Comma verse lists (`Isaiah 26:3,4`, `Psalm 23:1-3, 6`) are one item; `John 14:1–3; 14:27` gives two.
- **Continuations**: `v. 18`, `vv. 18-20` attach to the nearest passage above (current or previous section only).
- **Hymns**: a line starting `Hymn` / `Song` / `Opening hymn` / `Closing hymn` / `Closing song` (`Hymn 23`, `Hymn: Amazing Grace (verses 1, 2, 5)`, `Song - It Is Well v1-3`); `Opening:`, `Closing:` and `Sing` also work when the library title matches well, and a line that is exactly a hymn title links. A number matches a hymnal number (`Hymn 460` is labelled with the hymn title); otherwise fuzzy title match. **Refrain rule**: if the hymn has a refrain it is sung after each listed verse, unless the list names `R` itself, in which case the order is exactly as written.
- **Quotes**: a `Quote:` line (rest of the block is the body; a last line starting with a dash is the attribution), or blockquote paragraphs.
- **Bold = highlight**: bold words that match text in the current passage become word highlights on that verse (shown as a subtle yellow underline, yellow on hover). Bold inside a quote is part of the quote.
- **Amber items** need a choice (no match, several close matches, a verse the hymn lacks); hover for the reason, click to choose. Pin or unlink a detection to override it.
- **Paste review**: after a paste, a bar above the notes reads "N items found. M lines to check." and lists lines that look like a hymn title or a quotation but were not linked, each with an accept button and Skip.
- **Selection popup**: selecting text offers a small popup to make the selection a verse, hymn or quote item.

## Command box (Control pane; `/` or Ctrl+K focuses it)

Exact commands win; anything else is a search. Placeholder: "Show a verse, hymn or words". Grammar in `src/modules/present/lib/command/command.ts`.

| Type | Does |
|---|---|
| `John 3:16`, `jn 3 16-18`, `ps 23 esv` | Show a passage (optional translation) |
| `18`, `v18`, `:18`, `18-20` | Verse(s) in the current chapter |
| `3:16` | Chapter and verse in the current book |
| `gen 1-2`, `psalm 23:1-3, 6` | Chapter ranges and lists show the first part |
| `next`, `back`, `prev`, `previous` | Step like the transport buttons |
| `h 23`, `hymn amazing grace 1-3,R` | Show a hymn by number or title, optional verse list |
| `.` or `blank` | Toggle blank |
| `clear` / `x` | Clear highlights |
| `?` | Help |
| `"next"`, `?back` | A quoted word or a leading `?` forces a search |
| anything else | Search (results in the Control pane; not available in solo) |

A translation that is not installed falls back to the default with a note. Alt+Enter on a typed verse or hymn adds it to the notes instead of showing it.

## Keyboard

| Key | Action |
|---|---|
| `/`, Ctrl+K | Focus the command box |
| Right / Down / PageDown, Left / Up / PageUp | Next / previous (clicker keys, if enabled) |
| `.`, `B` | Hide / show the screen |
| Ctrl+Enter | Toggle hide / show (in notes: show the item at the cursor) |
| Alt+Enter | In the command box: add the typed verse or hymn to the notes |
| Alt+Left / Alt+Right | Previous / next, always on |
| `N` / Shift+`N` | Next / previous plan item |
| `H`, `X` | Reveal next note highlight, clear highlights |
| `?` | Help |

Long-press next/previous on a passage steps by section (`usePresenterShortcuts`).

## Simple viewer (`/present/solo`)

A single-device viewer with no session: the screen plus a subtle translucent command prompt. `/` (or the small always-visible `/` box at the bottom) opens it; it hides itself after a moment. Passage, hymn, verse, blank and clear commands work; search does not. Offered from the Presenter's Control "..." menu.

## Joining and handoff

Go live creates a session with an 8-character join code (the Control "..." menu shows code, QR and link; **Open screen** in the status row opens the viewer). Screens open `/present/v/<code>`; phones can follow along at `/present/f/<code>`. The plan and notes are stored on the session, so a reload or another device resumes them. The **handoff** link gives another device control of the same session (it is a secret: copy with care); **Leave** drops this device without ending the session, **End** closes it for everyone.

## Files

The Presenter is a feature module (task 0123): turning it off (`localStorage['kth.modules'] = '-present'` in a dev build, `BIBLE_MODULES=-present` for a dev server) removes the app, tile, verse action, Study strip, strings and routes; present links then answer "not available". See `packages/core/docs/features/feature-modules-migration.md`.


| File | Description |
|---|---|
| `src/modules/present/app/PresenterApp.tsx` | The page: app bar, three-pane grid, splitters |
| `src/modules/present/app/PhoneLayout.tsx` | Phone layout; rows in `src/modules/present/app/phone/` |
| `src/modules/present/app/control/` | Control pane: status row, transport, add row, menu; `ShownList.tsx` (the Shown, not in notes list) |
| `src/modules/present/app/notes/` | Notes pane, editor (`editor/`), detection (`detect.ts`, `hymnMatch.ts`), `notesStore.ts`, services (`services/`); `SuggestionBar.tsx` (paste review), `SelectionPopup.tsx` (selection popup) |
| `src/modules/present/lib/command/` | Command grammar, `CommandBox`, search results, hotkey |
| `src/modules/present/lib/solo/` | Simple viewer entry (`SoloApp.tsx`, `localSession.ts`) |
| `src/modules/present/lib/ViewerApp.tsx` | The projection viewer |
| `src/modules/present/lib/protocol.ts`, `src/modules/present/lib/reducer.ts` | Session state, intents (including highlight intents) |
| `src/modules/present/stores/shownStore.ts` | Items shown but not in the notes |
| `src/modules/present/lib/notesApi.ts` | Notes sync with the session |
| `src/modules/present/study/` | Shared pieces: preview, hymn/quote pickers, help, Study companion strip (`PresentBar`, `PresentHighlightBar`) |
| `src/modules/present/present.scss` | Strip, panel and picker styles (loaded with the module code) |
| `src/modules/present/manifest.ts`, `binding.ts`, `module.ts` | The feature module: contributions, lazy loaders + boot probe, activation (Study integration through host slots) |
| `server/modules/present/` | Server half: session, hymn and page routes (a server feature module) |
| `e2e/tests/presenter-controller-e2e.spec.ts` | E2E for the Presenter, phone layout and `/present/solo` |
