# Bookmarks & Collections

**Last verified:** 2026-09-09

Verse bookmarking. The UI presents **one flat, manually ordered list**; the collection tree underneath it is in the schema and reachable by extensions, but nothing in the app shows or creates a second collection.

## The shape of the feature

- **One collection.** `CollectionService.getOrCreateDefaultCollection()` returns the single default collection, found by a `metadata.isDefaultBookmarks` flag (`DEFAULT_BOOKMARKS_FLAG`) - not by its display name, so renaming or localizing it does not orphan it. A collection carrying the default name and icon (`Favorites`, `⭐`) but no flag is **adopted** (stamped with the flag, name left alone) rather than duplicated.
- **Saving** happens in the Bible pane: **Add Current Verse** in the toolbar's bookmark menu, **Ctrl+D**, or the verse context menu. A shift-click selection is saved as a passage.
- **The toolbar control opens the list; it does not save.** Returning to a saved place is the frequent errand and saving is the rare one, so the button is a menu button, not a toggle. Its ribbon fills to report the state of the selected verse.
- **Naming is optional.** `pinned_item.title` is null until the user sets one; a null title renders from `reference_text`.
- **Re-pointing.** An existing bookmark can be aimed at a new verse. A named bookmark keeps its name; an unnamed one re-labels itself. This is what makes a named bookmark a movable slot ("Where I'm reading in Romans") rather than a fresh save each time.
- **Manual order.** `sort_order` is what the manager's drag-and-drop writes (and the arrow keys on a row's drag handle, which are the same move without a mouse), and what `getBookmarks()` sorts by.
- **A red ribbon marks a bookmarked verse** in the text, at the opening verse of a passage. The glyph everywhere in the feature is a ribbon rather than a star - a star ranks, a ribbon takes you back - and its colour is a fixed deep red (`BOOKMARK_COLOR`) rather than a theme accent.
- **No notes.** `pinned_item.notes` exists in the schema and in the store, but nothing in the UI reads or writes it: a saved place either says what it is in its name or does not need to, and anything longer is a verse note.

## Files

### State

| File | Description |
|---|---|
| `src/ui/stores/useBookmarkStore.ts` | Zustand store. The **flat slice** - `bookmarks`, `bookmarksLoaded`, `loadBookmarks`, `addBookmark`, `replaceBookmarkRef`, `setBookmarkTitle`, `setBookmarkNotes`, `removeBookmark`, `reorderBookmarks`, `toggleVerseBookmark` - is what the UI uses. `markedVerses()` derives `bookmarkedVerses` - which drives the verse markers, the toolbar ribbon and the context menu's **Remove Bookmark** - marking a passage at its opening verse only. `setBookmarkNotes` has no UI caller. The collection/tree half of the store is the extension-facing API and has no UI |
| `src/ui/services/AppInitService.ts` | Calls `loadBookmarks()` (and `loadCollectionTree()`) at startup, so the verse markers are right on the first chapter drawn |

### Components

| File | Description |
|---|---|
| `src/ui/components/bible/BookmarkMenu.tsx` | The Bible toolbar's bookmark menu. One ribbon button opens it (`data-bookmarked` reports whether the selected verse is saved); inside, **Add Current Verse** / **Remove Bookmark** acts on `selectedVerseId` (plus `selectionEndVerseId` for a passage) and is disabled when nothing is selected, then up to 12 bookmarks (`MAX_DROPDOWN_ITEMS`) to jump to, how many are not shown, and **Manage Bookmarks…**, which dispatches `command:bookmarks:manage` |
| `src/ui/components/ManageBookmarksDialog.tsx` | The manager: flat list, inline rename, remove, and drag-to-reorder from the handle (arrow keys on that handle do the same move, so ordering is not mouse-only). Escape backs out of an inline edit *discarding* the draft - see "Escape cancels" below - before it closes the dialog |
| `src/ui/components/VerseContextMenu.tsx` | **Add to Bookmarks** opens a flyout submenu beside the item (add as new, or pick an existing bookmark to re-point here); hover or click opens it, Escape/ArrowLeft backs out of it, and it flips side or lifts when it would leave the window. **Remove Bookmark** appears only when the verse has one. All of it is opt-in: a host that passes no `onAddBookmark` gets the menu unchanged |
| `src/ui/components/BiblePaneOverlays.tsx` | Wires the context menu's bookmark callbacks to the store. `contextMenuVerseRange()` decides verse-vs-passage from the selection |
| `src/ui/components/BibleVerseList.tsx` | Renders the ribbon beside a bookmarked verse. `renderVerseIndicators()` composes the note indicator and the ribbon, because `HighlightedVerse` takes a single `suffix` |
| `src/ui/components/shared/icons/BookmarkIcon.tsx` | The ribbon glyph and `BOOKMARK_COLOR`, the one deep red every bookmark surface uses |
| `src/ui/components/Sidebar.tsx` | Collapsible "Bookmarks" section rendering `CollectionTree`. **Not mounted** - the toolbar menu and the manager are the bookmark UI |
| `src/ui/components/CollectionTree.tsx` | Tree of collections and pinned items. **Not mounted.** Kept because it is a finished, tested implementation of collection *hierarchy*, which is the obvious next step if folders are ever wanted |

