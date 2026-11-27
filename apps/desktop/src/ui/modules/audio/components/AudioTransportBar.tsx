/**
 * The "bar" player style, docked under the Bible toolbar of the pane being read: skipping, play/pause, progress,
 * the verse being read, speed, the quick-settings gear, pop-out and stop. In pop-up style it renders nothing
 * while audio is active. The idle notice strip ("no audio for this translation") shows in the pane that asked.
 * Registered in the host's `readerBars` slot (rendered inside the pane's BiblePaneProvider).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Popover } from '@bible/ui';
import { focusAudioPlayer } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import type { ReaderBarProps } from '../../host/slots';
import { useBiblePaneContext } from '../../../components/BiblePaneContext';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { AudioTransportButtons } from './AudioTransportButtons';
import { AudioProgress } from './AudioProgress';
import { AudioStatusLine } from './AudioStatusLine';
import { AudioSpeedControl } from './AudioSpeedControl';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioIcon } from './AudioIcons';
import { AudioPassageProgress, LoopIndicator } from './AudioPlaylist';
import { usePassageLabel } from './usePassageLabel';
import { registerAudioBarPane, showsIdleNotice } from './paneRequest';
import './audio.css';

/** In a pane that is not the one being read: where the audio is, a way there, and pause / stop. */
const ElsewhereStrip: React.FC<{ now: ReturnType<typeof useNowPlaying>; status: string }> = ({ now, status }) => {
  const { t } = useI18n();
  const queue = useAudio((s) => s.queue);
  const { label } = usePassageLabel();
  const playing = status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving';
  const passage = queue && queue.kind === 'list' ? queue.passages[queue.index] : undefined;
  const ref = passage ? label(passage) : now.chapterLabel;
  return (
    <div className="audio-elsewhere" role="group" aria-label={t('audio.transport.label')} data-testid="audio-elsewhere">
      <span className="audio-elsewhere__text">{t('audio.elsewhere.label', { ref, module: now.moduleAbbr ?? '' })}</span>
      <button type="button" className="audio-status__btn" onClick={() => audioStore.revealPlayingTab()} data-testid="audio-goto-tab">{t('audio.elsewhere.goto')}</button>
      <button type="button" className="audio-btn" onClick={() => audioStore.togglePlay()} title={playing ? t('audio.pause') : t('audio.play')} aria-label={playing ? t('audio.pause') : t('audio.play')} data-testid="audio-elsewhere-play-pause">
        <AudioIcon name={playing ? 'pause' : 'play'} />
      </button>
      <button type="button" className="audio-btn" onClick={() => audioStore.stop()} title={t('audio.player.stop')} aria-label={t('audio.player.stop')} data-testid="audio-elsewhere-stop">
        <AudioIcon name="stop" />
      </button>
    </div>
  );
};

/** The pane it belongs to comes from the pane context, so the slot's props (the chapter on screen) are not needed. */
export const AudioTransportBar: React.FC<ReaderBarProps> = () => {
  const { t } = useI18n();
  const { panelId } = useBiblePaneContext();
  const enabled = useAudio((s) => s.enabled);
  const status = useAudio((s) => s.status);
  const notice = useAudio((s) => s.notice);
  const style = useAudio((s) => s.prefs.playerStyle);
  const mine = useAudio((s) => s.isPlayingTab(panelId));
  const now = useNowPlaying();
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);

  useEffect(() => registerAudioBarPane(panelId), [panelId]);

  const idle = status === 'idle';
  const full = enabled && mine && style === 'bar';
  // Stopping, switching style or the feature going off must not leave the popover armed for next time.
  useEffect(() => { if (!full) setGearOpen(false); }, [full]);

  if (!enabled) return null;
  if (idle) {
    if (!notice || !showsIdleNotice(panelId)) return null;
    return (
      <div className="audio-transport audio-transport--notice" data-testid="audio-transport">
        <AudioStatusLine />
      </div>
    );
  }
  if (enabled && !idle && !mine && style === 'bar') {
    return <ElsewhereStrip now={now} status={status} />;
  }
  if (!full) return null;

  return (
    <div className="audio-transport" role="toolbar" aria-label={t('audio.transport.label')} data-testid="audio-transport">
      <div className="audio-transport__row">
        <AudioTransportButtons />
        <AudioProgress />
        <span className="audio-transport__now" data-testid="audio-now-playing">{now.refLabel}</span>
        <AudioPassageProgress />
        <LoopIndicator />
        <button type="button" className="audio-btn" onClick={() => { audioStore.setTargetTab(panelId); audioStore.openPlayer(); }} title={t('audio.playlist.open')} aria-label={t('audio.playlist.open')} data-testid="audio-playlist-open">
          <AudioIcon name="speaker" />
        </button>
        <AudioSpeedControl />
        <button
          type="button"
          className="audio-btn"
          ref={gearRef}
          aria-haspopup="dialog"
          aria-expanded={gearOpen}
          title={t('audio.quick.title')}
          aria-label={t('audio.quick.title')}
          data-testid="audio-gear"
          onClick={() => setGearOpen((o) => !o)}
        >
          <AudioIcon name="gear" />
        </button>
        <button type="button" className="audio-btn" onClick={() => { audioStore.setPlayerStyle('popup'); requestAnimationFrame(() => focusAudioPlayer()); }} title={t('audio.transport.popOut')} aria-label={t('audio.transport.popOut')} data-testid="audio-popout">
          <AudioIcon name="popOut" />
        </button>
        <button type="button" className="audio-btn" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')} data-testid="audio-close">
          <AudioIcon name="close" />
        </button>
      </div>
      <AudioStatusLine />
      <Popover
        open={gearOpen && !!now.moduleAbbr}
        anchor={gearOpen && gearRef.current ? gearRef.current.getBoundingClientRect() : null}
        onClose={() => setGearOpen(false)}
        label={t('audio.quick.title')}
        width={340}
        estimatedHeight={320}
        align="end"
        autoFocus
        className="audio-popover"
        insideRefs={[gearRef]}
      >
        {now.moduleAbbr && <AudioQuickSettings moduleAbbr={now.moduleAbbr} onOpenedSettings={() => setGearOpen(false)} />}
      </Popover>
    </div>
  );
};

export default AudioTransportBar;
