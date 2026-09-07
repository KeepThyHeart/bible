# User Data

Everything that reads or writes the per-user database (`user_*.db`): notes,
highlights/underlines, bookmark collections, prayer/note collections, user
cross-references, verse links, and study sessions. This is the user's own
content - separate from module databases so it survives module updates and can
be backed up or synced independently.

## Files

### Repositories

| File | Purpose |
|---|---|
| `src/Data/Repositories/UserNoteRepository.ts` | `user_note` CRUD, hierarchy (`parent_note_id`), verse queries, FTS search via `user_note_fts`, tags, note-type filtering, next/previous-verse-with-content navigation. Owns the note<->verse link load/save. |
| `src/Data/Repositories/IUserNoteRepository.ts` | Interface + `NoteSummary`. |
| `src/Data/Repositories/UserTextMarkupRepository.ts` | `user_text_markup` - highlights, underlines, and any future markup type. Async API. Normalises every written colour to hex. |
| `src/Data/Repositories/IUserTextMarkupRepository.ts` | Interface: `create`/`update`/`delete`, `getForVerse`, `getForVerseRange`, `getForModule`, `getByColor`, `getByNote`, `deleteForVerse(Range)`, `countForModule`, `findOverlapping`. |
| `src/Data/Repositories/CollectionRepository.ts` | `collection` + `pinned_item` - the bookmark tree. Includes `moveCollection`, `reorderCollections`, `reorderPinnedItems`, `getCollectionsContainingVerse`. |
| `src/Data/Repositories/ICollectionRepository.ts` | Interface (21 methods, collections and pinned items in one repository per the one-repo-per-database-concern rule). |
| `src/Data/Repositories/UserCommentaryRepository.ts` | `user_commentary` - named groupings of user notes (the "user's own commentary" / prayer-list container). CRUD plus default-collection handling. |
| `src/Data/Repositories/IUserCommentaryRepository.ts` | Interface. |
| `src/Data/Repositories/UserCrossReferenceRepository.ts` | `user_cross_reference` - user-created verse<->verse links with an optional note. |
| `src/Data/Repositories/IUserCrossReferenceRepository.ts` | Interface. |
| `src/Data/Repositories/VerseLinkRepository.ts` | The unified `verse_link` table. Works against *any* connection - user DB or module DB - because the table is identical everywhere. Also exports `mapRowToVerseLink` for repositories that join `verse_link` into their own queries. |
| `src/Data/Repositories/IVerseLinkRepository.ts` | Interface + `VerseLinkFilter`. |
| `src/Data/Repositories/SessionRepository.ts` | `session` - study sessions, their serialized `session_data` JSON, default/autosave flags, `markSessionOpened`. |
| `src/Data/Repositories/ISessionRepository.ts` | Interface. |

### Models

| File | Purpose |
|---|---|
| `src/Data/Models/User/UserNote.ts` | Note entity: hierarchy, tags, linked verses (`getLinkedVerses`/`setLinkedVerses`), note/document types. |
| `src/Data/Models/User/UserTextMarkup.ts` | Markup entity + `TextMarkupMetadata` (`markupType`, `underlineStyle`, `underlineColor`, `colorName`, ...) - the extensibility point that keeps new markup kinds out of the schema. |
| `src/Data/Models/User/UserHighlight.ts` | Pre-migration-003 entity, kept for compatibility. New code uses `UserTextMarkup`. |
| `src/Data/Models/User/Collection.ts` | `Collection` and `PinnedItem` (+ `PinnedItemType`). |
| `src/Data/Models/User/UserCommentary.ts` | User commentary/collection entity. |
| `src/Data/Models/User/UserCrossReference.ts` | User cross-reference entity. |
| `src/Data/Models/User/ContentVerseLink.ts` | Legacy entity for the removed `content_verse_link` table. Superseded by `VerseLinkRecord`. |
| `src/Data/Models/User/Session.ts` | `Session` + the `SessionData` shape (per-pane tab state for bible/commentary/dictionary/book/notes/...). |
| `src/Data/Models/User/ReadingPlan.ts` | Reading-plan entities. |
| `src/Data/Models/Common/VerseLinkRecord.ts` | The unified `verse_link` row model, shared by user and module databases. |

### Services

