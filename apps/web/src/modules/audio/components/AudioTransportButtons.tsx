/** Chapter back, verse back, play/pause, verse forward, chapter forward. Shared by the desktop bar and the phone player. */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';

export function AudioTransportButtons({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const status = useStore(audioStore, () => audioStore.status);
  const playing = status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving';
  // After an error (for example no recording of this chapter) nothing here can do anything; Retry is in the status line.
  const dead = status === 'error';
  const busy = status === 'resolving' || status === 'preparing';
  const cls = `audio-btn${large ? ' audio-btn--large' : ''}`;
  return (
    <div class="audio-transport__buttons" role="group" aria-label={t('audio.transport.controls')}>
      <button type="button" class={cls} disabled={dead} onClick={() => audioStore.seekChapter(-1)} title={t('audio.transport.prevChapter')} aria-label={t('audio.transport.prevChapter')}>
        <i class="fa-solid fa-backward-fast" aria-hidden="true" />
      </button>
      <button type="button" class={cls} disabled={dead} onClick={() => audioStore.seekVerse(-1)} title={t('audio.transport.prevVerse')} aria-label={t('audio.transport.prevVerse')}>
        <i class="fa-solid fa-backward-step" aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={dead}
        class={`${cls} audio-btn--primary`}
        onClick={() => audioStore.togglePlay()}
        title={playing ? t('audio.pause') : t('audio.play')}
        aria-label={playing ? t('audio.pause') : t('audio.play')}
        data-testid="audio-play-pause"
      >
        <i class={`fa-solid ${busy ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
      </button>
      <button type="button" class={cls} disabled={dead} onClick={() => audioStore.seekVerse(1)} title={t('audio.transport.nextVerse')} aria-label={t('audio.transport.nextVerse')}>
        <i class="fa-solid fa-forward-step" aria-hidden="true" />
      </button>
      <button type="button" class={cls} disabled={dead} onClick={() => audioStore.seekChapter(1)} title={t('audio.transport.nextChapter')} aria-label={t('audio.transport.nextChapter')}>
        <i class="fa-solid fa-forward-fast" aria-hidden="true" />
      </button>
    </div>
  );
}
