import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { VerseHistory } from './VerseHistory';
import { useVerseText } from '../../hooks/useVerseText';
import type { IBibleDataProvider } from '../../providers/interfaces';

const EXPAND_PREF_KEY = 'bible-reader-study-verse-expanded';

function loadExpandPref(): boolean {
  try {
    return localStorage.getItem(EXPAND_PREF_KEY) === 'true';
  } catch { return false; }
}

function saveExpandPref(expanded: boolean): void {
  try {
    localStorage.setItem(EXPAND_PREF_KEY, String(expanded));
  } catch { /* ignore */ }
}

interface StudyVerseHeaderProps {
  verseLabel: string;
  verseId: number | null;
  pinned: boolean;
  onTogglePin: () => void;
  onPrev: () => void;
  onNext: () => void;
  onNavigateBible?: () => void;
  history: Array<{ verseId: number; timestamp: number }>;
  onHistorySelect: (verseId: number) => void;
  bibleProvider?: IBibleDataProvider;
}

export function StudyVerseHeader({
  verseLabel, verseId, pinned, onTogglePin, onPrev, onNext,
  onNavigateBible, history, onHistorySelect, bibleProvider,
}: StudyVerseHeaderProps) {
  const { t } = useTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState(loadExpandPref);
  const verseText = useVerseText(verseId, bibleProvider);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    saveExpandPref(next);
  };

  // ===== Collapsed view =====
  if (!expanded) {
    return (
      <div class={`study-verse-header study-verse-header--collapsed ${pinned ? 'study-verse-header--pinned' : ''}`}>
        <span class="study-verse-header__summary">
          {t('studyVerseHeader.notesFor')}{' '}
          <button class="study-verse-header__ref" onClick={onNavigateBible} title={t('studyVerseHeader.goToVerseInBible')}>
            {verseLabel || 'Select a verse'}
          </button>
          <button
            class={`study-verse-header__pin ${pinned ? 'study-verse-header__pin--active' : ''}`}
            onClick={onTogglePin}
            title={pinned ? t('studyVerseHeader.unpinVerse') : t('studyVerseHeader.pinVerse')}
          >
            <i class={`fa-solid fa-thumbtack${pinned ? '' : ' fa-rotate-by'}`} style={pinned ? undefined : { '--fa-rotate-angle': '30deg' } as any} />
          </button>
        </span>
        <button class="study-verse-header__toggle" onClick={toggleExpanded}>{t('studyVerseHeader.expand')}</button>
      </div>
    );
  }

  // ===== Expanded view =====
  return (
    <div class={`study-verse-header ${pinned ? 'study-verse-header--pinned' : ''}`}>
      <div class="study-verse-header__center">
        <div class="study-verse-header__ref-line">
          <button
            class="study-verse-header__ref"
            onClick={onNavigateBible}
            title={t('studyVerseHeader.goToVerseInBible')}
          >
            {verseLabel || 'Select a verse'}
          </button>
          <button
            class={`study-verse-header__pin ${pinned ? 'study-verse-header__pin--active' : ''}`}
            onClick={onTogglePin}
            title={pinned ? t('studyVerseHeader.unpinVerse') : t('studyVerseHeader.pinVerse')}
          >
            <i class={`fa-solid fa-thumbtack${pinned ? '' : ' fa-rotate-by'}`} style={pinned ? undefined : { '--fa-rotate-angle': '30deg' } as any} />
          </button>
          <div class="study-verse-header__history-wrap">
            <button
              class={`study-verse-header__history-btn ${historyOpen ? 'study-verse-header__history-btn--active' : ''}`}
              onClick={() => setHistoryOpen(!historyOpen)}
              title={t('studyVerseHeader.verseHistory')}
            >
              <i class="fa-solid fa-clock-rotate-left" />
            </button>
            {historyOpen && (
              <VerseHistory
                history={history}
                onSelect={(vid) => { setHistoryOpen(false); onHistorySelect(vid); }}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
        </div>
        {verseText && (
          <div class="study-verse-header__text">
            {verseText}{' '}
            <button class="study-verse-header__toggle" onClick={toggleExpanded}>{t('studyVerseHeader.collapse')}</button>
          </div>
        )}
        {!verseText && (
          <button class="study-verse-header__toggle" onClick={toggleExpanded}>{t('studyVerseHeader.collapse')}</button>
        )}
      </div>

      <div class="study-verse-header__nav-group">
        <button class="study-verse-header__nav" onClick={onPrev} title={t('studyVerseHeader.prevVerse')}>
          <i class="fa-solid fa-chevron-left" />
        </button>
        <button class="study-verse-header__nav" onClick={onNext} title={t('studyVerseHeader.nextVerse')}>
          <i class="fa-solid fa-chevron-right" />
        </button>
      </div>
    </div>
  );
}
