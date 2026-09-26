/**
 * The two questions asked before the first sound: "read aloud on this phone?"
 * (speech costs battery; asked once per engine per device) and "download this
 * voice?" (a one-time download of tens of megabytes). On the phone one notice
 * covers both. Nothing is downloaded or played until the reader confirms.
 */

import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatBytes } from '../../audio/audioStorage';

export function AudioGateDialog() {
  const { t } = useTranslation();
  const gate = useStore(audioStore, () => audioStore.pendingGate);
  const module = useStore(audioStore, () => audioStore.playingModule) ?? '';
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEscapeKey(!!gate, () => audioStore.cancelGate());

  // Focus the confirming button, and hand focus back to where it was on close.
  useEffect(() => {
    if (!gate) return;
    const before = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    return () => { before?.focus?.(); };
  }, [!!gate]);

  if (!gate) return null;

  const isBattery = gate.kind === 'battery';
  const size = gate.bytes ? formatBytes(gate.bytes) : null;
  const voice = gate.voiceLabel ?? '';
  const confirmLabel = size ? (isBattery ? t('audio.gate.downloadAndPlay') : t('audio.gate.download')) : t('audio.play');

  return (
    <div class="settings-panel-overlay audio-gate-overlay" onClick={() => audioStore.cancelGate()}>
      <div
        class="audio-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-gate-title"
        aria-describedby="audio-gate-body"
        data-testid="audio-gate"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="audio-gate-title" class="audio-gate__title">
          <i class="fa-solid fa-headphones" aria-hidden="true" /> {isBattery ? t('audio.gate.batteryTitle') : t('audio.gate.downloadTitle')}
        </h3>
        <div id="audio-gate-body" class="audio-gate__body">
          {isBattery && <p>{t('audio.gate.batteryBody', { module })}</p>}
          {size && (
            <>
              <p class="audio-gate__size">{t('audio.gate.voiceSize', { engine: gate.engineLabel, voice, size })}</p>
              <p class="audio-gate__hint">{t('audio.gate.downloadHint')}</p>
            </>
          )}
        </div>
        <div class="audio-gate__actions">
          <button type="button" class="audio-gate__btn" onClick={() => audioStore.cancelGate()}>{t('audio.action.cancel')}</button>
          <button type="button" class="audio-gate__btn audio-gate__btn--primary" ref={primaryRef} onClick={() => audioStore.confirmGate()} data-testid="audio-gate-confirm">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
