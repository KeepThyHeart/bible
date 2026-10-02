# Presenter

**Last verified:** 8b83839 (2026-09-28)

Drives a projected screen (or several) from the browser. The **Presenter** is a full page at `#/@present` (header TV button); the screen itself is the **viewer** at `/present/v/<code>`. A stripped-down **simple viewer** lives at `/present/solo`.

## Layout

Desktop: three panes with draggable splitters (sizes persist in `layoutPrefs.ts`).

| Pane | What it does |
|---|---|
| **Notes** (left) | Rich-text sermon notes with a Notes / Plan toggle. Recognised items get a small ▶; a green Play marker in the left gutter follows the last item shown. Service menu (save / open notes) in the app bar. |
| **Control** (top right) | Status row (Live state, joined-device count, Go live / End, hamburger menu), transport icons (previous, show/hide eye, next), the command box, search results, Verse / Hymn / Quote pickers. |
| **Preview** (bottom right) | The real viewer in an iframe. Interactive and presenter-only: double-click a word to highlight it. Before Go live it runs on an offline local session. |

The hamburger menu holds screen settings (text size, theme, clicker keys), join code / QR / link, handoff link, "Open simple viewer" and Help.

**Phone (<760px)** is a different layout, not the three panes: a frozen top row (status, transport, Verse / Hymn / Quote buttons; starting one appends it to the plan, shows it and scrolls to it), a drag-reorderable **Plan** list (live item green, per-row menu, highlight chips), and the command bar pinned at the bottom. There is no rich-text editor on phones.

## Notes smart parsing

Nothing is written back into the notes; items are decorations over the text (`src/apps/present/notes/detect.ts`).

- **References**: `John 3:16`, `Rom 8:28-30`, `Ps 23`, optional trailing translation (`John 3:16 ESV`).
- **Continuations**: `v. 18`, `vv. 18-20` attach to the nearest passage above (current or previous section only).
- **Hymns**: a line starting `Hymn` / `Song` (`Hymn 23`, `Hymn: Amazing Grace (verses 1, 2, 5)`, `Song - It Is Well v1-3`). A number matches a hymnal number; otherwise fuzzy title match. **Refrain rule**: if the hymn has a refrain it is sung after each listed verse, unless the list names `R` itself, in which case the order is exactly as written.
- **Quotes**: a `Quote:` line (rest of the block is the body; a last line starting with a dash is the attribution), or blockquote paragraphs.
- **Bold = highlight**: bold words that match text in the current passage become word highlights on that verse (shown as a subtle yellow underline, yellow on hover). Bold inside a quote is part of the quote.
- **Amber items** need a choice (no match, several close matches, a verse the hymn lacks); hover for the reason, click to choose. Pin or unlink a detection to override it.

## Command box (Control pane; `/` or Ctrl+K focuses it)

Exact commands win; anything else is a search. Grammar in `src/present/command/command.ts`.

| Type | Does |
|---|---|
| `John 3:16`, `jn 3 16-18`, `ps 23 esv` | Show a passage (optional translation) |
| `18`, `v18`, `:18`, `18-20` | Verse(s) in the current chapter |
| `h 23`, `hymn amazing grace 1-3,R` | Show a hymn by number or title, optional verse list |
| `.` or `blank` | Toggle blank |
| `clear` / `x` | Clear highlights |
| `?` | Help |
| anything else | Search (results in the Control pane; not available in solo) |

## Keyboard

| Key | Action |
|---|---|
| `/`, Ctrl+K | Focus the command box |
| Right / Down / PageDown, Left / Up / PageUp | Next / previous (clicker keys, if enabled) |
| `.`, `B` | Blank / unblank |
| Ctrl+Enter | Toggle blank |
| Alt+Left / Alt+Right | Previous / next, always on |
| `N` / Shift+`N` | Next / previous plan item |
| `H`, `X` | Reveal next note highlight, clear highlights |
| `?` | Help |

Long-press next/previous on a passage steps by section (`usePresenterShortcuts`).

## Simple viewer (`/present/solo`)

A single-device viewer with no session: the screen plus a subtle translucent command prompt. `/` (or the small always-visible `/` box at the bottom) opens it; it hides itself after a moment. Passage, hymn, verse, blank and clear commands work; search does not. Offered from the Presenter's hamburger menu and the setup card.

## Joining and handoff

Go live creates a session with an 8-character join code (menu shows code, QR and link). Screens open `/present/v/<code>`; phones can follow along at `/present/f/<code>`. The plan and notes are stored on the session, so a reload or another device resumes them. The **handoff** link gives another device control of the same session (it is a secret: copy with care); **Leave** drops this device without ending the session, **End** closes it for everyone.

## Files

| File | Description |
|---|---|
| `src/apps/present/PresenterApp.tsx` | The page: app bar, three-pane grid, splitters |
| `src/apps/present/route.ts` | `#/@present` hash helpers (`openPresenter`, `closePresenter`) |
| `src/apps/present/PhoneLayout.tsx` | Phone layout; rows in `src/apps/present/phone/` |
| `src/apps/present/control/` | Control pane: status row, transport, add row, menu, setup card |
| `src/apps/present/notes/` | Notes pane, editor (`editor/`), detection (`detect.ts`, `hymnMatch.ts`), `notesStore.ts`, services (`services/`) |
| `src/present/command/` | Command grammar, `CommandBox`, search results, hotkey |
| `src/present/solo/` | Simple viewer entry (`SoloApp.tsx`, `localSession.ts`) |
| `src/present/ViewerApp.tsx` | The projection viewer |
| `src/present/protocol.ts`, `src/present/reducer.ts` | Session state, intents (including highlight intents) |
| `src/present/notesApi.ts` | Notes sync with the session |
| `src/components/Present/` | Shared pieces: preview, hymn/quote pickers, help, Study companion strip (`PresentBar`, `PresentHighlightBar`) |
| `src/styles/_present.scss` | Strip, panel and picker styles |
| `e2e/tests/presenter-controller-e2e.spec.ts` | E2E for the Presenter, phone layout and `/present/solo` |
