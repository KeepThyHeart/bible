import { useEffect } from 'react';
import { useBookStore, createDefaultBookPanelState, BookTab, BookSection, BookSectionSummary } from '../../../stores/useBookStore';
import { updatePanelState } from '../../../stores/helpers/panelStateHelpers';

interface DetachedInitProps {
  isDetached?: boolean;
  panelId: string;
  openTabs?: BookTab[];
  activeTabIndex?: number;
  currentSectionByTab?: [string, number | null][];
  sectionsByTab?: [string, BookSection | null][];
  childSectionsByTab?: [string, BookSectionSummary[]][];
  sectionSummariesByTab?: [string, BookSectionSummary[]][];
}

/**
 * Initializes book panel state from props when the pane is rendered in a detached window.
 * Detached windows receive serialized state (Maps as arrays) via props rather than via the store.
 */
export function useDetachedInit(props: DetachedInitProps): void {
  useEffect(() => {
    if (!props.isDetached || !props.openTabs) return;

    const currentSectionMap = new Map(props.currentSectionByTab || []);
    const sectionsMap = new Map(props.sectionsByTab || []);
    const childSectionsMap = new Map(props.childSectionsByTab || []);
    const summariesMap = new Map(props.sectionSummariesByTab || []);

    const { panels } = useBookStore.getState(); // allow-getstate: event handler - read latest panel snapshot for serialization
    // Reuses the store's own factory rather than a hand-copied literal, so a new
    // per-tab Map added to BookPanelState can't go missing in detached windows.
    const createDefault = createDefaultBookPanelState;
    useBookStore.setState({
      panels: updatePanelState(panels, props.panelId, {
        openTabs: props.openTabs,
        activeTabIndex: props.activeTabIndex || 0,
        currentSectionByTab: currentSectionMap,
        sectionsByTab: sectionsMap,
        childSectionsByTab: childSectionsMap,
        sectionSummariesByTab: summariesMap,
      }, createDefault),
    });
  }, [props.isDetached, props.panelId]);
}
