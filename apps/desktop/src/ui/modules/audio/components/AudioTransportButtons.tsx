/** Chapter back, verse back, play/pause, verse forward, chapter forward. */
import React from 'react';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { AudioIcon } from './AudioIcons';
import './audio.css';

export const AudioTransportButtons: React.FC = () => {
  const { t } = useI18n();
  const status = useAudio((s) => s.status);
  const queue = useAudio((s) => s.queue);
  const chapters = useAudio((s) => s.canSeekChapter);
  const typed = !!queue && queue.kind === 'list';
  const playing = status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving';
  // After an error nothing here can do anything; Retry is in the status line.
  const dead = status === 'error';
  const busy = status === 'resolving' || status === 'preparing';
  return (
    <div className="audio-transport__buttons" role="group" aria-label={t('audio.transport.controls')}>
      {typed && queue && (
        <button type="button" className="audio-btn" disabled={dead || queue.index <= 0} onClick={() => audioStore.prevPassage()} title={t('audio.passages.prev')} aria-label={t('audio.passages.prev')} data-testid="audio-prev-passage">
          <AudioIcon name="prevChapter" />
        </button>
      )}
      {chapters && (
        <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekChapter(-1)} title={t('audio.transport.prevChapter')} aria-label={t('audio.transport.prevChapter')} data-testid="audio-prev-chapter">
          <AudioIcon name="prevChapter" />
        </button>
      )}
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
      {chapters && (
        <button type="button" className="audio-btn" disabled={dead} onClick={() => audioStore.seekChapter(1)} title={t('audio.transport.nextChapter')} aria-label={t('audio.transport.nextChapter')} data-testid="audio-next-chapter">
          <AudioIcon name="nextChapter" />
        </button>
      )}
      {typed && queue && (
        <button type="button" className="audio-btn" disabled={dead || queue.index >= queue.passages.length - 1} onClick={() => audioStore.nextPassage()} title={t('audio.passages.next')} aria-label={t('audio.passages.next')} data-testid="audio-next-passage">
          <AudioIcon name="nextChapter" />
        </button>
      )}
    </div>
  );
};
