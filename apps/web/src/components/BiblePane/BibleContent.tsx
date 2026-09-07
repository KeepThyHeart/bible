import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { VerseRenderer } from './VerseRenderer';
import { InterlinearLayoutToggle } from './InterlinearLayoutToggle';
import { isInterlinearPending } from './interlinearPending';
import { BookChapterPicker } from './BookChapterPicker';
import { isSingleChapterBook, formatPassageRef } from '../../constants';
import { getAllBookNames, getLocalizedBookName } from '../../utils/bookNames';
import { sanitizeHtml } from '../../utils/sanitize';
import type { InterlinearWordData, StrongsEntryData } from '../../types';
import type { VotdData } from '../../providers/interfaces';

function VerseOfTheDay() {
  const { t } = useTranslation();
  const [votd, setVotd] = useState<VotdData | null>(null);

  useEffect(() => {
    bibleStore.getVerseOfTheDay()
      .then(data => setVotd(data))
      .catch(() => {});
  }, []);

  if (!votd || !votd.text) return null;

  const ref = formatPassageRef(votd.book, votd.chapter, votd.verse);

  return (
    <div
      class="bible-content__votd"
      onClick={() => bibleStore.navigateTo(votd.book, votd.chapter, votd.verse)}
    >
      <div class="bible-content__votd-label">
        {votd.holiday ? t('bibleContent.votdHoliday', { holiday: votd.holiday }) : t('bibleContent.votdLabel')}
      </div>
      <div class="bible-content__votd-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(votd.text_html || votd.text) }} />
      <div class="bible-content__votd-ref">{ref}</div>
    </div>
  );
}

// Books with only one chapter — "Jude 5" means "Jude 1:5", not "Jude chapter 5"
const SINGLE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65]); // Obadiah, Philemon, 2 John, 3 John, Jude

function parseReference(input: string): { book: number; chapter: number; verse?: number; endVerse?: number } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const bookEntries = Object.entries(getAllBookNames());
  for (const [numStr, name] of bookEntries) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    const lowerInput = trimmed.toLowerCase();
    const abbrevs = [lowerName, lowerName.substring(0, 3)];
    if (/^\d/.test(lowerName)) abbrevs.push(lowerName.replace(' ', ''));
    for (const abbr of abbrevs) {
      if (lowerInput.startsWith(abbr)) {
        const rest = trimmed.substring(abbr.length).trim();
        // Groups: 1 = chapter (or verse in a single-chapter book), 2 = end of a
        // bare range ("Jude 5-7"), 3 = verse, 4 = end verse ("John 3:16-18").
        const match = rest.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
        if (match) {
          let chapter = parseInt(match[1], 10);
          let verse = match[3] ? parseInt(match[3], 10) : undefined;
          let endVerse = match[4] ? parseInt(match[4], 10) : undefined;
          // For single-chapter books, "Jude 5" means verse 5, not chapter 5 —
          // and "Jude 5-7" is a verse range in chapter 1.
          if (SINGLE_CHAPTER_BOOKS.has(bookNum) && verse === undefined) {
            verse = chapter;
            chapter = 1;
            endVerse = match[2] ? parseInt(match[2], 10) : undefined;
          }
          return { book: bookNum, chapter, verse, endVerse };
        }
        if (!rest) return { book: bookNum, chapter: 1 };
      }
    }
  }
  return null;
}

