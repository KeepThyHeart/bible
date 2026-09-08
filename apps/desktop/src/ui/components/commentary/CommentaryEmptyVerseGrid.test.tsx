import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentaryEmptyVerseGrid from './CommentaryEmptyVerseGrid';
import type { CommentaryEntrySummary } from '../../stores/useCommentaryStore';
import { enT } from '../../testing/enCatalog';

// The component resolves its own strings; mocking the hook keeps the test
// free of a ContextProvider while still asserting the shipped English.
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

describe('CommentaryEmptyVerseGrid', () => {
  const johnCh3Vid = (verse: number) => 43_003_000 + verse; // John 3:verse

  const summaries: CommentaryEntrySummary[] = [
    { verse_id_start: johnCh3Vid(1), entry_level: 'verse', word_count: 10 },
    { verse_id_start: johnCh3Vid(3), verse_id_end: johnCh3Vid(5), entry_level: 'passage', word_count: 40 },
    { verse_id_start: johnCh3Vid(16), entry_level: 'verse', word_count: 100 },
    // Outside chapter - should be ignored
    { verse_id_start: 43_004_001, entry_level: 'verse', word_count: 20 },
  ];

  it('renders verse buttons for covered verses only', () => {
    render(
      <CommentaryEmptyVerseGrid
        summaries={summaries}
        currentVerseId={johnCh3Vid(16)}
        onSelectVerse={vi.fn()}
      />,
    );
    // Verse 1, 3, 4, 5 (from range), 16 - five buttons
    expect(screen.getByTestId('commentary-empty-verse-btn-1')).toBeTruthy();
    expect(screen.getByTestId('commentary-empty-verse-btn-3')).toBeTruthy();
    expect(screen.getByTestId('commentary-empty-verse-btn-4')).toBeTruthy();
    expect(screen.getByTestId('commentary-empty-verse-btn-5')).toBeTruthy();
    expect(screen.getByTestId('commentary-empty-verse-btn-16')).toBeTruthy();
    // Verse 2 has no entry
    expect(screen.queryByTestId('commentary-empty-verse-btn-2')).toBeNull();
    // Verse from John 4 should not appear in John 3 grid
    expect(screen.queryByTestId('commentary-empty-verse-btn-6')).toBeNull();
  });

  it('calls onSelectVerse with the entry start verseId when clicked', async () => {
    const user = userEvent.setup();
    const onSelectVerse = vi.fn();
    render(
      <CommentaryEmptyVerseGrid
        summaries={summaries}
        currentVerseId={johnCh3Vid(16)}
        onSelectVerse={onSelectVerse}
      />,
    );
    await user.click(screen.getByTestId('commentary-empty-verse-btn-3'));
    // Range entry starts at verse 3
    expect(onSelectVerse).toHaveBeenCalledWith(johnCh3Vid(3));
  });

  it('renders nothing when there are no matching entries in the chapter', () => {
    const empty: CommentaryEntrySummary[] = [
      { verse_id_start: 43_004_001, entry_level: 'verse', word_count: 20 },
    ];
    const { container } = render(
      <CommentaryEmptyVerseGrid
        summaries={empty}
        currentVerseId={johnCh3Vid(16)}
        onSelectVerse={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
