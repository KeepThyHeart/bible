# Commentary

**Last verified:** 2026-09-08

Commentary pane with tree navigation, reference auto-linking, multi-commentary support, and per-panel-instance state isolation.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/CommentaryPane.tsx` | Full multi-tab commentary pane (Overview, DraggableTabBar, module selector) |
| `src/ui/components/commentary/CommentarySinglePanel.tsx` | Lightweight single-commentary panel (one module, no tab bar, no overview) |
| `src/ui/components/commentary/CommentaryContentArea.tsx` | Shared: renders entries with loading/error/empty states and prev/next navigation; when empty, renders `CommentaryEmptyVerseGrid` |
| `src/ui/components/commentary/CommentaryEmptyVerseGrid.tsx` | Shared: grid of verse numbers in the current chapter that have commentary entries - shown in the empty state so the user can jump to the nearest match |
| `src/ui/components/commentary/CommentaryEntryView.tsx` | Shared: renders a single entry with Scripture link processing and hover tooltips (Ctrl/Cmd+Click on a reference opens it in a NEW Bible tab; plain click navigates the current tab) |
| `src/ui/components/commentary/CommentaryPassageHeader.tsx` | Shared: verse reference bar with pin toggle and Aa settings button |
| `src/ui/components/commentary/CommentaryVersePreview.tsx` | Shared: verse text preview with prev/next buttons |
| `src/ui/components/commentary/CommentaryPinnedBanner.tsx` | Shared: "Pinned to X" banner with sync button |
| `src/ui/components/commentary/DigestDisclaimer.tsx` | Shared: provenance notice shown above machine-generated commentary text; renders nothing for human-authored modules |
| `src/ui/components/commentary/useModuleProvenance.ts` | Shared: resolves whether a module's text is machine generated (abbreviation first, then the module's own `module_info` metadata), cached per renderer session |
| `src/ui/moduleDescriptions.ts` | Detection rules and English source text for the provenance notice, plus `DIGEST_DISPLAY_NAME` ("Combined Summary") and `isDigestModule()`; mirrors `apps/web/src/moduleDescriptions.ts` |
| `src/ui/components/CommentaryHome.tsx` | Overview tab showing all commentaries for the current verse - a discovery view. Sorting is a select: the default order puts promoted modules first, then modules already open as tabs, then the longest entries; A-Z, longest and shortest are the other options. Ctrl/Cmd+Click on a Scripture link opens the reference in a NEW Bible tab (full pane only). The filter box matches module name *and* abbreviation (`commentaryHome.filterPlaceholder`, with a matching `aria-label` from `commentaryHome.filterLabel`); the heading and the "{filtered} of {total} modules" counter are `commentaryHome.heading` / `commentaryHome.moduleCount` |
| `src/ui/components/CommentaryTreeView.tsx` | Tree view for browsing commentary structure (full pane only) |

### State

| File | Description |
|---|---|
| `src/ui/stores/useCommentaryStore.ts` | Re-export shim only; the implementation lives in `src/ui/stores/commentary/` |
| `src/ui/stores/commentary/useCommentaryStore.ts` | The store itself: per-panel-instance state (`panels: Map<panelId, CommentaryPanelState>`), assembled from the slices below |
| `src/ui/stores/commentary/types.ts` | `CommentaryPanelState`, `CommentaryTab`, `CommentaryEntry(Summary)`, `createDefaultPanelState` |
| `src/ui/stores/commentary/slices/tabSlice.ts` | Open/activate/close/reorder tabs; `openCommentary(..., { activate })` and `tabActivationSeq` |
| `src/ui/stores/commentary/slices/contentSlice.ts` | Entry loading, entry summaries, error/loading flags |
| `src/ui/stores/commentary/slices/navigationSlice.ts` | Verse sync, pinning, prev/next-verse-with-content |
| `src/ui/stores/commentary/slices/sessionSlice.ts` | Session serialize/restore for commentary panels |
| `src/ui/stores/commentary/slices/sharedSlice.ts` | Panel lifecycle and cross-slice shared state |
| `src/ui/stores/commentary/internals/coordinationControllers.ts` | The per-panel `CommentaryCoordinationController` instances (from `@bible/core`), held in a plain `Map` outside Zustand because they are mutable |
| `src/ui/stores/hooks/useCommentaryPanel.ts` | Hook returning per-instance state + bound actions for a given panelId |
| `src/ui/stores/helpers/panelStateHelpers.ts` | Shared utilities for per-panel state management (updatePanelState, etc.) |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/commentaryHandlers.ts` | Channels: `commentary:getAvailableCommentaries`, `commentary:getCommentaryInfo`, `commentary:getEntriesForVerse`, `commentary:getAllEntrySummaries`, `commentary:hasContentForVerse`, `commentary:getNextVerseWithContent`, `commentary:getPreviousVerseWithContent`, `commentary:search`, `commentary:batchRestoreSession` |

