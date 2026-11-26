/**
 * A polite live region that says what audio is doing in words, for screen readers: started, paused, resumed,
 * stopped, a chapter change, an error. Never the position, which changes several times a second.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';

export const AudioLiveRegion: React.FC = () => {
  const { t } = useI18n();
  const enabled = useAudio((s) => s.enabled);
  const status = useAudio((s) => s.status);
  const notice = useAudio((s) => s.notice);
  const now = useNowPlaying();
  const [message, setMessage] = useState('');
  const last = useRef<{ status: string; chapter: string; notice: string | null }>({ status: 'idle', chapter: '', notice: null });

  useEffect(() => {
    const prev = last.current;
    const chapter = now.chapterLabel;
    let next = '';
    if (notice?.tone === 'error' && notice.key !== prev.notice) {
      next = t(notice.key, { ref: chapter });
    } else if (status !== prev.status) {
      if (status === 'playing') next = prev.status === 'paused' ? t('audio.announce.resumed', { ref: now.refLabel }) : t('audio.announce.playing', { ref: chapter });
      else if (status === 'paused') next = t('audio.announce.paused');
      else if (status === 'idle' && prev.status !== 'idle') next = t('audio.announce.stopped');
    } else if (status === 'playing' && chapter && prev.chapter && chapter !== prev.chapter) {
      next = t('audio.announce.chapter', { ref: chapter });
    }
    last.current = { status, chapter: chapter || prev.chapter, notice: notice?.key ?? null };
    if (next) setMessage(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, notice, now.chapterLabel]);

  if (!enabled) return null;
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="audio-live">{message}</div>;
};
