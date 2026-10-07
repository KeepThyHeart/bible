import { useTranslation } from 'react-i18next';
import { WordStudyView } from '@bible/ui';
import type { WordOccurrenceItem } from '@bible/core/browser';
import { wordStudyStore } from '../../stores/wordStudyStore';
import { bibleStore } from '../../stores/bibleStore';
import { searchStore } from '../../stores/searchStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { useWordStudyLabels } from '../../hooks/useWordStudyLabels';
import { parseVerseId } from '../../utils/verseId';
import { formatPassageRef } from '../../constants';

interface WordStudyPaneProps {
  /** Called after an occurrence is opened, so a full-screen layout (mobile) can return to the Bible view. */
  onNavigate?: () => void;
  /** Open the full dictionary entry for a Strong's number; each layout supplies its own route. */
  onOpenStrongsEntry?: (strongs: string) => void;
  /** Mobile sheet: shows a close button. */
  onClose?: () => void;
}

/** The Word study panel: `WordStudyView` wired to `wordStudyStore`. */
export function WordStudyPane({ onNavigate, onOpenStrongsEntry, onClose }: WordStudyPaneProps) {
  const { t } = useTranslation();
  const labels = useWordStudyLabels();
  const s = wordStudyStore;
  const subject = useStore(s, () => s.subject);
  const overview = useStore(s, () => s.overview);
  const occurrences = useStore(s, () => s.occurrences);
  const loading = useStore(s, () => s.loading);
  const occurrencesLoading = useStore(s, () => s.occurrencesLoading);
  const error = useStore(s, () => s.error);
  const offline = useStore(s, () => s.offline);
  const filters = useStore(s, () => s.filters);
  const renderingMode = useStore(s, () => s.renderingMode);
  const query = useStore(s, () => s.query);
  const candidates = useStore(s, () => s.candidates);
  const canBack = useStore(s, () => s.canGoBack);
  const canForward = useStore(s, () => s.canGoForward);

  const formatBook = (book: number) => moduleStore.getBookName(book);
  const formatReference = (verseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(verseId);
    return formatPassageRef(bookNumber, chapter, verse, moduleStore.getBookName(bookNumber));
  };

  const openOccurrence = (item: WordOccurrenceItem) => {
    const { bookNumber, chapter, verse } = parseVerseId(item.verseId);
    void bibleStore.navigateToPreview(bookNumber, chapter, verse);
    onNavigate?.();
  };

  const strongs = subject?.kind === 'strongs' ? subject.strongs : undefined;

  return (
    <div className="word-study-pane" data-testid="word-study-pane">
      <div className="word-study-pane__bar">
        <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" disabled={!canBack} onClick={() => void s.back()} title={t('wordStudy.back')} aria-label={t('wordStudy.back')}>
          <i className="fa-solid fa-arrow-left kth-rtl-mirror" aria-hidden="true" />
        </button>
        <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" disabled={!canForward} onClick={() => void s.forward()} title={t('wordStudy.forward')} aria-label={t('wordStudy.forward')}>
          <i className="fa-solid fa-arrow-right kth-rtl-mirror" aria-hidden="true" />
        </button>
        <h2 className="word-study-pane__title">{t('wordStudy.title')}</h2>
        {onClose && (
          <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={onClose} title={t('wordStudy.close')} aria-label={t('wordStudy.close')}>
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </div>
      <div className="word-study-pane__scroll">
      {offline && (
        <div className="kth-ws-notice" role="status" data-testid="word-study-offline">
          <p>{t('wordStudy.offline')}</p>
          <button type="button" className="kth-btn kth-btn--sm" onClick={() => void s.reload()}>{t('wordStudy.retry')}</button>
        </div>
      )}
      {!subject && !loading && !offline && candidates.length === 0 && (
        <p className="word-study-pane__prompt">{t('wordStudy.prompt')}</p>
      )}
      <WordStudyView
        overview={overview}
        loading={loading}
        error={error ?? undefined}
        occurrences={occurrences}
        occurrencesLoading={occurrencesLoading}
        filters={filters}
        onFiltersChange={(f) => void s.setFilters(f)}
        renderingMode={renderingMode}
        onRenderingModeChange={(m) => void s.setRenderingMode(m)}
        onModuleChange={(m) => void s.setModule(m)}
        onSelectStrongs={(x) => void s.openStrongs(x)}
        onOpenOccurrence={openOccurrence}
        onLoadMore={() => void s.loadMore()}
        formatBook={formatBook}
        formatReference={formatReference}
        onSearchAll={strongs ? () => searchStore.performSearch(strongs) : undefined}
        onOpenInDictionary={strongs && onOpenStrongsEntry ? () => onOpenStrongsEntry(strongs) : undefined}
        query={query}
        onQueryChange={(q) => s.setQuery(q)}
        onSubmitQuery={(q) => void s.submit(q)}
        candidates={candidates}
        onPickCandidate={(x) => void s.pickCandidate(x)}
        labels={labels}
      />
      </div>
    </div>
  );
}
