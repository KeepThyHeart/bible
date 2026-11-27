/**
 * The player's "Generated · Joe" line, from the reader's choice rather than what last played: a
 * voice or source picked in the settings shows at once, before it takes over (at once while
 * playing; on the next play while paused). Falls back to what plays when the choice is "auto" or
 * cannot play here.
 */
import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { useSources } from './useSources';
import { sourceChipText } from './sourceChip';

export function useSourceChip(moduleAbbr: string | null | undefined): string {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const playingVoice = useStore(audioStore, () => audioStore.voiceId);
  const sources = useSources(moduleAbbr);
  if (!moduleAbbr) return '';
  const chosen = prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
  const usableChoice = chosen !== 'auto' ? sources.find(s => s.provider.id === chosen && s.usable) : undefined;
  const id = usableChoice?.provider.id ?? providerId;
  const status = sources.find(s => s.provider.id === id);
  let voiceId = id === providerId ? playingVoice : null;
  if (id && status?.provider.kind === 'tts') {
    const lang = audioStore.languageFor(moduleAbbr).toLowerCase().split(/[-_]/)[0];
    const pick = prefs.perTranslation[moduleAbbr]?.voiceId ?? prefs.voiceByEngineLang[`${id.slice(4)}:${lang}`];
    if (pick && status.voices.some(v => v.id === pick)) voiceId = pick;
    else if (!voiceId) voiceId = status.voices[0]?.id ?? null;
  }
  return sourceChipText(t, id, status?.provider.label, status?.voices.find(v => v.id === voiceId)?.label, moduleAbbr);
}
