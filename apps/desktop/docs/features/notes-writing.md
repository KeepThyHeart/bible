# Notes & Writing

**Last verified:** 2026-09-08

The Writing pane: file-backed `.bn` notes with a rich text editor and a folder browser, plus the separate Prayer pane. (There is no Journal or Documents tab - see "Not implemented".)

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/notes/UserNotesPane.tsx` | Main notes pane container with tab switching, file browser, editor |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesInit.ts` | Mount-time bootstrap for the pane: initialises the notes folder, restores the position this panel was left on (session or pop-out handover), keeps the dockview tab subtitle on the open note's title, and registers the position for both pop-out and the next launch |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesNavigation.ts` | Navigation actions for the pane: folder/note navigation, the breadcrumb pop-out (`handlePopOut`), and `requestRenameCurrentNote` |
| `src/ui/components/notes/UserNotesPane/UserNotesEditorView.tsx` | The editor view's breadcrumb header, rename-title control and pop-out button |
| `src/ui/components/notes/UserNotesPane/UserNotesSidebar.tsx` | The editor's collapsible sidebar: file actions, "Move to...", export buttons |
| `src/ui/components/notes/editor/NoteEditor.tsx` | TipTap rich text editor with extensions (tables, task lists, typography, color) |
| `src/ui/components/notes/editor/NoteViewer.tsx` | Read-only note display |
| `src/ui/components/notes/editor/EditorToolbar.tsx` | Two rows. **Formatting row:** headings, text formatting, font family/size, alignment, subscript/superscript, highlight, blockquote, lists, tables, task lists, colour, image, the print/export menu, word count. **Insert row:** just `+ Bible Passage`, with a visible text label (see "The insert row" and "Getting a note back out" below) |
| `src/ui/components/notes/editor/ToolbarMenu.tsx` | The toolbar's dropdown shell (highlight swatches, text colours, list styles, table actions). Anchors the panel to its trigger with viewport-clamped `position: fixed` so it cannot render off the edge of a narrow pane or be clipped by it (see "Toolbar dropdowns are clamped to the viewport" below) |
| `src/ui/components/notes/editor/VerseReferencePlugin.ts` | ProseMirror plugin that auto-detects Bible verse references in text, with Ctrl/Alt+Click navigation. Holds `{ decorations, ranges }` in plugin state and exposes `getVerseReferenceRanges(state)` - consumers ask it "is there a reference at this position?" instead of digging into DecorationSet internals |
| `src/ui/components/notes/editor/verseReferenceRanges.ts` | Pure doc -> `VerseRefRange[]` scan plus `findRangeContainingPos` / `findRangeEndingAt` / `findRangeAtCaret`. No DOM, no layout - every decision the expansion feature makes lives here so it is unit-testable |
| `src/ui/components/notes/editor/NoteEditorVerseMenu.tsx` | Right-click menu over a `.verse-ref-detected` decoration (Expand to full text..., Go to verse, Open in new panel) **or** over an already-expanded passage (Change format...). Every action is an optional prop and the caller passes only the set that applies - the two cases are mutually exclusive |
| `src/ui/components/PassageDialog.tsx` | **The dialog itself, shared with the Bible pane's "Copy Passage".** One component, three modes: `copy` writes to the clipboard, `insert` writes HTML into the note, `reformat` does the same for a passage already there. Reference box, translation picker, five formats, per-format options, live preview, primary action. See [copy-export.md](copy-export.md) |
| `src/ui/components/CopyOptionsDialog.tsx` | The Bible pane's adapter on to `PassageDialog`, in `copy` mode |
| `src/ui/components/notes/editor/VerseExpandPopover.tsx` | The notes editor's adapter on to it - maps `isReformat` / `promptForReference` / `asBlock` / an expansion id onto the dialog's `mode` and props. Opened by Tab, by "Expand to full text...", by "Change format...", and - with `promptForReference` - by `+ Bible Passage` and the two passage slash commands (see "One passage dialog, four ways in" below) |
| `src/ui/components/notes/editor/usePassageResolver.ts` | Reference parsing, translation choice and debounced fetching, shared by every mode of the dialog. Seeded with `initialVerses` so a caller that already has a passage (Tab, re-format, copy) does not blank and re-fetch. Reports a `PassageResolveStatus` (`empty` / `invalid` / `loading` / `notfound` / `ok` / `error` / `noTranslation`) the dialog renders as a `role="status"` line, plus `isStale` - the box has been edited past what the loaded verses answer to, which is what stops Enter acting on the previous passage mid-debounce |
| `src/ui/components/shared/VerseFormatPicker.tsx` | The picker: one radio per format from `formatCatalog`, in catalog order, each with its number badge, name and description |
| `src/ui/components/PassageMarkupOptionsPanel.tsx` | Shape controls for the selected note-insertion format - reference position, verse-number style, heading level, quote marks, comment placeholders. Renders only the controls that format uses |
| `src/ui/components/notes/editor/VerseExpandTabExtension.ts` | TipTap keymap (`priority: 1000`) binding Tab on a reference to the format picker (or, with `skipFormatMenu`, to a silent expansion). Returns `false` when there is no reference, so Table/ListItem/soft-tab all still work |
| `src/ui/components/notes/editor/VerseExpansionMark.ts` | TipTap mark stamping expanded passages with their id, source reference, format and options, so they can be re-formatted later. Round-trips through saved `.bn` HTML |
| `src/ui/components/notes/editor/verseExpansionRanges.ts` | Pure: `findExpansionRange` (stitches a multi-paragraph expansion back together by id, and works out whether replacing it should span whole blocks) and `getBlockContext` (is the reference alone on its line?) |
| `src/ui/components/VersePreviewTooltip.tsx` | Shared tooltip component showing verse preview on hover (used by NoteEditor and CommentaryPane). Takes a per-consumer `hint` and an optional `onGoToVerse` - see "The preview popup's hint is per-consumer" below |
| `src/ui/components/notes/editor/FontSizeExtension.ts` | Custom TipTap extension for font size via TextStyle mark |
| `src/ui/components/notes/editor/SlashCommands.tsx` | Slash command extension + popup UI: type "/" at start of empty line for command palette (headings, lists, tables, images, passages). "Passage (block)" and "Passage (verse-by-verse)" open the same dialog `+ Bible Passage` does, preselected to `blockquote` and `heading-per-verse` respectively |
| `src/ui/components/notes/NotesBreadcrumb.tsx` | Breadcrumb navigation bar for folder hierarchy |
| `src/ui/components/notes/NotesFolderBrowser.tsx` | File/folder list view with context menus, recent files section. The right-click menu is Open / Rename / Delete / **Move to...** / Reveal in Explorer (see "Moving a note into another folder" below) |
| `src/ui/components/notes/UserNotesPane/UserNotesDialogs.tsx` | Every modal the pane owns, so the pane itself stays layout. One `MoveToFolderDialog` serves both ways in: the sidebar's "move the note I have open" (`showMoveDialog`) and the browser's "move this one" (`moveEntry`) |
| `src/ui/components/notes/UserNotesPane/MoveToFolderDialog.tsx` | The destination list. Shows each folder's full path, indented by depth, with the entry's name in the header when it is moving something other than the open note |
| `src/ui/components/notes/UserNotesPane/hooks/useMoveDialogFolders.ts` | Loads that list - a bounded recursive walk of the notes folder (see "Moving a note into another folder") |
| `src/ui/components/notes/UserNotesPane/hooks/useNoteFileActions.ts` | Save / Save As / Print / Export PDF / Export .docx / Export .md / Open / Reveal. Owns `buildNoteDocumentHtml`, the standalone document printing and PDF export share |
| `src/ui/components/notes/NotesSetupDialog.tsx` | First-run dialog for choosing notes folder location |
| `src/ui/components/notes/NotesErrorBanner.tsx` | Error banner with retry/save-as/export actions |
| `src/ui/components/notes/NewNoteDialog.tsx` | New note dialog with template selection (Blank, Verse Study, Expository, Topical, Devotional) |
| `src/ui/components/notes/tabs/PrayerTab.tsx` | The Prayer pane - a real `PanelContentType` (`prayer`), registered in `PanelContentRenderer` and a singleton in `useLayoutStore`. Loads the prayer lists on mount, so a detached Prayer window has something to show |
| `src/ui/components/notes/prayer/PrayerList.tsx` | Prayer list display |
| `src/ui/components/notes/prayer/PrayerEditor.tsx` | Editor for prayer items |
| `src/ui/components/notes/prayer/PrayerListItem.tsx` | Individual prayer list item |
| `src/ui/components/notes/prayer/PrayerListSelector.tsx` | Selector for switching between prayer lists |
| `src/ui/components/notes/prayer/PrayerListConfigDialog.tsx` | Dialog for configuring prayer list settings |
| `src/ui/components/notes/prayer/ColorSelector.tsx` | Color picker for prayer list categories |
| `src/ui/components/NotePreviewTooltip.tsx` | Tooltip preview when hovering over note references |

