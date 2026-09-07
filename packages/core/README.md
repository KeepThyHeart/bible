# @bible/core

Core TypeScript library providing data access, business logic, and service layers for Bible study applications. This package is platform-agnostic and contains no UI or database driver code.  Consumers provide their own `ISql` implementation.

## Architecture

The package is built around several key design patterns:

- **Repository Pattern** -- One repository per database type, handling all CRUD and domain-specific queries
- **Dependency Injection** -- Repositories accept an `ISql` interface, not a concrete database driver
- **Interface-Based Design** -- Every repository has a corresponding `I*Repository` interface for testability and swappability
- **Multi-Database Architecture** -- Separate databases for reference data, user data, and content modules

```
+---------------------+
|  Consumer (Desktop, |
|  Web, CLI, Tests)   |
+----------+----------+
           | imports
+----------v----------+
|  Controllers        |  State management, coordination
|  Services           |  Business logic (search, parsing, formatting)
|  Repositories       |  Data access (CRUD + domain queries)
|  Models             |  Type-safe entity classes
+----------+----------+
           | depends on
+----------v----------+
|  ISql Interface     |  Abstract SQL operations
+----------+----------+
           | implemented by
+----------v----------+
|  SqliteProvider     |  (provided by @bible/desktop, or you provide your own)
+---------------------+
```

## Installation

This package is used as a workspace dependency within the monorepo:

```bash
# From the monorepo root
npm install
npm run build:core
```

Other packages reference it via the workspace protocol:

```json
{
  "dependencies": {
    "@bible/core": "*"
  }
}
```

## Providing an ISql Implementation

`@bible/core` defines the `ISql` interface but does **not** include a concrete database driver. The `SqliteProvider` (which uses `better-sqlite3`) lives in `@bible/desktop`. To use `@bible/core`, you must provide an object implementing `ISql`:

```typescript
import { ISql, SqlParameter, SqlResult } from '@bible/core';

// Option 1: Use the SqliteProvider from @bible/desktop
import { SqliteProvider } from '@bible/desktop/electron/providers/SqliteProvider';
const db: ISql = new SqliteProvider('path/to/database.db');

// Option 2: Implement ISql yourself for other platforms or testing
const mockSql: ISql = {
  queryOne<T>(sql: string, params?: SqlParameter[]): T | undefined { /* ... */ },
  queryAll<T>(sql: string, params?: SqlParameter[]): T[] { /* ... */ },
  execute(sql: string, params?: SqlParameter[]): SqlResult { /* ... */ },
  transaction<T>(callback: () => T): T { /* ... */ },
  close(): void { /* ... */ },
  isOpen(): boolean { /* ... */ },
  getDatabasePath(): string { /* ... */ },
};
```

Then pass the `ISql` instance to any repository:

```typescript
import { BibleRepository, BibleBookRepository, UserNoteRepository } from '@bible/core';

const bibleRepo = new BibleRepository(kjvDb);
const bookRepo = new BibleBookRepository(mainDb);
const noteRepo = new UserNoteRepository(userDb);
```

## Package Structure

```
src/
+-- Data/                    # Data access layer
|   +-- Core/                # ISql interface, Types, VerseIdHelper, helpers
|   +-- Models/              # Entity classes organized by database type
|   |   +-- Main/            # main.db models (BibleBook, ModuleMetadata, ...)
|   |   +-- User/            # user_*.db models (UserNote, UserHighlight, ...)
|   |   +-- Bible/           # bible_*.db models (BibleVerse, BibleModuleInfo)
|   |   +-- Commentary/      # commentary_*.db models
|   |   +-- Dictionary/      # dictionary_*.db models
|   |   +-- Book/            # book_*.db models
|   |   +-- Devotional/      # devotional_*.db models
|   |   +-- TopicalIndex/    # topical index models
|   |   +-- CrossReference/  # cross-reference models
|   |   +-- TagGraph/        # tag graph models
|   +-- Repositories/        # Repository interfaces and implementations
+-- Controllers/             # Application state and coordination logic
+-- Services/                # Business services (search, parsing, formatting)
+-- Api/                     # API contract interfaces (IBibleApi, ISearchApi, ...)
+-- types/                   # Shared TypeScript types
+-- index.ts                 # Package entry point (re-exports everything)
```

## Key Concepts

### Verse ID System

All verse references use a calculated numeric ID:

```
verse_id = (book_number * 1000000) + (chapter * 1000) + verse
```

| Reference       | Verse ID   |
|-----------------|------------|
| Genesis 1:1     | `1001001`  |
| John 3:16       | `43003016` |
| Revelation 22:21| `66022021` |

```typescript
import { VerseIdHelper } from '@bible/core';

const id = VerseIdHelper.calculate(43, 3, 16);      // 43003016
const ref = VerseIdHelper.parse(43003016);           // { bookNumber: 43, chapter: 3, verse: 16 }
const valid = VerseIdHelper.isValid(43003016);       // true
```

### Multi-Database Architecture

The application uses separate SQLite databases for different concerns:

| Database            | Purpose                         | Repository Examples              |
|---------------------|---------------------------------|----------------------------------|
| `main.db`           | Shared reference data           | BibleBookRepository, ModuleMetadataRepository |
| `user_*.db`         | Per-user data                   | UserNoteRepository, CollectionRepository, SessionRepository |
| `bible_*.db`        | Bible translation modules       | BibleRepository               |
| `commentary_*.db`   | Commentary modules              | CommentaryRepository          |
| `dictionary_*.db`   | Dictionary/lexicon modules      | DictionaryRepository          |
| `book_*.db`         | Reference book modules          | BookRepository                |

### Repository Pattern

Each database type gets one unified repository. Repositories depend on the `ISql` interface:

```typescript
import { BibleRepository, IBibleRepository } from '@bible/core';

// Concrete usage
const repo = new BibleRepository(kjvDb);
const verse = repo.getVerse(43003016);
const chapter = repo.getChapter(43, 3);

// Interface-based (for DI and testing)
function loadVerse(repo: IBibleRepository, verseId: number) {
  return repo.getVerse(verseId);
}
```

## Building

```bash
npm run build          # Compile TypeScript to dist/
npm run watch          # Watch mode
npm run clean          # Remove dist/
```

## Testing

```bash
npm run test           # Run tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # With coverage
```

## Further Documentation

- **Data Layer** -- [`src/Data/README.md`](src/Data/README.md) for detailed data access documentation
- **Controllers** -- [`src/Controllers/README.md`](src/Controllers/README.md) for controller patterns and usage
- **Services** -- [`src/Services/README.md`](src/Services/README.md) for business logic services
- **Working Examples** -- [`src/example.ts`](src/example.ts) for complete usage examples

## License

ISC
