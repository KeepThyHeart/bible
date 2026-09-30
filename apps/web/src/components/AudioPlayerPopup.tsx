/**
 * The desktop audio player as a fixed, anchored, non-modal panel (bottom-end). Mounted once, at the end
 * of DesktopApp. Shown while audio is active and the player style is 'popup'. It never takes focus on
 * its own; Alt+Shift+P moves focus into its verse pane, and Escape hands focus back.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import { audioStore } from '../stores/audioStore';
import { useStore } from '../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { AudioVersePane } from './audio/AudioVersePane';
import { AudioQuickSettings } from './audio/AudioQuickSettings';
import { AudioSpeedControl } from './audio/AudioSpeedControl';
import { AudioStatusLine } from './audio/AudioStatusLine';
import { AudioProgress } from './audio/AudioProgress';
import { AudioTransportButtons } from './audio/AudioTransportButtons';
import { useSources } from './audio/useSources';
import { sourceChipText } from './audio/sourceChip';
import { focusAudioPlayer, setAudioPlayerFocuser } from '../audio/audioShortcuts';

export function AudioPlayerPopup({ onOpenSettings }: { onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const status = useStore(audioStore, () => audioStore.status);
  const style = useStore(audioStore, () => audioStore.prefs.playerStyle);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  const rootRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<Element | null>(null);
  const [gearOpen, setGearOpen] = useState(false);

  const visible = enabled && layout === 'desktop' && style === 'popup' && status !== 'idle';

  useEffect(() => { if (!visible) setGearOpen(false); }, [visible]);

  // Lets Alt+Shift+P reach the verse pane; never runs on its own.
  useEffect(() => {
    if (!visible) return;
    return setAudioPlayerFocuser(() => {
      const active = document.activeElement;
      if (active && !rootRef.current?.contains(active) && active !== document.body) returnRef.current = active;
      const pane = paneRef.current;
      const target = pane?.querySelector<HTMLElement>('[tabindex="0"], [data-testid="audio-verse-pane"]') ?? pane;
      target?.focus();
    });
  }, [visible]);

  if (!visible) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || gearOpen || e.defaultPrevented) return;
    const back = returnRef.current;
    const el = back instanceof HTMLElement && back.isConnected ? back : document.querySelector<HTMLElement>('[data-testid="audio-listen"]');
    returnRef.current = null;
    if (el) { e.preventDefault(); el.focus(); }
  };

  const active = sources.find(s => s.provider.id === providerId);
  const sub = sourceChipText(t, providerId, active?.provider.label, active?.voices.find(v => v.id === voiceId)?.label, now.moduleAbbr ?? '');

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
          <h2 class="audio-popup__title" id="audio-popup-title" data-testid="audio-now-playing">{now.refLabel}</h2>
          {sub && <div class="audio-popup__sub" data-testid="audio-popup-sub">{sub}</div>}
        </div>
        <button
          type="button"
          class="audio-btn"
          ref={gearRef}
          aria-haspopup="dialog"
          aria-expanded={gearOpen}
          title={t('audio.quick.title')}
          aria-label={t('audio.quick.title')}
          data-testid="audio-gear"
          onClick={() => setGearOpen(o => !o)}
        >
          <i class="fa-solid fa-gear" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => { audioStore.setPlayerStyle('bar'); requestAnimationFrame(() => focusAudioPlayer()); }} title={t('audio.popup.dock')} aria-label={t('audio.popup.dock')} data-testid="audio-dock">
          <i class="fa-solid fa-window-minimize" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => { audioStore.stop(); document.querySelector<HTMLElement>('[data-testid="audio-listen"]')?.focus(); }} title={t('audio.player.stop')} aria-label={t('audio.player.stop')} data-testid="audio-close">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <div class="audio-popup__pane" ref={paneRef}>
        <AudioVersePane variant="popup" />
      </div>
      <AudioStatusLine />
      <AudioProgress />
      <div class="audio-popup__controls">
        <AudioTransportButtons />
        <AudioSpeedControl />
      </div>
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
          <AudioQuickSettings
            moduleAbbr={now.moduleAbbr}
            variant="desktop"
            onOpenSettings={section => { setGearOpen(false); onOpenSettings?.(section); }}
          />
        )}
      </Popover>
    </div>
  );
}
