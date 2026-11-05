import { useEffect, useRef, useState } from 'preact/hooks';
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

  // Back and "Add to tabs" remove the button that held focus: land on a sensible element once the
  // store change has rendered (the dictionary's card on Home, or the newly kept tab).
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ n: number; kind: 'home' | 'tab'; abbr?: string } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const root = rootRef.current;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (focusRequest.kind === 'tab') {
      target = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    } else {
      if (focusRequest.abbr) {
        target = Array.from(root.querySelectorAll<HTMLElement>('[data-module]'))
          .find(el => el.dataset.module === focusRequest.abbr) ?? null;
      }
      target ??= root.querySelector<HTMLElement>('.dictionary-home__search');
    }
    target?.focus({ preventScroll: true });
  }, [focusRequest]);

  return (
    <div class="dictionary-pane" ref={rootRef}>
      <DictionaryTabBar />
      {/* Nav bar sits OUTSIDE the scroll area so it's flush with edges */}
      {activeTabId !== DICT_HOME_TAB_ID && activeTab && (
        <div class="dictionary-nav-bar">
          <button
            class="dictionary-nav-bar__back"
            onClick={() => {
              setFocusRequest({ n: Date.now(), kind: 'home', abbr: activeTab.moduleAbbr });
              if (isTemp) {
                dictionaryStore.removeTab(activeTabId);
              } else {
                dictionaryStore.setActiveTab(DICT_HOME_TAB_ID);
              }
            }}
          >
            <i class="fa-solid fa-chevron-left fa-xs kth-rtl-mirror" /> {t('dictionaryPane.back')}
          </button>
          {isTemp && (
            <button
              class="dictionary-nav-bar__add"
              onClick={() => {
                dictionaryStore.keepTab(activeTabId);
                setFocusRequest({ n: Date.now(), kind: 'tab' });
              }}
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
