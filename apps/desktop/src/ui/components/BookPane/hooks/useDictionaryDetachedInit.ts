import { useEffect } from 'react';
import { useDictionaryStore, createDefaultDictionaryPanelState, DictionaryTab, DictionaryEntry } from '../../../stores/useDictionaryStore';
import { updatePanelState } from '../../../stores/helpers/panelStateHelpers';

interface DictionaryDetachedInitProps {
  isDetached?: boolean;
  panelId: string;
  dictOpenTabs?: DictionaryTab[];
  dictActiveTabIndex?: number;
  dictEntriesByTab?: [string, DictionaryEntry | null][];
}

/**
 * Initializes dictionary panel state from props when the pane is rendered in
 * a detached window. Mirrors `useDetachedInit` (the book side) - BookPane
 * hosts both book and dictionary tabs under one panelId, so the pop-out
 * payload and this hydration have to cover both stores.
 */
export function useDictionaryDetachedInit(props: DictionaryDetachedInitProps): void {
  useEffect(() => {
    if (!props.isDetached || !props.dictOpenTabs) return;

    const entriesMap = new Map(props.dictEntriesByTab || []);

    const { panels } = useDictionaryStore.getState(); // allow-getstate: event handler - read latest panel snapshot for serialization
    useDictionaryStore.setState({
      panels: updatePanelState(panels, props.panelId, {
        openTabs: props.dictOpenTabs,
        activeTabIndex: props.dictActiveTabIndex || 0,
        entriesByTab: entriesMap,
      }, createDefaultDictionaryPanelState),
    });
  }, [props.isDetached, props.panelId]);
}
