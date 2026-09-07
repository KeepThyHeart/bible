# Services

This directory contains business logic services that provide domain-specific operations.

## Architecture

Services follow these principles:

1. **Single Responsibility**: Each service focuses on one domain area
2. **Stateless**: Services don't maintain state (state is in controllers)
3. **Repository Access**: Services use repository interfaces for data access
4. **Pure Business Logic**: No UI concerns, no state management
5. **Reusable**: Services can be used by multiple controllers

## Pattern

```typescript
import { ISomeRepository } from '../Data/Repositories/ISomeRepository';

export class SomeService {
  constructor(private someRepo: ISomeRepository) {}

  async performOperation(input: Input): Promise<Output> {
    // Business logic using repositories
    const data = this.someRepo.getData();
    // Transform, calculate, validate
    return result;
  }
}
```

## Services

### BibleTextService

**Purpose**: Fetch and format Bible text for display

**Dependencies**:
- `IBibleBookRepository` - Bible book metadata

**Key Responsibilities**:
- Fetch verses, chapters, books from Bible repositories
- Format text based on display mode (Simple, Standard, Study)
- Apply text markup (Words of Christ in red, italics, Strong's numbers)
- Prepare parallel view data

**Key Methods**:
```typescript
// Get a formatted verse
getVerse(bibleRepo, verseId, options): Promise<FormattedVerse>

// Get an entire chapter
getChapter(bibleRepo, bookNumber, chapter, options): Promise<ChapterData>

// Get parallel view data
getParallelView(bibleRepos, bookNumber, chapter, options): Promise<ParallelColumn[]>
```

**Display Modes**:
- **Simple**: Clean text, no verse numbers, minimal markup - for devotional reading
- **Standard**: Verse numbers, section headings, red letters - default mode
- **Study**: All markup including Strong's numbers, morphology - maximum information

**Example**:
```typescript
const service = new BibleTextService(bibleBookRepo);

const chapter = await service.getChapter(
  kjvRepo,
  43, // John
  3,  // Chapter 3
  {
    mode: 'standard',
    showVerseNumbers: true,
    wordsOfChristInRed: true
  }
);

console.log(chapter.bookName); // "John"
console.log(chapter.verses.length); // Number of verses in John 3
console.log(chapter.verses[15].formattedHtml); // John 3:16 formatted
```

### VerseNavigationService

**Purpose**: Handle verse navigation and reference parsing

**Dependencies**:
- `IBibleBookRepository` - Bible book metadata for validation

**Key Responsibilities**:
- Parse verse references from user input (e.g., "John 3:16", "Gen 1:1-3")
- Navigate between chapters and books (previous/next)
- Validate verse references
- Format references for display

**Key Methods**:
```typescript
// Parse reference string
parseReference(reference: string): VerseReference | undefined

// Navigate to next/previous chapter
getNextChapter(bookNumber, chapter): NavigationResult
getPreviousChapter(bookNumber, chapter): NavigationResult

// Format reference for display
formatReference(verseId): string
formatRangeReference(startVerseId, endVerseId): string

// Validation
isValidReference(bookNumber, chapter, verse): boolean
```

**Supported Reference Formats**:
- `"John 3:16"` - Single verse
- `"John 3:16-17"` - Verse range
- `"John 3"` - Entire chapter
- `"Gen 1:1"` - Genesis 1:1
- `"Rom 8:28-39"` - Romans 8:28-39

**Example**:
```typescript
const service = new VerseNavigationService(bibleBookRepo);

// Parse user input
const ref = service.parseReference('John 3:16');
console.log(ref?.bookNumber); // 43
console.log(ref?.chapter); // 3
console.log(ref?.verseStart); // 16

// Navigate
const next = service.getNextChapter(43, 3);
if (next.canNavigate) {
  console.log(`Next: ${next.targetBookNumber}:${next.targetChapter}`);
}

// Format for display
const formatted = service.formatReference(43003016);
console.log(formatted); // "John 3:16"
```

## Service Design Guidelines

### When to Create a Service

Create a service when you have:
- Complex business logic that doesn't belong in a repository
- Operations that span multiple repositories
- Reusable logic needed by multiple controllers
- Domain-specific calculations or transformations

### When NOT to Create a Service

Don't create a service for:
- Simple CRUD operations (use repositories directly)
- UI-specific logic (belongs in controllers or UI layer)
- State management (belongs in controllers)

### Service vs. Repository

**Repositories**:
- Direct database access
- CRUD operations
- One repository per database type
- Return domain models

**Services**:
- Business logic
- Multi-repository operations
- Complex transformations
- Return DTOs or formatted data

Example:
```typescript
// Repository: Simple data access
class BibleRepository {
  getVerse(verseId): BibleVerse {
    return this.sql.queryOne('SELECT * FROM verse WHERE verse_id = ?', [verseId]);
  }
}

// Service: Business logic + formatting
class BibleTextService {
  getVerse(repo, verseId, options): FormattedVerse {
    const verse = repo.getVerse(verseId);
    // Apply formatting, markup, display mode logic
    return this.formatVerse(verse, options);
  }
}
```

## Testing

Services should be tested with:
- Mock repositories
- Known inputs and expected outputs
- Edge cases and validation

Example:
```typescript
describe('VerseNavigationService', () => {
  it('should parse "John 3:16"', () => {
    const mockRepo = createMockBibleBookRepository();
    const service = new VerseNavigationService(mockRepo);

    const ref = service.parseReference('John 3:16');

    expect(ref?.bookNumber).toBe(43);
    expect(ref?.chapter).toBe(3);
    expect(ref?.verseStart).toBe(16);
  });
});
```

## Adding New Services

When creating a new service:

1. **Identify Domain**: What business logic domain does this service cover?
2. **Define Interface**: What operations does this service provide?
3. **Inject Dependencies**: Accept repository interfaces via constructor
4. **Implement Logic**: Write pure business logic without state
5. **Return DTOs**: Return data transfer objects appropriate for the consumer
6. **Document**: Add JSDoc comments with examples
7. **Test**: Write unit tests with mocked dependencies

## Relationship to Other Layers

```
+-----------------+
|  Controllers    |  State management, orchestration
+--------+--------+
         | Uses
         |
+--------v--------+
|    Services     |  Business logic, transformations
+--------+--------+
         | Uses
         |
+--------v--------+
|  Repositories   |  Data access
+-----------------+
```

Controllers use services for complex operations.
Services use repositories for data access.
Repositories use database providers (ISql) for queries.

## See Also

- [Controllers README](../Controllers/README.md) - State management layer
- [Data README](../Data/README.md) - Data access layer
- [Bible Pane Examples](../Controllers/example-bible-pane.ts) - Complete usage examples
