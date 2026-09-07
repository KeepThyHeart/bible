# Getting Started

An end-to-end walkthrough: supply a database provider, open the databases, read Bible text, and drive the controllers and search services.

## Quick Start

```typescript
import {
  // Database abstraction - you provide the implementation
  type ISql,
  // Module loading
  ModuleLoader,
  // Repositories
  BibleRepository,
  CommentaryRepository,
  DictionaryRepository,
  ModuleMetadataRepository,
  BibleBookRepository,
  // Controllers (stateful business logic)
  VerseNavigationController,
  BibleTabController,
  CommentaryCoordinationController,
  // Services
  BibleSearchService,
  SessionSerializationService,
  // Utilities
  VerseIdHelper,
  formatVerseText,
  processCommentaryLinks,
  ReferenceParser,
} from '@bible/core';
```

## Step 1: Provide an ISql Implementation

`@bible/core` has **zero runtime dependencies** - no SQLite driver, no Electron, no browser APIs. You supply the database layer by implementing `ISql`:

```typescript
interface ISql {
  queryOne<T>(sql: string, params?: SqlParameter[]): T | undefined;
  queryAll<T>(sql: string, params?: SqlParameter[]): T[];
  execute(sql: string, params?: SqlParameter[]): SqlResult;
  transaction<T>(callback: () => T): T;
  close(): void;
  isOpen(): boolean;
  getDatabasePath(): string;
}
```

**Example with better-sqlite3 (Node.js):**
```typescript
import Database from 'better-sqlite3';
import type { ISql, SqlParameter, SqlResult } from '@bible/core';

class SqliteProvider implements ISql {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }
  queryOne<T>(sql: string, params?: SqlParameter[]): T | undefined {
    return this.db.prepare(sql).get(...(params || [])) as T | undefined;
  }
  queryAll<T>(sql: string, params?: SqlParameter[]): T[] {
    return this.db.prepare(sql).all(...(params || [])) as T[];
  }
  execute(sql: string, params?: SqlParameter[]): SqlResult {
    const result = this.db.prepare(sql).run(...(params || []));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }
  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }
  close() { this.db.close(); }
  isOpen() { return this.db.open; }
  getDatabasePath() { return this.db.name; }
}
```

## Step 2: Open Databases and Create Repositories

The app uses three kinds of databases:
- **main.db** - Bible book list, module registry
- **Module databases** (e.g., `bible_kjv.db`) - Bible text, commentary entries, etc.
- **user_*.db** - Notes, highlights, bookmarks (optional)

```typescript
// Open main database
const mainDb = new SqliteProvider('data/main.db');
const bookRepo = new BibleBookRepository(mainDb);
const metadataRepo = new ModuleMetadataRepository(mainDb);

// Open a Bible module
const kjvDb = new SqliteProvider('data/modules/bible_kjv.db');
const kjvRepo = new BibleRepository(kjvDb);

// Or use ModuleLoader for automatic discovery + caching
const bibleLoader = new ModuleLoader({
  moduleType: 'bible',
  metadataRepo,
  pathResolver: { resolveModulePath: (p) => `data/${p}` },
  sqlFactory: { create: (p) => new SqliteProvider(p) },
  createRepo: (db) => new BibleRepository(db),
  fileExists: (p) => require('fs').existsSync(p),
});

const kjv = bibleLoader.get('KJV');  // Lazy-loads and caches
const esv = bibleLoader.get('ESV');  // Same pattern
```

## Step 3: Read Bible Text

```typescript
// Get a single verse
const verse = kjvRepo.getVerse(43003016);  // John 3:16
console.log(verse?.text);

// Get a chapter
const chapter = kjvRepo.getChapter(43, 3);  // John chapter 3
for (const v of chapter) {
  const formatted = formatVerseText(v);
  console.log(`${v.verse}: ${formatted.textHtml}`);
}

// Parse verse references
const helper = VerseIdHelper;
const id = helper.calculate(43, 3, 16);     // 43003016
const parsed = helper.parse(43003016);       // { bookNumber: 43, chapter: 3, verse: 16 }
```

## Step 4: Use Controllers for Stateful Features

Controllers manage business logic without any UI dependency.

### Navigation History
```typescript
const nav = new VerseNavigationController();
nav.addEntry({ verseId: 43003016, bookNumber: 43, chapter: 3, bookName: 'John' });
nav.addEntry({ verseId: 45008028, bookNumber: 45, chapter: 8, bookName: 'Romans' });

console.log(nav.canGoBack());    // true
const prev = nav.goBack();       // Returns John 3 entry
console.log(prev?.bookName);     // 'John'
```

### Tab Management
```typescript
const tabs = new BibleTabController();
const tabId = tabs.openTab({ abbreviation: 'KJV', name: 'King James Version' });
tabs.openTab({ abbreviation: 'ESV', name: 'English Standard Version' });
tabs.switchTab(0);               // Switch to KJV

const active = tabs.getActiveTab();
console.log(active?.abbreviation); // 'KJV'

// Each tab has its own navigation
const tabNav = tabs.getNavigation(tabId);
tabNav?.addEntry({ verseId: 1001001, bookNumber: 1, chapter: 1, bookName: 'Genesis' });
```

### Commentary Coordination
```typescript
const commentary = new CommentaryCoordinationController();
commentary.openTab('MHC', "Matthew Henry's Commentary");
commentary.syncToVerse(43003016);

commentary.pin();                        // Pin to John 3:16
commentary.syncToVerse(45008028);        // Bible moved to Romans 8
console.log(commentary.getEffectiveVerseId()); // Still 43003016 (pinned)
commentary.unpin();
```

### Session Persistence
```typescript
const session = new SessionSerializationService();
session.register('bible', tabs);         // BibleTabController implements SerializableController
session.register('navigation', nav);

// Save
const snapshot = session.serializeAll();
const json = JSON.stringify(snapshot);

// Restore later
const restored = JSON.parse(json);
session.restoreAll(restored);
```

## Step 5: Search

```typescript
// Full-text search
const searchRepo = new BibleSearchRepository(mainDb);
const searchService = new BibleSearchService(searchRepo, new Map([['KJV', kjvRepo]]), bookRepo);
const results = searchService.search('KJV', 'love one another');
```

## Step 6: Commentary Links (Custom Output)

By default, commentary links produce HTML anchors. Override with a custom `LinkFormatter`:

```typescript
import { processCommentaryLinks, type LinkFormatter } from '@bible/core';

// Markdown links instead of HTML
const markdownFormatter: LinkFormatter = {
  formatScriptureLink(startVerseId, endVerseId, displayText) {
    return `[${displayText}](bible://${startVerseId})`;
  }
};

const html = processCommentaryLinks(commentaryText, {
  bookNumber: 43,
  chapter: 3,
  linkFormatter: markdownFormatter,
});
```

## API Contract Interfaces

For building a full client (REST API, CLI, mobile), implement the typed interfaces:

```typescript
import type { IBibleApi, ICommentaryApi, ISearchApi } from '@bible/core';
// Import detailed types from:
import type { FormattedVerse, ChapterResult } from '@bible/core/Api/ApiTypes';
```

These interfaces define every operation available. See `packages/core/src/Api/` for the full surface.

## Cleanup

```typescript
bibleLoader.closeAll();
mainDb.close();
```
