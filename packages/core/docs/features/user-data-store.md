# User-data store (desktop and web)

One store, one model, on both apps: the generic `user_data_item` table
(`IUserDataRepository`) plus the unified `verse_link` table (`IVerseLinkRepository`).
Features keep their own data in it instead of writing ad-hoc `localStorage` blobs, and
account sync (task 0063) will later sync this one store.

| Platform | Implementation | Where |
|---|---|---|
| Desktop | `UserDataRepository`, `VerseLinkRepository` over `ISql` (better-sqlite3) | `src/Data/Repositories/` |
| Web | `MemoryUserDb` (same interfaces, in memory) persisted to IndexedDB by `WebUserData` | `src/UserData/`, `apps/web/src/userdata/` |

Both pass one contract suite, `src/__tests__/contracts/userDataContract.ts`, run by
`userDataContract.test.ts` (SQLite and memory) and `apps/web/src/userdata/WebUserData.test.ts`
(IndexedDB, on `fake-indexeddb`). A new implementation is done when it passes the suite.

## Files

| File | Purpose |
|---|---|
| `src/UserData/MemoryUserDb.ts` | Both repositories over in-memory tables. Emits a `UserDataChange` for every write (`subscribe`), takes loads and remote changes without emitting (`load`, `applyRemote`), keeps ids and dates like SQLite. Browser-safe. |
| `src/UserData/UserDataBackup.ts` | `exportUserData` (`.zip`, or `.bbk` with a password) and `importUserData` (merge or replace) in backup format v1. |
| `src/UserData/LocalStorageMigration.ts` | `migrateLocalStorage`: one-shot, crash-safe copy of legacy `localStorage` keys into the store. |
| `apps/web/src/userdata/WebUserData.ts` | IndexedDB write-through, multi-tab sync, id blocks, persistence request, memory-only fallback. |
| `apps/web/src/userdata/userData.ts` | The app's single instance: `getUserData()`. |
| `apps/web/src/userdata/backupFiles.ts` | `downloadBackup()` and `restoreBackupFile()` (browser file plumbing, no UI). |
| `apps/web/src/stores/studyHistoryStorage.ts` | The first migrated feature (Study verse history); the worked example below. |

All of `src/UserData` is in the `@bible/core/browser` barrel as the `UserData` namespace.

## Registering a collection (a checklist for a feature)

1. **Pick the owner.** `appOwner('<feature>')` gives `app:<feature>`. Use a lowercase,
   hyphenated feature name and keep it forever: it is part of the stored data, of
   backups and of sync. Extensions and modules use their own uuid as owner; the app never
   writes under those.
2. **Name the collections and keys** in a comment at the top of the feature's storage file
   (owner, collection, itemKey, value shape), as `studyHistoryStorage.ts` does. Keys are
   free text; use the natural id (a verse id, a preset id), not an array index.
3. **Store JSON** (`UserDataItem.json(...)`) unless the value is a single string, int or
   bool. Version a payload by adding optional fields; never rename a field in place.
4. **Anchor to scripture with `verse_link`**, not with columns in the value:
   `source_type: 'user_data_item'`, `source_id: item.itemId`. Overwriting an item keeps its
   `itemId`, so links survive; **removing an item does not remove its links**, so the feature
   removes them (`links.deleteForSource('user_data_item', id)`).
5. **Migrate old data** with `migrateLocalStorage` if the feature had a `localStorage` key
   (see below). Never delete the legacy key yourself.
6. **Do not put secrets** here. The store is backed up and will sync.
7. Reads are synchronous once `getUserData()` has resolved; writes are durable a moment later
   (`await store.flush()` if you must be sure, e.g. before a migration removes an old key).

## Backup registry classification (a checklist for a new user table)

The web store holds only `user_data_item` and `verse_link`, so features normally need no new
table and nothing here. If you do add a table to the user database (desktop or core schema):

