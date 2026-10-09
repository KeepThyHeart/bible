/**
 * Genealogy module code (lazy): puts the family tree into the host's Study
 * slots. Everything registered goes into `ctx.subscriptions`, so switching the
 * module off removes the tab, the phone section and the Topics action.
 */
import { Suspense, lazy } from 'preact/compat';
import { useTranslation } from 'react-i18next';
import type { FeatureModuleContext } from '@bible/core/browser';
import { mobileStudySections, studyModes, topicEntityActions } from '../../host/slots';
import { commentaryStore } from '../../stores/commentaryStore';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId } from '../../utils/verseId';
import './genealogy.scss';

/** Persisted nowhere, but the class `study-pane--family-tree` and `topics-browser__family-tree` derive from it. */
export const FAMILY_TREE_MODE = 'family-tree';

const loadView = () => import('./FamilyTreeView');
const FamilyTreeView = lazy(loadView);

function FamilyTreeSection() {
  const { t } = useTranslation();
  return (
    <div class="mobile-study-section">
      <div class="mobile-study-section__header">
        <i class="fa-solid fa-sitemap" /> {t('genealogyPane.title')}
      </div>
      <div class="mobile-study-section__content">
        <button class="mobile-study-section__browse-link" onClick={() => studyStore.openStudyMode(FAMILY_TREE_MODE)}>
          <i class="fa-solid fa-arrow-up-right-from-square" /> {t('genealogyPane.title')}
        </button>
      </div>
    </div>
  );
}

function FamilyTreeSheet({ onNavigateBible }: { onNavigateBible?: () => void }) {
  const { t } = useTranslation();
  const mode = useStore(studyStore, () => studyStore.studyMode);
  const focus = useStore(studyStore, () => studyStore.studyModeFocus);
  if (mode !== FAMILY_TREE_MODE) return null;
  // Reading a verse from the family tree: preview it, then leave the sheet for the reader.
  const openVerse = (verseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(verseId);
    bibleStore.navigateToPreview(bookNumber, chapter, verse);
    studyStore.closeStudyMode();
    onNavigateBible?.();
  };
  return (
    <div class="mobile-topics-overlay mobile-family-tree-overlay">
      <div class="mobile-topics-overlay__header">
        <button class="mobile-topics-overlay__close" onClick={() => studyStore.closeStudyMode()} aria-label={t('genealogyPane.close')}>
          <i class="fa-solid fa-xmark" />
        </button>
        <span class="mobile-topics-overlay__title">
          <span class="mobile-topics-overlay__pane-label">{t('studyPane.study')}</span> {t('genealogyPane.title')}
        </span>
      </div>
      <div class="mobile-topics-overlay__body">
        <Suspense fallback={null}>
          <FamilyTreeView focus={focus} compact onOpenVerse={openVerse} />
        </Suspense>
      </div>
    </div>
  );
}

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    studyModes.register({
      id: FAMILY_TREE_MODE,
      order: 10,
      labelKey: 'genealogyPane.title',
      stripLabelKey: 'genealogyPane.modes',
      load: loadView,
    }),
    mobileStudySections.register({ id: 'family-tree', order: 45, Section: FamilyTreeSection, Sheet: FamilyTreeSheet }),
    topicEntityActions.register({
      id: 'family-tree',
      category: 'people',
      iconClass: 'fa-solid fa-sitemap',
      labelKey: 'genealogyPane.showFamilyTree',
      run(personId, name, { mobile }) {
        if (mobile) {
          // From a person's Topics detail: swap the Topics overlay for the family tree sheet.
          studyStore.closeTopicsBrowser();
          studyStore.openStudyMode(FAMILY_TREE_MODE, { personId, name });
        } else {
          // Switch the right pane to Study in Family tree mode, centred on this person.
          studyStore.openStudyMode(FAMILY_TREE_MODE, { personId, name });
          commentaryStore.setRightPaneMode('study');
        }
      },
    }),
  );
}
