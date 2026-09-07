# Bible Desktop App - Data Access Layer

This TypeScript library provides a clean, type-safe data access layer for the Bible Desktop application's multi-database architecture.

## Architecture

The data layer follows these design patterns:

- **Repository Pattern**: Each entity type has a repository that handles CRUD operations
- **Dependency Injection**: Repositories accept an `ISql` interface for database access
- **SQL Abstraction**: The `ISql` interface abstracts the underlying database implementation
- **Natural Data Models**: Entity classes with intuitive methods (arrays, add/remove operations, etc.)

## Database Structure

The application uses a **multi-database architecture**:

1. **Main Database** (`main.db`) - Shared reference data
   - Bible structure (books, chapters, verses)
   - Module registry

2. **User Databases** (`user_[username].db`) - Per-user data
   - Notes, highlights, bookmarks
   - Collections, reading plans
   - Application state

3. **Module Databases** - Content modules
   - `bible_*.db` - Bible translations
   - `commentary_*.db` - Commentaries
   - `dictionary_*.db` - Dictionaries/lexicons
   - `book_*.db` - Reference books
   - `devotional_*.db` - Devotionals

## Quick Start

### Installation

```bash
npm install
```

### Providing an ISql Implementation

The data layer depends on the `ISql` interface for all database operations. **`@bible/core` does not include a concrete database driver.** The `SqliteProvider` (using `better-sqlite3`) lives in `@bible/desktop`. You must provide your own `ISql` implementation or use the one from the desktop package.

```typescript
import { ISql } from './Data';

// Option 1: Use SqliteProvider from @bible/desktop
// import { SqliteProvider } from '@bible/desktop/electron/providers/SqliteProvider';
// const db: ISql = new SqliteProvider('path/to/database.db');

// Option 2: Implement ISql for your platform or tests
const db: ISql = createYourSqlProvider('path/to/database.db');
```

### Basic Usage

```typescript
import { BibleBookRepository, UserNoteRepository, BibleRepository } from './Data';

// Assumes you have ISql instances for each database (see above)
// const mainDb: ISql = ...
// const userDb: ISql = ...
// const kjvDb: ISql = ...

// Main database repositories
const bookRepo = new BibleBookRepository(mainDb);

// Get a Bible book
const john = bookRepo.getByName('John');
console.log(john?.getDisplayName()); // "John (NT)"

// Get books by testament
const otBooks = bookRepo.getByTestament('OT');

// User database repositories
const noteRepo = new UserNoteRepository(userDb);

// Get notes for John 3:16
const notes = noteRepo.getForVerse(43003016);

// Create a new note
const note = new UserNote({
  verseIdStart: 43003016,
  content: 'For God so loved the world...',
  contentFormat: 'html',
  noteType: 'verse_note',
  visibility: 'private',
  tags: ['salvation', 'love']
});

noteRepo.create(note);

// Bible module repositories
const bibleRepo = new BibleRepository(kjvDb);

// Get John 3:16
const verse = bibleRepo.getVerse(43003016);
console.log(verse?.text);

// Get entire chapter
const chapter = bibleRepo.getChapter(43, 3); // John 3

// Search for verses
const results = bibleRepo.search('love');
```

## Deprecated model fields

A few model fields are kept **populated from the current storage** so consumers
outside `@bible/core` keep compiling: `BibleVerse.textPlain`,
`BibleVerse.formattingData`, `DictionaryEntry.exampleVerses`,
`WordOccurrence.bibleModule` and `BaseModuleInfo.version`. Each carries a
`@deprecated` tag naming what to read instead.

Range convention (`verse_id_start` inclusive, `verse_id_end` inclusive, NULL =
single verse) is stated **once**, in `Core/Types.ts` - use `resolveRangeEnd()`
rather than branching on NULL. Word offsets are 0-based and inclusive everywhere.

Open enums whose SQL `CHECK` constraints were dropped (`module_type`,
`dictionary_type`, `note_type`, `item_type`, `relationship_type`, `plan_type`,
`search_type`, `link_type`, `source_type`, `entry_level`) live as union types
plus `is*`/`assert*` validators in `Core/Types.ts` and are enforced at the
repository write boundary.

`ModuleFormatCompat.test.ts` builds both shapes of each database in memory and
asserts the same repository call works against either.

## Core Components

### ISql Interface

The `ISql` interface provides database abstraction:

```typescript
interface ISql {
  queryOne<T>(sql: string, params?: SqlParameter[]): T | undefined;
  queryAll<T>(sql: string, params?: SqlParameter[]): T[];
  execute(sql: string, params?: SqlParameter[]): SqlResult;
  transaction<T>(callback: () => T): T;
  close(): void;
}
```

### SqliteProvider (in @bible/desktop)

The SQLite implementation of `ISql` lives in `@bible/desktop` at `electron/providers/SqliteProvider.ts`. It uses `better-sqlite3` and is compiled for Electron's Node.js version.

```typescript
// Import from the desktop package, not from core
import { SqliteProvider } from '@bible/desktop/electron/providers/SqliteProvider';

const db = new SqliteProvider('path/to/database.db', {
  readonly: false,
  fileMustExist: true
});
```

If you are using `@bible/core` outside of the desktop app, implement the `ISql` interface with your preferred database driver.

### Repository Pattern

Each repository implements `IRepository<T>`:

```typescript
interface IRepository<T> {
  getById(id: number): T | undefined;
  create(entity: T): T;
  update(entity: T): T;
  delete(id: number): boolean;
  getAll(options?: QueryOptions): T[];
}
```

## Data Models

### Main Database

- **BibleBook** - Bible book metadata
- **BibleVerseRef** - Verse reference with unique IDs
- **ChapterInfo** - Chapter-level information
- **ModuleMetadata** - Installed module registry

