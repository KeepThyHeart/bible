/**
 * The content of the desktop settings popover and the phone settings sheet: source
 * for this translation, speech engine and voice when they matter, the player style
 * (desktop), and a link to all audio settings. It never names an engine itself.
 */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../../stores/audioStore';
import { useStore } from '../../hooks/useStore';
import { choiceOfUi, uiSourceOf } from '../../audio/sourceChoice';
import { EngineSelect, SourceSegmented } from './AudioControls';
import { useSources } from './useSources';

export interface AudioQuickSettingsProps {
  moduleAbbr: string;
  variant: 'desktop' | 'phone';
  onOpenSettings?(section?: string): void;
}

export function AudioQuickSettings({ moduleAbbr, variant, onOpenSettings }: AudioQuickSettingsProps) {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const voiceId = useStore(audioStore, () => audioStore.voiceId);
  const sources = useSources(moduleAbbr);
  const language = audioStore.languageFor(moduleAbbr);
  const lang = language.toLowerCase().split(/[-_]/)[0];

  const chosen = prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
  const ui = uiSourceOf(chosen);

  // The engine whose voices are offered: the chosen one, else the one playing.
  // (the chosen engine may be unusable for this translation: then the one playing instead)
  const chosenUsable = chosen.startsWith('tts:') && sources.some(s => s.provider.id === chosen && s.usable);
  const engineProviderId = chosenUsable ? chosen : providerId?.startsWith('tts:') ? providerId : null;
  const engineStatus = engineProviderId ? sources.find(s => s.provider.id === engineProviderId && s.usable) : undefined;
  const voices = engineStatus ? engineStatus.voices : [];
  const engine = engineStatus ? engineStatus.provider.id.slice(4) : null;
  const selectedVoice = engine
    ? (prefs.perTranslation[moduleAbbr]?.voiceId ?? prefs.voiceByEngineLang[`${engine}:${lang}`] ?? voiceId ?? '')
    : '';

  const pickSource = (next: 'auto' | 'recorded' | 'generated' | 'default') => {
    if (next === 'default') return;
    const choice = choiceOfUi(next, sources, chosen, providerId);
    if (choice) audioStore.setTranslationSource(moduleAbbr, choice);
  };

  return (
    <div class={`audio-panel audio-quick audio-quick--${variant}`} data-testid="audio-quick-settings">
      <div class="audio-panel__row">
        <span class="audio-panel__label">{t('audio.source.for', { module: moduleAbbr })}</span>
        <SourceSegmented
          sources={sources}
          value={ui}
          label={t('audio.source.for', { module: moduleAbbr })}
          moduleAbbr={moduleAbbr}
          language={language}
          onChange={pickSource}
        />
      </div>

      {ui === 'generated' && sources.filter(s => s.provider.kind === 'tts' && s.usable).length >= 2 && (
        <div class="audio-panel__row">
          <label class="audio-panel__label" for="audio-quick-engine">{t('audio.source.engine')}</label>
          <EngineSelect
            id="audio-quick-engine"
            sources={sources}
            value={chosenUsable ? chosen : (providerId ?? '')}
            onChange={c => audioStore.setTranslationSource(moduleAbbr, c)}
          />
        </div>
      )}

      {engine && voices.length >= 2 && (
        <div class="audio-panel__row">
          <label class="audio-panel__label" for="audio-quick-voice">{t('audio.voice.label')}</label>
          <select
            id="audio-quick-voice"
            class="audio-select"
            value={selectedVoice}
            onChange={e => audioStore.setEngineVoice(engine, language, (e.target as HTMLSelectElement).value)}
          >
            {voices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
      )}

      {variant === 'desktop' && (
        <div class="audio-panel__row">
          <span class="audio-panel__label" id="audio-quick-style">{t('audio.style.label')}</span>
          <div class="audio-segmented" role="radiogroup" aria-labelledby="audio-quick-style">
            {(['bar', 'popup'] as const).map(style => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={prefs.playerStyle === style}
                class={`audio-segmented__btn${prefs.playerStyle === style ? ' audio-segmented__btn--active' : ''}`}
                onClick={() => audioStore.setPlayerStyle(style)}
              >
                {t(`audio.style.${style}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {onOpenSettings && (
        <button type="button" class="audio-panel__more" onClick={() => onOpenSettings('audio')}>
          {t('audio.quick.all')} <i class="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
