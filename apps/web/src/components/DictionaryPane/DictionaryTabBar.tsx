import { useState } from 'preact/hooks';
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
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTab } from '../common/SortableTab';
import { ModuleSelectDialog } from '../common/ModuleSelectDialog';
import { dictionaryStore, DICT_HOME_TAB_ID } from '../../stores/dictionaryStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

export function DictionaryTabBar() {
  const { t } = useTranslation();
  const tabs = useStore(dictionaryStore, () => dictionaryStore.tabs);
  const activeTabId = useStore(dictionaryStore, () => dictionaryStore.activeTabId);
  const modules = useStore(dictionaryStore, () => dictionaryStore.modules);
  const [showModuleDialog, setShowModuleDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      dictionaryStore.reorderTabs(active.id as string, over.id as string);
    }
  };

  const sortableTabs = tabs.filter(t => t.id !== DICT_HOME_TAB_ID);

  /**
   * Apply the picker's checkboxes to the open tabs.
   *
   * The list shows every dictionary, open ones included — the "+" is a picker
   * for what is open, exactly as it is for commentaries, so unchecking closes
   * a tab. The old dropdown listed only unopened modules and added one per
   * click, which could never close anything.
   */
  const handleApply = (selection: Set<string>) => {
    for (const tab of sortableTabs) {
      if (!selection.has(tab.moduleAbbr)) {
        dictionaryStore.removeTab(tab.id);
      }
    }
    const openAbbrs = new Set(sortableTabs.map(tab => tab.moduleAbbr));
    for (const abbr of selection) {
      if (!openAbbrs.has(abbr)) {
        const module = modules.find(m => m.abbreviation === abbr);
        dictionaryStore.addTab(abbr, module?.name ?? abbr);
      }
    }
    setShowModuleDialog(false);
  };

  return (
    <div class="dictionary-tab-bar">
      {/* Home tab — fixed, non-draggable */}
      {tabs.find(t => t.id === DICT_HOME_TAB_ID) && (
        <div
          class={`dictionary-tab-bar__tab ${activeTabId === DICT_HOME_TAB_ID ? 'dictionary-tab-bar__tab--active' : ''} dictionary-tab-bar__tab--home`}
          onClick={() => dictionaryStore.setActiveTab(DICT_HOME_TAB_ID)}
          title={t('dictionaryPane.home')}
        >
          <span class="dictionary-tab-bar__label"><i class="fa-solid fa-house fa-xs" /> {t('dictionaryTabBar.home')}</span>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToHorizontalAxis]} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableTabs.map(t => t.id)} strategy={rectSortingStrategy}>
          {sortableTabs.map(tab => {
            const isTemp = tab.temporary ?? false;
            return (
              <SortableTab
                key={tab.id}
                id={tab.id}
                class={`dictionary-tab-bar__tab ${tab.id === activeTabId ? 'dictionary-tab-bar__tab--active' : ''} ${isTemp ? 'dictionary-tab-bar__tab--temporary' : ''}`}
                onClick={() => dictionaryStore.setActiveTab(tab.id)}
                title={isTemp ? `${tab.moduleName} (${t('dictionaryTabBar.preview')})` : tab.moduleName}
              >
                <span class="dictionary-tab-bar__label">{tab.moduleName}</span>
                <button
                  class="dictionary-tab-bar__close"
                  onClick={(e) => {
                    e.stopPropagation();
                    dictionaryStore.removeTab(tab.id);
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

      {/* Add dictionary button */}
      <button
        class="dictionary-tab-bar__add"
        onClick={() => setShowModuleDialog(true)}
        title={t('dictionaryTabBar.addDictionary')}
      >
        <i class="fa-solid fa-plus" />
      </button>

      <ModuleSelectDialog
        isOpen={showModuleDialog}
        modules={modules}
        sections={moduleStore.getDictionarySections()}
        selected={sortableTabs.map(tab => tab.moduleAbbr)}
        labels={{
          title: t('dictionaryTabBar.dictionaries'),
          filterPlaceholder: t('dictionaryTabBar.filterDictionaries'),
          noModules: t('dictionaryTabBar.noModules'),
          noMatches: t('dictionaryTabBar.noMatches'),
          other: t('dictionaryTabBar.other'),
          cancel: t('dictionaryTabBar.cancel'),
          apply: t('dictionaryTabBar.apply'),
        }}
        onApply={handleApply}
        onClose={() => setShowModuleDialog(false)}
        // DictionaryModule carries no description of its own; the only source
        // is the settings.json override the server publishes.
        getDescription={m => moduleStore.getModuleDescription('dictionaries', m.abbreviation)?.description}
      />
    </div>
  );
}
