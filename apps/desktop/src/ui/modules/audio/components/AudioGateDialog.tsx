/**
 * The question asked before the first sound when a voice must be downloaded ("Download the voice?").
 * (The battery question is phone-only and does not occur here; it is worded the same way if it ever does.)
 * Nothing is downloaded or played until the reader confirms.
 */
import React from 'react';
import { formatBytes } from '@bible/audio';
import { ConfirmDialog } from '../../../components/shared/ConfirmDialog';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import './audio.css';

export const AudioGateDialog: React.FC = () => {
  const { t } = useI18n();
  const gate = useAudio((s) => s.pendingGate);
  const module = useAudio((s) => s.playingModule) ?? '';
  if (!gate) return null;

  const isBattery = gate.kind === 'battery';
  const size = gate.bytes ? formatBytes(gate.bytes) : null;
  const parts: string[] = [];
  if (isBattery) parts.push(t('audio.gate.batteryBody', { module }));
  // One paragraph per line, as the web shows them (the size line has no full stop of its own).
  if (size) parts.push(t('audio.gate.voiceSize', { engine: gate.engineLabel, voice: gate.voiceLabel ?? '', size }), t('audio.gate.downloadHint'));
  return (
    <ConfirmDialog
      open
      title={isBattery ? t('audio.gate.batteryTitle') : t('audio.gate.downloadTitle')}
      message={parts.join('\n')}
      confirmLabel={size ? t('audio.gate.downloadAndPlay') : t('audio.play')}
      cancelLabel={t('audio.action.cancel')}
      onConfirm={() => audioStore.confirmGate()}
      onCancel={() => audioStore.cancelGate()}
    />
  );
};