1. Add a `TableSpec` to `USER_TABLES` in `src/Backup/Registry.ts`: columns, `pk`, `autoId`,
   `fks` (including logical pointers such as `verse_link.source_id`), `identity` (how two
   rows are "the same" in a merge) and a `cls`:
   `content` (user's own data, always backed up), `workspace` (layouts and preferences),
   `history` (bulky, opt-in), or add the name to `EXCLUDED_TABLES` (install state, derived
   indexes, secrets, sync bookkeeping).
2. If rows in your table are pointed at by `verse_link`, add the table to the `targets` map of
   `verse_link`'s polymorphic FK so ids are remapped on restore.
3. Add the table to `UserDatabase.sql` (and the desktop DDL); `registry.test.ts` and the
   desktop drift test fail until the DDL and the registry agree.
4. Bump `USER_SCHEMA_VERSION` and add an `upgraders` entry only if you change an existing
   table's shape.
5. If the table must exist on the web too, extend `SnapshotSql`/`importUserData` in
   `UserDataBackup.ts` and `WebUserData` (object store, hydrate, drain); until then the web
   import reports its section under `ignoredSections` rather than dropping it silently.
6. Add a case to `src/__tests__/Backup/` (seed row in `seed.ts`) so replace and merge are exercised.

## Multi-tab behaviour (web)

- Every tab loads the whole store and keeps it in memory. A tab applies other tabs' committed
  changes as they arrive on a `BroadcastChannel`; `onRemoteChange` tells the UI to refresh.
- **Last write wins per key**, as in IndexedDB itself. There is no merge inside a value.
- Ids come from per-tab blocks of 1,000,000 reserved in an IndexedDB transaction, so two tabs
  never issue the same `itemId` or `linkId`. Ids are therefore not dense.
- Known limit: if two tabs create the *same key* in the same instant, the surviving row keeps
  one tab's `itemId`; links the other tab made to its own id are orphaned. Keys that are
  natural ids (a verse id) make this a non-event; do not rely on `itemId` for data that two tabs
  create concurrently.
- Writes that fail (quota, storage cleared) stay queued and retry with the next write;
  `onError` reports them.
- If IndexedDB cannot be opened, `WebUserData.persistent` is `false` and the store works in
  memory for the session.
- `requestPersistence()` asks the browser not to evict the origin's storage. Call it after the
  user has saved something worth keeping.

## Backup and restore

Export writes the same payload a desktop backup has (`user/user_data_item.ndjson`,
`user/verse_link.ndjson`, manifest with SHA-256s), plain (`.zip`) or sealed with a password
(`.bbk`). The desktop restore planner reads a web export (tested), and the web import reads a
desktop backup: it takes the `user_data_item` rows and the `verse_link` rows that hang off them,
and lists every other section in `ignoredSections`. Merge keeps the newer `modified_date` per
key (ties keep the local value) and never duplicates a link; replace empties the store first.
A damaged or wrongly-keyed file is rejected before anything changes.

## Migrating `localStorage`

```ts
await migrateLocalStorage(store.items, localStorage,
  [{ legacyKey: 'old-key', ownerUuid: appOwner('feature'), collection: 'things',
     convert: (raw) => JSON.parse(raw).map((e) => ({ itemKey: String(e.id), payload: e })) }],
  () => store.flush());
```

Absent key: skipped and looked for again next start. Unreadable value: left in place and
reported. Existing items are never overwritten. A marker (`app:userdata` / `migrations` /
`ls:<key>`) is written after the data and before the key is removed, and the key is removed
only after `flush()` resolves.

## Relationship to account sync (0063)

0063 plans a SQLite user database on OPFS and a change tracker over `user_data_item` and
`verse_link`. This store is the interface those sit under: `MemoryUserDb` already emits the
row-level changes a tracker needs, and its rows are in the registry's column names. If 0063
moves the web user DB to sqlite-wasm, `WebUserData` is replaced by a sqlite-backed provider that
passes the same contract suite; features and backups do not change. Web `localStorage`
settings (0087) are not migrated here.
