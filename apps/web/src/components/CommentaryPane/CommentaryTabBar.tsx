import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';

/** Restrict dragging to horizontal axis only */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTab } from '../common/SortableTab';
import { ModuleSelectDialog } from '../common/ModuleSelectDialog';
import { commentaryStore, HOME_TAB_ID } from '../../stores/commentaryStore';
import { moduleStore } from '../../stores/moduleStore';
import { bibleStore } from '../../stores/bibleStore';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { getCommentaryDescription, getCommentaryPriority, isDigestModule, getDigestDisplayName } from '../../moduleDescriptions';
import type { ModuleSection } from '../../types';

export function CommentaryTabBar() {
  const { t } = useTranslation();
  const tabs = useStore(commentaryStore, () => commentaryStore.tabs);
  const activeTabId = useStore(commentaryStore, () => commentaryStore.activeTabId);
  const commentaryModules = useStore(moduleStore, () => moduleStore.getCommentaryModules());
  const showOverview = useStore(settingsStore, () => settingsStore.showCommentaryOverview);
  const highlightedVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);
  // Subscribe to entriesByTab changes to trigger re-renders for has-content indicators
  useStore(commentaryStore, () => commentaryStore.entriesByTab);
  const [showModuleDialog, setShowModuleDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Use abbreviation for tab label to save space
  const getShortName = (moduleName: string, moduleAbbr?: string): string => {
    if (moduleAbbr && isDigestModule(moduleAbbr)) return getDigestDisplayName();
    if (moduleAbbr) return moduleAbbr;
    if (moduleName.length <= 10) return moduleName;
    return moduleName.substring(0, 8) + '...';
  };

  const activeTab = bibleStore.getActiveTab();
  const currentBook = activeTab?.book ?? null;
  const currentChapter = activeTab?.chapter ?? null;

  const serverSections: ModuleSection[] | null = moduleStore.getCommentarySections();

  // Display order for the picker: section order when settings.json configures
  // sections, otherwise the hardcoded popularity ranking. Filtering inside the
  // dialog preserves this order.
  const orderedModules = serverSections && serverSections.length > 0
    ? (() => {
        const orderMap = new Map<string, number>();
        let idx = 0;
        for (const sec of serverSections) {
          for (const abbr of sec.modules) {
            orderMap.set(abbr.toLowerCase(), idx++);
          }
        }
        return [...commentaryModules].sort((a, b) => {
          const oa = orderMap.get(a.abbreviation.toLowerCase()) ?? 999999;
          const ob = orderMap.get(b.abbreviation.toLowerCase()) ?? 999999;
          return oa - ob;
        });
      })()
    : [...commentaryModules].sort((a, b) => {
        const pa = getCommentaryPriority(a.abbreviation);
        const pb = getCommentaryPriority(b.abbreviation);
        return pa - pb;
      });

  const availability = useStore(commentaryStore, () => commentaryStore.availability);
  const availabilityLoading = useStore(commentaryStore, () => commentaryStore.availabilityLoading);

  // Availability drives the per-passage badges below, and is only worth
  // fetching while the picker is on screen.
  useEffect(() => {
    if (!showModuleDialog) return;
    if (currentBook && currentChapter) {
      const verseNum = highlightedVerse
        ? highlightedVerse - (currentBook * 1000000) - (currentChapter * 1000)
        : undefined;
      commentaryStore.fetchAvailability(currentBook, currentChapter, verseNum);
    }
  }, [showModuleDialog]);

  const handleApply = (selection: Set<string>) => {
    // Remove tabs that were unchecked
    const currentAbbrs = new Set(tabs.map(t => t.moduleAbbr));
    for (const abbr of currentAbbrs) {
      if (!selection.has(abbr)) {
        const tab = tabs.find(t => t.moduleAbbr === abbr);
        if (tab) commentaryStore.removeTab(tab.id);
      }
    }
    // Add tabs that were newly checked
    for (const abbr of selection) {
      if (!currentAbbrs.has(abbr)) {
        // Name resolved by the store (`resolveTabName`), not here: the digest's
        // shipped name is its abbreviation, "SYNTHESIS", and passing it through
        // is how that reached the tab label. One place decides.
        const mod = commentaryModules.find(m => m.abbreviation === abbr);
        commentaryStore.addTab(abbr, mod?.name);
      }
    }
    setShowModuleDialog(false);
  };

  /** Per-passage "has content for John 3:16" badges — commentary-only. */
  const renderAvailability = (m: { abbreviation: string }) => {
    const avail = availability[m.abbreviation];
    const hasVerse = avail?.hasVerse ?? false;
    const hasChapter = avail?.hasChapter ?? false;
    const bookName = currentBook ? moduleStore.getBookName(currentBook) : '';
    const verseNum = highlightedVerse && currentBook && currentChapter
      ? highlightedVerse - (currentBook * 1000000) - (currentChapter * 1000)
      : null;
    return (
      <>
        {currentBook && !availabilityLoading && (hasVerse || hasChapter) && (
          <div class="module-card__content-line">
            {hasVerse && verseNum ? (
              <span class="module-card__badge module-card__badge--verse">
                <i class="fa-solid fa-check" /> {t('commentaryTabBar.hasContentFor')} {bookName} {currentChapter}:{verseNum}
              </span>
            ) : hasChapter ? (
              <span class="module-card__badge module-card__badge--chapter">
                <i class="fa-solid fa-check" /> {t('commentaryTabBar.hasContentFor')} {bookName} {currentChapter}
              </span>
            ) : null}
          </div>
        )}
        {availabilityLoading && currentBook && (
          <div class="module-card__content-line">
            <span class="module-card__badge module-card__badge--loading">
              <i class="fa-solid fa-spinner fa-spin" />
            </span>
          </div>
        )}
      </>
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      commentaryStore.reorderTabs(active.id as string, over.id as string);
    }
  };

  // Sortable items: exclude home tab (it stays fixed at position 0)
  const sortableTabs = tabs.filter(t => t.id !== HOME_TAB_ID);

  return (
    <div class="commentary-tab-bar">
      {/* Home tab is not draggable — always first (hidden when overview disabled in settings) */}
      {showOverview && tabs.find(t => t.id === HOME_TAB_ID) && (
        <div
          class={`commentary-tab-bar__tab ${activeTabId === HOME_TAB_ID ? 'commentary-tab-bar__tab--active' : ''} commentary-tab-bar__tab--home`}
          onClick={() => commentaryStore.setActiveTab(HOME_TAB_ID)}
          title={t('commentaryTabBar.overview')}
        >
          <span class="commentary-tab-bar__label"><i class="fa-solid fa-house fa-xs" /> {t('commentaryTabBar.overview')}</span>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableTabs.map(t => t.id)} strategy={rectSortingStrategy}>
          {sortableTabs.map(tab => {
            const isTemp = tab.temporary ?? false;
            const hasContent = highlightedVerse
              ? commentaryStore.tabHasContentForVerse(tab.id, highlightedVerse)
              : false;
            return (
              <SortableTab
                key={tab.id}
                id={tab.id}
                class={`commentary-tab-bar__tab ${tab.id === activeTabId ? 'commentary-tab-bar__tab--active' : ''} ${hasContent ? 'commentary-tab-bar__tab--has-content' : ''} ${isTemp ? 'commentary-tab-bar__tab--temporary' : ''}`}
                onClick={() => commentaryStore.setActiveTab(tab.id)}
                title={isTemp ? `${tab.moduleName} (${t('commentaryTabBar.preview')})` : tab.moduleName}
              >
                {tab.pinned && <i class="fa-solid fa-thumbtack fa-2xs commentary-tab-bar__pin-indicator" />}
                <span class="commentary-tab-bar__label">{getShortName(tab.moduleName, tab.moduleAbbr)}</span>
                <button
                  class="commentary-tab-bar__close"
                  onClick={(e) => {
                    e.stopPropagation();
                    commentaryStore.removeTab(tab.id);
                  }}
                  title={t('commentaryTabBar.closeTab')}
                >
                  <i class="fa-solid fa-xmark fa-xs" />
                </button>
              </SortableTab>
            );
          })}
        </SortableContext>
      </DndContext>

      <button
        class="commentary-tab-bar__add"
        onClick={() => setShowModuleDialog(true)}
        title={t('commentaryTabBar.addCommentary')}
      >
        <i class="fa-solid fa-plus" />
      </button>

      <ModuleSelectDialog
        isOpen={showModuleDialog}
        modules={orderedModules}
        sections={serverSections}
        selected={tabs.map(t => t.moduleAbbr)}
        labels={{
          title: t('commentaryTabBar.commentaries'),
          filterPlaceholder: t('commentaryTabBar.filterCommentaries'),
          noModules: t('commentaryTabBar.noModules'),
          noMatches: t('commentaryTabBar.noMatches'),
          other: t('dictionaryTabBar.other'),
          cancel: t('commentaryTabBar.cancel'),
          apply: t('commentaryTabBar.apply'),
        }}
        onApply={handleApply}
        onClose={() => setShowModuleDialog(false)}
        getDisplayAbbr={m => isDigestModule(m.abbreviation) ? getDigestDisplayName() : m.abbreviation}
        getDisplayName={m => isDigestModule(m.abbreviation)
          ? `${getDigestDisplayName()} — ${t('commentaryTabBar.combinedSummary')}`
          : (m.name && m.name !== m.abbreviation ? m.name : undefined)}
        getDescription={m => moduleStore.getModuleDescription('commentaries', m.abbreviation)?.description
          || getCommentaryDescription(m.abbreviation)?.description}
        renderExtra={renderAvailability}
      />
    </div>
  );
}
