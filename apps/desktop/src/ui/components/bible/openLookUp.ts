import { useLookUpStore } from '../../stores/useLookUpStore';
import { activateDictionaryPanel, revealDictionaryPanel } from './revealDictionaryPanel';

/**
 * "Look up 'word'": show the Dictionary pane's Overview with the word in its search box and the results
 * from every installed dictionary underneath, grouped by dictionary, the Strong's entry first when the
 * word is tagged. The Overview renders them from `useLookUpStore` (`dictionary/DictionaryWordSearch.tsx`).
 */
export function openLookUp(text: string, strongs?: string): void {
  const panelId = revealDictionaryPanel({ deferActivation: true });
  if (!panelId) return;
  // allow-getstate: imperative action from an event handler, not render.
  const run = useLookUpStore.getState().run({ text, strongs });
  useLookUpStore.getState().requestShow(panelId); // allow-getstate: imperative action
  activateDictionaryPanel(panelId);
  void run;
}
