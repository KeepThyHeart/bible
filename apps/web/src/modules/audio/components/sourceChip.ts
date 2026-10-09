/** The text of the source chip: "Recorded · KJV", "Generated · Amy" or "Generated". */
export function sourceChipText(
  t: (key: string, options?: Record<string, string>) => string,
  providerId: string | null,
  _providerLabel: string | undefined,
  voiceLabel: string | undefined,
  moduleAbbr: string,
): string {
  if (!providerId) return '';
  if (providerId === 'recorded') return t('audio.chip.recorded', { module: moduleAbbr });
  return voiceLabel ? t('audio.chip.generatedVoice', { voice: voiceLabel }) : t('audio.chip.generated');
}
