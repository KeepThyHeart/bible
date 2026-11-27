/**
 * The phone's full-screen player. Play opens it; the down chevron, Escape and the
 * Android Back button close it, and playback carries on (a mini-player then
 * shows above the bottom bar). It shows the verse being read with its
 * neighbours, the state line (loading, downloading, errors with their actions),
 * progress, the transport buttons, and a bottom row: speed, Repeat, Continue, and the
 * passages button (a text box of references; by default the current chapter is read).
 * No Stop: the chevron minimises and the mini-player's close button stops.
 * The gear (bottom row) and the voice under the title open the audio settings bottom sheet
 * (all of them: there is no other page).
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@bible/ui';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { bibleStore } from '../../../stores/bibleStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { useSourceChip } from './useSourceChip';
import { AudioProgress } from './AudioProgress';
import { AudioStatusLine } from './AudioStatusLine';
import { AudioTransportButtons } from './AudioTransportButtons';
import { AudioVersePane } from './AudioVersePane';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioPlaylist, PassagesButton } from './AudioPlaylist';
import { PlaybackToggles } from './PlaybackToggles';
import { AudioPassageProgress } from './AudioPassageProgress';
import { AudioElsewhere } from './AudioElsewhere';
import { AudioSpeedControl } from './AudioSpeedControl';
import { useSources } from './useSources';
import { sourceChipText } from './sourceChip';

export function AudioPlayerScreen() {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const open = useStore(audioStore, () => audioStore.playerOpen);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const sheetOpen = useStore(audioStore, () => audioStore.quickSettingsOpen);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const status = useStore(audioStore, () => audioStore.status);
  const now = useNowPlaying();
  const chipText = useSourceChip(now.moduleAbbr);
  const sources = useSources(now.moduleAbbr);
  const closeRef = useRef<HTMLButtonElement>(null);
  const visible = enabled && layout === 'phone' && open;
  const [passagesOpen, setPassagesOpen] = useState(false);

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
  const idle = status === 'idle';
  const sub = chipText;

  return (
    <div class="audio-screen" role="dialog" aria-modal="true" aria-label={t('audio.player.label')} data-testid="audio-player-screen">
      <div class="audio-screen__top">
        <button ref={closeRef} type="button" class="audio-btn audio-btn--large" onClick={() => audioStore.closePlayer()} title={t('audio.player.close')} aria-label={t('audio.player.close')} data-testid="audio-player-close">
          <i class="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
        <div class="audio-screen__ref">
          <span class="audio-screen__ref-main">{idle ? t('audio.passages.title') : now.refLabel}</span>
          {/* The voice in use: tapping it opens the settings, where it is chosen. */}
          {!idle && (
            <button type="button" class="audio-screen__ref-sub audio-screen__voice" onClick={() => audioStore.openQuickSettings()} title={t('audio.quick.title')} data-testid="audio-player-voice">
              {sub} <i class="fa-solid fa-caret-down" aria-hidden="true" />
            </button>
          )}
          {!idle && <AudioPassageProgress />}
        </div>
        {/* Balances the chevron so the title stays centred; the gear is in the bottom row. */}
        <span class="audio-screen__top-spacer" aria-hidden="true" />
      </div>

      {!idle && <AudioElsewhere />}
      {!idle && <AudioVersePane variant="phone" />}
      <AudioStatusLine />
      {!idle && <AudioProgress />}
      {!idle && <AudioTransportButtons large />}

      <AudioPlaylist open={idle || passagesOpen} onClose={() => setPassagesOpen(false)} />
      {/* Last, flush with the screen's edges: the playlist opens above it. */}
      {!idle && (
        <div class="audio-screen__bottom audio-tiles">
          <AudioSpeedControl large />
          <PlaybackToggles large />
          <PassagesButton large open={passagesOpen} onToggle={() => setPassagesOpen(o => !o)} />
          <button type="button" class="audio-btn audio-tool" onClick={() => audioStore.openQuickSettings()} title={t('audio.quick.title')} aria-label={t('audio.quick.title')} aria-haspopup="dialog" aria-expanded={sheetOpen} data-testid="audio-player-gear">
            <i class="fa-solid fa-gear" aria-hidden="true" />
            <span class="audio-tool__caption">{t('audio.quick.short')}</span>
          </button>
        </div>
      )}

      {sheetOpen && (now.moduleAbbr || bibleStore.getActiveTab()?.moduleAbbr) && (
        <BottomSheet open onClose={() => audioStore.closeQuickSettings()} title={t('audio.quick.title')} labels={{ close: t('audio.action.cancel') }} maxHeight="80dvh" className="audio-quick-sheet">
          <AudioQuickSettings
            moduleAbbr={(now.moduleAbbr ?? bibleStore.getActiveTab()?.moduleAbbr) as string}
            variant="phone"
          />
        </BottomSheet>
      )}
    </div>
  );
}
