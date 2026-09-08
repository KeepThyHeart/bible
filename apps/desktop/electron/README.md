# Electron Main Process: IPC Handler Organization

## Directory Structure

All IPC handlers live in `electron/ipc/`. The read-only/read-write distinction below is carried by the filename, not by the folder.

### Module & reference data (read-only)

Handlers that query **installed module databases** and **shared reference data** - Bibles, commentaries, dictionaries, books, cross-references, topical indexes - plus system-level operations.

- `bibleHandlers.ts` - Bible text queries (verses, chapters)
- `commentaryHandlers.ts` - Commentary entry queries
- `dictionaryHandlers.ts` - Dictionary/lexicon lookups
- `bookHandlers.ts` - Book/reference work section queries
- `crossReferenceHandlers.ts` - Cross-reference lookups
- `topicalIndexHandlers.ts` - Topical index browsing and search
- `searchHandlers.ts` - Combined search across modules (text + semantic)
- `moduleHandlers.ts` - Module installation, repository management, downloads
- `tagGraphHandlers.ts` - Entity/tag graph queries
- `i18nHandlers.ts` - Locale catalog loading

### User data (read-write)

Handlers that manage **user-created content** in the encrypted user database.

- `notesHandlers.ts` - User notes and prayer lists CRUD
- `highlightHandlers.ts` - Verse highlight/markup CRUD
- `collectionHandlers.ts` - Collections and bookmarks CRUD
- `fileNotesHandlers.ts` - File-based notes (`.bn` files) open/save
- `backupHandlers.ts` - User data backup and restore
- `studyHandlers.ts` - Study mode queries (interlinear, verse links, user cross-refs)
- `sessionHandlers.ts` - Study session CRUD (user DB, but treated as system state)

### System & platform

- `extensionHandlers.ts`, `marketplaceHandlers.ts` - Extension lifecycle
- `networkHandlers.ts`, `updateHandlers.ts`, `diagnosticsHandlers.ts`
- `featurePackHandlers.ts` - Optional downloadable content packs

### Infrastructure

- `handler-helper.ts` - The `ipcHandler` registration wrapper and `IpcKnownError`
- `result.ts` - The `Result<T>` envelope and standard error codes
- `allowedChannels.ts` - Preload channel allowlist
- `index.ts` - Central re-exports

---

## Handler Wrapper Function

There is **one** registration helper: `ipcHandler` in `ipc/handler-helper.ts`. See [`ipc/README.md`](./ipc/README.md) for the full contract.

```typescript
import { ipcHandler, IpcKnownError } from './handler-helper';

ipcHandler<[string, number, number], BibleVerse[]>(
  'bible:getChapter',
  (abbreviation, bookNumber, chapter) => {
    const repo = getBibleRepository(abbreviation);
    if (!repo) {
      throw new IpcKnownError('not_found', `Bible not found: ${abbreviation}`);
    }
    return repo.getChapter(bookNumber, chapter);
  }
);
```

It replies with a `Result<T>` envelope: `{ ok: true, value }` on success, or `{ ok: false, error: { code, message } }` on failure. The renderer unwraps it via `unwrap()` from `@/services/ipcResult`.

---

## Channel Naming Convention

Channels follow the pattern `domain:action`:

- **Module data:** `bible:getChapter`, `commentary:getEntriesForVerse`, `dictionary:searchEntries`
- **User data:** `notes:create`, `highlights:get-for-verse`, `collection:add-verse`
- **System:** `search:performSearch`, `session:getAll`, `module:install`

User data channels use kebab-case actions (`get-by-id`) while module data channels use camelCase (`getChapter`). The two styles carry no meaning; match the file you are editing.

---

## Adding a New IPC Handler

1. **Create or extend a handler file** in `electron/ipc/`:

   ```typescript
   import { ipcHandler, IpcKnownError } from './handler-helper';

   export function registerMyHandlers(): void {
     ipcHandler<[number], MyPayload>('myDomain:myAction', async (arg1) => {
       const row = await repo.get(arg1);
       if (!row) throw new IpcKnownError('not_found', `No row ${arg1}`);
       return row;
     });
   }
   ```

2. **Register in `main.ts`:** call `registerMyHandlers()` in the startup sequence alongside the other handler registrations.

3. **Expose in `preload.ts`:** add the channel to the `contextBridge` surface so the renderer can reach it.

4. **Add to `ipc/allowedChannels.ts`:** channels reached through `window.electron.ipcRenderer.invoke()` must be listed there, or the preload will reject them.

5. **Unwrap in the renderer:** call through `unwrap()` so the `Result<T>` envelope is converted back into a value-or-throw.
