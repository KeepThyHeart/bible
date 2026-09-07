import { useTranslation } from 'react-i18next';
import { DictionaryTabBar } from './DictionaryTabBar';
import { DictionaryHome } from './DictionaryHome';
import { DictionaryContent } from './DictionaryContent';
import { dictionaryStore, DICT_HOME_TAB_ID } from '../../stores/dictionaryStore';
import { useStore } from '../../hooks/useStore';
import type { IBibleDataProvider } from '../../providers/interfaces';

interface DictionaryPaneProps {
  bibleProvider?: IBibleDataProvider;
}

export function DictionaryPane({ bibleProvider }: DictionaryPaneProps) {
  const { t } = useTranslation();
  const tabs = useStore(dictionaryStore, () => dictionaryStore.tabs);
  const activeTabId = useStore(dictionaryStore, () => dictionaryStore.activeTabId);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const isTemp = activeTab?.temporary ?? false;

  return (
    <div class="dictionary-pane">
      <DictionaryTabBar />
      {/* Nav bar sits OUTSIDE the scroll area so it's flush with edges */}
      {activeTabId !== DICT_HOME_TAB_ID && activeTab && (
        <div class="dictionary-nav-bar">
          <button
            class="dictionary-nav-bar__back"
            onClick={() => {
              if (isTemp) {
                dictionaryStore.removeTab(activeTabId);
              } else {
                dictionaryStore.setActiveTab(DICT_HOME_TAB_ID);
              }
            }}
          >
            <i class="fa-solid fa-chevron-left fa-xs" /> {t('dictionaryPane.back')}
          </button>
          {isTemp && (
            <button
              class="dictionary-nav-bar__add"
              onClick={() => dictionaryStore.keepTab(activeTabId)}
            >
              <i class="fa-solid fa-plus fa-xs" /> {t('dictionaryPane.addToTabs')}
            </button>
          )}
        </div>
      )}
      <div class="dictionary-pane__scroll">
        {activeTabId === DICT_HOME_TAB_ID
          ? <DictionaryHome />
          : <DictionaryContent tabId={activeTabId} bibleProvider={bibleProvider} />}
      </div>
    </div>
  );
}
