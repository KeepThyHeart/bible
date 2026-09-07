# Repositories

The complete map of every repository in `@bible/core`: which database file it opens, which tables it touches, and where its interface lives. Use this to find the right repository without grepping; use [Data layer](data-layer.md) for the pattern they all follow.

## The four database families

| Family | File pattern | Contents |
|---|---|---|
| Main | `main.db` | Shared reference data: the 66 Bible books, the module registry, catalogs, the download queue. One per installation. |
| User | `user_*.db` | Everything the user creates: notes, markup, collections, sessions. One per user, kept separate so it survives module updates and can be backed up on its own. |
| Module | `bible_*.db`, `commentary_*.db`, `dictionary_*.db`, `book_*.db`, `xref_*.db`, `topical_*.db`, `devotional_*.db` | Read-only published content. One file per installed module. |
| Auxiliary | `tag_graph.db`, `enrichments_*.db` | Generated cross-module data (entity graph, enrichments). |

## Main database (`main.db`)

| Repository | Interface | Tables |
|---|---|---|
| `src/Data/Repositories/BibleBookRepository.ts` | `IBibleBookRepository.ts` | `bible_book`, `chapter_info` |
| `src/Data/Repositories/ModuleMetadataRepository.ts` | `IModuleMetadataRepository.ts` | `module_metadata` |
| `src/Data/Repositories/ModuleCatalogRepository.ts` | `IModuleCatalogRepository.ts` | `module_repository` |
| `src/Data/Repositories/ModuleUpdateRepository.ts` | `IModuleUpdateRepository.ts` | `module_update` |
| `src/Data/Repositories/DownloadQueueRepository.ts` | `IDownloadQueueRepository.ts` | `module_download_queue` |

Schema: `sql/schemas/initial/MainDatabase.sql`. Models: `src/Data/Models/Main/`.

## User database (`user_*.db`)

| Repository | Interface | Tables |
|---|---|---|
| `src/Data/Repositories/UserNoteRepository.ts` | `IUserNoteRepository.ts` | `user_note`, `note_verse_link` |
| `src/Data/Repositories/UserTextMarkupRepository.ts` | `IUserTextMarkupRepository.ts` | `user_text_markup` |
| `src/Data/Repositories/CollectionRepository.ts` | `ICollectionRepository.ts` | `collection`, `pinned_item` |
| `src/Data/Repositories/UserCommentaryRepository.ts` | `IUserCommentaryRepository.ts` | `user_commentary`, `user_note` |
| `src/Data/Repositories/UserCrossReferenceRepository.ts` | `IUserCrossReferenceRepository.ts` | `user_cross_reference` |
| `src/Data/Repositories/VerseLinkRepository.ts` | `IVerseLinkRepository.ts` | `verse_link` |
| `src/Data/Repositories/SessionRepository.ts` | `ISessionRepository.ts` | `session` |

Schema: `sql/schemas/initial/UserDatabase.sql`. Models: `src/Data/Models/User/`. Full detail in [User data](user-data.md).

## Module databases

| Repository | Interface | Opens | Tables |
|---|---|---|---|
| `src/Data/Repositories/BibleRepository.ts` | `IBibleRepository.ts` | `bible_*.db` | `bible_verse`, `interlinear_word`, `book_search_index`, `book_search_metadata`, `verse_positions` |
| `src/Data/Repositories/BibleSearchRepository.ts` | `IBibleSearchRepository.ts` | whichever database holds the search tables | `bible_search_index`, `bible_search_index_metadata`, `bible_search_verse_positions`, `saved_search` |
| `src/Data/Repositories/CommentaryRepository.ts` | `ICommentaryRepository.ts` | `commentary_*.db` | `commentary_entry`, `verse_reference`, `verse_link` |
| `src/Data/Repositories/DictionaryRepository.ts` | `IDictionaryRepository.ts` | `dictionary_*.db` | `dictionary_entry`, `word_occurrence` |
| `src/Data/Repositories/BookRepository.ts` | `IBookRepository.ts` | `book_*.db` | `book_section`, `scripture_reference`, `verse_link` |
| `src/Data/Repositories/CrossReferenceRepository.ts` | `ICrossReferenceRepository.ts` | `xref_*.db` | `cross_reference_group`, `cross_reference_entry`, `verse_link` |
| `src/Data/Repositories/TopicalIndexRepository.ts` | `ITopicalIndexRepository.ts` | `topical_*.db` | `topic`, `topic_fts`, `verse_link` |
| `src/Data/Repositories/TagGraphRepository.ts` | `ITagGraphRepository.ts` | `tag_graph.db` | `people`, `places`, `objects`, `themes`, `entity_verses`, `entity_facets`, `entity_facet_members`, `entity_topic_links`, `tag_associations`, `association_verses`, the three `*_attribute_map` tables, `people_roles`, `people_relationships` |
| `src/Data/Repositories/EnrichmentRepository.ts` | `IEnrichmentRepository.ts` | `enrichments_*.db` | `enrichment_units`, `enrichment_tags` |

