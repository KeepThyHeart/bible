/**
 * The floating pop-up player (bottom inline-end corner, non-modal). Mounted once, in the `shellOverlays` slot.
 * Shown while audio is active and the player style is 'popup'. It never takes focus on its own: Alt+Shift+P moves
 * focus into its verse pane (via the focuser registered below), and Escape hands focus back.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Popover } from '@bible/ui';
import { setAudioPlayerFocuser } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { AudioVersePane } from './AudioVersePane';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioSpeedControl } from './AudioSpeedControl';
import { AudioStatusLine } from './AudioStatusLine';
import { AudioProgress } from './AudioProgress';
import { AudioTransportButtons } from './AudioTransportButtons';
import { AudioIcon } from './AudioIcons';
import { AudioPassageProgress, AudioPlaylist } from './AudioPlaylist';
import { useSources } from './useSources';
import './audio.css';

/** After docking, the pop-up unmounts and the bar mounts a frame or two later: focus the bar's first usable control once it is there. */
function focusBarSoon(tries = 20): void {
  setAudioPlayerFocuser(null);
  requestAnimationFrame(() => {
    const btn = document.querySelector<HTMLElement>('[data-testid="audio-transport"] button:not(:disabled)');
    if (btn) btn.focus();
    else if (tries > 0) focusBarSoon(tries - 1);
  });
}

export const AudioPlayerPopup: React.FC = () => {
  const { t } = useI18n();
  const enabled = useAudio((s) => s.enabled);
  const status = useAudio((s) => s.status);
  const style = useAudio((s) => s.prefs.playerStyle);
  const playerOpen = useAudio((s) => s.playerOpen);
  const providerId = useAudio((s) => s.providerId);
  const voiceId = useAudio((s) => s.voiceId);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  const rootRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<Element | null>(null);
  const [gearOpen, setGearOpen] = useState(false);

  // Open while audio plays in pop-up style, or when asked to (the Listen chevron, the bar's list button).
  const idle = status === 'idle';
  const visible = enabled && ((style === 'popup' && !idle) || playerOpen);
  // In bar style the transport lives in the bar: the pop-up is then just the playlist (no duplicate controls).
  const full = style === 'popup' && !idle;

  useEffect(() => { if (!visible || !full) setGearOpen(false); }, [visible, full]);

  // Lets Alt+Shift+P reach the verse pane; never runs on its own.
  useEffect(() => {
    if (!visible || !full) return;
    return setAudioPlayerFocuser(() => {
      const active = document.activeElement;
      if (active && !rootRef.current?.contains(active) && active !== document.body) returnRef.current = active;
      const target = paneRef.current?.querySelector<HTMLElement>('[data-testid="audio-verse-pane"]') ?? paneRef.current;
      target?.focus();
    });
  }, [visible, full]);

  if (!visible) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || gearOpen || e.defaultPrevented) return;
    // Escape hands focus back to where the reader came from (or the Listen button); the audio keeps playing.
    const back = returnRef.current;
    const el = back instanceof HTMLElement && back.isConnected ? back : document.querySelector<HTMLElement>('[data-testid="audio-listen"]');
    returnRef.current = null;
    e.preventDefault();
    el?.focus();
  };

  const active = sources.find((s) => s.provider.id === providerId);
  const voiceLabel = active?.voices.find((v) => v.id === voiceId)?.label;
  const sub = idle || status === 'error' || !providerId
    ? ''
    : providerId === 'recorded'
      ? t('audio.chip.recorded', { module: now.moduleAbbr ?? '' })
      : voiceLabel ? t('audio.chip.generatedVoice', { voice: voiceLabel }) : t('audio.chip.generated');

  return (
    <div
      className={`audio-popup${full ? '' : ' audio-popup--list-only'}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="audio-popup-title"
      data-testid="audio-popup"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <div className="audio-popup__header">
        <div className="audio-popup__titles">
          <h2 className="audio-popup__title" id="audio-popup-title" data-testid={full ? 'audio-now-playing' : 'audio-popup-title'}>
            {idle ? t('audio.passages.title') : now.refLabel}
          </h2>
          {full && <AudioPassageProgress className="audio-passage-progress audio-popup__passage" />}
          {sub && full && <div className="audio-popup__sub" data-testid="audio-popup-sub">{sub}</div>}
        </div>
        {!idle && (
          <button type="button" className="audio-btn audio-btn--text" onClick={() => audioStore.revealPlayingTab()} data-testid="audio-goto-tab">
            {t('audio.elsewhere.goto')}
          </button>
        )}
        {full && (
          <>
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
            <button type="button" className="audio-btn" onClick={() => { audioStore.setPlayerStyle('bar'); focusBarSoon(); }} title={t('audio.popup.dock')} aria-label={t('audio.popup.dock')} data-testid="audio-dock">
              <AudioIcon name="dock" />
            </button>
            <button type="button" className="audio-btn" onClick={() => { audioStore.stop(); document.querySelector<HTMLElement>('[data-testid="audio-listen"]')?.focus(); }} title={t('audio.player.stop')} aria-label={t('audio.player.stop')} data-testid="audio-close">
              <AudioIcon name="close" />
            </button>
          </>
        )}
        {!full && (
          <button type="button" className="audio-btn" onClick={() => { audioStore.closePlayer(); document.querySelector<HTMLElement>('[data-testid="audio-listen"]')?.focus(); }} title={t('audio.playlist.close')} aria-label={t('audio.playlist.close')} data-testid="audio-popup-close">
            <AudioIcon name="close" />
          </button>
        )}
      </div>
      {full && (
        <>
          <div className="audio-popup__pane" ref={paneRef}>
            <AudioVersePane />
          </div>
          <AudioStatusLine />
          <AudioProgress />
          <div className="audio-popup__controls">
            <AudioTransportButtons />
            <AudioSpeedControl />
          </div>
        </>
      )}
      <AudioPlaylist startOpen={idle} />
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

export default AudioPlayerPopup;
