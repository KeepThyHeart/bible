# Bible Text Markup System (Highlights & Underlines)

A comprehensive highlighting and underlining system for Bible text with word-level precision, multi-verse support, and extensible design.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Components](#components)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Customization](#customization)
- [Performance](#performance)
- [Testing](#testing)

## Features

- **Word-Level Precision**: Highlight specific word ranges, not character positions
- **Multi-Verse Support**: Seamlessly highlight across verse boundaries
- **Six Colors**: yellow, green, blue, red, purple, orange
- **Four Underline Styles**: solid, wavy, dotted, dashed
- **Combined Markup**: Highlight + underline simultaneously with independent colors
- **Overlapping Markup**: Multiple markups may cover the same words; a word carries every id that claims it
- **Real-Time Preview**: Visual feedback during drag selection
- **Module-Specific**: Highlights tied to specific Bible translation
- **Note Integration**: Optional linking to user notes
- **Extensible Design**: Metadata JSON for future markup types (strikethrough, text boxes, etc.)

## Architecture

### Data Layer (`packages/core/src/Data/`)

```
Data/
+-- Core/
|   +-- Types.ts                          # HighlightColor, UnderlineStyle, MarkupType
+-- Models/User/
|   +-- UserTextMarkup.ts                 # Main model with helper methods
+-- Repositories/
    +-- IUserTextMarkupRepository.ts      # Interface
    +-- UserTextMarkupRepository.ts       # Implementation (overlaps kept, not resolved)
```

### UI Layer (`apps/desktop/src/ui/`)

```
ui/
+-- components/highlights/
|   +-- HighlightRenderer.tsx             # Applies markup to verse HTML
|   +-- HighlightSelector.tsx             # Drag-to-highlight interaction
|   +-- HighlightMenu.tsx                 # Color/style picker
|   +-- FloatingAnnotationToolbar.tsx     # Toolbar shown over a live selection
|   +-- UnderlineSwatch.tsx               # One swatch of the underline-colour picker
|   +-- capturedSelection.ts              # DOM selection -> verse/word indices
|   +-- IntegrationExample.tsx            # Full example
|   +-- index.ts                          # Component exports
+-- stores/
|   +-- useHighlightStore.ts              # Zustand state management
+-- utils/
|   +-- wordIndexing.ts                   # Word extraction and DOM navigation
|   +-- highlightHelpers.ts               # Helper utilities
+-- styles/
    +-- highlights.css                    # Styling for highlights and underlines
```

## Quick Start

### 1. Install Dependencies

The highlights feature requires:
- `@bible/core` - Data layer with models and repositories
- `zustand` - State management (already in package.json)
- `react` - UI framework

### 2. Import CSS

Add to your main `App.tsx`:

```typescript
import './styles/highlights.css';
```

### 3. Initialize Repository

Core defines the `ISql` interface and the repository; each app supplies its own provider (`electron/providers/SqliteProvider.ts` in the desktop main process).

```typescript
import { UserTextMarkupRepository } from '@bible/core';
import { SqliteProvider } from '../../electron/providers/SqliteProvider';

// Create database provider
const userDb = new SqliteProvider('data/users/user_john.db');

// Create repository
const markupRepository = new UserTextMarkupRepository(userDb);
```

### 4. Use in Bible Pane

See `IntegrationExample.tsx` for a complete working example.

Basic usage:

```typescript
import { HighlightedVerse, HighlightSelector, HighlightMenu } from './components/highlights';
import { useHighlightStore } from './stores/useHighlightStore';

function BiblePane({ moduleId, verses }) {
  const { loadHighlightsForVerseRange, createHighlight } = useHighlightStore();

  // Load highlights when chapter changes
  useEffect(() => {
    loadHighlightsForVerseRange(moduleId, startVerseId, endVerseId, repository);
  }, [moduleId, startVerseId, endVerseId]);

  return (
    <HighlightSelector moduleId={moduleId} repository={repository} onShowMenu={handleShowMenu}>
      {verses.map(verse => (
        <HighlightedVerse
          key={verse.id}
          verseId={verse.id}
          verseHTML={verse.html}
          moduleId={moduleId}
        />
      ))}
    </HighlightSelector>
  );
}
```

## Components

### `HighlightedVerse`

Renders a verse with highlights applied.

```typescript
<HighlightedVerse
  verseId={43003016}
  verseHTML="For God so <em>loved</em> the world..."
  moduleId={1}
/>
```

**Props:**
- `verseId: number` - Verse ID (e.g., John 3:16 = 43003016)
- `verseHTML: string` - HTML content of the verse
- `moduleId: number` - Bible module ID
- `onWordMouseDown?: (verseId, wordIndex, event) => void` - Optional mouse event handlers
- `onWordMouseMove?: (verseId, wordIndex, event) => void`
- `onWordMouseUp?: (verseId, wordIndex, event) => void`

### `HighlightSelector`

Wraps content to enable drag-to-highlight interaction.

```typescript
<HighlightSelector
  moduleId={1}
  repository={markupRepository}
  onShowMenu={(position, selection) => {
    // Show color picker menu
  }}
>
  {children}
</HighlightSelector>
```

**Props:**
- `moduleId: number` - Current Bible module ID
- `repository: IUserTextMarkupRepository` - Repository instance
- `onShowMenu: (position, selection) => void` - Called when user completes selection

### `HighlightMenu`

Color and style picker menu.

```typescript
<HighlightMenu
  position={{ x: 100, y: 200 }}
  onSelectHighlight={(color, markupType, underlineStyle, underlineColor) => {
    // Create highlight with selected options
  }}
  onCancel={() => {
    // User cancelled
  }}
/>
```

**Props:**
- `position: { x: number; y: number }` - Menu position
- `onSelectHighlight: (color, markupType, underlineStyle?, underlineColor?) => void` - Selection callback
- `onCancel: () => void` - Cancel callback

## Database Schema

### Table: `user_text_markup`

```sql
CREATE TABLE user_text_markup (
    markup_id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    verse_id_start INTEGER NOT NULL,
    verse_id_end INTEGER,
    text_start INTEGER,              -- Word index (0-based)
    text_end INTEGER,                -- Word index (0-based)
    color TEXT NOT NULL,             -- Primary color
    note_id INTEGER,                 -- Optional note link
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,                   -- JSON: markup type, styles, extensibility

    FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL,
    CHECK (color IN ('yellow', 'green', 'blue', 'red', 'purple', 'orange'))
);
```

## API Reference

### `UserTextMarkup` Model

```typescript
class UserTextMarkup {
  markupId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  textStart?: number;
  textEnd?: number;
  color: HighlightColor;
  noteId?: number;
  createdDate?: string;
  metadata?: TextMarkupMetadata;

  // Helper methods
  isSingleVerse(): boolean;
  isMultiVerse(): boolean;
  isPartialText(): boolean;
  hasNote(): boolean;
  getVerseRange(): { start: VerseId; end: VerseId };
  getMarkupType(): 'highlight' | 'underline' | 'both';
  getUnderlineStyle(): 'solid' | 'wavy' | 'dotted' | 'dashed';
  getUnderlineColor(): HighlightColor;
  hasHighlight(): boolean;
  hasUnderline(): boolean;
  coversVerse(verseId: VerseId): boolean;
  getWordRangeForVerse(verseId: VerseId): { start: number; end: number | null } | null;
}
```

### `IUserTextMarkupRepository` Interface

```typescript
interface IUserTextMarkupRepository {
  /** Inserts as given. Overlapping markup is allowed and is NOT resolved away. */
  create(markup: UserTextMarkup): Promise<UserTextMarkup>;
  update(markup: UserTextMarkup): Promise<void>;
  delete(markupId: number): Promise<void>;
  getById(markupId: number): Promise<UserTextMarkup | null>;
  getForVerse(verseId: VerseId, moduleId: number): Promise<UserTextMarkup[]>;
  getForVerseRange(start: VerseId, end: VerseId, moduleId: number): Promise<UserTextMarkup[]>;
  getForModule(moduleId: number): Promise<UserTextMarkup[]>;
  getByColor(color: HighlightColor, moduleId?: number): Promise<UserTextMarkup[]>;
  getByNote(noteId: number): Promise<UserTextMarkup[]>;
  deleteForVerse(verseId: VerseId, moduleId: number): Promise<void>;
  deleteForVerseRange(start: VerseId, end: VerseId, moduleId: number): Promise<void>;
  countForModule(moduleId: number): Promise<number>;
  findOverlapping(start: VerseId, end: VerseId | null, moduleId: number): Promise<UserTextMarkup[]>;
}
```

### `useHighlightStore` Zustand Store

```typescript
const {
  // State
  highlightsByModule,
  loading,
  error,

  // Actions
  loadHighlightsForModule,
  loadHighlightsForVerseRange,
  createHighlight,
  updateHighlight,
  deleteHighlight,

  // Selectors
  getHighlightsForVerse,
  getHighlightById,

  // Clear
  clearModule,
  clearAll
} = useHighlightStore();
```

## Usage Examples

### Creating a Simple Highlight

```typescript
const markup = new UserTextMarkup({
  moduleId: 1,                  // KJV
  verseIdStart: 43003016,       // John 3:16
  textStart: 3,                 // 4th word
  textEnd: 7,                   // 8th word
  color: 'yellow',
  metadata: {
    markupType: 'highlight',
    version: 1
  }
});

await createHighlight(markup, repository);
```

### Creating a Multi-Verse Highlight

```typescript
const markup = new UserTextMarkup({
  moduleId: 1,
  verseIdStart: 43003016,       // John 3:16
  verseIdEnd: 43003018,         // John 3:18
  textStart: 5,                 // Word 5 of first verse
  textEnd: 12,                  // Word 12 of last verse
  color: 'green',
  metadata: {
    markupType: 'highlight',
    version: 1
  }
});

await createHighlight(markup, repository);
```

### Creating Highlight with Underline

```typescript
const markup = new UserTextMarkup({
  moduleId: 1,
  verseIdStart: 43003016,
  textStart: 0,
  textEnd: 10,
  color: 'yellow',
  metadata: {
    markupType: 'both',
    underlineStyle: 'wavy',
    underlineColor: 'red',
    version: 1
  }
});

await createHighlight(markup, repository);
```

### Getting Highlight Statistics

```typescript
import { getHighlightStats } from './utils/highlightHelpers';

const highlights = await repository.getForModule(moduleId);
const stats = getHighlightStats(highlights);

console.log(`Total: ${stats.total}`);
console.log(`Yellow: ${stats.byColor.yellow}`);
console.log(`With notes: ${stats.withNotes}`);
console.log(`Verses highlighted: ${stats.versesHighlighted}`);
```

### Exporting Highlights

```typescript
import { exportToJSON, exportToCSV } from './utils/highlightHelpers';

const highlights = await repository.getForModule(moduleId);

// Export to JSON
const json = exportToJSON(highlights);
await fs.writeFile('highlights.json', json);

// Export to CSV
const csv = exportToCSV(highlights);
await fs.writeFile('highlights.csv', csv);
```

## Customization

### Custom Colors

Edit `highlights.css`:

```css
.highlight-custom {
  background-color: rgba(255, 105, 180, 0.4);  /* Hot pink */
}
```

Update Types.ts:

```typescript
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple' | 'orange' | 'custom';
```

### Custom Underline Styles

```css
.underline-double {
  text-decoration: underline;
  text-decoration-style: double;
  text-decoration-thickness: 2px;
}
```

## Performance

### Optimization Strategies

1. **Lazy Loading**: Load highlights only for visible verse range
   ```typescript
   loadHighlightsForVerseRange(moduleId, startVerse, endVerse, repository);
   ```

2. **Caching**: Zustand store caches highlights to avoid redundant queries

3. **Virtual Scrolling**: For long chapters, use react-window or react-virtual

4. **Indexed Queries**: Database indexes on `verse_id_start`, `verse_id_end`, `module_id`

5. **Batch Operations**: Use transactions for bulk create/update/delete

### Performance Benchmarks

- Render 100 verses with 50 highlights: <100ms
- Create a highlight overlapping an existing one: <50ms
- Query highlights for chapter (50 verses): <10ms

## Testing

### Unit Tests

Test word indexing:

```typescript
import { extractWords } from './utils/wordIndexing';

test('extractWords strips HTML', () => {
  const html = '<sup>16</sup> For God so <em>loved</em> the world';
  const words = extractWords(html);
  expect(words).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
});
```

Test that overlaps are kept, not resolved:

```typescript
test('an overlapping highlight does not delete the one beneath it', async () => {
  const existing = await repository.create(new UserTextMarkup({ verseIdStart: 16, ... }));
  await repository.create(new UserTextMarkup({ verseIdStart: 16, verseIdEnd: 18, ... }));

  // create() inserts directly - see the comment at the top of it.
  expect(await repository.getById(existing.markupId!)).not.toBeNull();
});
```

The UI side of this is covered by `removeFormattingFlow.test.tsx`, which also covers removal - including a word carrying several markup ids at once.

### Integration Tests

Test end-to-end flow:

```typescript
test('create highlight via UI flow', async () => {
  render(<BiblePaneWithHighlights moduleId={1} verses={testVerses} />);

  // Simulate drag selection
  const word1 = screen.getByText('God');
  const word2 = screen.getByText('world');

  fireEvent.mouseDown(word1);
  fireEvent.mouseMove(word2);
  fireEvent.mouseUp(word2);

  // Select color from menu
  const yellowButton = screen.getByTitle('yellow');
  fireEvent.click(yellowButton);

  // Verify highlight created
  const highlights = await repository.getForVerse(43003016, 1);
  expect(highlights).toHaveLength(1);
  expect(highlights[0].color).toBe('yellow');
});
```

## Additional Resources

- [Integration Example](./IntegrationExample.tsx) - Working example with detailed comments
- [Feature docs](../../../../docs/README.md) - Per-feature file listings for the desktop app

## Contributing

When adding new features:

1. Update the `UserTextMarkup` model if adding new helper methods
2. Add new repository methods to `IUserTextMarkupRepository` interface first
3. Update CSS for new colors/styles
4. Add tests for new functionality
5. Update this README with examples

## License

Part of the Bible Desktop App - see main repository for license information.
