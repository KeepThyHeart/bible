/**
 * Settings > Audio. Every control is built from what the registered providers and
 * engines report (`sourceStatus`, `capabilities`, `listVoices`, `isVoiceReady`), so
 * a new engine adds itself to the source control and brings its own voice list with
 * no change here. With no engines and no recordings the tab reduces to the toggles.
 */

import { useSyncExternalStore } from 'preact/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { SettingsForm } from '@bible/ui';
import type { AudioVoice, ITtsEngine, LoadProgress } from '@bible/core/browser';
import { audioStore } from '../../stores/audioStore';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { audioStorageUsage, clearChapters, clearModels, formatBytes } from '../../audio/audioStorage';
import type { AudioStorageUsage } from '../../audio/audioStorage';
import { effectiveRate } from '../../audio/audioPrefs';
import { EngineSelect, RateSlider, SourceSegmented } from '../audio/AudioControls';
import { choiceOfUi, uiSourceOf } from '../../audio/sourceChoice';
import { useSources } from '../audio/useSources';
import { AUDIO_SETTINGS, createAudioSettingsStore } from '../../audio/audioSettings';
import { isEnabled } from '../../utils/featureFlags';

interface VoiceRow { engineId: string; engine: ITtsEngine; engineLabel: string; voice: AudioVoice }
const keyOf = (engineId: string, voiceId: string) => `${engineId}:${voiceId}`;

