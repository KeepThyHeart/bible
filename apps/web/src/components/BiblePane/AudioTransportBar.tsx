/**
 * The desktop transport bar, docked under the Bible toolbar while audio plays
 * (or reports a state): chapter and verse skipping, play/pause, progress, the
 * speed and source chips (which open the source panel), settings and close.
 * The phone has its own full-screen player and mini-player instead.
 *
 * Hidden entirely when the feature is off, and when nothing is playing and there
 * is nothing to report.
 */

import { useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { Popover } from '@bible/ui';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { useNowPlaying } from '../../hooks/useNowPlaying';
import { AudioTransportButtons } from '../audio/AudioTransportButtons';
import { AudioProgress } from '../audio/AudioProgress';
import { AudioStatusLine } from '../audio/AudioStatusLine';
import { AudioSourcePanel } from '../audio/AudioSourcePanel';
import { formatRate } from '../audio/AudioControls';
import { useSources } from '../audio/useSources';
import { sourceChipText } from '../audio/sourceChip';

export function AudioTransportBar({ onOpenSettings }: { onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const layout = useStore(audioStore, () => audioStore.layout);
  const status = useStore(audioStore, () => audioStore.status);
  const notice = useStore(audioStore, () => audioStore.notice);
  const rate = useStore(audioStore, () => audioStore.rate);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const now = useNowPlaying();
  const sources = useSources(now.moduleAbbr);
  const [panelOpen, setPanelOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The shared Popover owns outside-press and Escape handling and focus return; the
  // chips only say where it is anchored.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const openPanel = (e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (panelOpen) { setPanelOpen(false); return; }
    setAnchor(el.getBoundingClientRect());
    setPanelOpen(true);
  };

  if (!enabled || layout !== 'desktop') return null;
  const idle = status === 'idle';
  if (idle && !notice) return null;

  // Nothing is playing, but the reader should hear why (e.g. no audio for this translation).
  if (idle) {
    return (
      <div class="audio-transport audio-transport--notice" data-testid="audio-transport" ref={rootRef}>
        <AudioStatusLine />
      </div>
    );
  }

  const active = sources.find(s => s.provider.id === providerId);
  const chip = sourceChipText(t, providerId, active?.provider.label, active?.voices.find(v => v.id === voiceId)?.label, now.moduleAbbr ?? '');
  const panelId = 'audio-source-panel-popover';

  return (
    <div class="audio-transport" role="toolbar" aria-label={t('audio.transport.label')} data-testid="audio-transport" ref={rootRef}>
      <div class="audio-transport__row">
        <AudioTransportButtons />
        <AudioProgress />
        <span class="audio-transport__now" data-testid="audio-now-playing">{now.refLabel}</span>
        <button
          type="button"
          class="audio-chip"
          data-chip
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? panelId : undefined}
          title={t('audio.transport.speed')}
          onClick={openPanel}
        >
          {formatRate(rate)}
        </button>
        <button
          type="button"
          class="audio-chip audio-chip--source"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? panelId : undefined}
          title={t('audio.transport.source')}
          onClick={openPanel}
        >
          {chip}
        </button>
        <button type="button" class="audio-btn" onClick={() => onOpenSettings?.('audio')} title={t('audio.transport.settings')} aria-label={t('audio.transport.settings')}>
          <i class="fa-solid fa-gear" aria-hidden="true" />
        </button>
        <button type="button" class="audio-btn" onClick={() => audioStore.stop()} title={t('audio.transport.close')} aria-label={t('audio.transport.close')} data-testid="audio-close">
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <AudioStatusLine />
      <Popover
        open={panelOpen && !!now.moduleAbbr}
        anchor={anchor}
        onClose={() => setPanelOpen(false)}
        id={panelId}
        label={t('audio.transport.source')}
        width={340}
        estimatedHeight={260}
        align="end"
        autoFocus
        className="audio-popover"
        insideRefs={[rootRef]}
      >
        {now.moduleAbbr && <AudioSourcePanel moduleAbbr={now.moduleAbbr} onOpenSettings={section => { setPanelOpen(false); onOpenSettings?.(section); }} />}
      </Popover>
    </div>
  );
}
