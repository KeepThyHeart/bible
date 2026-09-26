/**
 * The phone's full-screen player. Play opens it; the down chevron, Escape and the
 * Android Back button close it, and playback carries on (a mini-player then
 * shows above the bottom bar). It shows the verse being read with its
 * neighbours, the state line (loading, downloading, errors with their actions),
 * progress, the transport buttons, and the speed and voice/narrator chips.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../stores/audioStore';
import { moduleStore } from '../stores/moduleStore';
import { useStore } from '../hooks/useStore';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { AudioProgress } from './audio/AudioProgress';
import { AudioStatusLine } from './audio/AudioStatusLine';
import { AudioTransportButtons } from './audio/AudioTransportButtons';
import { AudioSourcePanel } from './audio/AudioSourcePanel';
import { formatRate } from './audio/AudioControls';
import { useSources } from './audio/useSources';
import { sourceChipText } from './audio/sourceChip';

export function AudioPlayerScreen({ onOpenSettings }: { onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const open = useStore(audioStore, () => audioStore.playerOpen);
  const status = useStore(audioStore, () => audioStore.status);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const rate = useStore(audioStore, () => audioStore.rate);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  const [panelOpen, setPanelOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const visible = enabled && layout === 'phone' && open;

  useEscapeKey(visible, () => audioStore.closePlayer());

  // Focus moves in when the player opens and back to where it was when it closes.
  useEffect(() => {
    if (!visible) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { before?.focus?.(); };
  }, [visible]);

  // A stopped player has nothing to show; do not leave an empty screen up while it is closing.
  if (!visible) return null;

  const active = sources.find(s => s.provider.id === providerId);
  const voiceLabel = active?.voices.find(v => v.id === voiceId)?.label;
  const chip = sourceChipText(t, providerId, active?.provider.label, undefined, now.moduleAbbr ?? '');
  const moduleName = now.moduleAbbr ? (moduleStore.getBibleModules().find(m => m.abbreviation === now.moduleAbbr)?.name ?? now.moduleAbbr) : '';
  const verses = now.tab?.verses ?? [];
  const idx = now.verse !== null ? verses.findIndex(v => v.verse === now.verse) : -1;
  const shown = idx >= 0 ? [idx - 1, idx, idx + 1].filter(i => i >= 0 && i < verses.length).map(i => ({ v: verses[i], current: i === idx })) : [];
  const busy = status === 'resolving' || status === 'preparing';
  const isRecorded = providerId === 'recorded';

  return (
    <div class="audio-screen" role="dialog" aria-modal="true" aria-label={t('audio.player.label')} data-testid="audio-player-screen">
      <div class="audio-screen__top">
        <span class="audio-screen__source">{chip}</span>
        <button ref={closeRef} type="button" class="audio-btn audio-btn--large" onClick={() => audioStore.closePlayer()} title={t('audio.player.close')} aria-label={t('audio.player.close')} data-testid="audio-player-close">
          <i class="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
      </div>

      <div class="audio-screen__ref">
        <span class="audio-screen__ref-main">{now.refLabel}</span>
        <span class="audio-screen__ref-sub">{moduleName}{voiceLabel && !isRecorded ? ` · ${voiceLabel}` : ''}</span>
      </div>

      <div class="audio-screen__text" aria-live="off">
        {busy && shown.length === 0 && <i class="fa-solid fa-spinner fa-spin" aria-hidden="true" />}
        {shown.map(({ v, current }) => (
          <p key={v.verse} class={`audio-screen__verse${current ? ' audio-screen__verse--current' : ''}`}>
            <sup>{v.verse}</sup> {v.text}
          </p>
        ))}
      </div>

      <AudioStatusLine />
      <AudioProgress />
      <AudioTransportButtons large />

      <div class="audio-screen__chips">
        <button type="button" class="audio-chip" aria-expanded={panelOpen} onClick={() => setPanelOpen(v => !v)} title={t('audio.transport.speed')}>
          {formatRate(rate)}
        </button>
        <button type="button" class="audio-chip audio-chip--source" aria-expanded={panelOpen} onClick={() => setPanelOpen(v => !v)}>
          {isRecorded ? t('audio.player.narrator') : voiceLabel ?? t('audio.voice.label')} <i class="fa-solid fa-caret-down" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => { audioStore.closePlayer(); onOpenSettings?.('audio'); }} title={t('audio.transport.settings')} aria-label={t('audio.transport.settings')}>
          <i class="fa-solid fa-gear" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')} data-testid="audio-player-stop">
          <i class="fa-solid fa-stop" aria-hidden="true" />
        </button>
      </div>
      {panelOpen && now.moduleAbbr && <AudioSourcePanel moduleAbbr={now.moduleAbbr} />}
    </div>
  );
}
