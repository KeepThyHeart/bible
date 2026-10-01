import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../contexts/useI18n';
import { CommentaryEntrySummary } from '../stores/useCommentaryStore';
import { formatVerseReference, parseVerseId } from '../utils/verseReference';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { DIGEST_DISPLAY_NAME, isDigestModule } from '../moduleDescriptions';

interface CommentaryTreeViewProps {
  abbreviation: string;
  summaries: CommentaryEntrySummary[];
  currentVerseId: number | null;
  onSelectVerse: (verseId: number) => void;
  onClose: () => void;
}

// Group entries by book and chapter
interface ChapterGroup {
  bookNumber: number;
  chapter: number;
  verses: CommentaryEntrySummary[];
}

interface BookGroup {
  bookNumber: number;
  chapters: ChapterGroup[];
}

const CommentaryTreeView: React.FC<CommentaryTreeViewProps> = ({
  abbreviation,
  summaries,
  currentVerseId,
  onSelectVerse,
  onClose
}) => {
  const { t } = useI18n();
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBooks, setExpandedBooks] = useState<Set<number>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // Group summaries by book and chapter
  const groupedData = useMemo(() => {
    const books: Map<number, Map<number, CommentaryEntrySummary[]>> = new Map();

    summaries.forEach(summary => {
      const { bookNumber, chapter } = parseVerseId(summary.verse_id_start);

      if (!books.has(bookNumber)) {
        books.set(bookNumber, new Map());
      }

      const bookMap = books.get(bookNumber)!;
      if (!bookMap.has(chapter)) {
        bookMap.set(chapter, []);
      }

      bookMap.get(chapter)!.push(summary);
    });

    // Convert to sorted arrays
    const result: BookGroup[] = [];
    books.forEach((chapters, bookNumber) => {
      const chapterGroups: ChapterGroup[] = [];
      chapters.forEach((verses, chapter) => {
        chapterGroups.push({ bookNumber, chapter, verses: verses.sort((a, b) => a.verse_id_start - b.verse_id_start) });
      });
      result.push({
        bookNumber,
        chapters: chapterGroups.sort((a, b) => a.chapter - b.chapter)
      });
    });

    return result.sort((a, b) => a.bookNumber - b.bookNumber);
  }, [summaries]);

  // Filter based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return groupedData;

    const query = searchQuery.toLowerCase();
    const filtered = groupedData
      .map(book => ({
        ...book,
        chapters: book.chapters
          .map(chapter => ({
            ...chapter,
            verses: chapter.verses.filter(verse => {
              const ref = formatVerseReference(verse.verse_id_start).toLowerCase();
              return ref.includes(query);
            })
          }))
          .filter(chapter => chapter.verses.length > 0)
      }))
      .filter(book => book.chapters.length > 0);

    // Auto-expand matching books and chapters
    const newExpandedBooks = new Set<number>();
    const newExpandedChapters = new Set<string>();

    filtered.forEach(book => {
      newExpandedBooks.add(book.bookNumber);
      book.chapters.forEach(chapter => {
        newExpandedChapters.add(`${book.bookNumber}-${chapter.chapter}`);
      });
    });

    setExpandedBooks(newExpandedBooks);
    setExpandedChapters(newExpandedChapters);

    return filtered;
  }, [groupedData, searchQuery]);

  // Auto-expand current verse's book and chapter
  useEffect(() => {
    if (currentVerseId) {
      const { bookNumber, chapter } = parseVerseId(currentVerseId);
      setExpandedBooks(prev => new Set(prev).add(bookNumber));
      setExpandedChapters(prev => new Set(prev).add(`${bookNumber}-${chapter}`));
    }
  }, [currentVerseId]);

  const toggleBook = (bookNumber: number) => {
    setExpandedBooks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookNumber)) {
        newSet.delete(bookNumber);
      } else {
        newSet.add(bookNumber);
      }
      return newSet;
    });
  };

  const toggleChapter = (bookNumber: number, chapter: number) => {
    const key = `${bookNumber}-${chapter}`;
    setExpandedChapters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const closeLabel = t('commentaryTreeView.close');

  return (
    <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="commentary-tree-title"
        className="bg-surface-elevated rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-border">
          <div className="flex items-center justify-between mb-md">
            <h2 id="commentary-tree-title" className="text-2xl font-semibold text-text-heading">
              {t('commentaryTreeView.title', {
                // The prop is the module's identity; the heading is prose. The
                // digest's identity is "SYNTHESIS" and its name is "Combined
                // Summary" - this heading was showing the former.
                abbreviation: isDigestModule(abbreviation) ? DIGEST_DISPLAY_NAME : abbreviation,
              })}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder={t('commentaryTreeView.searchPlaceholder')}
            aria-label={t('commentaryTreeView.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-md py-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto p-md">
          {filteredData.length === 0 ? (
            <div className="text-center text-text-secondary py-xl">
              {searchQuery
                ? t('commentaryTreeView.noMatches')
                : t('commentaryTreeView.noEntries')}
            </div>
          ) : (
            filteredData.map(book => {
              const isBookExpanded = expandedBooks.has(book.bookNumber);
              // Extract book name from full reference (e.g., "1 John 1:1" -> "1 John")
              const fullRef = formatVerseReference(book.chapters[0]?.verses[0]?.verse_id_start || 0);
              const bookName = fullRef.replace(/\s+\d+:\d+$/, ''); // Remove chapter:verse at end

              return (
                <div key={book.bookNumber} className="mb-sm">
                  {/* Book header */}
                  <button
                    type="button"
                    className="w-full text-start flex items-center px-sm py-xs hover:bg-background-warm cursor-pointer rounded"
                    onClick={() => toggleBook(book.bookNumber)}
                    aria-expanded={isBookExpanded}
                  >
                    <span aria-hidden="true" className="me-sm text-text-secondary rtl-mirror">{isBookExpanded ? '▼' : '▶'}</span>
                    <span className="font-semibold text-text-heading">{bookName}</span>
                    <span className="ms-sm text-sm text-text-secondary">
                      {t(
                        'commentaryTreeView.verseCount',
                        { count: book.chapters.reduce((sum, ch) => sum + ch.verses.length, 0), },
                      )}
                    </span>
                  </button>

                  {/* Chapters */}
                  {isBookExpanded && book.chapters.map(chapter => {
                    const chapterKey = `${book.bookNumber}-${chapter.chapter}`;
                    const isChapterExpanded = expandedChapters.has(chapterKey);

                    return (
                      <div key={chapterKey} className="ms-md">
                        {/* Chapter header */}
                        <button
                          type="button"
                          className="w-full text-start flex items-center px-sm py-xs hover:bg-background-warm cursor-pointer rounded"
                          onClick={() => toggleChapter(book.bookNumber, chapter.chapter)}
                          aria-expanded={isChapterExpanded}
                        >
                          <span aria-hidden="true" className="me-sm text-text-secondary text-sm rtl-mirror">
                            {isChapterExpanded ? '▼' : '▶'}
                          </span>
                          <span className="text-text-primary">
                            {t('commentaryTreeView.chapterLabel', { chapter: chapter.chapter, })}
                          </span>
                          <span className="ms-sm text-sm text-text-secondary">
                            {t('commentaryTreeView.verseCount', { count: chapter.verses.length, })}
                          </span>
                        </button>

                        {/* Verses */}
                        {isChapterExpanded && chapter.verses.map(verse => {
                          const { verse: verseNum } = parseVerseId(verse.verse_id_start);
                          const isActive = verse.verse_id_start === currentVerseId;

                          return (
                            <button
                              type="button"
                              key={verse.verse_id_start}
                              aria-current={isActive ? 'true' : undefined}
                              className={`w-full text-start ms-md px-sm py-xs cursor-pointer rounded transition-colors ${
                                isActive
                                  ? 'bg-accent text-text-on-accent font-semibold'
                                  : 'hover:bg-background-warm text-text-primary'
                              }`}
                              onClick={() => {
                                onSelectVerse(verse.verse_id_start);
                                onClose();
                              }}
                            >
                              <span className="me-sm">
                                {t('commentaryTreeView.verseLabel', { verse: verseNum })}
                              </span>
                              {verse.word_count && (
                                <span className={`text-sm ${isActive ? 'text-text-on-accent opacity-80' : 'text-text-secondary'}`}>
                                  {t('commentaryTreeView.wordCount', { count: verse.word_count, })}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-xl py-md border-t border-border flex justify-between items-center text-sm text-text-secondary">
          <span>
            {t('commentaryTreeView.totalEntries', { count: summaries.length, })}
          </span>
          <button
            type="button"
            className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommentaryTreeView;
