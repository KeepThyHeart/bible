/**
 * The Audio module's code (lazy chunk): what `activate()` adds to the host. It loads when Study's
 * reader boots (`onView:study.reader`) and only while the `audio` flag is on, so a site with the
 * feature off never fetches any of this.
 *
 * - wires the player to the offline Bible provider Study already built (`initAudio`);
 * - the Listen button (`readerToolbarActions`), the speaker mark on the tab being read (`readerTabBadges`),
 *   the desktop transport bar (`readerTransport`) and the follow-along scroll (`readerPaneEffects`);
 * - the verse being read, drawn through `verseDecorators`;
 * - the desktop pop-up player and the phone mini-player, full-screen player and gate dialog through
 *   `studyLayoutItems`, the phone Back button (`phoneBackHandlers`) and the Help dialog's keys (`helpShortcutRows`);
 * - Piper's downloadable assets in the shared asset catalog (`registerCatalogSource`).
 *
 * The audio engine follows the playing tab through the Bible store (`audioStore`): it must also see tabs
 * that are not active and tabs closing, which the `reader.*` hooks (active tab only) do not report.
 */
import './audio.scss';
import type { FeatureModuleContext } from '@bible/core/browser';
import {
  helpShortcutRows,
  phoneBackHandlers,
  readerPaneEffects,
  readerTabBadges,
  readerToolbarActions,
  readerTransport,
  studyLayoutItems,
  verseDecorators,
} from '../../host/slots';
import { peekOfflineBible } from '../../boot/offlineBible';
import { registerCatalogSource } from '../../assets/webAssets';
import { audioStore } from './audioStore';
import { getAudioConfig } from './lib/config';
import { initAudio } from './lib/initAudio';
import { loadPiperManifests } from './lib/tts/piper/piperAssets';
import { playingVerseDecorator, watchFollow } from './verseDecorator';
import { AudioGateDialog } from './components/AudioGateDialog';
import { AudioLiveRegion } from './components/AudioLiveRegion';
import { AudioMiniPlayer } from './components/AudioMiniPlayer';
import { AudioPlayerPopup } from './components/AudioPlayerPopup';
import { AudioPlayerScreen } from './components/AudioPlayerScreen';
import { AudioTransportBar } from './components/AudioTransportBar';
import { FollowScrollEffect } from './components/FollowScrollEffect';
import { HelpShortcutRows } from './components/HelpShortcutRows';
import { DesktopLayoutMark, PhoneLayoutMark } from './components/LayoutMarks';
import { ListenButton } from './components/ListenButton';
import { TabSpeakerBadge } from './components/TabSpeakerBadge';

/** Undo for the phone Back button: closes the audio settings sheet first, then the full-screen player. */
function closeAudioLayer(): boolean {
  if (audioStore.quickSettingsOpen) {
    audioStore.closeQuickSettings();
    return true;
  }
  if (audioStore.playerOpen) {
    audioStore.closePlayer();
    return true;
  }
  return false;
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  const config = getAudioConfig();
  // The flag is on but the server sent no usable `audio` block: nothing to play, nothing to show.
  if (!config) return;
  const pending = peekOfflineBible();
  if (!pending) {
    console.warn('[Audio] the offline Bible provider is not ready; Audio Bible stays off');
    return;
  }
  const bible = await pending;

  const piper = config.engines.find((e) => e.id === 'piper' && e.enabled);
  const { subscriptions } = ctx;
  subscriptions.push(
    readerToolbarActions.register(ListenButton),
    readerTabBadges.register(TabSpeakerBadge),
    readerTransport.register(AudioTransportBar),
    readerPaneEffects.register(FollowScrollEffect),
    helpShortcutRows.register(HelpShortcutRows),
    phoneBackHandlers.register(closeAudioLayer),
    // Gate dialog and live region sit with the shared dialogs, in both layouts.
    studyLayoutItems.register({ layout: 'both', placement: 'dialogs', Component: AudioGateDialog }),
    studyLayoutItems.register({ layout: 'both', placement: 'dialogs', Component: AudioLiveRegion }),
    studyLayoutItems.register({ layout: 'desktop', placement: 'overlay', Component: DesktopLayoutMark }),
    studyLayoutItems.register({ layout: 'desktop', placement: 'overlay', Component: AudioPlayerPopup }),
    studyLayoutItems.register({ layout: 'phone', placement: 'overlay', Component: PhoneLayoutMark }),
    studyLayoutItems.register({ layout: 'phone', placement: 'dock', Component: AudioMiniPlayer }),
    studyLayoutItems.register({ layout: 'phone', placement: 'overlay', Component: AudioPlayerScreen }),
    verseDecorators.register(playingVerseDecorator),
    { dispose: watchFollow(() => verseDecorators.invalidate()) },
  );
  if (piper) {
    subscriptions.push(registerCatalogSource((getText, signal) => loadPiperManifests(piper, getText, signal)));
  }
  // Last, so everything above is in place when the store announces it is enabled.
  const undo = initAudio(config, bible);
  subscriptions.push({ dispose: undo });
}
