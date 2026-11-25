import { useLookUpStore } from '../../stores/useLookUpStore';
import { activateDictionaryPanel, revealDictionaryPanel } from './revealDictionaryPanel';
import { SHOW_DICTIONARY_PANE_EVENT, type ShowDictionaryPaneDetail } from '../BookPane/showDictionaryPane';

/**
 * "Look up 'word'": show the Dictionary pane with the word's results from every installed dictionary,
 * grouped by dictionary, the Strong's entry first when the word is tagged. The pane renders them from
 * `useLookUpStore` (`dictionary/LookUpResults.tsx`).
 */
export function openLookUp(text: string, strongs?: string): void {
  const panelId = revealDictionaryPanel({ deferActivation: true });
  if (!panelId) return;
  // allow-getstate: imperative action from an event handler, not render.
  const run = useLookUpStore.getState().run({ text, strongs });
  activateDictionaryPanel(panelId);
  window.dispatchEvent(
    new CustomEvent<ShowDictionaryPaneDetail>(SHOW_DICTIONARY_PANE_EVENT, { detail: { panelId } }),
  );
  void run;
}