### Utilities

| File | Description |
|---|---|
| `src/ui/utils/commentaryLinkProcessor.ts` | Detects and auto-links Bible references in commentary HTML |
| `src/ui/hooks/useScriptureTooltip.ts` | Reusable hook for verse link click navigation + hover tooltip (used by CommentaryEntryView, StudyPane) |

### Architecture

**Dual-mode panels:** Users can add either a full `CommentaryPane` (multi-tab with Overview) or a lightweight `CommentarySinglePanel` (one specific commentary). Both share the same rendering components (`CommentaryEntryView`, `CommentaryPassageHeader`, etc.) so fixes apply everywhere.

**Per-panel state isolation:** Each commentary panel instance (identified by dockview panelId) has its own open tabs, active tab, pin state, verse tracking, etc. Two commentary panels can show different commentaries pinned to different verses simultaneously.

**Open in own panel:** Right-click an internal commentary tab -> "Open in own panel" -> creates a new `CommentarySinglePanel` dockview panel for that commentary module. The tab is removed from the source multi-tab pane.

**Cross-panel sync:** `syncAllPanelsWithVerse()` broadcasts verse changes from BiblePane to all commentary panels. Individual panels can opt out via pin.

**Auto-detect on mount:** When a CommentaryPane mounts, it checks `useBibleStore` for the currently loaded verse and immediately calls `syncWithBibleVerse`. This ensures new commentary panels show content for the already-selected verse rather than starting empty.

**Detached window sync:** Detached commentary panes listen for `verse-changed` IPC events via a ref pattern (`syncWithBibleVerseRef`) to avoid stale closures, and do not gate on the `initialized` flag, so verse updates arrive even before detached state is fully restored.

