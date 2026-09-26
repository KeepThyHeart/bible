/** The text of the source chip: "Recorded · KJV", or "Piper · Amy · on this device". */
export function sourceChipText(
  t: (key: string, options?: Record<string, string>) => string,
  providerId: string | null,
  providerLabel: string | undefined,
  voiceLabel: string | undefined,
  moduleAbbr: string,
): string {
  if (!providerId) return '';
  if (providerId === 'recorded') return t('audio.chip.recorded', { module: moduleAbbr });
  return voiceLabel
    ? t('audio.chip.onDeviceVoice', { engine: providerLabel ?? providerId, voice: voiceLabel })
    : t('audio.chip.onDevice', { engine: providerLabel ?? providerId });
}
