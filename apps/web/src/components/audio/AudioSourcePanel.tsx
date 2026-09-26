/**
 * Source, voice and speed for the translation being read: the popover on the
 * desktop bar and the section under the phone player's chips. Everything it
 * offers comes from what the providers report, so it never names an engine.
 */

import { useTranslation } from 'react-i18next';
import type { AudioSourceChoice } from '@bible/core/browser';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { RateSlider, SourceSegmented, UnusableNotes, rateFor } from './AudioControls';
import { useSources } from './useSources';

export function AudioSourcePanel({ moduleAbbr, onOpenSettings }: { moduleAbbr: string; onOpenSettings?: (section?: string) => void }) {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const sources = useSources(moduleAbbr);
  const language = audioStore.languageFor(moduleAbbr);

  const chosen = prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
  const active = sources.find(s => s.provider.id === providerId);
  const caps = active ? active.provider.capabilities(moduleAbbr) : null;
  const voices = caps?.voices ? active!.voices : [];
  const engine = providerId?.startsWith('tts:') ? providerId.slice(4) : null;
  const lang = language.toLowerCase().split(/[-_]/)[0];
  const selectedVoice = engine
    ? (prefs.perTranslation[moduleAbbr]?.voiceId ?? prefs.voiceByEngineLang[`${engine}:${lang}`] ?? voiceId ?? '')
    : (prefs.perTranslation[moduleAbbr]?.voiceId ?? voiceId ?? '');

  return (
    <div class="audio-panel" data-testid="audio-source-panel">
      <div class="audio-panel__row">
        <span class="audio-panel__label" id="audio-panel-source">{t('audio.source.for', { module: moduleAbbr })}</span>
        <SourceSegmented
          sources={sources}
          value={chosen}
          withAuto
          label={t('audio.source.for', { module: moduleAbbr })}
          moduleAbbr={moduleAbbr}
          language={language}
          onChange={source => audioStore.setTranslationSource(moduleAbbr, source as AudioSourceChoice)}
        />
      </div>
      <UnusableNotes sources={sources} moduleAbbr={moduleAbbr} language={language} />

      {voices.length > 0 && (
        <div class="audio-panel__row">
          <label class="audio-panel__label" for="audio-panel-voice">{t('audio.voice.label')}</label>
          <select
            id="audio-panel-voice"
            class="audio-select"
            value={selectedVoice}
            onChange={e => {
              const id = (e.target as HTMLSelectElement).value;
              if (engine) audioStore.setEngineVoice(engine, language, id);
              else audioStore.setTranslationVoice(moduleAbbr, id);
            }}
          >
            {voices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
      )}

      {caps?.rate && (
        <div class="audio-panel__row">
          <label class="audio-panel__label">{t('audio.speed.label')}</label>
          <RateSlider
            range={caps.rate}
            value={rateFor(caps)}
            label={t('audio.speed.label')}
            onChange={rate => audioStore.setPrefs({ rate })}
          />
        </div>
      )}

      {onOpenSettings && (
        <button type="button" class="audio-panel__more" onClick={() => onOpenSettings('audio')}>
          {t('audio.settings.more')} <i class="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