### State

| File | Description |
|---|---|
| `src/ui/stores/useNotesStore.ts` | Zustand store for notes state with per-panel-instance support via `panels: Map<string, NotesPanelState>` |
| `src/ui/stores/hooks/useNotesPanel.ts` | React hook that returns per-instance notes state + bound actions for a specific panelId |
| `src/ui/stores/useNoteEditorStore.ts` | Zustand store for editor content, dirty state, auto-save timer |
| `src/ui/stores/usePrayerStore.ts` | Zustand store for prayer lists and prayer note management |
| `src/ui/stores/useFileNotesStore.ts` | Zustand store for file notes settings (notes directory, recent files) **and `panelNavStates`** - where each notes panel was left (view / sidebar sub-tab / folder / open note), keyed by dockview panel id. All three are session-persisted; `setNotesPanelNavState` / `getNotesPanelNavState` / `pruneNotesPanelNavStates` are the imperative wrappers its non-React consumers use |

### Services

| File | Description |
|---|---|
| `src/ui/services/notesAPI.ts` | API wrapper for notes IPC calls |
| `src/ui/services/prayerListsAPI.ts` | API wrapper for prayer list IPC calls |
| `src/ui/services/fileNotesAPI.ts` | API wrapper for file-based .bn notes IPC calls |
| `src/ui/services/verseExpansionService.ts` | `resolveReferenceRange`, `buildInsertHtml`, `expandReference`, `expansionContentHash`, `getActiveTranslation` and `MAX_EXPAND_VERSES` |
| `src/ui/services/copyFormats/passageMarkupPreferences.ts` | Per-format option records, the last-used format id and the skip-the-menu flag |
| `src/ui/services/activeNoteFlush.ts` | `flushActiveNote()` - writes the active `.bn` on quit |
| `src/ui/services/verseFetchCache.ts` | Shared verse cache the hover and caret previews are served from |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/notesHandlers.ts` | IPC handlers for SQLite-based notes CRUD operations |
| `electron/ipc/fileNotesHandlers.ts` | IPC handlers for file-based .bn notes (CRUD, dialogs, verse notes, export to .md/.docx) |
| `electron/services/BibleNotesFileService.ts` | File service for .bn file operations, .bak backups, directory management, verse notes |
| `electron/main.ts` | `renderNoteDocument` plus the `notes:print` and `notes:export-pdf` channels that share it |

### Utilities

| File | Description |
|---|---|
| `src/ui/utils/exportNote.ts` | HTML-to-Markdown converter for note export |
| `src/ui/utils/textEntry.ts` | "Is focus inside a text entry?" - what keeps the format picker's digit shortcuts out of the reference field |

### Unit Tests

| File | Description |
|---|---|
| `src/ui/components/notes/editor/NoteEditor.test.tsx` | Tab-key indent/outdent, the Escape-then-Tab focus-out escape hatch, list/table Tab deferral, and save/load round-trip of the inserted indent |
| `src/ui/components/notes/editor/verseReferenceRanges.test.ts` | Offset arithmetic for reference detection: multiple references per paragraph, block offsets, mark-boundary non-detection, comma-continuation trimming, and the capitalised-word-before-a-numbered-book case |
| `src/ui/components/notes/editor/verseExpandFlow.test.tsx` | Right-click -> format picker -> Insert, driven through the real `NoteEditor`. Includes the keyboard-only path - a digit picks the format by its catalog number and Enter inserts it - which is the second half of "reference, Tab, 2, Enter" (the Tab handoff itself is in `verseExpandTab.test.tsx`, since jsdom will not let a DOM selection move ProseMirror's caret). Also asserts right-click on ordinary prose is left alone, that the format choice persists, and (under "the picker is a centered modal") that it portals out of the pane, keeps Cancel/Insert outside the scrolling region, cancels on Escape and on a backdrop click, and still offers the skip-the-menu checkbox |
| `src/ui/components/notes/editor/verseExpandTab.test.tsx` | Both Tab paths: the default one (claims the key, asks the host to open the picker, touches nothing) and the `skipFormatMenu` one (replace vs. paragraph-below, over-cap and not-found notices, single-undo). Plus fall-through when there is no reference, the container handler's `defaultPrevented` guard, and right-click -> "Change format..." -> Apply - including that it is *not* offered on hover, over ordinary prose, or on an edited passage. The keymap half drives a raw `Editor` because jsdom will not let a DOM selection move ProseMirror's caret. Also pins the **retired-format** case: a note carrying `data-expansion-format="standard"` still opens, shows that format selected and marked as no longer offered, previews it rather than blanking, and keeps it when Apply is pressed without choosing another |
| `src/ui/components/notes/editor/passageInsertUnified.test.tsx` | `+ Bible Passage` through the expansion dialog: the reference field asks first and withholds the formats until it resolves, an unparseable reference says so without fetching, the inserted passage carries the expansion mark, a blockquote insertion writes no quote characters into the text, the verse-by-verse layout offers comment room, the "always use this format" checkbox is absent from this entry point, the translation picker appears only when more than one Bible is installed, and the digit shortcuts stay out of the reference field while it has focus (and work the moment it does not) |
| `packages/core/src/Services/PassageFormat/passageMarkup.test.ts` | The four note-insertion shapes, with and without each option: source paragraphing, numbered verses, heading level, inline quote marks, chapter-carrying labels, comment placeholders (including the localized template and their exclusion from the fingerprint text), escaping, and the plain-text/Markdown renderings |
| `src/ui/services/copyFormats/passageMarkupPreferences.test.ts` | Per-format options round-trip a restart and stay independent of each other; per-field fallback on a bad value; the last-used format and the skip-the-menu flag |
| `src/ui/components/notes/editor/verseExpansionRanges.test.ts` | `findExpansionRange` across single/multi-paragraph and inline-in-a-sentence cases; `getBlockContext`'s alone-on-its-line decision |
| `src/ui/services/verseExpansionService.test.ts` | `resolveReferenceRange` / `buildExpandedHtml` table tests, plus the single-undo contract and the over-cap refusal |
| `src/ui/services/verseCopyService.persistence.test.ts` | Last-used format/options survive a restart, and degrade to defaults on a stale id, malformed JSON, or a throwing localStorage |
| `src/ui/components/VersePreviewTooltip.test.tsx` | The per-consumer `hint`, the "Go to verse" action, and red-letter rendering (formatted html, plain-text fallback, `.no-red-letter` when the setting is off) |
| `src/ui/components/notes/UserNotesPane/UserNotesEditorView.test.tsx` | Breadcrumb rename-title icon hidden (not just disabled) for verse notes; pop-out icon click wiring |
| `src/ui/components/notes/UserNotesPane/UserNotesSidebar.test.tsx` | Sidebar "Rename" action hidden for verse notes; "Move to..." stays available |
| `src/ui/components/notes/NotesFolderBrowser.test.tsx` | The browser's right-click menu: "Move to..." on a note, and not on a folder or inside Verse Notes |
| `src/ui/components/notes/UserNotesPane/hooks/useMoveDialogFolders.test.ts` | The recursive destination list: nested folders reachable, files excluded, the depth cap stopping a symlink loop, an unreadable folder skipped rather than fatal, and no disk access until the dialog opens |
| `src/ui/components/notes/editor/editorExportMenu.test.tsx` | The toolbar export menu: each item routing to its action, the menu closing on choice, all four in one menu, and nothing rendered when the host supplies no actions |
| `src/ui/components/notes/UserNotesPane/hooks/useNoteFileActions.test.ts` | Save-conflict handling and PDF export wiring: a complete sanitized standalone document, a file-safe default name, a reported failure reaching the banner, and a cancelled dialog saying nothing |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesInit.test.ts` | Restoring a remembered position: reopening the note (relative and absolute paths), the missing-file and read-throws fallbacks to the folder then the root, "left in the browser" staying in the browser, the not-yet-set-up case, and the registration rules - no clobbering before the restore resolves, no clearing on unmount, and detached windows restoring from their handover instead of the session map |
| `src/ui/services/AppInitService.test.ts` | First-run commentary defaults, and `restoreFileNotesFromSession`: restoring each panel into the id the layout actually has, pruning ids the layout no longer contains, and keeping every entry when the restored layout has no notes panel at all |
| `src/ui/stores/__tests__/notesPanelSession.test.ts` | The `ui.notesPanels` round trip through a JSON session blob, independence between panels, sessions with no such field, corrupt/half-written entries degrading rather than throwing, the unchanged-re-registration no-op, and pruning against the panel ids in a restored dockview layout |
| `src/ui/components/notes/UserNotesPane/hooks/useNotesNavigation.test.ts` | `handlePopOut` detaches with the correct pane type and payload shape, surfaces errors, and dispatches the dual-edit-guard event; `requestRenameCurrentNote` refuses verse notes |

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/notes.spec.ts` | Notes creation, editing, and interaction tests |

## Behavior Notes

### Tab key in the content editor

The Tab key indents instead of moving focus out of the editor, matching what users expect from any text editor. This is implemented in `NoteEditor.tsx` via a `keydown` handler on the editor's content container (not a TipTap keymap extension, so it's trivial to reason about and unit test in isolation):

- **A Bible reference immediately before the cursor:** claimed first, by `VerseExpandTabExtension` at `priority: 1000` - see "Expanding a verse reference in place" below. It returns `false` when there is no reference at the caret, so everything else in this list is unchanged.
- **Plain text (paragraphs, headings, etc.):** Tab inserts a 4-character run of non-breaking spaces (`SOFT_TAB`) at the cursor and calls `preventDefault()`. Shift+Tab removes one such run immediately before the cursor, if present. A literal U+0009 tab character is not used: default `white-space: normal` collapses it to a single space visually, so it would not render as an indent; non-breaking spaces are ordinary text characters and round-trip through the saved `.bn` HTML content exactly like any other text (verified in `NoteEditor.test.tsx`'s save/reload test).
- **Lists and tables:** the handler defers (does not call `preventDefault`) when the selection is inside a `listItem`, `taskItem`, `tableCell`, or `tableHeader` - TipTap's own built-in Tab bindings (list sink/lift, table next/previous-cell navigation) keep working unchanged.
- **Escape hatch - "Escape, then Tab":** pressing Escape arms a one-shot exception; the very next Tab press is left alone (not trapped), so the browser's default focus-out-of-field behavior runs and a keyboard-only user can leave the field. Any other keypress between Escape and Tab cancels the armed state, so it can't fire unexpectedly later. This is the same convention used by CodeMirror and other code-editor components for accessible tab-trapping. Note that this arms *before* the expansion keymap runs, so Escape-then-Tab leaves the editor even when the caret is sitting on a reference - accessibility wins over convenience.
- **The container handler defers to ProseMirror.** Its first act on a Tab is `if (e.defaultPrevented) return;`. It is a React bubble-phase listener on the wrapper div, so it runs *after* TipTap's own keydown handling, and an expansion fires in a plain paragraph where none of the `isActive('listItem' | 'tableCell' | ...)` checks hold. Without the guard the soft tab would be appended after every expanded passage - into saved `.bn` content.

### Expanding a verse reference in place

Two ways in, both landing on the same picker. **Tab** with the caret immediately after a reference, or **right-click** it and choose "Expand to full text...". The picker asks how the passage should be pasted, previews the answer live, and inserts on Enter - so the common case is "type the reference, Tab, Enter". (The toolbar's `+ Bible Passage` and the passage slash commands open the same picker with a reference field on top - see "One passage dialog, four ways in" below.)

**Five numbered formats.** Four of them are *note-insertion* shapes, which exist because a note has structure a clipboard does not:

| # | Format | Shape |
|---|---|---|
| **1** | **Block quote** *(default)* | The whole passage as one `<blockquote>`, broken only where the source text marks a paragraph |
| **2** | **Numbered quote** | One `<blockquote>`, each verse numbered and on its own line |
| **3** | **Inline quote** | `John 3:16-17 (KJV): "For God so loved the world..."`, inline, so it can be written into a sentence |
| **4** | **Verse headings** | A heading per verse ("Verse 16", level selectable, default H3) with the verse quoted beneath it |
| **5** | **Custom template** | Whatever the user's template says |

Two further ids, `standard` and `combined` (`LEGACY_PASSAGE_FORMAT_IDS`), are **retired**: still renderable, so a note already carrying `data-expansion-format="standard"` keeps its shape and can still be re-formatted, but never offered as a new choice. Re-formatting such a passage shows its format in the picker marked as no longer offered and carrying number `0`, so it cannot be reached by a digit. `remapLegacyFormatId` maps a stored preference on one of them onto the closest offered format (`standard` -> Numbered quote, `combined` -> Inline quote). See [copy-export.md](copy-export.md).

**The numbers are the same numbers everywhere**, because there is one dialog and one ordered list - `@bible/core`'s `PassageFormat/formatCatalog.ts` (`PASSAGE_FORMAT_ORDER`). The badge in front of each name is the key, and a hint line beneath the list says so. Only the first `MAX_FORMAT_SHORTCUT` (9) entries get a digit shortcut; anything past that is still selectable by mouse and arrow key.

**"John 3:16-17, Tab, 2, Enter" is the whole flow.** Tab opens the dialog with the passage already resolved and focus on the selected format *radio* - not a text field - so a digit is live from the moment the dialog appears, and Enter inserts. The digit is claimed only when focus is outside a text entry (`utils/textEntry.ts`), which is what keeps the `+ Bible Passage` reference field typable: "John 3:16" is mostly digits. Copy mode and `+ Bible Passage` focus the reference box instead, because there the passage is what the user came to say.

**Options are remembered per format, not globally.** Someone who quotes with H2 headings and drops the numbers from their inline quotations wants both back; one shared option set would make them re-choose on every switch. Selecting a format therefore loads that format's own record (`passageMarkupPreferences.ts`), and changing an option writes it immediately - dismissing the picker with Escape throws away the insertion, never the settings. The last-used format is remembered too, and pre-selected.

**"Always use this format" turns the asking off.** The picker asks by default because the four shapes are genuinely different documents and the right one changes from line to line. Once someone has settled on one, the checkbox sets `skipFormatMenu` and Tab expands silently in the remembered format. Right-click -> "Expand to full text..." always opens the picker, which is how the asking comes back.

**Tab's placement depends on where the reference sits** (`getBlockContext`):

- **Alone on its own line** - a bare citation. Tab *replaces* it with the passage.
- **Inside a sentence** ("as Paul says in Rom 8:28, we know...") - the sentence has to survive, so the reference is left exactly where it is and the passage is inserted as a new paragraph beneath it. Replacing over it would destroy the sentence.

The keymap decides that synchronously and hands the host a `VerseExpandRequest`; the *fetch* happens in `NoteEditor`, because a keymap cannot await one before deciding whether it is claiming the key.

Tab is a keymap extension at `priority: 1000`, which puts it ahead of `@tiptap/extension-table`'s Tab binding (priority 100) and `ListItem`/`TaskItem`'s (51) - so a reference typed in a table cell expands rather than jumping cells. It returns `false` whenever there is no reference ending at the caret, which is what leaves every other Tab behaviour untouched: ProseMirror carries on to Table, then ListItem, then the container handler's soft tab.

Because a keymap cannot await a fetch before deciding whether to consume the key, Tab claims it **synchronously**. A refusal (`not-found`, `no-translation`, `fetch-failed`, and `too-large` on the silent path) therefore has to be announced or it reads as a dead keypress - that is what the `role="status"` notice is for. On the default path `NoteEditor.handleTabExpandRequest` reports them; on the silent path `onExpandFailed` does.

- **Output goes through the shared format engine** (`@bible/core`'s `PassageFormat`, re-exported through `services/copyFormats`), not a bespoke HTML builder. `buildInsertHtml` in `verseExpansionService` is the single door on to both families: the clipboard formats, which produce newline-separated lines that get wrapped into paragraphs, and `passageMarkup.ts`, which produces a block tree that already knows its own structure. Everything the two share - verse-text extraction, red letters, reference building, the two universal options - is `formatHelpers`, so a passage quoted into a note and the same passage on the clipboard agree. Every entry point goes through it, so the same passage inserted two ways comes out identical.
- **Single-line formats stay inline.** `inline` and `plain` produce one line, which is inserted as inline content so an expansion mid-sentence ("as Paul says in Rom 8:28, we know...") does not tear the sentence into paragraphs. Multi-line formats (a template, or a retired `standard`/`combined` expansion) legitimately become paragraphs.
- **One undo step.** `expandReference` calls `closeHistory(tr)` before `insertContentAt`, so prosemirror-history does not group the expansion with the keystrokes that typed the reference. Without it a single Ctrl+Z eats both the expansion and the tail of the typed reference.
- **Bare chapters mean the whole chapter, and a bare book means the whole book.** `John 3` resolves to 43003001-43003999, `John 3-5` to 43003001-43005999 (with no start verse, the parser's `endVerse` is read as an end *chapter*), and `John` to 43001001-43999999. This is `resolveReferenceRange`, on the Tab/right-click path only: the dialog's reference box does its own arithmetic in `usePassageResolver` and reads a bare `Ps 119` as Psalm 119:1. The `...999` upper bound is the same trick `BibleRepository.getChapter` uses - the fetch is an inclusive `BETWEEN` on the numeric id. Whole-chapter references start at verse 1, not verse 0: verse 0 carries chapter prefaces in some modules, but `Genesis 1:0` computes to 1001000, below the IPC layer's minimum valid verse id of 1001001 (`validateVerseId`), and would throw. A backwards range ("John 3:16-2") collapses to the start verse rather than fetching nothing.
- **`MAX_EXPAND_VERSES` (50)** bounds a *silent* expansion. Over the cap, `expandReference` refuses with `reason: 'too-large'` rather than truncating - which is what stops "always use this format" from dumping all 176 verses of Psalm 119 into a note on one keystroke. The picker has no such cap: it shows the verse count and a warning, and the user is looking at both before they press Insert.
- **Verse-number labels carry the chapter across a chapter boundary.** In a numbered quote of "John 3:35-4:2" a bare `(1)` says nothing about which chapter it came from - the same rule the Advanced copy format uses.
- **Re-detection after expansion is expected.** Most formats re-emit the reference as their first line, so the plugin detects and underlines it again. Right-click -> expand will offer to expand it a second time. That is harmless (and occasionally useful), not a bug.
- **The block-level formats are inserted as blocks.** A `<blockquote>` or an `<h3>` cannot live inside a marked run, so `passageMarkupToHtml` puts the expansion span *inside* each block instead - one span per line, all sharing the expansion id, exactly as a multi-paragraph clipboard format does.

### One passage dialog, four ways in

There is one dialog for putting scripture anywhere: `components/PassageDialog.tsx`, with a `mode` prop. `VerseExpandPopover.tsx` is the notes editor's adapter on to it and `CopyOptionsDialog.tsx` is the Bible pane's. What the mode decides is small and enumerable: which store the format choice is remembered in, whether the primary button says Copy / Insert / Apply, whether the preview shows source text or HTML, and whether committing writes to the clipboard or calls `onInsert`.

The four ways in:

| Entry point | Opens with |
|---|---|
| Tab after a reference | The reference resolved, last-used format preselected |
| Right-click -> "Expand to full text..." | Same, always asking |
| `+ Bible Passage` | `promptForReference`, empty field, preselected to `blockquote` |
| `/` -> "Passage (block)" / "Passage (verse-by-verse)" | `promptForReference`, preselected to `blockquote` / `heading-per-verse` |

(The toolbar button shares `openPassageBlock` with the "Passage (block)" slash command, so the two are the same entry point wearing two labels. Only Tab and right-click use the *last-used* format; the prompt-mode entries each name the shape their label promises.)

`promptForReference` decides only two things: whether the dialog opens holding a passage, and where focus lands. The reference row itself - an input and, when more than one Bible is installed, a translation `<select>` - is present in every mode, so a Tab insertion can have its reference corrected in place and a copy can be re-pointed without reopening. Everything else is shared verbatim, so a toolbar insertion carries the same `verseExpansion` mark, produces byte-identical markup through `passageMarkup.ts`, and is re-formattable afterwards exactly like a Tab one.

- **Formats and the preview are withheld until there is a passage.** Choosing how to lay out nothing is busywork and a preview of nothing reads as a bug, so until the resolver returns verses the body is a single `role="status"` line carrying the resolver's state ("Type a reference...", "Invalid reference", "Loading verses...", "That passage is not in this translation", "Failed to fetch verses", "No Bible translation installed"). Insert is disabled in the same condition.
- **Enter is a no-op while the reference is still resolving.** The dialog commits on Enter, and in prompt mode the first Enter usually lands mid-fetch. The `hasPassage` guard makes that do nothing rather than insert an empty passage; the user presses Enter again once the preview appears.
- **"Always use this format" is not offered here.** The checkbox is about what *Tab* does. Someone who opened the dialog from the toolbar came to make a choice, and someone re-formatting is not making a default.
- **The expansion id is minted when the dialog opens**, in the state that opens it - `newExpansionId()` inline in the JSX would mint a fresh one on every re-render, and the id is what makes the inserted passage re-formattable.
- **The resolver is inert when disabled.** Tab and re-format arrive with verses in hand, so `enabled: false` skips the debounce, the fetch and the module list load entirely.
- **The default translation is what the Bible pane is showing**, via `getActiveTranslation()`, matched case-insensitively against the installed modules so the `<select>` shows the value that was resolved rather than silently falling back to its first option. Failing that, the first installed module; only with none installed does it report `noTranslation`.
- **An empty module list is a real state, not a broken one.** A detached notes window is its own renderer with its own empty store, so the resolver calls `loadAvailableBibles()` rather than concluding nothing is installed.

### Comment placeholders

`heading-per-verse` and `blockquote-numbered` offer a `commentPlaceholders` checkbox ("Room to comment under each verse"). It emits a `{ kind: 'placeholder' }` block under each verse, rendered as `<p><em>[Comments for John 3:16]</em></p>` - the expositor's layout: verse, your comment on it, verse, your comment. Without it a verse-by-verse insertion arrives as an unbroken run of quotations and the writer has to open every gap by hand. It is a property of the format, so Tab gets it too.

- **The placeholder is deliberately *not* wrapped in the expansion mark**, and `passageMarkupToText` filters it out. The mark fingerprints the text it covers so an edited passage stops being offered for re-formatting - and a placeholder exists to be typed over. Counting it would withdraw the re-format offer the moment the writer did the one thing the placeholder asks for.
- **A numbered quote with placeholders breaks into one blockquote per verse**, because the prompt goes *between* the verses. Without placeholders it stays the single blockquote the format is named for.
- **The label names the single verse**, never the whole passage and never carrying the translation: it labels the line above it and it is going to be deleted.
- Only the per-verse formats offer it. There is nothing to put a gap between in a passage rendered as one quotation.

### Block quotes carry no quote characters

`@tailwindcss/typography` sets `quotes` on `blockquote` and hangs an `open-quote` / `close-quote` off its first and last paragraph, which would dress a quoted passage in both the quote bar *and* a pair of curly quotes. The bar already says "this is quoted", and the marks are pure decoration the document does not contain - copy the note back out and they are not there, so what the editor showed would not match what the note holds.

`src/ui/styles/globals.css` resets `quotes: none` on `.prose blockquote` and `content: none` on its first/last paragraph pseudo-elements. Scoped to `.prose` rather than `.note-editor .tiptap`, because the read-only `NoteViewer` uses the same typography classes with no `.note-editor` ancestor.

### The format picker is a modal, not an anchored popover

The picker is a modal, not a popup anchored under the reference. It is a decision the user has to finish before anything happens, and it does not need to sit beside the text it came from - and being a modal is what lets it be the same component the copy dialog is. `fixed inset-0` backdrop, `useFocusTrap`, Escape and click-away to cancel, a pinned header, a single `flex-1 overflow-y-auto` body, and a pinned footer. Cancel and the primary action are *structurally* on screen rather than positioned and hoped for, which is what a regression test can assert (`insert.closest('.overflow-y-auto')` must be null). The "Always use this format" checkbox lives in the pinned footer beside the buttons, so it cannot scroll out of reach either.

Two things are required for the modal to land where it should, and both apply to copy mode as well:

- **`PopupPortal`** (`hooks/usePopupPosition`). A `fixed inset-0` backdrop declared inside a dock pane covers the pane, not the window: dockview's `.dv-dockview { contain: layout }` establishes a containing block for every pane, so `position: fixed` inside one is no longer viewport-relative.
- **`MODAL_Z_INDEX` 9999**, not Tailwind's `z-50`. The notes editor's own fixed chrome (the expand notice) sits at 9998, and a modal must never open underneath one of them.

**Its height is fixed**, `h-[85vh] max-h-[54rem]`, rather than content-driven. The `+ Bible Passage` entry point starts as a single `role="status"` line ("Type a reference..."), so a content-driven dialog would open about three rows tall and grow to full size a 300 ms debounce and a fetch later - moving Insert out from under the pointer at exactly the moment the user reaches for it. Switching format would do a smaller version of the same thing, since every format brings a different number of shape controls and a different-length preview. Sized generously up front, capped at 85vh in a short window, with the body still the only thing that scrolls. The status line is a `flex-1` child of a `min-h-full` column, so while there is nothing to show it fills the reserved space instead of hanging at the top of an empty box.

`VersePreviewTooltip` (the hover and caret verse previews) uses `usePopupPosition`; it is a genuinely anchored popup.

### Changing an expanded passage's format afterwards

Right-clicking a passage that came from an expansion offers **"Change format..."**; choosing it reopens the same picker, pre-selected to the format that passage is currently in, with Insert replaced by **Apply**. Choosing a different format (or toggling red-letter, or changing the heading level) re-renders the passage in place.

The action lives on the right-click menu, where the other passage actions are and where the user has asked for it. `NoteEditor.handleEditorContextMenu` therefore matches `.verse-expansion` as well as `.verse-ref-detected`, and `verseMenu` state carries either a `range` (a detected reference) or an `expansion` - never both. `NoteEditorVerseMenu`'s four actions are all optional props for that reason: the menu serves two mutually-exclusive cases and each passes only its own set.

The shape options travel with the passage, not just the format id: `data-expansion-options` carries `headingLevel`, `verseNumbers`, `referencePosition` and `quoteMarks` alongside the two universal flags, which is what lets an H2-per-verse passage reopen as an H2 one. They are parsed field by field on the way back in - the attribute comes off disk, and a value written by an older build (or by hand) must be dropped rather than trusted; a missing one falls back to that format's default.

This is why expanded content carries the `verseExpansion` **mark** (`VerseExpansionMark.ts`) rather than being inserted as plain content: "re-format this passage" needs to find it, know which reference produced it, and know how it is currently rendered. All three live in the mark's attributes (`data-expansion-id` / `-ref` / `-format` / `-options`).

- **A mark, not a node.** A multi-line format spans several paragraphs; a block node wrapper would change the document's structure and complicate editing inside it. Marks are inline, so one expansion is several marked runs sharing an `expansionId`, stitched back together by `findExpansionRange`.
- **The id must be globally unique, not per-session.** Ids persist inside saved `.bn` files, so a counter that restarts at 1 each launch would collide with ids already in a note. `crypto.randomUUID()` with a timestamp+random fallback.
- **`fillsBlocks` decides the replacement range.** When the marked runs fill their paragraphs completely, the replacement has to span the block boundaries too, or the new paragraphs get nested inside the old one. When the expansion sits inside a sentence, only the marked run is replaced.
- **The extent is re-looked-up at Apply time**, not reused from when the dialog opened - the document can change while it is open.
- **An edited passage is no longer offered for re-formatting.** Expanded text is ordinary editable document content, and a user may well type a parenthetical into the middle of it. Re-formatting replaces the passage wholesale, so silently re-rendering an edited one would destroy their words. The mark records a `contentHash` of the text as inserted (`expansionContentHash`, FNV-1a over the whitespace-stripped plain text); when the passage's current text no longer matches, `findExpansionRange` reports `isEdited` and the menu item is withheld - the right-click is left alone entirely, as if the passage were ordinary prose. Expanding the reference again is still available if the user wants a clean copy. Whitespace is stripped before hashing because the formatted string separates lines with `\n` while the document uses paragraph boundaries - they cannot be compared otherwise. A passage with no recorded hash is treated as pristine, since there is nothing to compare against.
- **Round-trip is the risk to watch.** The mark renders as `<span data-expansion-*>` and parses back from one; DOMPurify preserves `data-*`, so it also survives `NoteViewer`'s read-only sanitising path. Guarded by a save/reload test.
- Malformed `data-expansion-options` (hand-edited or truncated note content) parses to `null` rather than throwing - a corrupt attribute must not stop a note from rendering.

**Numbered books after a capitalised word.** `ReferenceParser.scanText`'s pattern matches `[A-Z][a-z]+\s+\d+`, which also matches an ordinary capitalised word plus a number - and a numbered book's prefix is exactly such a number. In "See 1 John 3:16" the regex first consumes "See 1", so the scan resumes at `match.index + 1` rather than at `lastIndex`, which is what lets it find the real reference that started inside the rejected span. `lastIndex` still increases strictly each iteration, so it cannot loop. Covered in `packages/core`'s `ReferenceParser.test.ts` (including a termination guard) and in `verseReferenceRanges.test.ts`.

### Preview of the reference being typed

While the caret sits on (or immediately after) a detected reference, the editor shows the same `VersePreviewTooltip` the hover path uses, so the user can check which verse Tab would insert. This matters more than it sounds: typing `Jn 3:1` on the way to `Jn 3:16` leaves a *valid* reference under the caret, and Tab would expand John 3:1.

It is anchored **under the reference's own decoration element**, not the caret. The decoration is a real DOM node with a bounding rect, so this needs neither `coordsAtPos` (which returns garbage in jsdom, being layout-dependent) nor a second positioning system alongside `usePopupPosition` - and a popup below the reference cannot obscure the text being typed, which a caret-anchored one can. The element is located with `view.domAtPos`, which walks the DOM-to-document mapping and needs no layout either.

Debounced 250 ms, served from the shared `verseFetchCache` (so it is free once the reference has been hovered), suppressed while the hover tooltip or the expand dialog is open, and cleared on blur.

### The preview popup's hint is per-consumer

`VersePreviewTooltip`'s footer hint is a `hint?: React.ReactNode` prop with no default: omit it and no footer renders. Each of its six call sites passes the string that is true of it, because they do not all handle the same gestures - only the notes *editor* handles both Ctrl+Click and Alt+Click. The Study pane's cross-references, the read-only `NoteViewer`, and `StudyRichText` navigate on a plain click and ignore modifiers entirely; the two commentary surfaces support plain click plus Ctrl+Click.

There is also an `onGoToVerse?` prop that renders an explicit "Go to verse" action in the popup header, so following a reference does not require knowing a modifier convention at all.

### The Writing pane reopens where you left it

Each notes panel's position is a `NotesPanelNavState`, persisted with the session so a half-written sermon note is still open after a restart. Note *content* is never at risk regardless (`flushActiveNote` writes the active `.bn` on quit) - this is about "where I was".

```jsonc
// SessionData.ui.notesPanels
{
  "notes_default": {
    "view": "editor",              // browser | editor
    "sideTab": "recent",           // browse | recent  (optional)
    "currentPath": "Documents/Sermons",
    "currentNotePath": "Documents/Sermons/Romans 8.bn"
  }
}
```

- **Keyed by the real dockview panel id**, never `DEFAULT_PANEL_ID` (`'_default'`). It follows the Bible/Commentary convention of keying on the id the layout actually created; `'_default'` is a fallback key that only exists in detached windows.
- **It lives in Zustand, not in a module-level Map**, because it has to be serialized as well as read imperatively: `useFileNotesStore.getSessionData()` returns it as `notesPanels`, and `useSessionStore.getSessionData()` spreads the whole `fileNotes` blob into `SessionData.ui`. `session_data` is opaque JSON, so no schema migration is involved, and the field is optional on `SessionData` so a session without it still loads.
- **It is not cleared on unmount.** A dockview panel unmounts every time its tab is switched away from or the layout is rebuilt, and the position has to outlive that as well as a quit. Instead `AppInitService` prunes, on restore, every entry whose panel id is not in the restored layout - bounding the map without depending on catching the moment a panel closes. (Pruning is skipped when the restored layout contains no notes panels at all: that is equally consistent with a session predating layout persistence, and throwing the entries away there would lose the position for a pane the default layout is about to recreate.)
- **The registration effect is gated on the restore having run.** It fires on the pane's first commit - before the bootstrap's `await` chain resolves - so without the gate it would write the pane's mount-time defaults (browser view, notes root) straight over the position the restore was about to read. With React StrictMode double-invoking mount effects in development, that race is not theoretical.
- **A missing note is an ordinary outcome, not an error.** The remembered file may have been renamed, moved, deleted, or live on a notes folder that is not there any more. `useNotesInit` falls back to the remembered folder, and thence to the root, logging a `console.warn` and showing nothing: an error banner about a file the user moved on from is a terrible way to open the app.
- **`view` decides whether the editor reopens**, not `currentNotePath` - the path survives a "back to the folder" navigation, so a panel left in the browser comes back in the browser even though it still remembers the last note it had open.
- **Pop-out reads the same state.** The tab context menu's handover payload carries `initialSideTab` alongside `initialView` / `initialCurrentPath` / `initialCurrentNotePath`; the breadcrumb button's carries the other three. A detached window never consults the session map: it is told its position explicitly, and detached panes share the `_default` panel id, so a lookup would be both wrong and cross-contaminating.

### Verse note titles are read-only

Verse notes (`BnFile.type === 'verse_note'`, created via `BibleNotesFileService.createVerseNote`) always derive their title from the linked verse reference (e.g. `"John 3:16"`) and cannot be renamed - unlike every other `BnFile.type` (`document`, `sermon`, `study`, `outline`, `annotation`), which keeps a free-text, user-editable title. This is enforced in two places:

- **UI:** the breadcrumb's rename-title icon (`UserNotesEditorView.tsx`) and the sidebar's "Rename" action (`UserNotesSidebar.tsx`) are both omitted entirely for verse notes (not just disabled) via a `titleEditable` / `currentNote.type !== 'verse_note'` check, so the read-only-ness is visible, not just silently ignored.
- **Logic:** `useNotesNavigation.ts`'s `requestRenameCurrentNote` also refuses verse notes as defense-in-depth, in case something else reaches the handler directly.

### Moving a note into another folder

There are three ways in:

| Where | Moves |
|---|---|
| Editor sidebar -> "Move to..." | The note the editor has open |
| Browser right-click -> "Move to..." | The note that was right-clicked |
| Dragging a note onto a folder row | That note, into that folder |

The browser's context-menu item is the one that is reachable without knowing anything: the sidebar's "Move to..." only exists in the editor view and the editor's sidebar is collapsed by default, and drag-and-drop can only reach a folder that happens to be listed in the folder currently on screen. All three end in the same `MoveToFolderDialog` (for the two menu routes) and the same `handleMoveEntry` -> `fileNotesAPI.renameEntry`.

- **Files only.** Folders are not draggable either. A folder can be dropped into its own subtree, and a flat list of destinations has no way to refuse that - so the offer is not made rather than made and then policed.
- **Not inside Verse Notes.** That tree is arranged by the Bible pane (`Book/Chapter/verse.bn`); moving a note out of it would orphan it from the verse it annotates.
- **One dialog, two subjects.** `UserNotesDialogs` renders a single `MoveToFolderDialog`, opened either by `showMoveDialog` (the open note) or by `moveEntry` (the right-clicked one). They are mutually exclusive by construction - each entry point sets its own state - and the dialog names the entry in its header when it is not the open note, because "Move to folder" with no subject is a question about nothing in particular.

**The destination list is recursive**, so a note can be filed into `Sermons/2026` and not just `Sermons` - subfolders are the entire reason someone opens this dialog. `useMoveDialogFolders` walks the tree depth-first (so each folder is immediately followed by its own children, which is what makes the indented list read as a tree) and is bounded twice over: `MAX_DEPTH` 8 and `MAX_FOLDERS` 300. The notes directory is an ordinary folder on the user's disk - it can contain a symlink loop, or a checked-out repository - and neither should hang the dialog or fire thousands of IPC round-trips. A folder the OS refuses to list is skipped; the rest of the tree is still a valid set of destinations. Nothing touches the disk until the dialog opens.

The browser's context menu offers no export. Exporting a note the user has not opened would mean a second, parallel export flow (read the `.bn` off disk, ask which of four formats, convert) beside the one the editor already has. The live path is the editor's export menu below.

### Getting a note back out: print, PDF, Word, Markdown

All four exports are available from the notes sidebar and, because that sidebar is collapsed by default in the editor view, from one dropdown in the toolbar as well.

**It is in the formatting row, not the insert row.** The insert row exists to give the app's own content action a place of its own (see "The insert row" below); exporting is not inserting, and a second thing on that row dilutes the one signal it carries. The menu sits at the end of the formatting row, beside the image button and before the word count.

**One menu, not four buttons.** A row that already carries nine formatting controls cannot absorb four more and stay readable. The trigger is a printer icon with a caret; the panel is `ToolbarMenu`, so it is clamped to the viewport like every other toolbar dropdown, and choosing an item closes it (these are commands, not toggles).

`EditorToolbar` renders it only when handed a complete `NoteExportActions` - print, PDF, Word, Markdown. A bare `NoteEditor` has no file behind it, and the actions belong to the pane that owns the file, not to the editor; `UserNotesPane` passes the same four handlers the sidebar buttons call, so the two surfaces cannot drift.

**Printing and PDF export share everything but the exit:**

- `useNoteFileActions.buildNoteDocumentHtml` builds the standalone document once - sanitized body, print stylesheet, CSP - so a printout and a PDF of one note are the same page rather than two near-identical ones that drift apart.
- The main process's `renderNoteDocument` (in `main.ts`, beside the print handler) is the shared half of the pipeline: temp file, hidden `BrowserWindow` with JavaScript disabled, `lockDownNavigation`, a re-injected CSP. `notes:print` asks the loaded page to `print()`; `notes:export-pdf` asks it for `printToPDF()` and writes the buffer to the path a save dialog returned. The window and the temp file are disposed in a `finally`, so a cancelled print, a failed write and a page that never loaded all clean up.
- **The save dialog comes first**, mirroring `file-notes:export-markdown` - a cancelled dialog then costs no rendering at all. A cancel answers `{ success: true }`: the user asked for nothing to happen, and nothing happened, which is not an error to report.
- These two channels answer with a plain `{ success, error? }` rather than the `Result<T>` envelope the `file-notes:*` handlers use, because they are registered in `main.ts` beside the window plumbing they need rather than through `ipcHandler`. `fileNotesAPI.exportNotePdf` / `printNote` are typed for that shape.
- The Markdown and Word exports go through `unwrap`, since their channels *do* answer with the `Result<T>` envelope (`ok` / `value` / `error`); their `catch` shows the message.

The PDF label is `userNotesPane.exportPdfLabel` in `locales/en/`. The six draft locales are behind English by hundreds of keys, and a missing key falls back to English at runtime.

### The insert row

The toolbar is two rows, not one. The top row is formatting - everything that restyles text that is already in the document. The second row holds a single labelled text button: `+ Bible Passage`.

Inserting a Bible passage is arguably the single most useful action in a Bible note editor, and an unlabelled icon in a row of formatting toggles reads as another formatting toggle. The visible `+ Bible Passage` text is what makes it findable, and the separate row is what makes "this inserts content" legible as a different *kind* of action.

**It is the only thing on that row on purpose.** Image insertion is a stock editor action - every editor has it, next to the table button - and a user who knows any other editor looks for it in the formatting row, so `+ Image` lives there as an icon button next to the table menu. The insert row exists to give the *app's own* feature a place of its own, which putting anything else beside it dilutes. The export menu is in the formatting row for the same reason: it is not an insertion.

The `+ Bible Passage` label is `editorToolbar.insertPassageLabel` in `locales/en/`; the image button is icon-only and carries `editorToolbar.insertImageTitle` as its title/aria-label.

### Toolbar dropdowns are clamped to the viewport

Every toolbar dropdown renders through `ToolbarMenu`, which measures its trigger and places the panel with `position: fixed`, clamped to the visual viewport on all four sides (and flipped above the trigger when there is no room below). Two things make plain `absolute` positioning unusable here: a panel aligned to its trigger's trailing edge grows outwards and lands at a negative offset when the trigger is near the start of a wrapped toolbar row, and an `absolute` panel is laid out inside the pane, so it is clipped by the pane's own overflow even when there is room for it on screen.

Measurement happens in `useLayoutEffect` (before paint) with the panel rendered `visibility: hidden`, so the first *visible* paint is already correct - there is no flash-and-jump. Natural width has to be measured rather than declared because these panels size to localized text.

### Which translation a passage is inserted from

`usePassageResolver` defaults to the translation the Bible pane is currently showing, resolved through `verseExpansionService.getActiveTranslation()`, and the dialog renders a picker so a note can quote a version other than the one being read (hidden when only one Bible is installed - a one-option select is just clutter). The "no Bible translation" message is reachable only when zero Bible modules are installed.

`getActiveTranslation()` reads `useBibleStore`'s panel map and falls back to the first registered panel, the same way `publishBibleWhenContext` and `storeSync` do. A dockview-hosted Bible pane registers under its own panel id (`'bible_default'`, and further ids for splits); `DEFAULT_PANEL_ID` (`'_default'`) is only the fallback key and is empty in a normal session, so reading it alone would resolve nothing.

The resolver also kicks `loadAvailableBibles()` when the module list is empty: a detached notes window has its own renderer with an empty store, and an unloaded list must not be mistaken for "nothing installed". For the same reason the translation it resolved is kept - rather than discarded for the first installed module - while the list is still empty, and re-normalised against the module list's own casing once that arrives, so the `<select>` shows the value that was resolved instead of silently falling back to its first option.

### The reference hover preview is anchored to the reference, not the pointer

`NoteEditor`'s hover handler positions `VersePreviewTooltip` from the reference element's `getBoundingClientRect()` (`{ x: rect.left, y: rect.bottom }`) with `offsetY={REFERENCE_POPUP_GAP}` (4px), rather than from `e.clientX/clientY` with the hook's 20px pointer offset.

Pointer-anchoring is wrong here twice over. It renders below wherever in the line the cursor happened to be - reliably too low - and it re-renders as the pointer drifts. Worse, 20px below the pointer is a **dead band**: leaving the reference fires `mouseout` and starts the close timer while the pointer still has 20 unowned pixels to cross before the popup's `onMouseEnter` can cancel it, so the popup vanishes on the way to it. The gap is 4px and `HOVER_CLOSE_DELAY_MS` is 220ms - enough to reach it, short enough that a popup left by a passing pointer does not linger. `usePopupPosition` clamps horizontally and flips vertically, so no separate edge handling is needed.

`offsetY` is an optional prop on `VersePreviewTooltip`; omitting it keeps the hook's 20px default, which is what the pointer-anchored call sites use.

### The pop-out control lives at the end of the header, not beside the title

`UserNotesEditorView`'s pop-out button sits at the far end of the breadcrumb header (`ms-auto` against the `flex-1` nav), with the same bordered chrome as the sidebar toggle. It is deliberately not beside the Edit Title pencil: two 14px icons a few pixels apart, one of which renames the note and the other of which tears the pane into a separate window, are routinely misclicked for each other.

## Not implemented

- **A Journal feature.** There is no `journal` `PanelContentType`, no journal tab in the Writing pane, and no way to create a journal panel. Journalling is done as an ordinary `.bn` note, optionally from the "Devotional" template in `NewNoteDialog`.
- **A Documents tab.** Same story: standalone documents are ordinary `.bn` files in the notes folder.
- **The SQLite document/journal note types have no UI.** `useNotesStore.loadDocuments` / `loadJournals`, the `notesAPI.getDocuments` / `getJournals` wrappers and the `notes:get-documents` / `notes:get-journals` IPC channels are all present and functional, but nothing in the Writing pane calls them. The note types themselves are still real elsewhere - `VerseLinksDisplay` renders journal links, and `notesHandlers.ts` maps note types - so the slice is kept rather than unwound.
