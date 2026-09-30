/**
 * The one line that reports what audio is doing when it is not simply playing:
 * fetching a chapter, downloading a voice, preparing speech, an error with its
 * actions, or a notice (a fallback the reader should know about). The desktop
 * transport bar and the phone player both show it, so the app has one wording
 * (it has no toast component).
 */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import type { NoticeAction } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { useNowPlaying } from '../../hooks/useNowPlaying';
import { formatBytes } from '../../audio/audioStorage';

export function AudioStatusLine() {
  const { t } = useTranslation();
  const status = useStore(audioStore, () => audioStore.status);
  const progress = useStore(audioStore, () => audioStore.progress);
  const notice = useStore(audioStore, () => audioStore.notice);
  const now = useNowPlaying();
  const ref = now.chapterLabel || now.refLabel;

  const action = (a: NoticeAction) => {
    if (a === 'retry') return { label: t('audio.action.retry'), run: () => audioStore.retry() };
    if (a === 'resume') return { label: t('audio.action.resume'), run: () => audioStore.resume() };
    return { label: t('audio.action.useOnDevice'), run: () => { void audioStore.useOnDeviceInstead(); } };
  };

  // An error, or a notice the reader should see, wins over progress.
  if (notice) {
    const isError = notice.tone === 'error';
    return (
      <div
        class={`audio-status audio-status--${isError ? 'error' : 'notice'}`}
        role={isError ? 'alert' : 'status'}
        data-testid="audio-status"
      >
        <span class="audio-status__text">{t(notice.key, { ref })}</span>
        <span class="audio-status__actions">
          {notice.actions.map(a => {
            const { label, run } = action(a);
            return <button key={a} type="button" class="audio-status__btn" onClick={run}>{label}</button>;
          })}
          {!isError && (
            <button type="button" class="audio-status__btn" onClick={() => audioStore.clearNotice()}>{t('audio.action.dismiss')}</button>
          )}
        </span>
      </div>
    );
  }

  if (status === 'resolving') {
    return <div class="audio-status" data-testid="audio-status"><span class="audio-status__text">{t('audio.status.gettingReady')}</span></div>;
  }

  if (status === 'preparing' || status === 'buffering') {
    let text: string;
    let cancellable = false;
    if (progress?.phase === 'voice' || progress?.phase === 'engine') {
      cancellable = true;
      text = progress.total
        ? t('audio.status.downloadingVoiceOf', { loaded: formatBytes(progress.loaded), total: formatBytes(progress.total) })
        : t('audio.status.downloadingVoice');
    } else if (progress?.phase === 'manifest' || progress?.phase === 'audio') {
      text = progress.total
        ? t('audio.status.loadingChapterOf', { ref, loaded: formatBytes(progress.loaded), total: formatBytes(progress.total) })
        : t('audio.status.loadingChapter', { ref });
    } else if (status === 'buffering') {
      text = t('audio.status.buffering');
    } else {
      text = t('audio.status.preparing', { ref: now.refLabel || ref });
    }
    return (
      <div class="audio-status" data-testid="audio-status">
        <i class="fa-solid fa-spinner fa-spin audio-status__spinner" aria-hidden="true" />
        <span class="audio-status__text">{text}</span>
        {cancellable && (
          <span class="audio-status__actions">
            <button type="button" class="audio-status__btn" onClick={() => audioStore.stop()}>{t('audio.action.cancel')}</button>
          </span>
        )}
      </div>
    );
  }
  return null;
}
