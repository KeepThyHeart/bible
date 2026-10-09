/**
 * The desktop transport bar, docked under the Bible toolbar when the player style is 'bar': skipping,
 * play/pause, progress, the verse being read, speed, the quick-settings gear, pop-out and stop.
 * In pop-up style it renders nothing while audio is active; the idle notice strip (for example "no
 * audio for this translation") shows in either style. The phone has its own player.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import { focusAudioPlayer } from '../lib/audioShortcuts';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { AudioTransportButtons } from './AudioTransportButtons';
import { AudioProgress } from './AudioProgress';
import { AudioStatusLine } from './AudioStatusLine';
import { AudioSpeedControl } from './AudioSpeedControl';
import { AudioQuickSettings } from './AudioQuickSettings';

export function AudioTransportBar({ onOpenSettings }: { onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const status = useStore(audioStore, () => audioStore.status);
  const notice = useStore(audioStore, () => audioStore.notice);
  const style = useStore(audioStore, () => audioStore.prefs.playerStyle);
  const now = useNowPlaying();
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);

  const idle = status === 'idle';
  const hidden = !enabled || layout !== 'desktop' || (!idle && style === 'popup');
  // Stopping, switching style or the feature going off must not leave the popover armed for next time.
  useEffect(() => { if (hidden || idle) setGearOpen(false); }, [hidden, idle]);

  if (!enabled || layout !== 'desktop') return null;
  if (idle) {
    // Nothing is playing, but the reader should hear why (e.g. no audio for this translation).
    if (!notice) return null;
    return (
      <div class="audio-transport audio-transport--notice" data-testid="audio-transport">
        <AudioStatusLine />
      </div>
    );
  }
  if (style === 'popup') return null;

  return (
    <div class="audio-transport" role="toolbar" aria-label={t('audio.transport.label')} data-testid="audio-transport">
      <div class="audio-transport__row">
        <AudioTransportButtons />
        <AudioProgress />
        <span class="audio-transport__now" data-testid="audio-now-playing">{now.refLabel}</span>
        <AudioSpeedControl />
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
        <button type="button" class="audio-btn" onClick={() => { audioStore.setPlayerStyle('popup'); requestAnimationFrame(() => focusAudioPlayer()); }} title={t('audio.transport.popOut')} aria-label={t('audio.transport.popOut')} data-testid="audio-popout">
          <i class="fa-solid fa-up-right-from-square" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')} data-testid="audio-close">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
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
