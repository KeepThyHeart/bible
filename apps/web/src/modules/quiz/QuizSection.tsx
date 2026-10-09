import { useState } from 'preact/hooks';
import { Suspense, lazy } from 'preact/compat';
import { useTranslation } from 'react-i18next';

// Loaded when the sheet first opens.
const QuizPane = lazy(() => import('./QuizPane').then((m) => ({ default: m.QuizPane })));

/**
 * The phone Study pane's Quiz section (registered in the `studyPaneSections`
 * slot): a button that opens a full-screen sheet starting a quiz on the
 * current chapter. The sheet is mounted only while open.
 */
export function QuizSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div class="mobile-study-section">
        <div class="mobile-study-section__header">
          <i class="fa-solid fa-circle-question" /> {t('quiz.title')}
        </div>
        <div class="mobile-study-section__content">
          <button class="mobile-study-section__browse-link" onClick={() => setOpen(true)}>
            <i class="fa-solid fa-arrow-up-right-from-square" /> {t('quiz.quizThisChapter')}
          </button>
        </div>
      </div>
      {open && (
        <div class="mobile-topics-overlay">
          <div class="mobile-topics-overlay__header">
            <button class="mobile-topics-overlay__close" onClick={() => setOpen(false)} aria-label={t('quiz.close')}>
              <i class="fa-solid fa-xmark" />
            </button>
            <span class="mobile-topics-overlay__title">
              <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('quiz.title')}
            </span>
          </div>
          <div class="mobile-topics-overlay__body">
            <Suspense fallback={null}><QuizPane startOnCurrentChapter onPassageOpened={() => setOpen(false)} /></Suspense>
          </div>
        </div>
      )}
    </>
  );
}
