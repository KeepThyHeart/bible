import type { IDockviewPanel } from 'dockview-react';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useGenealogyFocusStore } from '../stores/useGenealogyFocusStore';
import { genericEnglishTitle } from './paneNames';

/**
 * Open (or focus) the Genealogy pane on a person's Family view.
 *
 * Reuses an existing Genealogy pane when there is one, otherwise creates one
 * with the canonical English title (the tab strip localizes it per render; see
 * `NewTabPage.handleQuickAction`). Returns false when there is no dockview
 * (detached windows, tests), so a caller can hide or ignore the gesture.
 */
export function openFamilyTree(personId: string): boolean {
  const api = useLayoutStore.getState().dockviewApi; // allow-getstate: event handler - dockview API access outside render
  if (!api) return false;

  let target: IDockviewPanel | undefined = api.panels.find((p) => p.params?.contentType === 'genealogy');
  if (!target) {
    target = api.addPanel({
      id: `genealogy_${Date.now()}`,
      component: 'panelContent',
      title: genericEnglishTitle('genealogy') ?? 'Family Tree',
      params: { contentType: 'genealogy' },
    });
  }
  useGenealogyFocusStore.getState().requestFocus(target.id, personId); // allow-getstate: event handler - imperative request
  target.api.setActive();
  return true;
}
