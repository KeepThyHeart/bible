import { useDictionaryStore } from '../../stores/useDictionaryStore';
import { activateDictionaryPanel, revealDictionaryPanel } from './revealDictionaryPanel';
import { activateWhenContentReady } from '../../services/paneHandoff';
import {
  SHOW_DICTIONARY_PANE_EVENT,
  type ShowDictionaryPaneDetail,
} from '../BookPane/showDictionaryPane';

/**
 * Open a Strong's number as a full lexicon entry in the Dictionary pane.
 *
 * This is the app's one "open this Strong's entry" gesture, extracted from
 * `useVerseInteractionHandlers` so that surfaces other than the Bible pane -
 * the Strong's search header, for one - can reach the full entry without
 * re-deriving the three steps it takes:
 *
 * 1. `revealDictionaryPanel()` finds the Dictionary pane on screen, or creates
 *    one, and returns its *dockview* panel id. Writing the lookup to
 *    `DEFAULT_PANEL_ID` instead lands it on panel state nothing renders.
 * 2. `lookupStrongsNumber` picks the Greek or Hebrew lexicon and loads the
 *    entry into that panel.
 * 3. `SHOW_DICTIONARY_PANE_EVENT` dismisses the pane's Overview shelf, which
 *    would otherwise cover the entry that just arrived underneath it.
 */
export async function openStrongsInDictionary(strongsNumber: string): Promise<void> {
  // Reveal without activating, so the pane does not come to the front still
  // showing the word looked up before this one. The switch is held until the
  // entry has loaded, and capped so a slow lexicon still feels responsive.
  const panelId = revealDictionaryPanel({ deferActivation: true });
  if (!panelId) return;

  // allow-getstate: imperative navigation from an event handler, not render.
  const lookup = useDictionaryStore.getState().lookupStrongsNumber(strongsNumber, panelId);
  activateWhenContentReady(() => activateDictionaryPanel(panelId), lookup);
  await lookup;

  window.dispatchEvent(
    new CustomEvent<ShowDictionaryPaneDetail>(SHOW_DICTIONARY_PANE_EVENT, {
      detail: { panelId },
    })
  );
}