| File | Purpose |
|---|---|
| `src/Services/CollectionService.ts` | Bookmark operations above the repository: auto-created "Favorites", `quickBookmarkVerse`/`quickBookmarkPassage`, duplicate detection, circular-reference prevention in `moveToCollection`, item counts, human-readable reference formatting, `initializeDefaultCollections`. |
| `src/Services/VerseLinksService.ts` | `getVerseLinks(verseId, openModuleIds?)` - aggregates everything that points at one verse (commentary direct entries and mentions, cross-reference modules, book sections, user notes, user cross-reference count) into a single `VerseLinksSummary` for Study Mode. All access via repository interfaces; no raw SQL. |
| `src/Services/SessionSerializationService.ts` | Controllers register under a name; `serializeAll()` / `restoreAll()` walk them into one `SessionSnapshot`. Keeps session capture out of the consumer's UI stores. |
| `src/Services/VerseReferenceIndexingService.ts` | Detects Bible references in free text (note bodies, imported content) and returns `DetectedVerseReference[]` with context. Language-configurable via an injected `IReferenceParser` + continuation pattern. |

### Schema

| File | Purpose |
|---|---|
| `sql/schemas/initial/UserDatabase.sql` | The current user schema (2.0.0). What a brand-new user database is created from - the end state, not a historical baseline. |

### Tests

| File | Purpose |
|---|---|
| `src/__tests__/UserNoteRepository.test.ts` | Notes CRUD, hierarchy, verse queries, search. |
| `src/__tests__/UserTextMarkupRepository.test.ts` | Markup CRUD, colour normalisation, range selection/deletion. |
| `src/__tests__/CollectionRepository.test.ts` | Collections and pinned items. |
| `src/__tests__/UserCommentaryRepository.test.ts` | User commentary CRUD. |
| `src/__tests__/UserCrossReferenceRepository.test.ts` | User cross-references. |
| `src/__tests__/SessionRepository.test.ts` | Sessions, default/autosave selection. |
| `src/__tests__/RangeBatchQueries.test.ts` | Range/containment query helpers shared by these repositories. |
| `src/Services/CollectionService.test.ts` | Favorites bootstrap, duplicate detection, circular moves. |
| `src/Services/VerseLinksService.test.ts` | Aggregation across module and user sources. |
| `src/Services/VerseReferenceIndexingService.test.ts` | Reference extraction and context. |
| `src/Data/Migration/repairUserSchema.test.ts` | The upgraded-profile markup repair - see [Migrations](migrations.md). |
| `src/Data/Core/Colors.test.ts` | `normalizeMarkupColor` / `markupColorName`. |

## The unified `verse_link` table

"Unified" means: **one table shape for every kind of content->verse reference,
byte-identical in every module database and in the user database.**

```sql
verse_link(
  link_id, source_type, source_id,
  verse_id_start, verse_id_end,     -- both inclusive; single verse is end = start
  link_type, sort_order, context, metadata
)
```

One verse-linking table for every content type, keyed by
`(source_type, source_id)`:

| Content | Key |
|---|---|
| A note | `source_type='note'`, `source_id = note_id` |
| A journal entry | `source_type='journal'` |
| A prayer item | `source_type='prayer'` |

and in module databases, `topic_verses`, `cross_reference_entry`,
`dictionary_entry.example_verses` and `scripture_reference` - see
[Module format](module-format.md).

What it buys: one range convention instead of four (`verse_id_start` /
`verse_id_end`, never `start_verse_id`), one index set, one repository, and one
answer to "what points at verse V?" across every content type.

What it costs: `source_id` is polymorphic, so there is **no foreign key and no
`ON DELETE CASCADE`**. Deleting a note or a cross-reference group must delete its
links explicitly - that is the repository's job.

`source_type` and `link_type` are open sets with no SQL `CHECK`. The
vocabularies live in `src/Data/Core/Types.ts` as `SOURCE_TYPES` and `LINK_TYPES`
and are enforced on write by `assertSourceType` / `assertLinkType`. Reads are
lenient on purpose: an unrecognised value in shipped data surfaces as data, not
as an exception.

## How it works

Opening the database and using a repository:

```typescript
const userDb = new SqliteProvider('data/users/user_john.db');
const notes = new UserNoteRepository(userDb);
const markup = new UserTextMarkupRepository(userDb);

const forVerse = notes.getForVerse(43003016);      // John 3:16
await markup.create(new UserTextMarkup({ ... }));
```

