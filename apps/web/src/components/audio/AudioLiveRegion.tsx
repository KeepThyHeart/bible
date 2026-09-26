/**
 * A polite live region that says what audio is doing in words, for screen
 * readers: it announces changes of state (started, paused, stopped, an error,
 * a chapter change), never the position, which changes several times a second.
 * It is visually hidden and rendered once for the whole app.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { useNowPlaying } from '../../hooks/useNowPlaying';

export function AudioLiveRegion() {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const status = useStore(audioStore, () => audioStore.status);
  const notice = useStore(audioStore, () => audioStore.notice);
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
  }, [status, notice, now.chapterLabel]);

  if (!enabled) return null;
  return <div class="audio-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="audio-live">{message}</div>;
}
