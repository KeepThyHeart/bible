/**
 * The reader sees three sources (Auto, Recorded, Generated); the stored choice keeps
 * the core contract (`auto | recorded | tts:<engine>`). These helpers map between them.
 */

import type { AudioSourceChoice } from '@bible/core/browser';
import type { SourceStatus } from './AudioSourceResolver';

export type UiSource = 'auto' | 'recorded' | 'generated';

export interface UiOption { id: UiSource; label: string; disabled: boolean; reason?: string }

type T = (key: string, options?: Record<string, string>) => string;

const RECORDED_ID = 'recorded';

/** "en" -> "English" (in the reader's language), falling back to the code itself. */
export function displayLanguage(code: string): string {
  const primary = code.split(/[-_]/)[0];
  if (!primary) return code;
  try {
    const ui = typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : 'en';
    return new Intl.DisplayNames([ui], { type: 'language' }).of(primary) ?? code;
  } catch {
    return code;
  }
}

/** Why a source cannot be chosen, in words. */
export function unusableText(status: SourceStatus, moduleAbbr: string, language: string, t: (k: string, o?: Record<string, string>) => string): string {
  const name = status.provider.kind === 'recorded' ? '' : status.provider.label;
  switch (status.reason) {
    case 'no-recording': return t('audio.source.noRecording', { module: moduleAbbr });
    case 'browser': return t('audio.source.browserUnsupported', { engine: name });
    default: return t('audio.source.noVoice', { engine: name, language: displayLanguage(language) });
  }
}

/** `tts:*` is "Generated". */
export function uiSourceOf(choice: AudioSourceChoice): UiSource {
  if (choice === 'auto') return 'auto';
  return choice === RECORDED_ID ? 'recorded' : 'generated';
}

/** Engines that can speak this translation, in resolver order. */
export function usableEngines(statuses: SourceStatus[]): SourceStatus[] {
  return statuses.filter(s => s.provider.kind === 'tts' && s.usable);
}

/**
 * The `tts:<engine>` that "Generated" stands for: the current one when it is a usable
 * engine, else the engine now playing, else the first usable engine; null when none.
 */
export function generatedChoice(
  statuses: SourceStatus[],
  current: AudioSourceChoice,
  playingProviderId: string | null,
): `tts:${string}` | null {
  const engines = usableEngines(statuses);
  const ok = (id: string | null): id is `tts:${string}` => !!id && id.startsWith('tts:') && engines.some(e => e.provider.id === id);
  if (ok(current)) return current;
  if (ok(playingProviderId)) return playingProviderId;
  const first = engines[0]?.provider.id;
  return first ? (first as `tts:${string}`) : null;
}

/** The stored choice for a picked UI source; null when it cannot be picked (Generated with no engine). */
export function choiceOfUi(
  ui: UiSource,
  statuses: SourceStatus[],
  current: AudioSourceChoice,
  playingProviderId: string | null,
): AudioSourceChoice | null {
  if (ui === 'generated') return generatedChoice(statuses, current, playingProviderId);
  return ui;
}

/** The three options, with the reason an unusable one cannot be picked. */
export function uiOptions(statuses: SourceStatus[], moduleAbbr: string, language: string, t: T): UiOption[] {
  const recorded = statuses.find(s => s.provider.kind === 'recorded');
  const engines = statuses.filter(s => s.provider.kind === 'tts');
  const recordedOk = !!recorded?.usable;
  const generatedOk = engines.some(s => s.usable);
  return [
    { id: 'auto', label: t('audio.source.auto'), disabled: false },
    {
      id: 'recorded', label: t('audio.source.recorded'), disabled: !recordedOk,
      reason: recordedOk ? undefined : recorded ? unusableText(recorded, moduleAbbr, language, t) : t('audio.source.noRecording', { module: moduleAbbr }),
    },
    {
      id: 'generated', label: t('audio.source.generated'), disabled: !generatedOk,
      reason: generatedOk ? undefined : engines[0] ? unusableText(engines[0], moduleAbbr, language, t) : t('audio.source.noGenerated', { language: displayLanguage(language) }),
    },
  ];
}
