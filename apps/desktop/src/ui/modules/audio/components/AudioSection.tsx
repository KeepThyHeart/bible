/**
 * Preferences > Audio. Every control is built from what the registered providers and engines report
 * (`sourceStatus`, `capabilities`, `listVoices`, `isVoiceReady`), so a new engine adds itself with no change here.
 * With no engines and no recordings the section reduces to the toggles.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import type { AudioVoice, ITtsEngine, LoadProgress } from '@bible/core/browser';
import { AUDIO_SETTINGS, createAudioSettingsStore, choiceOfUi, effectiveRate, formatBytes, uiSourceOf } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useBibleStore } from '../../../stores/useBibleStore';
import { assetsAPI } from '../../../services/electronAPI';
import { isEnabled } from '../../../settings/featureFlags';
import { EngineSelect, RateSlider, SourceSegmented } from './AudioControls';
import { useSources } from './useSources';
import { AudioDownloads } from '../downloads/AudioDownloads';
import './audio.css';

interface VoiceRow { engineId: string; engine: ITtsEngine; engineLabel: string; voice: AudioVoice }
const keyOf = (engineId: string, voiceId: string) => `${engineId}:${voiceId}`;

/** Bytes the asset store holds for speech runtimes and voices, and their ids. */
async function ttsAssets(): Promise<{ bytes: number; ids: string[] }> {
  const snap = await assetsAPI.list();
  const tts = snap.entries.filter((e) => e.kind.startsWith('tts-'));
  return { bytes: tts.reduce((sum, e) => sum + e.storedBytes, 0), ids: tts.filter((e) => e.storedBytes > 0 || e.status !== 'available').map((e) => e.id) };
}

