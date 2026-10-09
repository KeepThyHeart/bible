/**
 * Timeline module code (lazy): the phone Study page's Timeline section and its
 * full-screen sheet, registered in the host's `mobileStudySections` slot. The
 * sheet is mounted only while open, so the dataset loads on first open.
 */
import { Suspense, lazy } from 'preact/compat';
import { useSyncExternalStore } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { FeatureModuleContext } from '@bible/core/browser';
import { mobileStudySections } from '../../host/slots';
import './timeline.scss';

const TimelinePane = lazy(() => import('./TimelinePane').then((m) => ({ default: m.TimelinePane })));

// Whether the sheet is open: module state, shared by the card and the sheet.
let sheetOpen = false;
const listeners = new Set<() => void>();
function setSheetOpen(open: boolean): void {
  sheetOpen = open;
  for (const fn of [...listeners]) fn();
}
function useSheetOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => sheetOpen,
  );
}

function TimelineSection() {
  const { t } = useTranslation();
  // The sheet belongs to the Study page: leaving it closes the sheet (as the page's own state did before).
  useEffect(() => () => setSheetOpen(false), []);
  return (
    <div class="mobile-study-section">
      <div class="mobile-study-section__header">
        <i class="fa-solid fa-timeline" /> {t('timeline.title')}
      </div>
      <div class="mobile-study-section__content">
        <button class="mobile-study-section__browse-link" onClick={() => setSheetOpen(true)}>
          <i class="fa-solid fa-arrow-up-right-from-square" /> {t('timeline.open')}
        </button>
      </div>
    </div>
  );
}

function TimelineSheet() {
  const { t } = useTranslation();
  if (!useSheetOpen()) return null;
  return (
    <div class="mobile-topics-overlay">
      <div class="mobile-topics-overlay__header">
        <button class="mobile-topics-overlay__close" onClick={() => setSheetOpen(false)} aria-label={t('timeline.close')}>
          <i class="fa-solid fa-xmark" />
        </button>
        <span class="mobile-topics-overlay__title">
          <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('timeline.title')}
        </span>
      </div>
      <div class="mobile-topics-overlay__body">
        <Suspense fallback={null}>
          <TimelinePane />
        </Suspense>
      </div>
    </div>
  );
}

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    mobileStudySections.register({ id: 'timeline', order: 50, Section: TimelineSection, Sheet: TimelineSheet }),
    { dispose: () => setSheetOpen(false) },
  );
}
