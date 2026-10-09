/**
 * Lazy half of the Similar module (task 0126; activated at startup, `onStartupFinished`). It adds
 * nothing to host slots: the panel view, commands and verse action are reached through the
 * manifest, `binding.views`, `commands` and `verseActionHandlers`. What it does:
 *
 * - detects whether the main process has data for Similar and keeps the `similarAvailable`
 *   when-context key current (the command and the verse-menu entry read it): at startup, when
 *   the library changes (a semantic pack may have arrived or left) and whenever the verse menu opens;
 * - makes linked Similar panels follow the verse the reader deliberately picks;
 * - tells the store which translation to show rows in (the Bible pane the reader was last in).
 *
 * Following the verse stays on the host's `verseFollowers` list, not on `reader.verseChanged`: that
 * hook also fires for selection changes the follow-the-verse panes deliberately ignore.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { libraryChangeListeners, verseFollowers, verseMenuOpenListeners } from '../host/hostListeners';
import { useBibleStore } from '../../stores/useBibleStore';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { setSimilarModuleResolver, useSimilarStore } from './useSimilarStore';
import { useSimilarAvailability } from './useSimilarAvailability';

const refreshAvailability = () => void useSimilarAvailability.getState().refresh(); // allow-getstate: listener callback

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  setSimilarModuleResolver(() => {
    const bibleState = useBibleStore.getState(); // allow-getstate: resolver, called on demand
    const lastId = useLayoutStore.getState().lastActiveBiblePanelId; // allow-getstate: resolver, called on demand
    const panel = (lastId ? bibleState.panels.get(lastId) : undefined) ?? bibleState.panels.values().next().value;
    return panel?.openTabs[panel.activeTabIndex]?.abbreviation;
  });
  ctx.subscriptions.push(
    { dispose: () => setSimilarModuleResolver(() => undefined) },
    verseFollowers.add((verseId) => useSimilarStore.getState().followVerse(verseId)), // allow-getstate: listener callback
    libraryChangeListeners.add(refreshAvailability),
    verseMenuOpenListeners.add(refreshAvailability),
  );
  refreshAvailability();
}
