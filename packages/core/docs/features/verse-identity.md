# Verse Identity

Everything that turns a human reference ("John 3:16", "Jude 5-8") into the
integer the rest of the system stores, and back again. Read this before touching
anything that parses, formats, ranges, or navigates scripture references.

## Files

| File | Purpose |
|---|---|
| `src/Data/Core/Types.ts` | `VerseId`, the `Book` enum, `VerseIdHelper`, `VerseRange`, `VerseReference`, `WordRange`, the normative range convention, `resolveRangeEnd` / `resolveOptionalRangeEnd`, and the open-enum validators. |
| `src/Data/Core/Types.test.ts` | Tests for the helper and the enum validators. |
| `src/Data/Core/BookNames.ts` | Canonical English book-name tables (`LONG_NAMES` / `MEDIUM_NAMES` / `SHORT_NAMES`), the alias map `ENGLISH_BOOK_NAMES`, `getBookName`, `getBookNumber`, `isSingleChapterBook`, `BOOK_COUNT`. No imports, no platform deps. |
| `src/Data/Core/VerseRangeQuery.ts` | SQL WHERE-fragment builders for point-in-range and range-overlap queries. |
| `src/Data/Core/VerseRangeQuery.test.ts` | Tests for the fragment builders. |
| `src/Data/Core/StrongsNumberHelper.ts` | Normalizes Strong's numbers between user input, interlinear rows, and dictionary `entry_key`. |
| `src/Data/Core/StrongsNumberHelper.test.ts` | Tests for parsing and the padding variants. |
| `src/Services/ReferenceParser.ts` | Parses reference strings; fuzzy book matching; `scanText` finds references inside running prose. |
| `src/Services/ReferenceParser.test.ts` | Tests. |
| `src/Services/ReferenceCollapser.ts` | The inverse: a list of verse IDs collapsed into "Acts 1:2, 4-5; Romans 2:3", flat or as clickable segments. |
| `src/Services/ReferenceCollapser.test.ts` | Tests. |
| `src/Services/BibleSections.ts` | The ten canonical book groupings (Pentateuch ... Revelation) and `getBibleSection(bookNumber)`. |
| `src/Services/BibleSections.test.ts` | Tests. |
| `src/Services/VerseNavigationService.ts` | Repository-backed next/previous chapter, chapter info, reference formatting. See the gotcha - nothing outside core uses it. |
| `src/Services/VerseNavigationService.test.ts` | Tests. |

## The verse ID

```
verse_id = (book_number * 1_000_000) + (chapter * 1_000) + verse
```

Genesis 1:1 = `1001001`, John 3:16 = `43003016`, Revelation 22:21 = `66022021`.

It is used everywhere - every table that references scripture, every IPC payload,
every search result - because a single sortable integer gives, for free, what a
`(book, chapter, verse)` triple does not:

- **Ordering.** `ORDER BY verse_id` is canonical order. No composite index, no
  three-column comparator.
- **Ranges.** A passage is `verse_id BETWEEN start AND end`, and containment is
  one comparison per bound. All the range work in `VerseRangeQuery.ts` follows
  from this.
- **A single column.** Foreign keys, joins, and cache keys are one integer.

The formula is restated in a handful of hot paths (`toUSFM.ts`, `parseUSFM.ts`,
`CommentaryLinkProcessor.ts`, `BibleViewService.deduplicateTopics`) rather than
imported, so a change to it is not a single edit. `VerseIdHelper.calculate` /
`.parse` are the canonical implementation.

Versification is fixed: 66 books, standard English (KJV) numbering, one scheme.
There is no versification mapping layer, by design.

## Range convention

`src/Data/Core/Types.ts` carries the single normative statement, and every other
file points at it rather than restating it. In short:

- Columns are spelled `verse_id_start` / `verse_id_end`. Never the reverse.
- **Both bounds are inclusive.** A single verse is `end = start`.
- Where the anchor is mandatory, `verse_id_end` is NOT NULL, so containment is
  uniformly `start <= X AND end >= X` with no NULL branch.