function getCoverageMessage(coveredBooks: number[] | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!coveredBooks || coveredBooks.length === 0) {
    return t('bibleContent.coverageNone');
  }

  const hasOT = coveredBooks.some(b => b <= 39);
  const hasNT = coveredBooks.some(b => b >= 40);

  // Full NT only
  if (!hasOT && coveredBooks.length === 27) {
    return t('bibleContent.coverageNTOnly');
  }
  // Full OT only
  if (!hasNT && coveredBooks.length === 39) {
    return t('bibleContent.coverageOTOnly');
  }

  // Single book
  if (coveredBooks.length === 1) {
    const bookName = getLocalizedBookName(coveredBooks[0]);
    return t('bibleContent.coverageSingleBook', { bookName });
  }

  // A few books (up to 5) — list them
  if (coveredBooks.length <= 5) {
    const names = coveredBooks.map(b => getLocalizedBookName(b)).join(', ');
    return t('bibleContent.coverageFewBooks', { names });
  }

  // Partial NT or OT
  if (!hasOT) {
    const names = coveredBooks.map(b => getLocalizedBookName(b)).join(', ');
    return t('bibleContent.coveragePartialNT', { names });
  }
  if (!hasNT) {
    const names = coveredBooks.map(b => getLocalizedBookName(b)).join(', ');
    return t('bibleContent.coveragePartialOT', { names });
  }

  // Mixed / partial — summarize
  const otCount = coveredBooks.filter(b => b <= 39).length;
  const ntCount = coveredBooks.filter(b => b >= 40).length;
  const parts: string[] = [];
  if (otCount > 0) parts.push(`${otCount} of 39 Old Testament`);
  if (ntCount > 0) parts.push(`${ntCount} of 27 New Testament`);

  return t('bibleContent.coveragePartial', { parts: parts.join(' and ') });
}

interface BibleContentProps {
  interlinearWords?: InterlinearWordData[];
  strongsEntries?: Record<string, StrongsEntryData>;
  interlinearLoading?: boolean;
  interlinearUnavailable?: boolean;
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
  onCopyVerse?: (verseId: number) => void;
  onCommentaryVerse?: (verseId: number) => void;
}

