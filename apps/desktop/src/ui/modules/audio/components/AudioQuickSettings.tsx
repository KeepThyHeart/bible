/**
 * The content of the gear popover: source for this translation, speech engine and voice when they matter,
 * the player style, and a button to all audio settings. It never names an engine itself.
 */
import React from 'react';
import { choiceOfUi, uiSourceOf } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { EngineSelect, SourceSegmented } from './AudioControls';
import { AudioIcon } from './AudioIcons';
import { ContinueCheckbox, LoopControl } from './AudioPlaylist';
import { useSources } from './useSources';
import './audio.css';

/** The window event the host listens for to open Preferences at a section (`App.tsx`). */
export const OPEN_PREFERENCES_SECTION_EVENT = 'open-preferences-section';

export function openAudioPreferences(): void {
  window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_SECTION_EVENT, { detail: 'audio' }));
}

export interface AudioQuickSettingsProps {
  moduleAbbr: string;
  /** Called after "All audio settings" opened Preferences (the popover closes itself). */
  onOpenedSettings?(): void;
}

export const AudioQuickSettings: React.FC<AudioQuickSettingsProps> = ({ moduleAbbr, onOpenedSettings }) => {
  const { t } = useI18n();
  const prefs = useAudio((s) => s.prefs);
  const providerId = useAudio((s) => s.providerId);
  const voiceId = useAudio((s) => s.voiceId);
  const sources = useSources(moduleAbbr);
  const language = audioStore.languageFor(moduleAbbr);
  const lang = language.toLowerCase().split(/[-_]/)[0];

  const chosen = prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
  const ui = uiSourceOf(chosen);

  // The engine whose voices are offered: the chosen one, else the one playing.
  const chosenUsable = chosen.startsWith('tts:') && sources.some((s) => s.provider.id === chosen && s.usable);
  const engineProviderId = chosenUsable ? chosen : providerId?.startsWith('tts:') ? providerId : null;
  const engineStatus = engineProviderId ? sources.find((s) => s.provider.id === engineProviderId && s.usable) : undefined;
  const voices = engineStatus ? engineStatus.voices : [];
  const engine = engineStatus ? engineStatus.provider.id.slice(4) : null;
  const selectedVoice = engine ? (prefs.perTranslation[moduleAbbr]?.voiceId ?? prefs.voiceByEngineLang[`${engine}:${lang}`] ?? voiceId ?? '') : '';

  const pickSource = (next: 'auto' | 'recorded' | 'generated' | 'default') => {
    if (next === 'default') return;
    const choice = choiceOfUi(next, sources, chosen, providerId);
    if (choice) audioStore.setTranslationSource(moduleAbbr, choice);
  };

  return (
    <div className="audio-panel audio-quick" data-testid="audio-quick-settings">
      <div className="audio-panel__row">
        <span className="audio-panel__label">{t('audio.source.for', { module: moduleAbbr })}</span>
        <SourceSegmented sources={sources} value={ui} label={t('audio.source.for', { module: moduleAbbr })} moduleAbbr={moduleAbbr} language={language} onChange={pickSource} />
      </div>

      {ui === 'generated' && sources.filter((s) => s.provider.kind === 'tts' && s.usable).length >= 2 && (
        <div className="audio-panel__row">
          <label className="audio-panel__label" htmlFor="audio-quick-engine">{t('audio.source.engine')}</label>
          <EngineSelect id="audio-quick-engine" sources={sources} value={chosenUsable ? chosen : (providerId ?? '')} onChange={(c) => audioStore.setTranslationSource(moduleAbbr, c)} />
        </div>
      )}

      {engine && voices.length >= 2 && (
        <div className="audio-panel__row">
          <label className="audio-panel__label" htmlFor="audio-quick-voice">{t('audio.voice.label')}</label>
          <select id="audio-quick-voice" className="audio-select" value={selectedVoice} onChange={(e) => audioStore.setEngineVoice(engine, language, e.target.value)}>
            {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
      )}

      <div className="audio-panel__row">
        <span className="audio-panel__label" id="audio-quick-style">{t('audio.style.label')}</span>
        <div className="audio-segmented" role="radiogroup" aria-labelledby="audio-quick-style">
          {(['bar', 'popup'] as const).map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={prefs.playerStyle === style}
              className={`audio-segmented__btn${prefs.playerStyle === style ? ' audio-segmented__btn--active' : ''}`}
              onClick={() => audioStore.setPlayerStyle(style)}
            >
              {t(`audio.style.${style}`)}
            </button>
          ))}
        </div>
      </div>

      <LoopControl testId="audio-quick-loop" />
      <ContinueCheckbox testId="audio-quick-continue" />

      <button type="button" className="audio-panel__more" data-testid="audio-all-settings" onClick={() => { openAudioPreferences(); onOpenedSettings?.(); }}>
        {t('audio.quick.all')} <AudioIcon name="chevron" size={10} />
      </button>
    </div>
  );
};
