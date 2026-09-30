/**
 * The phone's mini-player: what is being read and a play/pause button, above the
 * bottom bar in every view while audio is active and the full player is closed.
 * Tapping the text reopens the full player; the cross stops playback.
 */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../stores/audioStore';
import { useStore } from '../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { useSources } from './audio/useSources';
import { sourceChipText } from './audio/sourceChip';

export function AudioMiniPlayer() {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const open = useStore(audioStore, () => audioStore.playerOpen);
  const status = useStore(audioStore, () => audioStore.status);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  if (!enabled || layout !== 'phone' || open || status === 'idle') return null;

  const active = sources.find(s => s.provider.id === providerId);
  const chip = sourceChipText(t, providerId, active?.provider.label, active?.voices.find(v => v.id === voiceId)?.label, now.moduleAbbr ?? '');
  const playing = status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving';

  return (
    <div class="audio-mini" data-testid="audio-mini">
      <button
        type="button"
        class="audio-btn audio-btn--primary"
        onClick={() => audioStore.togglePlay()}
        title={playing ? t('audio.pause') : t('audio.play')}
        aria-label={playing ? t('audio.pause') : t('audio.play')}
      >
        <i class={`fa-solid ${status === 'resolving' || status === 'preparing' ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
      </button>
      <button type="button" class="audio-mini__text" onClick={() => audioStore.openPlayer()} aria-label={t('audio.player.open')}>
        <span class="audio-mini__ref">{now.refLabel}</span>
        <span class="audio-mini__chip">{chip}</span>
      </button>
      <button type="button" class="audio-btn" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')}>
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>
  );
}