**Markdown detection:** `CommentaryEntryView` sniffs entry content with `looksLikeMarkdown` (from `src/ui/components/study/markdown.ts`, shared with the Study pane's `StudyRichText`) and runs it through `markdownToHtml` before `reprocessCommentaryLinks`/`sanitizeHtml`. The commentary IPC surface does not carry the module's declared `content_format`, so the format is detected from the text itself. This is what the bundled `SYNTHESIS` digest (`content_format: "markdown"` in its module metadata) needs; rendered raw its entries would reach the reader as literal `====` rules and `**asterisks**`. HTML modules (the majority) are unaffected: `looksLikeMarkdown` errs toward HTML whenever block-level tags are present. `CommentaryHome.tsx`'s `HomeEntryPreview` (the Overview tab) applies the same detection before its own `reprocessCommentaryLinks`/`sanitizeHtml` pass. Note `markdownToHtml` strips a *leading* H1 by default, because synthesis entries open with a title repeating the reference the pane already displays.

**Ctrl/Cmd+Click on Scripture references:** In every commentary content view (`CommentaryEntryView` for full/single panels, `HomeEntryPreview` for the Overview grid), a Ctrl/Cmd modifier on a click of an auto-linked Bible reference opens the reference as a NEW Bible panel via `openPassageInNewPanel`, docked into the primary Bible panel's group. A plain click navigates the existing passage. The interceptor is attached in the capture phase so it runs before `useScriptureTooltip`'s default click handler.

**Empty-verse fallback grid:** When the active commentary has no entry for the current verse, `CommentaryContentArea` renders `CommentaryEmptyVerseGrid` alongside the prev/next/browse controls. The grid enumerates the verse numbers in the current chapter that DO have entries (derived from `entrySummariesByTab`, which `CommentaryPane` lazily loads via `loadEntrySummaries` whenever the entries map is empty). Clicking a verse number calls `navigateToVerse` to jump to the nearest match without leaving the pane. `CommentarySinglePanel` loads its own summaries once through `commentaryAPI.getAllEntrySummaries` and uses the same grid.

**Module picker availability badge:** Opening the commentary selector (`ModuleSelector` via `CommentaryPane`'s "Add Commentary") checks every installed commentary for content at the current verse and shows a "Has content for {reference}" badge, so a user picking among many locally-installed commentaries is not choosing blind. The check is opt-in on `ModuleSelector` - it takes `availabilityLabel`/`availabilityLoading` per `ModuleItem` and renders nothing extra unless a caller supplies them, so Bible/dictionary uses of the same generic picker are unaffected. `CommentaryPane` fires the batch check only when the selector opens (not on every render), caches results per `abbreviation:verseId` so re-opening the selector or re-checking the same verse is free, and caps the batch at 12 modules (`MAX_AVAILABILITY_CHECKS`) so a large local commentary set cannot fire an unbounded burst of synchronous main-process (better-sqlite3) queries - modules beyond the cap simply show no badge and no spinner rather than a spinner that never resolves. A per-check token guards against a slower, superseded check (the verse changed again before the first batch resolved) clobbering newer results, and a failed lookup degrades to "no badge" rather than a misleading one. It reuses the `commentary:hasContentForVerse` IPC handler.

**AI-generated content disclosure:** The AI-synthesized `SYNTHESIS` commentary is optional content: it is never the default (`DEFAULT_COMMENTARY_PREFERENCE` in `src/ui/constants.ts` prefers the human-authored Gill, then MHC), and neither `npm run init` nor the module catalog installs it. Wherever it is installed, every surface that shows its text says where it came from. `DigestDisclaimer` renders a `role="note"` provenance banner above the text, and the entry container points back at it with `aria-describedby` so screen readers reach the notice first. Detection is two-stage (`useModuleProvenance`): the known digest abbreviation answers synchronously so the notice is on screen in the first paint, and any *other* module whose `module_info.author` / `copyright` / `description` / `full_name` declares itself generated is caught from that metadata without a code change. Collapsing is session-scoped only - it is never persisted, and the collapsed chip still names the provenance. Covered surfaces: the docked commentary pane, the popped-out commentary window, `CommentarySinglePanel`, the Overview grid (badge in the module row plus the full notice inside the expanded card), and the Study pane's commentary list and detail view.

### Unit tests

| File | Description |
|---|---|
| `src/ui/components/CommentaryPane.test.tsx` | Overview handoff (`tabActivationSeq`), tab close x, selector wiring |
| `src/ui/components/CommentaryHome.test.tsx` | Overview grid, filter box (name + abbreviation), Ctrl/Cmd+click |
| `src/ui/components/CommentaryTreeView.test.tsx` | Browse tree |
| `src/ui/components/commentary/CommentaryContentArea.test.tsx` | Loading/error/empty states and prev/next |
| `src/ui/components/commentary/CommentaryEmptyVerseGrid.test.tsx` | Verse-number grid derived from entry summaries |
| `src/ui/components/commentary/CommentaryEntryView.test.tsx` | Link processing, markdown sniffing, Ctrl/Cmd+click |
| `src/ui/components/commentary/CommentaryPinnedBanner.test.tsx` | Pin banner + sync |
| `src/ui/components/commentary/DigestDisclaimer.test.tsx` | Provenance notice, collapse behavior |
| `src/ui/moduleDescriptions.test.ts` | Digest detection rules, `DIGEST_DISPLAY_NAME`, provenance source text |
| `src/ui/components/study/VerseLinksDisplay.digest.test.tsx` | Study Mode's "Commentaries:" chips show the digest's display name, never `SYNTHESIS` |
| `src/ui/stores/useCommentaryStore.test.ts` | Store behavior through the shim |
| `src/ui/stores/commentary/slices/sessionSlice.test.ts` | Session serialize/restore |
| `src/ui/stores/commentary/slices/sharedSlice.test.ts` | Panel lifecycle |
| `src/ui/utils/commentaryLinkProcessor.test.ts` | Renderer-side reference re-linking |
| `packages/core/src/Services/CommentaryLinkProcessor.test.ts` | `buildLinkedReference`, incl. the comma-separated verse-list case below |

### E2E Tests

| File | Description |
|---|---|
| `e2e/tests/commentary.spec.ts` | Commentary loading, display, and interaction tests |
| `e2e/tests/ai-disclaimer.spec.ts` | AI-content disclosure: present for SYNTHESIS, absent for Matthew Henry, survives pop-out, collapses/expands, renders with theme tokens in light/dark/sepia |

## Comma-separated verse lists in auto-linked references

`packages/core/src/Services/CommentaryLinkProcessor.ts` - `buildLinkedReference`.

A commentary module can store a partially-linked reference such as `<a ...>Rom 2:5</a>,6,11`, where the anchor covers only the first verse and the continuation verses trail after it as bare text. Pattern 1 hands `buildLinkedReference` the whole match as `originalText` (`"Rom 2:5,6,11"`), and each verse in the list is emitted as its own anchor by a loop.

Segment 0 therefore takes only the prefix of `originalText` that precedes the verse list (the book name and chapter), so no segment repeats the ones after it and the first anchor spans only its own verse. The split keeps its separators, so `"Jeremiah 7:16, 14:11"` comes back with the spacing the source had rather than normalised to a bare comma.

The cases in `CommentaryLinkProcessor.test.ts` assert the **visible text** and the per-anchor targets (`textOf` / `linksIn` helpers), not merely that the right verse IDs appear somewhere in the HTML.

## What the pane opens on

`CommentaryPane` keeps "am I showing Overview?" in component state (`overviewActive`, default `true`), because Overview is not one of the store's tabs. Intent about when to give that up is explicit rather than inferred from the tab count:

- `openCommentary(panelId, abbreviation, name, { activate })` - `activate` defaults to `true`. With `activate: false` the tab is appended and nothing else moves: `activeTabIndex` stays put and no sequence is bumped.
- `CommentaryPanelState.tabActivationSeq` counts tabs brought forward *because someone asked* - `openCommentary` with `activate: true`, and every `setActiveTab`. The pane watches that, not the tab count.
- `AppInitService.runDefaultInit` opens a default commentary on first launch, after the pane has mounted, and passes `{ activate: false }`: it is populating the pane, not deciding what is on screen. A new user therefore meets the Overview list of everything covering the verse.

The digest tab is labelled **"Combined Summary"** (`DIGEST_DISPLAY_NAME`), never its database name `SYNTHESIS` - so a tab cannot be found by abbreviation. `e2e/tests/ai-disclaimer.spec.ts` keeps a small `TAB_LABELS` map for this.

**`SYNTHESIS` is never user-facing copy.** `isDigestModule(abbr)` guards every place the abbreviation could reach a reader:

- `study/VerseLinksDisplay.tsx` - the "Commentaries:" chips in the Bible pane's Study Mode.
- `CommentaryPane.tsx`'s **Add Commentary** list. `ModuleSelector` renders `module.abbreviation` as each row's secondary line, so the guard is at the call site - the generic selector has no business knowing about one module. That makes `ModuleItem.abbreviation` display text; `ModuleItem.id` is the identity, and this call site's `onSelect`/`onRemove` act on `id`.
- `CommentaryTreeView.tsx` - the "Browse {abbreviation} Commentary" heading, which is prose about the module rather than a reference to its identity.

The `electron-builder*.yml` file lists and `ModuleCard.tsx` (Module Manager, where the real abbreviation is the point) keep the raw string deliberately.

## Closing a commentary

There are two visible ways to drop a commentary, plus the tab context menu's **Close tab**:

- **An x on the tab** (`commentary-tab-close-{tabId}`).
- **An x beside each open module in the Add Commentary list.** `ModuleSelector` takes an opt-in `onRemove`/`removeLabel` pair and renders the x on any row whose `openCount` is above zero. Without it the selector is add-only: an already-open module shows an "open" badge and clicking the row just selects it again. The x is a *sibling* of the row button, not a child - a nested `<button>` is invalid HTML and swallows the outer click.

Both are hidden when only one commentary is open, matching the gate on the context menu's **Close tab**: closing the last one would leave the strip with nothing but Overview.

## Picking a module from the selector, in tests

`ModuleSelector`'s list re-sorts as the per-verse availability check resolves ("has content for this verse" first), so a row located a moment ago is routinely replaced before a click reaches it - and `{ force: true }` makes that worse, not better, because forcing skips the actionability wait that would otherwise catch the swap. Filter, then press **Enter**: `handleKeyDown` reads the current list.

Note also that `ModuleSelector` in `embedded` mode (the Books/Dictionary picker, `BookPane/BookModuleSelectorModal.tsx`) renders no `data-testid="module-selector"` wrapper - reach it through the modal's `role="dialog"` instead.