export function AudioSettingsTab() {
  const { t } = useTranslation();
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const enabled = useStore(audioStore, () => audioStore.enabled);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const layout = useStore(audioStore, () => audioStore.layout);
  const moduleAbbr = useStore(bibleStore, () => bibleStore.getActiveModule());
  const sources = useSources(moduleAbbr);
  const language = audioStore.languageFor(moduleAbbr);
  const lang = language.toLowerCase().split(/[-_]/)[0];

  // The "While playing" toggles come from the shared settings registry.
  const audioSettings = useMemo(createAudioSettingsStore, []);
  const toggleValues = useSyncExternalStore(audioSettings.subscribe, audioSettings.getSnapshot);
  useEffect(() => audioStore.subscribe(() => { void audioSettings.reload(); }), [audioSettings]);
  const toggleFields = AUDIO_SETTINGS.toFields('audio', { translate: (key, fallback) => t(key, fallback), isEnabled, values: toggleValues });

  const [usage, setUsage] = useState<AudioStorageUsage | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [downloads, setDownloads] = useState<Record<string, LoadProgress>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const controllers = useRef(new Map<string, AbortController>());

  const refreshUsage = useCallback(() => { void audioStorageUsage().then(setUsage, () => setUsage(null)); }, []);
  useEffect(() => { refreshUsage(); }, []);
  // Leaving the tab cancels downloads in flight: nothing keeps running behind a closed panel.
  useEffect(() => () => { for (const c of controllers.current.values()) c.abort(); }, []);

  const rows: VoiceRow[] = [];
  for (const s of sources) {
    if (s.provider.kind !== 'tts' || !s.usable) continue;
    const engineId = s.provider.id.slice(4);
    const engine = audioStore.engines.get(engineId);
    if (engine) for (const voice of s.voices) rows.push({ engineId, engine, engineLabel: s.provider.label, voice });
  }
  const rowKeys = rows.map(r => keyOf(r.engineId, r.voice.id)).join('|');

  // Which voices are already on the device.
  useEffect(() => {
    let live = true;
    void Promise.all(rows.map(async r => [keyOf(r.engineId, r.voice.id), await r.engine.isVoiceReady(r.voice.id).catch(() => false)] as const))
      .then(entries => { if (live) setReady(Object.fromEntries(entries)); });
    return () => { live = false; };
  }, [rowKeys]);

  if (!enabled) return null;

  const download = async (row: VoiceRow) => {
    const key = keyOf(row.engineId, row.voice.id);
    const ctrl = new AbortController();
    controllers.current.set(key, ctrl);
    setFailed(f => ({ ...f, [key]: false }));
    setDownloads(d => ({ ...d, [key]: { phase: 'voice', loaded: 0 } }));
    try {
      await row.engine.prepare(row.voice.id, p => setDownloads(d => ({ ...d, [key]: p })), ctrl.signal);
      setReady(r => ({ ...r, [key]: true }));
    } catch (e) {
      if ((e as { code?: string })?.code !== 'aborted') setFailed(f => ({ ...f, [key]: true }));
    } finally {
      controllers.current.delete(key);
      setDownloads(d => { const { [key]: _gone, ...rest } = d; return rest; });
      audioStore.invalidateSources(moduleAbbr);
      refreshUsage();
    }
  };

  const remove = async (row: VoiceRow) => {
    await row.engine.evictVoice(row.voice.id).catch(() => {});
    setReady(r => ({ ...r, [keyOf(row.engineId, row.voice.id)]: false }));
    audioStore.invalidateSources(moduleAbbr);
    refreshUsage();
  };

  const translationChoice = prefs.perTranslation[moduleAbbr]?.source;

  // One speed range for the tab: the widest any usable source offers. `effectiveRate` narrows it per source.
  const ranges = sources.filter(s => s.usable).map(s => s.provider.capabilities(moduleAbbr).rate).filter((r): r is NonNullable<typeof r> => !!r);
  const rate = ranges.length > 0
    ? { min: Math.min(...ranges.map(r => r.min)), max: Math.max(...ranges.map(r => r.max)), step: Math.min(...ranges.map(r => r.step)) }
    : null;

  return (
    <div class="settings-panel__section audio-settings" data-section="audio">
      <h4 class="settings-panel__section-title">{t('audio.settings.title')}</h4>

      <div class="audio-settings__group">
        <h5 class="audio-settings__heading">{t('audio.settings.source')}</h5>
        <SourceSegmented
          sources={sources}
          value={uiSourceOf(prefs.source)}
          label={t('audio.settings.source')}
          moduleAbbr={moduleAbbr}
          language={language}
          onChange={ui => {
            const choice = ui === 'default' ? null : choiceOfUi(ui, sources, prefs.source, providerId);
            if (choice) audioStore.setPrefs({ source: choice });
          }}
        />
        {uiSourceOf(prefs.source) === 'generated' && (
          <label class="audio-settings__engine">
            <span>{t('audio.source.engine')}</span>
            <EngineSelect id="audio-default-engine" sources={sources} value={prefs.source} onChange={c => audioStore.setPrefs({ source: c })} />
          </label>
        )}
        <p class="audio-settings__hint">{t('audio.settings.sourceHint')}</p>

        <h5 class="audio-settings__heading">{t('audio.settings.thisTranslation', { module: moduleAbbr })}</h5>
        <SourceSegmented
          sources={sources}
          value={translationChoice ? uiSourceOf(translationChoice) : 'default'}
          withDefault
          label={t('audio.settings.thisTranslation', { module: moduleAbbr })}
          moduleAbbr={moduleAbbr}
          language={language}
          onChange={ui => {
            if (ui === 'default') { audioStore.setTranslationSource(moduleAbbr, undefined); return; }
            const choice = choiceOfUi(ui, sources, translationChoice ?? prefs.source, providerId);
            if (choice) audioStore.setTranslationSource(moduleAbbr, choice);
          }}
        />
        {translationChoice && uiSourceOf(translationChoice) === 'generated' && (
          <label class="audio-settings__engine">
            <span>{t('audio.source.engine')}</span>
            <EngineSelect id="audio-translation-engine" sources={sources} value={translationChoice} onChange={c => audioStore.setTranslationSource(moduleAbbr, c)} />
          </label>
        )}
      </div>

      {layout === 'desktop' && (
        <div class="audio-settings__group" data-testid="audio-player-style">
          <h5 class="audio-settings__heading" id="audio-style-heading">{t('audio.style.label')}</h5>
          <div class="audio-segmented" role="radiogroup" aria-labelledby="audio-style-heading">
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

      {rows.length > 0 && (
        <div class="audio-settings__group" data-testid="audio-voices">
          <h5 class="audio-settings__heading">{t('audio.settings.voices', { language: language || moduleAbbr })}</h5>
          {rows.map(row => {
            const key = keyOf(row.engineId, row.voice.id);
            const progress = downloads[key];
            const isReady = ready[key] === true;
            const chosen = (prefs.voiceByEngineLang[`${row.engineId}:${lang}`] ?? '') === row.voice.id;
            return (
              <div key={key} class={`audio-settings__voice${chosen ? ' audio-settings__voice--selected' : ''}`}>
                <div class="audio-settings__voice-main">
                  <span class="audio-settings__voice-name">{row.voice.label}</span>
                  <span class="audio-settings__voice-meta">
                    {[
                      row.engineLabel,
                      row.voice.quality ? t(`audio.settings.quality.${row.voice.quality}`) : null,
                      row.voice.downloadBytes ? formatBytes(row.voice.downloadBytes) : null,
                      isReady ? t('audio.settings.downloaded') : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  {progress && (
                    <progress class="audio-settings__progress" max={progress.total ?? undefined} value={progress.total ? progress.loaded : undefined} aria-label={t('audio.status.downloadingVoice')} />
                  )}
                  {failed[key] && <span class="audio-settings__voice-meta" role="alert">{t('audio.settings.downloadFailed')}</span>}
                </div>
                {!progress && isReady && !chosen && (
                  <button type="button" class="audio-settings__btn" onClick={() => audioStore.setEngineVoice(row.engineId, language, row.voice.id)}>{t('audio.settings.useVoice')}</button>
                )}
                {!progress && isReady && (
                  <button type="button" class="audio-settings__btn" onClick={() => { void remove(row); }}>{t('audio.settings.remove')}</button>
                )}
                {!progress && !isReady && (
                  <button type="button" class="audio-settings__btn" onClick={() => { void download(row); }}>{t('audio.settings.download')}</button>
                )}
                {progress && (
                  <button type="button" class="audio-settings__btn" onClick={() => controllers.current.get(key)?.abort()}>{t('audio.action.cancel')}</button>
                )}
              </div>
            );
          })}
          <p class="audio-settings__hint">{t('audio.settings.voicesHint')}</p>
        </div>
      )}

      {rate && (
        <div class="audio-settings__group">
          <h5 class="audio-settings__heading">{t('audio.speed.label')}</h5>
          <RateSlider range={rate} value={effectiveRate(prefs.rate, { rate })} label={t('audio.speed.label')} onChange={r => audioStore.setPrefs({ rate: r })} />
          <p class="audio-settings__hint">{t('audio.settings.speedHint')}</p>
        </div>
      )}

      <div class="audio-settings__group">
        <h5 class="audio-settings__heading">{t('audio.settings.whilePlaying')}</h5>
        <SettingsForm
          fields={toggleFields}
          values={toggleValues}
          idPrefix="audio-pref"
          onChange={(key, value) => { audioSettings.set(key, value); }}
        />
      </div>

      <div class="audio-settings__group" data-testid="audio-storage">
        <h5 class="audio-settings__heading">{t('audio.settings.storage')}</h5>
        <div class="audio-settings__storage">
          <span>{t('audio.settings.storageVoices', { size: formatBytes(usage?.modelBytes ?? 0) })}</span>
          <button type="button" class="audio-settings__btn" disabled={!usage?.modelBytes} onClick={() => { void clearModels().then(() => { for (const e of audioStore.engines.values()) e.dispose(); setReady({}); audioStore.invalidateSources(); refreshUsage(); }); }}>
            {t('audio.settings.remove')}
          </button>
        </div>
        <div class="audio-settings__storage">
          <span>{t('audio.settings.storageChapters', { size: formatBytes(usage?.chapterBytes ?? 0), count: usage?.chapterCount ?? 0 })}</span>
          <button type="button" class="audio-settings__btn" disabled={!usage?.chapterBytes} onClick={() => { void clearChapters().then(refreshUsage); }}>
            {t('audio.settings.clear')}
          </button>
        </div>
      </div>
    </div>
  );
}
