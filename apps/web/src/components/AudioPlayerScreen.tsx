/**
 * The phone's full-screen player. Play opens it; the down chevron, Escape and the
 * Android Back button close it, and playback carries on (a mini-player then
 * shows above the bottom bar). It shows the verse being read with its
 * neighbours, the state line (loading, downloading, errors with their actions),
 * progress, the transport buttons, and a bottom row with the speed control and Stop.
 * The gear opens the quick-settings bottom sheet.
 */

import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@bible/ui';
import { audioStore } from '../stores/audioStore';
import { useStore } from '../hooks/useStore';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { AudioProgress } from './audio/AudioProgress';
import { AudioStatusLine } from './audio/AudioStatusLine';
import { AudioTransportButtons } from './audio/AudioTransportButtons';
import { AudioVersePane } from './audio/AudioVersePane';
import { AudioQuickSettings } from './audio/AudioQuickSettings';
import { AudioSpeedControl } from './audio/AudioSpeedControl';
import { useSources } from './audio/useSources';
import { sourceChipText } from './audio/sourceChip';

export function AudioPlayerScreen({ onOpenSettings }: { onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const open = useStore(audioStore, () => audioStore.playerOpen);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const sheetOpen = useStore(audioStore, () => audioStore.quickSettingsOpen);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  const closeRef = useRef<HTMLButtonElement>(null);
  const visible = enabled && layout === 'phone' && open;

  // Escape closes the sheet first, then the player.
  useEscapeKey(visible && !sheetOpen, () => audioStore.closePlayer());
  useEscapeKey(visible && sheetOpen, () => audioStore.closeQuickSettings());

  // Focus moves in when the player opens and back to where it was when it closes.
  useEffect(() => {
    if (!visible) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { before?.focus?.(); };
  }, [visible]);

  if (!visible) return null;

  const active = sources.find(s => s.provider.id === providerId);
  const voiceLabel = active?.voices.find(v => v.id === voiceId)?.label;
  const sub = sourceChipText(t, providerId, active?.provider.label, voiceLabel, now.moduleAbbr ?? '');

  return (
    <div class="audio-screen" role="dialog" aria-modal="true" aria-label={t('audio.player.label')} data-testid="audio-player-screen">
      <div class="audio-screen__top">
        <button ref={closeRef} type="button" class="audio-btn audio-btn--large" onClick={() => audioStore.closePlayer()} title={t('audio.player.close')} aria-label={t('audio.player.close')} data-testid="audio-player-close">
          <i class="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
        <div class="audio-screen__ref">
          <span class="audio-screen__ref-main">{now.refLabel}</span>
          <span class="audio-screen__ref-sub">{sub}</span>
        </div>
        <button type="button" class="audio-btn audio-btn--large" onClick={() => audioStore.openQuickSettings()} title={t('audio.quick.title')} aria-label={t('audio.quick.title')} aria-haspopup="dialog" aria-expanded={sheetOpen} data-testid="audio-player-gear">
          <i class="fa-solid fa-gear" aria-hidden="true" />
        </button>
      </div>

      <AudioVersePane variant="phone" />
      <AudioStatusLine />
      <AudioProgress />
      <AudioTransportButtons large />

      <div class="audio-screen__bottom">
        <AudioSpeedControl large />
        <button type="button" class="audio-btn audio-btn--large" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')} data-testid="audio-player-stop">
          <i class="fa-solid fa-stop" aria-hidden="true" />
        </button>
      </div>

      {sheetOpen && now.moduleAbbr && (
        <BottomSheet open onClose={() => audioStore.closeQuickSettings()} title={t('audio.quick.title')} labels={{ close: t('audio.action.cancel') }} maxHeight="80dvh" className="audio-quick-sheet">
          <AudioQuickSettings
            moduleAbbr={now.moduleAbbr}
            variant="phone"
            onOpenSettings={section => { audioStore.closeQuickSettings(); audioStore.closePlayer(); onOpenSettings?.(section ?? 'audio'); }}
          />
        </BottomSheet>
      )}
    </div>
  );
}
