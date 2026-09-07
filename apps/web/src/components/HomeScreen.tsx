import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../stores/bibleStore';
import { commentaryStore } from '../stores/commentaryStore';
import { searchStore } from '../stores/searchStore';
import { focusSearchField } from '../utils/focusSearchField';
import { sanitizeHtml } from '../utils/sanitize';
import type { VotdData } from '../providers/interfaces';

interface HomeScreenProps {
  onNavigate?: (view: 'bible' | 'search') => void;
}

export function HomeScreen({ onNavigate }: HomeScreenProps) {
  const { t } = useTranslation();
  const [votd, setVotd] = useState<VotdData | null>(null);

  useEffect(() => {
    bibleStore.getVerseOfTheDay()
      .then(data => setVotd(data))
      .catch(() => {});
  }, []);

  const handleReadBible = () => {
    bibleStore.setShowHome(false);
    onNavigate?.('bible');
  };

  const handleSearch = () => {
    // Mark the search UI open so the desktop right-pane strip actually renders
    // (and highlights) the Search tab — it is gated on searchStore.isOpen, so
    // without this the pane switches to a mode with no matching tab and the
    // click reads as doing nothing.
    searchStore.open();
    commentaryStore.setRightPaneMode('search');
    commentaryStore.expand();
    onNavigate?.('search');
    // Desktop's only visible search input is the header field (the panel's own
    // input is display:none above 1024px). Focus it once the pane has rendered.
    // On mobile the header field is hidden, focusSearchField() no-ops, and the
    // panel's inline input remains the entry point.
    requestAnimationFrame(() => { focusSearchField(); });
  };

  return (
    <div class="home-screen">
      <div class="home-screen__header">
        <i class="fa-solid fa-book-bible home-screen__icon" />
        <h1 class="home-screen__title">{t('app.name')}</h1>
      </div>
      {/* Fixed-height slot: the skeleton occupies the same box as the loaded
          card, so the verse arriving never re-centers the column. */}
      <div class="home-screen__votd-slot">
        {votd && votd.text ? (
          <div
            class="home-screen__votd"
            onClick={() => bibleStore.navigateTo(votd.book, votd.chapter, votd.verse)}
          >
            <div class="home-screen__votd-label">
              {votd.holiday ? t('bibleContent.votdHoliday', { holiday: votd.holiday }) : t('bibleContent.votdLabel')}
            </div>
            <div
              class="home-screen__votd-text"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(votd.text_html || votd.text) }}
            />
            <div class="home-screen__votd-ref">
              {t(String(votd.book), { ns: 'books' })} {votd.chapter}:{votd.verse}
            </div>
          </div>
        ) : (
          <div
            class="home-screen__votd home-screen__votd--skeleton home-screen__loading"
            aria-hidden="true"
          >
            <div class="home-screen__skeleton-line home-screen__skeleton-line--label" />
            <div class="home-screen__skeleton-line" />
            <div class="home-screen__skeleton-line home-screen__skeleton-line--short" />
            <div class="home-screen__skeleton-line home-screen__skeleton-line--ref" />
          </div>
        )}
      </div>
      <div class="home-screen__actions">
        <button class="home-screen__action-btn home-screen__action-btn--primary" onClick={handleReadBible}>
          <i class="fa-solid fa-book-open" />
          <span>{t('homeScreen.readBible')}</span>
        </button>
        <button class="home-screen__action-btn" onClick={handleSearch}>
          <i class="fa-solid fa-magnifying-glass" />
          <span>{t('homeScreen.search')}</span>
        </button>
      </div>
    </div>
  );
}
