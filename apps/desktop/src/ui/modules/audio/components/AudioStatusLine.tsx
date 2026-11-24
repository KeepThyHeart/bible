/**
 * The one line that reports what audio is doing when it is not simply playing: fetching a chapter,
 * downloading a voice, preparing speech, an error with its actions, or a notice. Shown in the bar and the pop-up.
 */
import React from 'react';
import { formatBytes } from '@bible/audio';
import type { NoticeAction } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { AudioIcon } from './AudioIcons';
import './audio.css';

export const AudioStatusLine: React.FC = () => {
  const { t } = useI18n();
  const status = useAudio((s) => s.status);
  const progress = useAudio((s) => s.progress);
  const notice = useAudio((s) => s.notice);
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
      <div className={`audio-status audio-status--${isError ? 'error' : 'notice'}`} role={isError ? 'alert' : 'status'} data-testid="audio-status">
        <span className="audio-status__text">{t(notice.key, { ref })}</span>
        <span className="audio-status__actions">
          {notice.actions.map((a) => {
            const { label, run } = action(a);
            return <button key={a} type="button" className="audio-status__btn" onClick={run}>{label}</button>;
          })}
          {!isError && (
            <button type="button" className="audio-status__btn" onClick={() => audioStore.clearNotice()}>{t('audio.action.dismiss')}</button>
          )}
        </span>
      </div>
    );
  }

  if (status === 'resolving') {
    return <div className="audio-status" data-testid="audio-status"><span className="audio-status__text">{t('audio.status.gettingReady')}</span></div>;
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
      <div className="audio-status" data-testid="audio-status">
        <AudioIcon name="spinner" className="audio-spin" size={14} />
        <span className="audio-status__text">{text}</span>
        {cancellable && (
          <span className="audio-status__actions">
            <button type="button" className="audio-status__btn" onClick={() => audioStore.stop()}>{t('audio.action.cancel')}</button>
          </span>
        )}
      </div>
    );
  }
  return null;
};
