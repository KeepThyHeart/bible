/** Chapter back, verse back, play/pause, verse forward, chapter forward. */
import React from 'react';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { AudioIcon } from './AudioIcons';
import './audio.css';

export const AudioTransportButtons: React.FC = () => {
  const { t } = useI18n();
  const status = useAudio((s) => s.status);
  const playing = status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving';
  // After an error nothing here can do anything; Retry is in the status line.
  const dead = status === 'error';
  const busy = status === 'resolving' || status === 'preparing';
  return (
    <div className="audio-transport__buttons" role="group" aria-label={t('audio.transport.controls')}>
      <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekChapter(-1)} title={t('audio.transport.prevChapter')} aria-label={t('audio.transport.prevChapter')} data-testid="audio-prev-chapter">
        <AudioIcon name="prevChapter" />
      </button>
      <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekVerse(-1)} title={t('audio.transport.prevVerse')} aria-label={t('audio.transport.prevVerse')} data-testid="audio-prev-verse">
        <AudioIcon name="prevVerse" />
      </button>
      <button
        type="button"
        disabled={dead}
        className="audio-btn audio-btn--primary"
        onClick={() => audioStore.togglePlay()}
        title={playing ? t('audio.pause') : t('audio.play')}
        aria-label={playing ? t('audio.pause') : t('audio.play')}
        data-testid="audio-play-pause"
      >
        <AudioIcon name={busy ? 'spinner' : playing ? 'pause' : 'play'} className={busy ? 'audio-spin' : undefined} />
      </button>
      <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekVerse(1)} title={t('audio.transport.nextVerse')} aria-label={t('audio.transport.nextVerse')} data-testid="audio-next-verse">
        <AudioIcon name="nextVerse" />
      </button>
      <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekChapter(1)} title={t('audio.transport.nextChapter')} aria-label={t('audio.transport.nextChapter')} data-testid="audio-next-chapter">
        <AudioIcon name="nextChapter" />
      </button>
    </div>
  );
};