- Where the anchor itself is optional (`user_note`, `pinned_item`,
  `commentary_entry`), both columns are nullable **together**:
  `(start IS NULL AND end IS NULL) OR (both NOT NULL)`.

Reads still go through `resolveRangeEnd(start, end)` because older databases predate
the rule and legitimately carry NULL ends. Writes to the optional-anchor tables
go through `resolveOptionalRangeEnd(start, end)`, which is what stops a
half-populated `(start set, end NULL)` row from being written.

The in-memory `VerseRange` uses `startVerseId` / `endVerseId` - different
spelling, same meaning; the names predate the convention.

## Open enums

`MODULE_TYPES`, `DICTIONARY_TYPES`, `NOTE_TYPES`, `ITEM_TYPES`, `PLAN_TYPES`,
`SEARCH_TYPES`, `LINK_TYPES`, `SOURCE_TYPES`, `ENTRY_LEVELS` all live in
`Types.ts` as `as const` arrays, each paired with an `is...` / `assert...` guard
built by the local `enumValidators` factory. A failed assert throws
`InvalidEnumValueError`, which carries the enum name, the offending value, and
the allowed list.

They live in TypeScript rather than in SQL `CHECK` constraints because SQLite
cannot alter a CHECK constraint - an open value set trapped in one is unfixable
without rebuilding the table. The schemas therefore drop those constraints.
Closed sets fixed by the domain (`testament`, `content_format`, 0/1 flags such
as `right_to_left`) keep their CHECK constraints and are *not* validated here.

The contract is: **validate on write at the repository boundary, be lenient on
read**, so an unexpected value in an already-shipped module surfaces as data
rather than a crash.

`RELATIONSHIP_TYPES` is the odd one out - a genuinely open set.
`isRelationshipType` accepts any `lower_snake_case` token, and the constant only
documents the vocabulary this repo ships.

## How it works

Text in, verse IDs out:

```
"Ro 5:5; 8:9"
  -> ReferenceParser.parse() / .scanText()
  -> { book: 45, chapter: 5, verse: 5, ... }
  -> VerseIdHelper.calculate(45, 5, 5) -> 45005005
```

Verse IDs out, text in:

```
[44001002, 44001004, 44001005, 45002003]
  -> collapseReferences()            -> "Acts 1:2, 4-5; Romans 2:3"
  -> collapseReferencesStructured()  -> [{ref,label:'Acts 1:2',verseId}, {sep}, ...]
```

`ReferenceParser` resolves book names through `ENGLISH_BOOK_NAMES` by default,
but the constructor takes a `ReferenceParserConfig` (`bookNames`, `displayNames`,
`singleChapterBooks`), which is how a localized app supplies translated tables
without editing `BookNames.ts`. Latin-script languages reuse the class;
anything with fundamentally different reference syntax implements
`IReferenceParser` instead.

Lookup order inside `parse()` is exact match, then `getBookNumberFuzzy` -
Damerau-Levenshtein distance <= 2 and less than half the input length, skipping
keys of 2 characters or fewer, with character-overlap then length-similarity as
tiebreakers. That is what turns "Jonh 3:16" into John, setting `fuzzyMatch` and
`correctedBookName`.

`BookNames.ts` is the single source of truth for the repo; a full 66-book table
was previously hardcoded in fourteen places. It is re-exported from
`ReferenceParser.ts` (`ENGLISH_*`) and from `ReferenceCollapser.ts`
(`getBookName`, `BookNameFormat`) so the old import sites still resolve.

## Gotchas

- **`VerseIdHelper.getBookName(book)` returns the enum *key*** - `"FirstSamuel"`,
  `"SongOfSolomon"` - not a display name. For anything a user sees, use
  `getBookName(bookNumber, format)` from `BookNames.ts`.
- **`VerseIdHelper.format(verseId)` returns `"43:3:16"`**, not `"John 3:16"`. The
  reference-shaped formatter is `VerseIdHelper.formatReference(start, end, names)`,
  which needs a book-name lookup passed in.
- **`getChapterRange` ends the chapter at verse 999.** It is a sentinel, not a
  real verse count - the helper has no chapter/verse tables to consult.
