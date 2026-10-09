/**
 * The Bible toolbar's Listen button (registered in the host's `readerToolbarActions` slot).
 * `canPlay` asks whether any source can speak this translation (and starts that check the
 * first time), so the button is enabled only when pressing it can work.
 */
import { useTranslation } from 'react-i18next';
import type { ReaderToolbarActionProps } from '../../../host/slots';
import { useStore } from '../../../hooks/useStore';
import { audioStore } from '../audioStore';

export function ListenButton({ tab }: ReaderToolbarActionProps) {
  const { t } = useTranslation();
  const audioEnabled = useStore(audioStore, () => audioStore.enabled);
  const audioLayout = useStore(audioStore, () => audioStore.layout);
  const audioActive = useStore(audioStore, () => audioStore.isPlayingTab(tab?.id));
  const audioStatus = useStore(audioStore, () => audioStore.status);
  const audioCanPlay = useStore(audioStore, () => audioStore.canPlay(tab));
  if (!audioEnabled) return null;

  const audioPlaying = audioActive && (audioStatus === 'playing' || audioStatus === 'preparing' || audioStatus === 'buffering' || audioStatus === 'resolving');
  const onListen = () => {
    if (audioLayout === 'phone') {
      // The full-screen player; Play starts it, and it stays open over playback already going.
      audioStore.openPlayer();
      if (!audioActive) void audioStore.play();
      return;
    }
    audioStore.togglePlay();
  };

  return (
    <button
      class="bible-toolbar__btn bible-toolbar__listen"
      onClick={onListen}
      disabled={!audioActive && !audioCanPlay}
      title={!audioActive && !audioCanPlay ? t('audio.notice.noAudio') : audioPlaying && audioLayout === 'desktop' ? t('audio.pause') : t('audio.listenTooltip')}
      aria-label={audioPlaying && audioLayout === 'desktop' ? t('audio.pause') : t('audio.listen')}
      aria-pressed={audioLayout === 'desktop' && audioActive ? audioPlaying : undefined}
      data-testid="audio-listen"
    >
      <i class={`fa-solid ${audioPlaying && audioLayout === 'desktop' ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
      <span class="bible-toolbar__btn-label">{audioPlaying && audioLayout === 'desktop' ? t('audio.pause') : t('audio.listen')}</span>
    </button>
  );
}