Shared base: `src/Data/Repositories/BaseModuleRepository.ts` supplies `mapModuleIdentity` and the `module_info` identity/provenance block that every module type's info model uses. Schemas: `sql/schemas/initial/`. Models: `src/Data/Models/<Type>/`.

## Tests

| File | Covers |
|---|---|
| `src/Data/Repositories/BibleRepository.test.ts` | Bible verses and module info |
| `src/Data/Repositories/BibleBookRepository.test.ts` | Book table and chapter info |
| `src/Data/Repositories/TopicalIndexRepository.test.ts` | Topical index reads |
| `src/__tests__/BibleSearchRepository.test.ts` | FTS search queries |
| `src/__tests__/BibleSearchHighlightColumns.test.ts` | Search highlight column handling |
| `src/__tests__/CommentaryRepository.test.ts` | Commentary entries |
| `src/__tests__/DictionaryRepository.test.ts` | Dictionary entries |
| `src/__tests__/BookRepository.test.ts` | Book sections |
| `src/__tests__/CrossReferenceRepository.test.ts` | Cross-reference groups and entries |
| `src/__tests__/TopicalIndexRepository.test.ts` | Topical index |
| `src/__tests__/TagGraphRepository.test.ts` | Entity graph |
| `src/__tests__/ModuleMetadataRepository.test.ts` | Module registry |
| `src/__tests__/ModuleCatalogRepository.test.ts` | Catalog repositories |
| `src/__tests__/ModuleUpdateRepository.test.ts` | Update records |
| `src/__tests__/DownloadQueueRepository.test.ts` | Download queue |
| `src/__tests__/SessionRepository.test.ts` | Sessions |
| `src/__tests__/UserNoteRepository.test.ts` | Notes and note verse links |
| `src/__tests__/UserTextMarkupRepository.test.ts` | Highlights and underlines |
| `src/__tests__/UserCommentaryRepository.test.ts` | User commentary collections |
| `src/__tests__/UserCrossReferenceRepository.test.ts` | User cross-references |
| `src/__tests__/CollectionRepository.test.ts` | Collections and pinned items |
| `src/__tests__/RangeBatchQueries.test.ts` | Batched verse-range queries across repositories |

## Gotchas

- **`verse_link` appears in four different databases.** Commentary, Book, Cross-reference and User databases each have one, and `VerseLinkRepository` is the user-database one. It unifies what would otherwise be a per-type link table in each - see [User data](user-data.md) and [Module format](module-format.md) before assuming which you are looking at.
- **`TagGraphRepository` maps a fixed category -> table-name lookup** rather than accepting a table name, because those identifiers cannot be bound as parameters. Add a category by extending that lookup, never by threading a caller-supplied string through.
- **`BibleSearchRepository` reads and writes `saved_search`, which is declared only in `MainDatabase.sql`.** Point it at the main database, not a user database: `UserDatabase.sql` has no `saved_search` table (it declares `user_search_history`, and mentions `saved_search` only in a column comment). The repository takes a bare `ISql` and cannot check this for you, so the call site decides whether it works. The `search_history` table is declared alongside `saved_search` in `MainDatabase.sql` but is no longer read or written by any code - see [Search](search.md).
- **`UserCommentaryRepository` reads `user_note`.** User commentary entries are stored as notes with a different type, not in a separate content table.
