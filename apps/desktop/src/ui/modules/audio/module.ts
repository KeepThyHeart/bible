/**
 * Lazy half of the Audio module (task 0223), activated at startup with the `audio` flag on.
 * Reads what main serves; when nothing can play there is no UI at all. Otherwise it builds the
 * audio system, hands it to `audioStore` and fills the host slots. Everything goes in
 * `ctx.subscriptions`, so switching the module off removes the UI and stops the audio.
 *
 * Main window only: detached windows are separate renderers where feature modules do not run.
 */
import type { Disposable, FeatureModuleContext } from '@bible/core/browser';
import { readerBars, readerPaintControllers, readerToolbarItems, shellOverlays } from '../host/slots';
import { audioStore } from './audioState';
import { hasPlayableAudio, loadDesktopAudioConfig, setDesktopRuntimeBytes } from './desktopAudioConfig';
import { createDesktopAudioSystem } from './audioSystem';
import { installAudioShortcuts } from './shortcuts';
import { setDesktopRecordings } from './downloads/recordingsHandle';
import { resetDesktopDownloadsModel } from './downloads/AudioDownloads';
import { installAudioBookmarksSession } from './audioBookmarksSession';
import { PlayingVerseController } from './PlayingVerseController';
import { ListenButton } from './components/ListenButton';
import { AudioTransportBar } from './components/AudioTransportBar';
import { AudioPlayerPopup } from './components/AudioPlayerPopup';
import { AudioGateDialog } from './components/AudioGateDialog';
import { AudioLiveRegion } from './components/AudioLiveRegion';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  let loaded;
  try {
    loaded = await loadDesktopAudioConfig();
  } catch (err) {
    console.warn('[audio] configuration unavailable; audio stays off', err);
    return;
  }
  setDesktopRuntimeBytes(loaded.runtimeBytes);
  if (!hasPlayableAudio(loaded.config)) return;

  const system = createDesktopAudioSystem(loaded.config);
  audioStore.init(system);
  // Preferences > Audio > downloads reads the recorded channel's manifests and URL scheme.
  setDesktopRecordings(system.recordings);
  const subscriptions: Disposable[] = [
    readerToolbarItems.register(ListenButton),
    readerBars.register(AudioTransportBar),
    shellOverlays.register(AudioPlayerPopup),
    shellOverlays.register(AudioGateDialog),
    shellOverlays.register(AudioLiveRegion),
    readerPaintControllers.register(PlayingVerseController),
    installAudioBookmarksSession(),
    { dispose: installAudioShortcuts(audioStore) },
    // Stops the audio and releases the system.
    // Ends a download run too: its model belongs to this audio system.
    { dispose: () => { resetDesktopDownloadsModel(); setDesktopRecordings(undefined); audioStore.dispose(); } },
  ];
  ctx.subscriptions.push(...subscriptions);
}
