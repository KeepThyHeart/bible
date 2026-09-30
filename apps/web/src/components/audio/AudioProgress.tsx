/**
 * Where the reader is in the chapter: a slider over the chapter's verses with one
 * tick per verse. Moving it (mouse, touch or arrow keys) jumps to that verse when
 * released. For speech the total length is unknown until it has been spoken, and
 * for recordings the verse timings live in the player, so both use the same verse
 * scale; a recording's elapsed and total time are shown beside it.
 */

import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { useNowPlaying } from '../../hooks/useNowPlaying';
import { formatClock } from '../../audio/audioStorage';

/** Dense chapters (Psalm 119) would smear the ticks into a solid bar. */
const MAX_TICKS = 60;

export function AudioProgress({ showTime = true }: { showTime?: boolean }) {
  const { t } = useTranslation();
  const now = useNowPlaying();
  const position = useStore(audioStore.position, () => audioStore.position.position);
  const duration = useStore(audioStore.position, () => audioStore.position.duration);
  const [dragging, setDragging] = useState<number | null>(null);

  const count = now.verses.length;
  if (count === 0) return <div class="audio-progress audio-progress--empty" />;

  const index = dragging ?? Math.max(0, now.verseIndex);
  const verse = now.verses[index];
  const fill = count > 1 ? (index / (count - 1)) * 100 : 0;
  const ticks = count <= MAX_TICKS ? now.verses : [];

  return (
    <div class="audio-progress">
      <div class="audio-progress__track">
        <div class="audio-progress__fill" style={{ inlineSize: `${fill}%` }} />
        {ticks.map((v, i) => (
          <span key={v} class="audio-progress__tick" style={{ insetInlineStart: `${count > 1 ? (i / (count - 1)) * 100 : 0}%` }} aria-hidden="true" />
        ))}
        <input
          type="range"
          class="audio-progress__slider"
          min={0}
          max={count - 1}
          step={1}
          value={index}
          aria-label={t('audio.transport.progress')}
          aria-valuetext={t('audio.transport.verseOf', { verse, count })}
          data-testid="audio-progress"
          onInput={e => setDragging(Number((e.target as HTMLInputElement).value))}
          onChange={e => {
            const v = now.verses[Number((e.target as HTMLInputElement).value)];
            setDragging(null);
            if (v !== undefined) audioStore.jumpToVerse(v);
          }}
        />
      </div>
      {showTime && (
        <span class="audio-progress__label" data-testid="audio-progress-label">
          {duration ? `${formatClock(position)} / ${formatClock(duration)}` : t('audio.transport.verseOf', { verse, count })}
        </span>
      )}
    </div>
  );
}