export function BibleContent({
  interlinearWords,
  strongsEntries,
  interlinearLoading,
  interlinearUnavailable,
  onStrongsClick,
  onStrongsHover,
  onStrongsLeave,
  onCopyVerse,
  onCommentaryVerse,
}: BibleContentProps) {
  const { t } = useTranslation();
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const displayMode = tab?.displayMode ?? 'standard';
  const studyShowInterlinear = useStore(bibleStore, () => bibleStore.studyShowInterlinear);
  const studyShowNotes = useStore(bibleStore, () => bibleStore.studyShowNotes);
  // Whether this chapter carries any publisher footnotes at all. Modules that
  // ship none leave the Notes toggle with nothing to reveal.
  const hasNotes = tab?.verses.some(v => v.footnotes && v.footnotes.length > 0) ?? false;
  const [refValue, setRefValue] = useState('');
  const [refError, setRefError] = useState('');
  const refInputRef = useRef<HTMLInputElement>(null);
  const showBookPicker = useStore(bibleStore, () => bibleStore.showBookPicker);

  if (!tab) return <div class="bible-content bible-content--empty">{t('bibleContent.noTabSelected')}</div>;

  if (!tab.book || !tab.chapter) {
    const handleRefSubmit = (e: Event) => {
      e.preventDefault();
      const ref = parseReference(refValue);
      if (ref) {
        setRefError('');
        bibleStore.navigateTo(ref.book, ref.chapter, ref.verse, { endVerse: ref.endVerse });
        setRefValue('');
      } else if (refValue.trim()) {
        setRefError(t('bibleContent.refNotFound', { ref: refValue.trim() }));
      }
    };

    return (
      <div class="bible-content bible-content--empty">
        <div class="bible-content__welcome">
          <i class="fa-solid fa-book-bible fa-3x" style={{ color: 'var(--accent-color)', opacity: 0.3, marginBottom: '16px' }} />
          <p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>{t('bibleContent.enterPassage')}</p>
          <form onSubmit={handleRefSubmit} action="javascript:void(0)" class="bible-content__ref-form">
            <input
              ref={refInputRef}
              type="text"
              placeholder={t('bibleContent.refPlaceholder')}
              value={refValue}
              onInput={(e) => { setRefValue((e.target as HTMLInputElement).value); setRefError(''); }}
              class="bible-content__ref-input"
            />
            <button type="submit" class="bible-content__ref-btn">
              <i class="fa-solid fa-arrow-right" /> {t('bibleContent.go')}
            </button>
          </form>
          {refError && <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginTop: '8px' }}>{refError}</p>}
          <VerseOfTheDay />
        </div>
      </div>
    );
  }

  const showVerseNumbers = displayMode !== 'reading';

  const handleVerseClick = (verseId: number, extend = false) => {
    if (extend) {
      // Shift-click widens the passage without moving the anchor, so the study
      // panes keep showing the verse the reader actually chose. No commentary
      // reload for the same reason — nothing about the focus verse changed.
      bibleStore.extendSelectionTo(verseId);
      return;
    }
    bibleStore.setStudyVerse(verseId);
    if (tab.book && tab.chapter) {
      commentaryStore.loadForChapter(tab.book, tab.chapter);
    }
  };

  // Verses between the anchor and the shift-clicked end, excluding the anchor
  // itself — those render faintly to show they are along for the copy.
  const selectedRange = tab.selectionEndVerse != null && tab.studyVerse != null
    ? {
        start: Math.min(tab.studyVerse, tab.selectionEndVerse),
        end: Math.max(tab.studyVerse, tab.selectionEndVerse),
      }
    : null;

  // Chapter navigation helpers
  const book = tab.book ? moduleStore.getBookByNumber(tab.book) : null;
  const maxChapter = book?.chapter_count ?? 999;
  const bookName = tab.book ? getLocalizedBookName(tab.book) : '';

  // Paging is a sequential step: it modifies the current history entry instead
  // of appending one per chapter read through.
  const PAGE = { replace: true } as const;

  const goToPrev = () => {
    if (!tab.book || !tab.chapter) return;
    if (tab.chapter > 1) {
      bibleStore.navigateTo(tab.book, tab.chapter - 1, undefined, PAGE);
    } else if (tab.book > 1) {
      const prevBook = moduleStore.getBookByNumber(tab.book - 1);
      if (prevBook) bibleStore.navigateTo(tab.book - 1, prevBook.chapter_count, undefined, PAGE);
    }
  };

  const goToNext = () => {
    if (!tab.book || !tab.chapter) return;
    if (tab.chapter < maxChapter) {
      bibleStore.navigateTo(tab.book, tab.chapter + 1, undefined, PAGE);
    } else if (tab.book < 66) {
      bibleStore.navigateTo(tab.book + 1, 1, undefined, PAGE);
    }
  };

  const canGoPrev = (tab.book ?? 0) > 1 || (tab.chapter ?? 0) > 1;
  const canGoNext = (tab.book ?? 0) < 66 || (tab.chapter ?? 0) < maxChapter;

  // Group interlinear words by verse
  const wordsByVerse = new Map<number, InterlinearWordData[]>();
  if (interlinearWords) {
    for (const w of interlinearWords) {
      const existing = wordsByVerse.get(w.verseId) || [];
      existing.push(w);
      wordsByVerse.set(w.verseId, existing);
    }
  }

  // While interlinear data is on its way the verses are not rendered at all —
  // see the exclusive branch below. Shared with BiblePane's scroll-to-verse
  // effect, which must not measure a DOM that holds the spinner.
  const interlinearPending = isInterlinearPending(displayMode, studyShowInterlinear, interlinearLoading);

  // Determine content to render below the header
  // Treat as loading if we have a book/chapter set but no verses yet and no error
  const isLoading = tab.loading || !!(tab.book && tab.chapter && tab.verses.length === 0 && !tab.loadError);
  const isEmpty = !isLoading && tab.verses.length === 0;

  return (
    <div class={`bible-content bible-content--${displayMode}`}>
      {/* Chapter heading with nav buttons — always rendered to prevent flicker */}
      <div class="bible-content__chapter-header">
        <button class="bible-content__nav-btn" disabled={!canGoPrev || isLoading} onClick={goToPrev}>
          <i class="fa-solid fa-chevron-left" />
        </button>
        <h2
          class="bible-content__chapter-title bible-content__chapter-title--tappable"
          onClick={() => bibleStore.openBookPicker()}
          title={t('bibleContent.goToBookChapter')}
        >
          {isSingleChapterBook(tab.book) ? bookName : `${bookName} ${tab.chapter}`} <i class="fa-solid fa-caret-down bible-content__chapter-caret" />
        </h2>
        <button class="bible-content__nav-btn" disabled={!canGoNext || isLoading} onClick={goToNext}>
          <i class="fa-solid fa-chevron-right" />
        </button>
      </div>
      {isLoading ? (
        <div class="bible-content bible-content--loading">
          <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }} />
          {t('bibleContent.loading')}
        </div>
      ) : isEmpty ? (
        <div class="bible-content__no-content">
          <i class={`fa-solid ${tab.loadError ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} style={{ fontSize: '1.5em', color: tab.loadError ? 'var(--text-muted)' : 'var(--accent-color)', opacity: 0.6, marginBottom: '8px' }} />
          <p>{tab.loadError || getCoverageMessage(tab.coveredBooks, t)}</p>
          {tab.loadError && (
            <button
              style={{ marginTop: '12px', padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--accent-color)', cursor: 'pointer' }}
              onClick={() => tab.book && tab.chapter && bibleStore.navigateTo(tab.book, tab.chapter)}
            >
              <i class="fa-solid fa-rotate-right" style={{ marginRight: '6px' }} />{t('bibleContent.retry')}
            </button>
          )}
        </div>
      ) : (
        <>
          {displayMode === 'study' && (
            <div class="bible-content__study-toggles">
              <label class="bible-content__study-toggle">
                <input
                  type="checkbox"
                  checked={studyShowInterlinear}
                  onChange={(e) => bibleStore.setStudyShowInterlinear((e.target as HTMLInputElement).checked)}
                />
                {t('bibleContent.interlinear')}
              </label>
              {/* Notes are publisher footnotes carried in the Bible module
                  itself. Most modules ship none — no installed one currently
                  does — and a checkbox that can never reveal anything just
                  reads as broken, so it is disabled and says why. */}
              <label
                class={`bible-content__study-toggle${hasNotes ? '' : ' bible-content__study-toggle--unavailable'}`}
                title={hasNotes ? undefined : t('bibleContent.notesUnavailable')}
              >
                <input
                  type="checkbox"
                  checked={studyShowNotes && hasNotes}
                  disabled={!hasNotes}
                  onChange={(e) => bibleStore.setStudyShowNotes((e.target as HTMLInputElement).checked)}
                />
                {t('bibleContent.notes')}
              </label>
              {/* Layout switch sits with the interlinear it changes, not three
                  clicks away in Settings. Hidden when the interlinear is off,
                  since it would control nothing. */}
              {studyShowInterlinear && <InterlinearLayoutToggle />}
            </div>
          )}
          {interlinearPending ? (
            // Exclusive, not a banner above the verses: rendering the plain
            // text first and then swapping in the taller interlinear rows made
            // the whole chapter jump under the reader.
            <div class="bible-content__interlinear-status bible-content__interlinear-status--loading">
              <i class="fa-solid fa-spinner fa-spin" /> {t('bibleContent.interlinearLoading')}
            </div>
          ) : (
            <>
            {interlinearUnavailable && studyShowInterlinear && (
              <div class="bible-content__interlinear-status bible-content__interlinear-status--unavailable">
                <i class="fa-solid fa-circle-info" /> {t('bibleContent.interlinearUnavailable')}
              </div>
            )}
            {tab.verses.map(verse => (
              <VerseRenderer
                key={verse.verse_id}
                verse={verse}
                isHighlighted={tab.studyVerse === verse.verse_id}
                isSelected={tab.previewVerse != null && (
                  tab.previewVerseEnd
                    ? verse.verse_id >= tab.previewVerse && verse.verse_id <= tab.previewVerseEnd
                    : verse.verse_id === tab.previewVerse
                )}
                isInRange={selectedRange != null
                  && verse.verse_id >= selectedRange.start
                  && verse.verse_id <= selectedRange.end}
                showVerseNumbers={showVerseNumbers}
                displayMode={displayMode}
                interlinearWords={studyShowInterlinear ? wordsByVerse.get(verse.verse_id) : undefined}
                strongsEntries={strongsEntries}
                showNotes={studyShowNotes}
                onVerseClick={handleVerseClick}
                onStrongsClick={onStrongsClick}
                onStrongsHover={onStrongsHover}
                onStrongsLeave={onStrongsLeave}
              />
            ))}
            </>
          )}
        </>
      )}
      {/* Mobile-only action bar — currently disabled; use context menu instead */}
      <BookChapterPicker
        isOpen={showBookPicker}
        onClose={() => bibleStore.closeBookPicker()}
        onSelect={(book, chapter, verse, endVerse) => {
          bibleStore.closeBookPicker();
          bibleStore.navigateTo(book, chapter, verse, { endVerse });
        }}
        currentBook={tab.book}
        currentChapter={tab.chapter}
      />
    </div>
  );
}