Note verse links, load path:

```
UserNoteRepository.getById(id)
  -> mapRowToEntity(row)
  -> loadLinkedVerses(note)
      VerseLinkRepository.getForSource('note', noteId)
        -> verseLinkRecordToNoteLink()   (word offsets out of metadata)
  -> note.setLinkedVerses(links)
```

Save path:

```
UserNoteRepository.update(note)
  -> saveLinkedVerses(note)
      deleteForSource('note', id) then createMany(...)
```

`verse_link` is replace-all per source: a save deletes that note's rows and
re-inserts them, so repeated saves replace rather than accumulate.

Study Mode aggregation:

```
VerseLinksService.getVerseLinks(verseId, openModuleIds)
  -> ICommentaryRepository            direct entries + mentions, per open module
  -> ICrossReferenceRepository        xref modules -> CrossReferenceModule[]
  -> IBookRepository                  book sections referencing the verse
  -> IUserNoteRepository              user notes on the verse
  -> IUserCrossReferenceRepository    userRefCount
  -> VerseLinksSummary
```

## Gotchas

- **Migration 003 renamed `user_highlight` -> `user_text_markup`.**
  `UserHighlight` (the model) still exists; `UserTextMarkupRepository` is the
  only writer. "Highlight" in the UI means a `user_text_markup` row whose
  `metadata.markupType` is `'highlight'` - underline, strikethrough and box are
  the same table with different metadata, which is the whole point of the rename.

- **Colours are hex `#RRGGBB` everywhere.** `create`/`update` call
  `normalizeMarkupColor`, so a caller passing a palette name still lands hex.
  The six-name palette is a UI constant, not a storage format, and
  `markupColorName()` reverse-maps hex back to a palette name so the right swatch
  shows selected - a value that differs by one digit silently becomes an unnamed
  "custom" colour. The mapping must stay identical in
  `src/Data/Core/Colors.ts`, `src/Data/Migration/repairUserSchema.ts` and any
  migration that rewrites stored colours.

- **An upgraded profile can still carry the old CHECK.**
  `CREATE TABLE IF NOT EXISTS` never fixes an existing table, which is why
  highlighting was dead on every pre-hex profile. `repairUserSchema` handles it -
  see [Migrations](migrations.md).

- **`verse_id_end` is NOT NULL and inclusive (R-1).** A single verse is
  `end = start`. Writes go through `resolveRangeEnd`; where the *anchor itself*
  is optional (`user_note`, `pinned_item`) both columns are nullable together and
  `resolveOptionalRangeEnd` applies - never one without the other. A stray NULL
  end makes a single-verse row match every range starting after it.

- **`VerseLinkRepository` reads degrade, writes throw.** `isSupported()` is
  false on any database without the unified table; `create`/`createMany` raise
  rather than silently dropping a link. Every read method returns empty instead.

- **`VerseLinkRepository` is not user-database-specific.** It is constructed
  against whatever `ISql` you hand it. The same class serves
  `source_type='topic'` in a topical module and `source_type='note'` in the user
  DB.

- **`UserTextMarkupRepository` methods are `async` but the underlying `ISql` is
  synchronous.** The promises resolve immediately; the async signature is for
  API symmetry with the IPC boundary, not for concurrency.

- **`user_text_markup.module_id` references `main.db` `module_metadata.module_id`
  across databases** - there is no foreign key and cannot be one. A module
  re-registration that changes `module_id` orphans markup, so registry rows must
  be normalised on the way in rather than duplicated per install path.

- **`content_verse_link` is gone from `UserDatabase.sql`.** Any consumer still
  writing that table needs to move to `verse_link`.

- **`SessionSerializationService` swallows errors.** A controller that throws
  during `serializeState()` or `restoreState()` is skipped with a
  `console.warn` - the session still saves/restores, minus that controller. If a
  pane comes back empty after a restart, check the warnings.

## Related

- [Module format](module-format.md) - the module-database half of `verse_link`.
- [Migrations](migrations.md) - how an existing user database reaches this shape.
- [Data layer](data-layer.md) | [Repositories](repositories.md) |
  [Verse identity](verse-identity.md) | [Search](search.md)