### Hooks / commands

| File | Description |
|---|---|
| `src/ui/hooks/useBibleKeyboard.ts` | **Ctrl+D** toggles the bookmark on the selected verse or passage. Guarded by `isEditableTarget` so a text field keeps its own key |
| `src/ui/commands/bookmarkCommands.ts` | Registers `bookmarks.manage` for the command palette. Deliberately the *only* bookmark command - add/remove is bound to a specific pane and verse, which a palette entry cannot name |
| `src/ui/App.tsx` | Listens for `command:bookmarks:manage` and mounts `ManageBookmarksDialog` |

### Services

| File | Description |
|---|---|
| `src/ui/services/collectionAPI.ts` | IPC wrappers. Flat surface: `getBookmarks`, `bookmarkPassage`, `replaceBookmarkReference`, `renameBookmark`, alongside `quickBookmarkVerse`, `removePinnedItem`, `updatePinnedItem` and `reorderPinnedItems` |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/collectionHandlers.ts` | `collection:*`. Flat bookmark channels: `get-bookmarks`, `bookmark-passage`, `replace-bookmark-reference`, `rename-bookmark`. The tree-shaped channels (`create`, `move`, `get-tree`, ...) are there for extensions |
| `electron/ipc/allowedChannels.ts` | Allow-lists every `collection:*` channel |
| `electron/extensions/api-impl/bookmarksApiImpl.ts` | Bookmarks surface exposed to extensions - the only caller that can create a *collection* |
| `electron/extensions/api-impl/collectionsApiImpl.ts` | `api.collections` - the same `collection` / `pinned_item` rows seen as **ordered lists of passages** (reading plans, outlines). Adds ranges with a label and an explicit position, and reorders. Gated on `bookmarks:read` / `bookmarks:write`, the same grants `bookmarksApiImpl` uses, because they are the same rows |

### Core

| File | Description |
|---|---|
| `packages/core/src/Services/CollectionService.ts` | `getOrCreateDefaultCollection()` (plus the deprecated alias `getOrCreateFavorites()`, which extensions compile against), `getBookmarks()`, `replaceBookmarkReference()`, `renameBookmark()`, the private `isDefaultCollection()` / `findDefaultCollection()` pair, and the `DEFAULT_BOOKMARKS_FLAG` / `LEGACY_DEFAULT_NAME` / `LEGACY_DEFAULT_ICON` constants. `nextSortOrder()` ranks appends at `max+1`. `deleteCollection()` refuses to delete the default collection |
| `packages/core/src/Data/Repositories/CollectionRepository.ts` | User-DB access for `collection` and `pinned_item` (interface: `packages/core/src/Data/Repositories/ICollectionRepository.ts`) |

### Tests

| File | Description |
|---|---|
| `packages/core/src/Services/CollectionService.test.ts` | Default-collection resolution (flag, rename, adoption by name and icon), flat list ordering, re-point title rules, rename trimming/clearing, sort-order after deletion |
| `src/ui/stores/useBookmarkStore.bookmarks.test.ts` | Flat slice: marked-verse derivation, verse-vs-passage routing, toggle, optimistic reorder and its rollback, blank-note clearing |
| `src/ui/components/bible/BookmarkMenu.test.tsx` | That opening the menu saves nothing, saving against the selection, passage selection, removal, disabled save with no selection, dropdown cap and overflow text, navigation, manage event |
| `src/ui/components/ManageBookmarksDialog.test.tsx` | List rendering, rename, no notes editor, remove, handle reordering and its bounds, navigation, Escape-cancels, Escape-with-focus-outside |
| `src/ui/components/VerseContextMenu.test.tsx` | Flyout open on click and on hover, add, replace-target list, Escape backing out one level, and removal only when bookmarked |
| `electron/extensions/__tests__/Collections.test.ts` | `api.collections`: the dense-position invariant after insert-at, insert-past-the-end, remove-from-the-middle, move up and down, and a wholesale reorder; range storage (single verse as end = start); argument validation off the untyped RPC wire; `bookmarks:read` / `bookmarks:write` gating; disposal |
| `e2e/tests/bookmarks.spec.ts` | End to end: saving from the menu, the jump list navigating, naming, keyboard reordering from the drag handle, removal, Escape closing the manager, and re-pointing an existing bookmark |

## Data flow

`BookmarkMenu` / `VerseContextMenu` / **Ctrl+D** -> `useBookmarkStore` -> `collectionAPI` -> `collection:*` IPC -> `CollectionService` -> `CollectionRepository` -> `collection` / `pinned_item` in the user DB. Extensions enter the same chain at `bookmarksApiImpl` (flags on verses) or `collectionsApiImpl` (ordered lists of passages) - two namespaces over one store, because "is this verse saved" and "what is entry 3 of this reading plan" are different questions.

## Gotchas

### Escape cancels an inline edit - and takes focus back

`ManageBookmarksDialog` commits a rename on blur, which is what you want for a click elsewhere. Escape therefore has to say "this blur does not count": `cancelledEditRef` is set before the input unmounts and checked in the commit, so Escape discards the half-typed draft instead of saving it.

The handler is bound to `document`, not to the dialog. A dialog-level `onKeyDown` only sees the keystroke while focus is inside the dialog, and focus is not guaranteed to be there: the manager opens from a toolbar popover that unmounts as it opens, and a click on inert chrome can drop focus to `<body>`. The handler calls `dialogRef.current?.focus()` after cancelling an edit, so the ring stays in the dialog.

In tests, `activateFocusTrap` moves focus on a `requestAnimationFrame`; a click fired before that frame runs gets its inline editor blurred out from under it. `ManageBookmarksDialog.test.tsx` has a `settle()` helper for this.

### The verse marker is not a button

It reports state and nothing more. Every way to change that state is one gesture away already (the toolbar menu, Ctrl+D, the context menu), and a third click target inline with the words - right beside the note indicator, which *does* open something - would be a coin flip as to what it did.

### The bookmark red is not a theme token

`BOOKMARK_COLOR` is one value in every theme, read through `var(--theme-bookmark-rgb, 214 40 40)` so a theme *may* override it. It clears 4:1 on both the light and the dark backgrounds the app ships, and a landmark that changed hue per theme would stop working as a landmark.

### Sort order is `max+1`, not `length`

Ranking an append off the collection's item count collides with an existing rank as soon as anything has been deleted from the middle: three items ranked 0, 1, 2, delete the middle one, and the count is 2 - the rank the last item still holds. `nextSortOrder()` exists for that, and `getBookmarks()` tie-breaks on `pin_id`.

The extension-facing `api.collections` takes the other route and keeps `sort_order` **dense and zero-based** - a collection of n entries occupies exactly 0..n-1 - renumbering the whole collection after every insert, removal and move. It has to: the position a caller reads back is the position it passes to `move`, so a gap makes the number it was handed a lie, and a tie makes two entries read back in whichever order the storage engine feels like.

The two rules agree rather than fight. After a dense renumber `max` is `n-1`, so the app's own `nextSortOrder()` append lands at exactly `n` - the same slot the extension API's append would have chosen - and `getBookmarks()`, which sorts by `sort_order` and tie-breaks on `pin_id`, never sees a tie to break.

## Not implemented

- **Collection hierarchy in the UI.** `collection:create` / `update` / `delete` / `move` / `reorder` exist in IPC and in the store; no UI calls them. Extensions can. If an extension creates a collection, its items do not appear in the bookmarks list - the list is the default collection only.
- **A production bridge for either extension namespace.** `bookmarksApiImpl` and `collectionsApiImpl` are attached only when `ExtensionHost` is given a `bookmarksBridge` / `collectionsBridge`, and `main.ts` supplies neither - it wires the bible, commentary, dictionary, book, command, context, UI, workspace and l10n bridges and stops there. Both namespaces are therefore absent from a real worker today, which is what an extension feature-detecting `typeof api.collections` should see. The in-memory bridges in `api-impl/InMemoryDataBridges.ts` are what the tests drive; a SQL-backed `IExtensionCollectionsBridge` should delegate to `CollectionRepository` (whose statements are all parameterized) rather than write its own, and specifically to `reorderPinnedItems()` for the renumbering described above.
- **Search or filter within bookmarks.** The manager shows the whole list.
- **Bookmarking anything but a verse or passage.** `pinned_item.item_type` allows notes, commentary entries, dictionary entries, book sections and images; only `verse` and `passage` are reachable from the UI.