- **`VerseIdHelper.isValid` only bounds the book number** (1-66) and requires
  chapter >= 1, verse >= 1 and an integer id. It cannot tell you that Psalm 151 or
  John 3:99 does not exist. The integer guard matters: without it `43003016.7`
  parses to a plausible triple and passes.
- **Two unrelated `VerseReference` types exist.** `src/Data/Core/Types.ts` exports
  `{ bookNumber, chapter, verse }`; `src/Services/VerseNavigationService.ts` exports a
  wider one with `bookName`, `verseStart`, `verseEnd`, `verseId`. Import the right
  one.
- **`verseRangeOverlapsRangeNullable` binds its parameters in reverse**
  (`[endVerseId, startVerseId]`). That is correct for the overlap test
  `start <= ? AND COALESCE(end, start) >= ?`, but it reads wrong at the call site.
  Prefer it over `verseRangeOverlapsRange` on `verse_link` and any other table
  following the canonical convention, because `COALESCE` keeps `end IS NULL` and
  `end = start` indistinguishable.
- **`allowWholeBook` is off by default and must stay off for the search box.**
  Typing "John" there is someone searching for the *word*; and "love"
  fuzzy-matches a book name. Whole-book matching is deliberately exact-only, no
  fuzzy fallback. Only callers with no keyword mode (the copy/export dialog) opt
  in.
- **`scanText` deliberately rejects fuzzy matches**, otherwise "Task 1" links to a
  Bible book. It also rewinds `lastIndex` to `match.index + 1` after a rejection:
  the pattern happily eats "See 1" out of "See 1 John 3:16", and resuming from
  the end of the rejected span would silently detect *John* 3:16.
- **Single-chapter books get reinterpreted.** For Obadiah, Philemon, 2 John,
  3 John and Jude, "Jude 5" parses as chapter 1 verse 5, and any `endChapter` is
  discarded. `ReferenceCollapser` mirrors this on output ("Jude 5-8", no chapter).
- **`getBookNumber` matches the alias table literally** after lower-casing and
  trimming; internal spacing must match an entry. Both `"1 sam"` and `"1sam"` are
  in the table for that reason.
- **`getBibleSection` throws** on an out-of-range book number, where
  `getBookName` returns `"Book <n>"`. Do not assume one convention.
- **Hebrew Strong's numbers have variable zero-padding in shipped interlinear
  data** (`H7225`, `H07225`, `H007225`), Greek does not.
  `StrongsNumberHelper.toInterlinearVariants` generates all of them and
  `buildInterlinearWhereClause` turns them into an `IN (...)` clause - never match
  a Strong's number with a single equality. Dictionary `entry_key` is a third
  format again: 5-digit zero-padded with no prefix (`toDictionaryKey`).
- **`StrongsNumberHelper.getDictionaryModule` returns hardcoded module names**
  (`'strongsgreek'` / `'strongshebrew'`). It does not consult the module registry.
- **`VerseNavigationService` has no consumer outside core** (only its own test).
  Navigation in the apps goes through `Controllers/VerseNavigationController`,
  which is what the root barrel exports; the service is reachable only via the
  `Services` barrel. Its `getChapterInfo` returns `verseCount: 0` - a hardcoded
  placeholder, since it has no Bible module to count from.
- **The root barrel does not `export * from './Services'`.** `src/index.ts` lists
  services individually, so `VerseNavigationService` is absent from
  `@bible/core`'s root exports while `ReferenceParser`, `ReferenceCollapser` and
  `BibleSections` are present.

## See also

- [Data layer](data-layer.md) and [Repositories](repositories.md) - where the
  range fragments are consumed.
- [Text rendering](text-rendering.md) - word offsets inside a verse, which are a
  different index space from verse IDs.
- [Browser subset](browser-subset.md) - `VerseIdHelper`, `BookNames`,
  `ReferenceParser`, `ReferenceCollapser`, `BibleSections` and
  `StrongsNumberHelper` are all re-exported from `@bible/core/browser`.