### User Database

- **UserNote** - User-created notes (hierarchical)
- **UserHighlight** - Highlighted verses
- **Collection** - User collections (hierarchical)
- **PinnedItem** - Items in collections
- **ReadingPlan** - Reading plans with days and passages

### Module Databases

- **BibleVerse** - Bible verse text with formatting
- **InterlinearWord** - Interlinear data (Hebrew/Greek)
- **CommentaryEntry** - Commentary entries
- **DictionaryEntry** - Dictionary/lexicon entries
- **WordOccurrence** - Concordance word occurrences

## Verse ID System

The application uses a calculated verse ID system:

```
verse_id = (book_number * 1000000) + (chapter * 1000) + verse
```

Examples:
- Genesis 1:1 = `01001001`
- John 3:16 = `43003016`
- Revelation 22:21 = `66022021`

Helper class:

```typescript
import { VerseIdHelper } from './Data';

// Calculate verse ID
const verseId = VerseIdHelper.calculate(43, 3, 16); // 43003016

// Parse verse ID
const ref = VerseIdHelper.parse(43003016);
// { bookNumber: 43, chapter: 3, verse: 16 }

// Validate
VerseIdHelper.isValid(43003016); // true
```

## Repository Examples

### BibleBookRepository

```typescript
const repo = new BibleBookRepository(mainDb);

// Get book by ID
const book = repo.getById(1);

// Get book by name or abbreviation
const genesis = repo.getByName('Genesis');
const gen = repo.getByName('Gen');

// Get books by testament
const otBooks = repo.getByTestament('OT');

// Search books
const results = repo.search('John');

// Get total verse count
const total = repo.getTotalVerseCount(); // 31102 (KJV)
```

### UserNoteRepository

```typescript
const repo = new UserNoteRepository(userDb);

// Get note by ID (loads linked verses and child notes)
const note = repo.getById(1);

// Get notes for a verse
const notes = repo.getForVerse(43003016);

// Get notes for a verse range (Romans 8)
const romans8Notes = repo.getForVerseRange(45008001, 45008039);

// Get top-level notes
const topNotes = repo.getTopLevelNotes();

// Search notes
const searchResults = repo.search('salvation');

// Get notes by tag
const tagged = repo.getByTag('important');

// Create hierarchical note
const parent = new UserNote({
  title: 'Study on John',
  content: 'Overview...',
  noteType: 'study'
});
repo.create(parent);

const child = new UserNote({
  parentNoteId: parent.noteId,
  verseIdStart: 43003016,
  content: 'This verse...',
  noteType: 'verse_note'
});
repo.create(child);
```

### BibleRepository

```typescript
const repo = new BibleRepository(kjvDb);

// Get single verse
const verse = repo.getByVerseId(43003016);

// Get chapter
const john3 = repo.getChapter(43, 3);

// Get entire book
const john = repo.getBook(43);

// Get verse range
const passage = repo.getByVerseRange(45008028, 45008039);

// Search
const results = repo.search('love', { limit: 50 });

// Get verses with headings
const headings = repo.getVersesWithHeadings();
```

## Working with Multiple Databases

```typescript
// Open all databases (ISql instances -- use SqliteProvider from @bible/desktop or your own)
// const mainDb: ISql = new SqliteProvider('data/main.db');
// const userDb: ISql = new SqliteProvider('data/users/user_john.db');
// const kjvDb: ISql = new SqliteProvider('data/modules/bible_kjv.db');
// const esvDb: ISql = new SqliteProvider('data/modules/bible_esv.db');

// Create repositories
const bookRepo = new BibleBookRepository(mainDb);
const noteRepo = new UserNoteRepository(userDb);
const kjvRepo = new BibleRepository(kjvDb);
const esvRepo = new BibleRepository(esvDb);

// Look up book info
const john = bookRepo.getByName('John');

// Get verse from both translations
const kjvVerse = kjvRepo.getVerse(43003016);
const esvVerse = esvRepo.getVerse(43003016);

console.log('KJV:', kjvVerse?.text);
console.log('ESV:', esvVerse?.text);

// Get user's notes on this verse
const notes = noteRepo.getForVerse(43003016);

// Clean up
mainDb.close();
userDb.close();
kjvDb.close();
esvDb.close();
```

## Building

```bash
npm run build
```

Outputs to `dist/` directory with TypeScript declarations.

## TypeScript Configuration

The project uses strict TypeScript settings:
- Strict null checks
- No implicit any
- Unused locals/parameters detection
- Source maps and declarations

See `tsconfig.json` for full configuration.

## Implemented Repositories

**Main Database:** BibleBookRepository, ModuleMetadataRepository, ModuleCatalogRepository, DownloadQueueRepository, ModuleUpdateRepository

**User Database:** UserNoteRepository, UserTextMarkupRepository, UserCommentaryRepository, UserCrossReferenceRepository, CollectionRepository, SessionRepository

**Module Databases:** BibleRepository, BibleSearchRepository, CommentaryRepository, DictionaryRepository, BookRepository, TopicalIndexRepository, CrossReferenceRepository, TagGraphRepository

**Any Database:** VerseLinkRepository - the unified `verse_link` table is identical in every module database and in the user database, so one repository serves them all.

**Potential Future Repositories:**
- ReadingPlanRepository
- DevotionalRepository

## Contributing

Follow these patterns when adding new repositories:

1. Create model class with natural methods
2. Create repository implementing `IRepository<T>`
3. Inject `ISql` via constructor
4. Add JSON parsing for metadata fields
5. Add domain-specific query methods
6. Export from `index.ts`

## License

ISC
