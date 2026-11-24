/**
 * Where the reader is in the chapter: a native range input over the chapter's verses, one tick per verse.
 * Moving it (mouse or arrow keys) jumps to that verse on release. Its value text reads "verse N of M".
 */
import React, { useState } from 'react';
import { formatClock } from '@bible/audio';
import { audioStore, usePosition } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { useAudio } from '../audioState';
import './audio.css';

/** Dense chapters (Psalm 119) would smear the ticks into a solid bar. */
const MAX_TICKS = 60;

export const AudioProgress: React.FC<{ showTime?: boolean }> = ({ showTime = true }) => {
  const { t } = useI18n();
  const now = useNowPlaying();
  const { position, duration } = usePosition();
  const dead = useAudio((s) => s.status === 'error');
  const [dragging, setDragging] = useState<number | null>(null);

  const count = now.verses.length;
  if (count === 0) return <div className="audio-progress audio-progress--empty" />;

  const index = dragging ?? Math.max(0, now.verseIndex);
  const verse = now.verses[index];
  const fill = count > 1 ? (index / (count - 1)) * 100 : 0;
  const ticks = count <= MAX_TICKS ? now.verses : [];
  const jump = (value: number) => {
    const v = now.verses[value];
    setDragging(null);
    if (v !== undefined) audioStore.jumpToVerse(v);
  };

  return (
    <div className="audio-progress">
      <div className="audio-progress__track">
        <div className="audio-progress__fill" style={{ inlineSize: `${fill}%` }} />
        {ticks.map((v, i) => (
          <span key={v} className="audio-progress__tick" style={{ insetInlineStart: `${count > 1 ? (i / (count - 1)) * 100 : 0}%` }} aria-hidden="true" />
        ))}
        <input
          type="range"
          className="audio-progress__slider"
          min={0}
          max={count - 1}
          step={1}
          value={index}
          disabled={dead}
          aria-label={t('audio.transport.progress')}
          aria-valuetext={t('audio.transport.verseOf', { verse, count })}
          data-testid="audio-progress"
          onChange={(e) => setDragging(Number(e.target.value))}
          onMouseUp={(e) => jump(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') jump(Number((e.target as HTMLInputElement).value)); }}
        />
      </div>
      {showTime && (
        <span className="audio-progress__label" data-testid="audio-progress-label">
          {duration
            ? <span className="audio-progress__clock">{`${formatClock(position)} / ${formatClock(duration)}`}</span>
            : t('audio.transport.verseOf', { verse, count })}
        </span>
      )}
    </div>
  );
};
