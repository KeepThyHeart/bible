import { useState, useEffect, useRef } from 'preact/hooks';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Modifier } from '@dnd-kit/core';
import { SortableTab } from '../common/SortableTab';
import { bibleStore, BibleTab } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { BookChapterPicker } from './BookChapterPicker';
import { formatPassageRef } from '../../constants';
import { useTranslation } from 'react-i18next';

/** Restrict dragging to horizontal axis only (no vertical movement) */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

interface BibleTabBarProps {
  /** Use vertical sorting strategy (e.g. landscape sidebar) */
  vertical?: boolean;
  /** Hide the home button (e.g. mobile has home in bottom nav) */
  hideHome?: boolean;
}

export function BibleTabBar({ vertical, hideHome }: BibleTabBarProps) {
  const { t } = useTranslation();
  const tabs = useStore(bibleStore, () => bibleStore.tabs);
  const activeTabId = useStore(bibleStore, () => bibleStore.activeTabId);
  const [showNewTabPicker, setShowNewTabPicker] = useState(false);
  /**
   * Tab whose passage is being changed via double-click.
   *
   * Changing the open passage is the single most common thing a reader does, so
   * it is reachable several ways: the chapter heading, the reference box, the
   * header field — and now the tab itself, which is what a tab's own label
   * looks like it should do.
   */
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const isDndActive = useRef(false);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!barRef.current || !activeTabId) return;
    requestAnimationFrame(() => {
      const activeEl = barRef.current?.querySelector('.bible-tab-bar__tab--active') as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      }
    });
  }, [activeTabId, tabs.length]);

  // Manual touch scrolling: tabs need touch-action:none for dnd-kit, so we
  // handle scroll ourselves. Quick swipes scroll; 500ms holds drag.
  // Handles horizontal scrolling in portrait and vertical scrolling in landscape.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (isDndActive.current) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollLeft = bar.scrollLeft;
      startScrollTop = bar.scrollTop;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isDndActive.current) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (vertical) {
        if (Math.abs(dy) > 5) {
          bar.scrollTop = startScrollTop - dy;
        }
      } else {
        if (Math.abs(dx) > 5) {
          bar.scrollLeft = startScrollLeft - dx;
        }
      }
    };

    bar.addEventListener('touchstart', onTouchStart, { passive: true });
    bar.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      bar.removeEventListener('touchstart', onTouchStart);
      bar.removeEventListener('touchmove', onTouchMove);
    };
  }, [vertical]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } }),
  );

  const getTabInfo = (tab: BibleTab): { title: string; subtitle: string } => {
    if (!tab.book || !tab.chapter) return { title: 'New Tab', subtitle: tab.moduleAbbr };
    const title = formatPassageRef(tab.book, tab.chapter, null, moduleStore.getBookName(tab.book));
    return { title, subtitle: tab.moduleAbbr };
  };

  const handleNewTabSelect = (book: number, chapter: number, verse?: number, endVerse?: number) => {
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr || 'KJV';
    bibleStore.addTabWithPassage(moduleAbbr, book, chapter, verse, endVerse);
    setShowNewTabPicker(false);
  };

  const editingTab = editingTabId ? tabs.find(tb => tb.id === editingTabId) : undefined;

  const handleEditSelect = (book: number, chapter: number, verse?: number, endVerse?: number) => {
    if (editingTabId) {
      bibleStore.setShowHome(false);
      bibleStore.setActiveTab(editingTabId);
      bibleStore.navigateTo(book, chapter, verse, { endVerse });
    }
    setEditingTabId(null);
  };

  const handleDragStart = () => {
    isDndActive.current = true;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    isDndActive.current = false;
    const { active, over } = event;
    if (over && active.id !== over.id) {
      bibleStore.reorderTabs(active.id as string, over.id as string);
    }
  };

  const handleDragCancel = () => {
    isDndActive.current = false;
  };

  const showHome = useStore(bibleStore, () => bibleStore.showHome);

  return (
    <div class="bible-tab-bar" ref={barRef}>
      {!hideHome && (
        <button
          class={`bible-tab-bar__home ${showHome ? 'bible-tab-bar__home--active' : ''}`}
          onClick={() => bibleStore.setShowHome(true)}
          title={t('bibleTabBar.home')}
        >
          <i class="fa-solid fa-house" />
        </button>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={vertical ? undefined : [restrictToHorizontalAxis]} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <SortableContext items={tabs.map(t => t.id)} strategy={vertical ? verticalListSortingStrategy : horizontalListSortingStrategy}>
          {tabs.map(tab => {
            const { title, subtitle } = getTabInfo(tab);
            const isActive = tab.id === activeTabId && !showHome;
            return (
              <SortableTab
                key={tab.id}
                id={tab.id}
                class={`bible-tab-bar__tab ${isActive ? 'bible-tab-bar__tab--active' : ''}`}
                onClick={() => { bibleStore.setShowHome(false); bibleStore.setActiveTab(tab.id); }}
                onDblClick={() => setEditingTabId(tab.id)}
              >
                <div class="bible-tab-bar__tab-content">
                  <span class="bible-tab-bar__tab-title">{title}</span>
                  <span class="bible-tab-bar__tab-subtitle">{subtitle}</span>
                </div>
                {tabs.length > 1 && (
                  <button
                    class="bible-tab-bar__close"
                    onClick={(e) => {
                      e.stopPropagation();
                      bibleStore.removeTab(tab.id);
                    }}
                    title={t('bibleTabBar.closeTab')}
                  >
                    <i class="fa-solid fa-xmark fa-xs" />
                  </button>
                )}
              </SortableTab>
            );
          })}
        </SortableContext>
      </DndContext>
      <button
        class="bible-tab-bar__add"
        onClick={() => setShowNewTabPicker(true)}
        title={t('bibleTabBar.newTab')}
      >
        +
      </button>

      <BookChapterPicker
        isOpen={showNewTabPicker}
        onClose={() => setShowNewTabPicker(false)}
        onSelect={handleNewTabSelect}
      />

      {/* Double-click a tab to change its passage. */}
      <BookChapterPicker
        isOpen={!!editingTab}
        onClose={() => setEditingTabId(null)}
        onSelect={handleEditSelect}
        currentBook={editingTab?.book ?? null}
        currentChapter={editingTab?.chapter ?? null}
        moduleAbbr={editingTab?.moduleAbbr}
        onChangeTranslation={(abbr) => {
          if (editingTab) bibleStore.setTabTranslation(editingTab.id, abbr);
        }}
      />
    </div>
  );
}