export const AudioSection: React.FC = () => {
  const { t } = useI18n();
  const prefs = useAudio((s) => s.prefs);
  const enabled = useAudio((s) => s.enabled);
  const providerId = useAudio((s) => s.providerId);
  const playingModule = useAudio((s) => s.playingModule);
  const paneModule = useBibleStore((s) => s.panels.values().next().value?.openTabs[0]?.abbreviation ?? '');
  const moduleAbbr = playingModule ?? paneModule;
  const sources = useSources(moduleAbbr);
  const language = moduleAbbr ? audioStore.languageFor(moduleAbbr) : '';
  const lang = language.toLowerCase().split(/[-_]/)[0];

  // The "While playing" toggles come from the shared settings registry.
  const audioSettings = useMemo(() => createAudioSettingsStore(audioStore), []);
  const toggleValues = useSyncExternalStore(audioSettings.subscribe, audioSettings.getSnapshot, audioSettings.getSnapshot);
  useEffect(() => audioStore.subscribe(() => { void audioSettings.reload(); }), [audioSettings]);
  const toggleFields = useMemo(
    () => AUDIO_SETTINGS.toFields('audio', { translate: (key) => t(key), isEnabled, values: toggleValues }),
    [t, toggleValues],
  );

  const [storage, setStorage] = useState<{ bytes: number; ids: string[] } | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [downloads, setDownloads] = useState<Record<string, LoadProgress>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const controllers = useRef(new Map<string, AbortController>());

  const refreshStorage = useCallback(() => { void ttsAssets().then(setStorage, () => setStorage(null)); }, []);
  useEffect(() => { refreshStorage(); }, [refreshStorage]);
  // Leaving the section cancels downloads in flight: nothing keeps running behind a closed panel.
  useEffect(() => () => { for (const c of controllers.current.values()) c.abort(); }, []);

  const rows: VoiceRow[] = [];
  for (const s of sources) {
    if (s.provider.kind !== 'tts' || !s.usable) continue;
    const engineId = s.provider.id.slice(4);
    const engine = audioStore.engines.get(engineId);
    if (engine) for (const voice of s.voices) rows.push({ engineId, engine, engineLabel: s.provider.label, voice });
  }
  const rowKeys = rows.map((r) => keyOf(r.engineId, r.voice.id)).join('|');

  // Which voices are already on the device.
  useEffect(() => {
    let live = true;
    void Promise.all(rows.map(async (r) => [keyOf(r.engineId, r.voice.id), await r.engine.isVoiceReady(r.voice.id).catch(() => false)] as const))
      .then((entries) => { if (live) setReady(Object.fromEntries(entries)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKeys]);

  if (!enabled) return null;

  const download = async (row: VoiceRow) => {
    const key = keyOf(row.engineId, row.voice.id);
    const ctrl = new AbortController();
    controllers.current.set(key, ctrl);
    setFailed((f) => ({ ...f, [key]: false }));
    setDownloads((d) => ({ ...d, [key]: { phase: 'voice', loaded: 0 } }));
    try {
      await row.engine.prepare(row.voice.id, (p) => setDownloads((d) => ({ ...d, [key]: p })), ctrl.signal);
      setReady((r) => ({ ...r, [key]: true }));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'aborted' && (e as Error)?.name !== 'AbortError') setFailed((f) => ({ ...f, [key]: true }));
    } finally {
      controllers.current.delete(key);
      setDownloads((d) => { const { [key]: _gone, ...rest } = d; return rest; });
      audioStore.invalidateSources(moduleAbbr || undefined);
      refreshStorage();
    }
  };

  const remove = async (row: VoiceRow) => {
    await row.engine.evictVoice(row.voice.id).catch(() => {});
    setReady((r) => ({ ...r, [keyOf(row.engineId, row.voice.id)]: false }));
    audioStore.invalidateSources(moduleAbbr || undefined);
    refreshStorage();
  };

  const removeAllVoices = async () => {
    const { ids } = await ttsAssets().catch(() => ({ ids: [] as string[] }));
    for (const id of ids) await assetsAPI.remove(id).catch(() => undefined);
    for (const e of audioStore.engines.values()) e.dispose();
    setReady({});
    audioStore.invalidateSources();
    refreshStorage();
  };

  const translationChoice = moduleAbbr ? prefs.perTranslation[moduleAbbr]?.source : undefined;

  // One speed range for the section: the widest any usable source offers. `effectiveRate` narrows it per source.
  const ranges = moduleAbbr
    ? sources.filter((s) => s.usable).map((s) => s.provider.capabilities(moduleAbbr).rate).filter((r): r is NonNullable<typeof r> => !!r)
    : [];
  const rate = ranges.length > 0
    ? { min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)), step: Math.min(...ranges.map((r) => r.step)) }
    : null;

  return (
    <div className="audio-settings" data-testid="audio-section">
      <div className="audio-settings__group">
        <h4 className="audio-settings__heading">{t('audio.settings.source')}</h4>
        <SourceSegmented
          sources={sources}
          value={uiSourceOf(prefs.source)}
          label={t('audio.settings.source')}
          moduleAbbr={moduleAbbr}
          language={language}
          onChange={(ui) => {
            const choice = ui === 'default' ? null : choiceOfUi(ui, sources, prefs.source, providerId);
            if (choice) audioStore.setPrefs({ source: choice });
          }}
        />
        {uiSourceOf(prefs.source) === 'generated' && (
          <label className="audio-settings__engine">
            <span>{t('audio.source.engine')}</span>
            <EngineSelect id="audio-default-engine" sources={sources} value={prefs.source} onChange={(c) => audioStore.setPrefs({ source: c })} />
          </label>
        )}
        <p className="audio-settings__hint">{t('audio.settings.sourceHint')}</p>

        {moduleAbbr && (
          <>
            <h4 className="audio-settings__heading">{t('audio.settings.thisTranslation', { module: moduleAbbr })}</h4>
            <SourceSegmented
              sources={sources}
              value={translationChoice ? uiSourceOf(translationChoice) : 'default'}
              withDefault
              label={t('audio.settings.thisTranslation', { module: moduleAbbr })}
              moduleAbbr={moduleAbbr}
              language={language}
              onChange={(ui) => {
                if (ui === 'default') { audioStore.setTranslationSource(moduleAbbr, undefined); return; }
                const choice = choiceOfUi(ui, sources, translationChoice ?? prefs.source, providerId);
                if (choice) audioStore.setTranslationSource(moduleAbbr, choice);
              }}
            />
            {translationChoice && uiSourceOf(translationChoice) === 'generated' && (
              <label className="audio-settings__engine">
                <span>{t('audio.source.engine')}</span>
                <EngineSelect id="audio-translation-engine" sources={sources} value={translationChoice} onChange={(c) => audioStore.setTranslationSource(moduleAbbr, c)} />
              </label>
            )}
          </>
        )}
      </div>

      <div className="audio-settings__group" data-testid="audio-player-style">
        <h4 className="audio-settings__heading" id="audio-style-heading">{t('audio.style.label')}</h4>
        <div className="audio-segmented" role="radiogroup" aria-labelledby="audio-style-heading">
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

      {rows.length > 0 && (
        <div className="audio-settings__group" data-testid="audio-voices">
          <h4 className="audio-settings__heading">{t('audio.settings.voices', { language: language || moduleAbbr })}</h4>
          {rows.map((row) => {
            const key = keyOf(row.engineId, row.voice.id);
            const progress = downloads[key];
            const isReady = ready[key] === true;
            const chosen = (prefs.voiceByEngineLang[`${row.engineId}:${lang}`] ?? '') === row.voice.id;
            const meta = [
              row.engineLabel,
              row.voice.quality ? t(`audio.settings.quality.${row.voice.quality}`) : null,
              row.voice.downloadBytes ? formatBytes(row.voice.downloadBytes) : null,
              isReady ? t('audio.settings.downloaded') : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={key} className={`audio-settings__voice${chosen ? ' audio-settings__voice--selected' : ''}`} data-testid="audio-voice-row">
                <div className="audio-settings__voice-main">
                  <span className="audio-settings__voice-name">{row.voice.label}</span>
                  <span className="audio-settings__voice-meta">{meta}</span>
                  {progress && (
                    <progress className="audio-settings__progress" max={progress.total ?? undefined} value={progress.total ? progress.loaded : undefined} aria-label={t('audio.status.downloadingVoice')} />
                  )}
                  {failed[key] && <span className="audio-settings__voice-meta" role="alert">{t('audio.settings.downloadFailed')}</span>}
                </div>
                {!progress && isReady && !chosen && (
                  <button type="button" className="audio-settings__btn" onClick={() => audioStore.setEngineVoice(row.engineId, language, row.voice.id)}>{t('audio.settings.useVoice')}</button>
                )}
                {!progress && isReady && (
                  <button type="button" className="audio-settings__btn" onClick={() => { void remove(row); }}>{t('audio.settings.remove')}</button>
                )}
                {!progress && !isReady && (
                  <button type="button" className="audio-settings__btn" onClick={() => { void download(row); }}>{t('audio.settings.download')}</button>
                )}
                {progress && (
                  <button type="button" className="audio-settings__btn" onClick={() => controllers.current.get(key)?.abort()}>{t('audio.action.cancel')}</button>
                )}
              </div>
            );
          })}
          <p className="audio-settings__hint">{t('audio.settings.voicesHint')}</p>
        </div>
      )}

      {rate && (
        <div className="audio-settings__group">
          <h4 className="audio-settings__heading">{t('audio.speed.label')}</h4>
          <RateSlider range={rate} value={effectiveRate(prefs.rate, { rate })} label={t('audio.speed.label')} onChange={(r) => audioStore.setPrefs({ rate: r })} />
          <p className="audio-settings__hint">{t('audio.settings.speedHint')}</p>
        </div>
      )}

      <div className="audio-settings__group">
        <h4 className="audio-settings__heading">{t('audio.settings.whilePlaying')}</h4>
        <SettingsForm fields={toggleFields} values={toggleValues} idPrefix="audio-pref" onChange={(key, value) => { audioSettings.set(key, value); }} />
      </div>

      <div className="audio-settings__group" data-testid="audio-storage">
        <h4 className="audio-settings__heading">{t('audio.settings.storage')}</h4>
        <div className="audio-settings__storage">
          <span data-testid="audio-storage-voices">{t('audio.settings.storageVoices', { size: formatBytes(storage?.bytes ?? 0) })}</span>
          <button type="button" className="audio-settings__btn" disabled={!storage?.bytes} onClick={() => { void removeAllVoices(); }}>
            {t('audio.settings.removeVoices')}
          </button>
        </div>
      </div>

      <div className="audio-settings__group" data-testid="audio-downloads-slot">
        <h4 className="audio-settings__heading">{t('audio.downloads.heading')}</h4>
        <AudioDownloads />
      </div>
    </div>
  );
};

export default AudioSection;
