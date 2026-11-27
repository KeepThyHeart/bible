/**
 * The desktop full player as a fixed, anchored, non-modal panel (bottom-end): like the phone's full
 * player but without the verse pane (the Bible text is on screen beside it), with the same bar of
 * tools (speed, Repeat, Continue, Playlist, Settings) along its bottom. Mounted once, at the end
 * of DesktopApp. Shown while audio is active and the player style is 'popup'. It never takes focus on
 * its own; Alt+Shift+P moves focus to its play controls, and Escape hands focus back.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { useSourceChip } from './useSourceChip';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioSpeedControl } from './AudioSpeedControl';
import { AudioStatusLine } from './AudioStatusLine';
import { AudioProgress } from './AudioProgress';
import { AudioTransportButtons } from './AudioTransportButtons';
import { AudioPlaylist, PassagesButton } from './AudioPlaylist';
import { PlaybackToggles } from './PlaybackToggles';
import { AudioPassageProgress } from './AudioPassageProgress';
import { AudioElsewhere } from './AudioElsewhere';
import { useSources } from './useSources';
import { sourceChipText } from './sourceChip';
import { setAudioPlayerFocuser } from '@bible/audio';

/** After docking, the pop-up unmounts and the bar mounts a frame or two later: focus the bar's first usable control once it is there. */
function focusBarSoon(tries = 20): void {
  setAudioPlayerFocuser(null);
  requestAnimationFrame(() => {
    const btn = document.querySelector<HTMLElement>('[data-testid="audio-transport"] button:not(:disabled)');
    if (btn) btn.focus();
    else if (tries > 0) focusBarSoon(tries - 1);
  });
}

export function AudioPlayerPopup() {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const status = useStore(audioStore, () => audioStore.status);
  const style = useStore(audioStore, () => audioStore.prefs.playerStyle);
  const open = useStore(audioStore, () => audioStore.playerOpen);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const now = useNowPlaying();
  const chipText = useSourceChip(now.moduleAbbr);
  const sources = useSources(now.moduleAbbr);
  const rootRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<Element | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const [passagesOpen, setPassagesOpen] = useState(false);

  const idle = status === 'idle';
  // The pop-up is the player: it shows while audio runs in pop-up style, and whenever it was opened (idle: just the playlist editor).
  const visible = enabled && layout === 'desktop' && ((style === 'popup' && !idle) || open);
  const closeIt = () => { if (idle || style !== 'popup') audioStore.closePlayer(); else audioStore.stop(); };

  useEffect(() => { if (!visible) setGearOpen(false); }, [visible]);

  // Lets Alt+Shift+P reach the player; never runs on its own.
  useEffect(() => {
    if (!visible) return;
    return setAudioPlayerFocuser(() => {
      const active = document.activeElement;
      if (active && !rootRef.current?.contains(active) && active !== document.body) returnRef.current = active;
      rootRef.current?.querySelector<HTMLElement>('.audio-popup__controls button:not(:disabled)')?.focus();
    });
  }, [visible]);

  if (!visible) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || gearOpen || e.defaultPrevented) return;
    // Escape closes the player (it is a dialog) and hands focus back to where the reader came from, or Listen.
    const back = returnRef.current;
    const el = back instanceof HTMLElement && back.isConnected ? back : document.querySelector<HTMLElement>('[data-testid="audio-listen"]');
    returnRef.current = null;
    e.preventDefault();
    closeIt();
    el?.focus();
  };

  const active = sources.find(s => s.provider.id === providerId);
  const sub = status === 'error' ? '' : chipText;

  return (
    <div
      class="audio-popup"
      role="dialog"
      aria-modal="false"
      aria-labelledby="audio-popup-title"
      data-testid="audio-popup"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <div class="audio-popup__header">
        <div class="audio-popup__titles">
          <h2 class="audio-popup__title" id="audio-popup-title" data-testid="audio-now-playing">{idle ? t('audio.passages.title') : now.refLabel}</h2>
          {!idle && <AudioPassageProgress />}
          {sub && !idle && <div class="audio-popup__sub" data-testid="audio-popup-sub">{sub}</div>}
        </div>
        {!idle && <button type="button" class="audio-btn" onClick={() => { audioStore.setPlayerStyle('bar'); focusBarSoon(); }} title={t('audio.popup.dock')} aria-label={t('audio.popup.dock')} data-testid="audio-dock">
          <i class="fa-solid fa-window-minimize" aria-hidden="true" />
        </button>}
        <button type="button" class="audio-btn" onClick={() => { closeIt(); document.querySelector<HTMLElement>('[data-testid="audio-listen"]')?.focus(); }} title={t('audio.player.stop')} aria-label={t('audio.player.stop')} data-testid="audio-close">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      {!idle && <AudioElsewhere />}
      <AudioStatusLine />
      {!idle && <AudioProgress />}
      {!idle && (
        <div class="audio-popup__controls">
          <AudioTransportButtons large />
        </div>
      )}
      <AudioPlaylist open={idle || passagesOpen} onClose={() => setPassagesOpen(false)} />
      {/* The same bar of tiles as the phone player, along the pop-up's bottom edge. */}
      {!idle && (
        <div class="audio-popup__tiles audio-tiles">
          <AudioSpeedControl large />
          <PlaybackToggles large />
          <PassagesButton large open={passagesOpen} onToggle={() => setPassagesOpen(o => !o)} />
          <button
            type="button"
            class="audio-btn audio-tool"
            ref={gearRef}
            aria-haspopup="dialog"
            aria-expanded={gearOpen}
            title={t('audio.quick.title')}
            aria-label={t('audio.quick.title')}
            data-testid="audio-gear"
            onClick={() => setGearOpen(o => !o)}
          >
            <i class="fa-solid fa-gear" aria-hidden="true" />
            <span class="audio-tool__caption">{t('audio.quick.short')}</span>
          </button>
        </div>
      )}
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
        {now.moduleAbbr && (
          <AudioQuickSettings moduleAbbr={now.moduleAbbr} variant="desktop" />
        )}
      </Popover>
    </div>
  );
}
