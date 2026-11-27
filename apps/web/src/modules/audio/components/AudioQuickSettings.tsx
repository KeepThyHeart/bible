/**
 * All of the audio settings, in the player's gear (desktop popover, phone bottom sheet). There is
 * no separate Audio page in Preferences: this is the one place.
 *
 * - Voice: one list, recordings first (recommended), then each speech engine ("Generated · Piper").
 *   The choice is the reader's default for every translation; one without that source falls back
 *   on its own (the resolver's order). An unusable entry is disabled and says why underneath.
 * - Under a generated choice only: that engine's voice, its size and whether it is on the device
 *   (with Remove), and the engine select when there are two or more.
 * - The "while playing" switches (from the shared settings registry), the player style on desktop,
 *   offline downloads, and clearing cached recordings when there are any.
 *
 * Speed, Repeat and Continue are on the player itself. Built from what the providers report, so a
 * new engine or narrator appears here with no change.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { SettingsForm } from '@bible/ui';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { AUDIO_SETTINGS, audioStorageUsage, clearChapters, createAudioSettingsStore, formatBytes, openAudioCaches, unusableText } from '@bible/audio';
import type { AudioStorageUsage } from '@bible/audio';
import { useSourcesState } from './useSources';
import { AudioOfflineChoices } from './AudioOfflineChoices';
import { offlineAudio } from '../lib/offlineAudio';
import { downloadsDialog, getAudioDownloadsHandle } from '../lib/downloads';
import { getReadyAssetManager } from '../../../assets/webAssets';
import { isEnabled } from '../../../utils/featureFlags';

export interface AudioQuickSettingsProps {
  moduleAbbr: string;
  variant: 'desktop' | 'phone';
}

/** "Continue to the next chapter" is a toggle on the player, so it is not repeated here. */
const ON_PLAYER = new Set(['continueToNextChapter']);

export function AudioQuickSettings({ moduleAbbr, variant }: AudioQuickSettingsProps) {
  const { t } = useTranslation();
  const tt = (k: string, o?: Record<string, string>) => t(k, o);
  const prefs = useStore(audioStore, () => audioStore.prefs);
  const providerId = useStore(audioStore, () => audioStore.providerId);
  const playingVoice = useStore(audioStore, () => audioStore.voiceId);
  const { list: sources, loaded } = useSourcesState(moduleAbbr);
  const language = audioStore.languageFor(moduleAbbr);
  const lang = language.toLowerCase().split(/[-_]/)[0];

  const audioSettings = useMemo(() => createAudioSettingsStore(audioStore), []);
  // A plain subscription, not preact/compat's useSyncExternalStore: compat changes how selects report changes.
  const [toggleValues, setToggleValues] = useState(() => audioSettings.getSnapshot());
  useEffect(() => audioSettings.subscribe(() => setToggleValues(audioSettings.getSnapshot())), [audioSettings]);
  useEffect(() => audioStore.subscribe(() => { void audioSettings.reload(); }), [audioSettings]);
  const toggleFields = AUDIO_SETTINGS.toFields('audio', { translate: (key, fallback) => t(key, fallback), isEnabled, values: toggleValues })
    .filter(f => !ON_PLAYER.has(f.key));

  const [usage, setUsage] = useState<AudioStorageUsage | null>(null);
  const refreshUsage = useCallback(() => {
    void getReadyAssetManager().then(a => audioStorageUsage(openAudioCaches(), a)).then(setUsage, () => setUsage(null));
  }, []);
  useEffect(() => { refreshUsage(); }, []);

  // Recordings first, then the engines.
  const ordered = [...sources].sort((a, b) => (a.provider.kind === 'recorded' ? 0 : 1) - (b.provider.kind === 'recorded' ? 0 : 1));
  const chosen = prefs.perTranslation[moduleAbbr]?.source ?? prefs.source;
  // "auto" (the default) shows what it plays: the source playing, else the first usable one.
  const selected = chosen !== 'auto' ? chosen : (providerId ?? ordered.find(s => s.usable)?.provider.id ?? '');
  const selectedStatus = ordered.find(s => s.provider.id === selected);

  const labelOf = (id: string, kind: string, label: string) =>
    kind === 'recorded' ? t('audio.source.recordingOption') : t('audio.source.generatedOption', { engine: label || id.slice(4) });

  const pick = (id: string) => {
    // One choice for every translation: drop this translation's own override, if it had one.
    if (prefs.perTranslation[moduleAbbr]?.source) audioStore.setTranslationSource(moduleAbbr, undefined);
    audioStore.setPrefs({ source: id as typeof prefs.source });
  };

  // The voice of the generated choice.
  const engine = selectedStatus?.provider.kind === 'tts' && selectedStatus.usable ? selected.slice(4) : null;
  const voices = engine ? selectedStatus!.voices : [];
  const voiceId = engine
    ? (prefs.perTranslation[moduleAbbr]?.voiceId ?? prefs.voiceByEngineLang[`${engine}:${lang}`] ?? playingVoice ?? voices[0]?.id ?? '')
    : '';
  const voice = voices.find(v => v.id === voiceId);
  const ttsEngine = engine ? audioStore.engines.get(engine) : undefined;
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setVoiceReady(null);
    if (ttsEngine && voiceId) void ttsEngine.isVoiceReady(voiceId).then(r => { if (live) setVoiceReady(r); }, () => { if (live) setVoiceReady(false); });
    return () => { live = false; };
  }, [ttsEngine, voiceId]);

  const removeVoice = async () => {
    if (!ttsEngine || !voiceId) return;
    await ttsEngine.evictVoice(voiceId).catch(() => {});
    setVoiceReady(false);
    audioStore.invalidateSources(moduleAbbr);
    refreshUsage();
  };

  const unusable = ordered.filter(s => !s.usable);
  const saved = useStore(offlineAudio, () => offlineAudio.byModule);
  // The downloads dialog saves recordings: offer it only where one can play, or to manage what is saved.
  const canDownload = !!getAudioDownloadsHandle()
    && (ordered.some(s => s.provider.kind === 'recorded' && s.usable) || Object.keys(saved).length > 0);

  // Until the sources are known, a placeholder: the panel then appears whole, not growing under the pointer.
  if (!loaded) {
    return (
      <div class={`audio-panel audio-quick audio-quick--${variant}`} data-testid="audio-quick-settings">
        <p class="audio-note" role="status" data-testid="audio-quick-loading">{t('audio.status.gettingReady')}</p>
      </div>
    );
  }

  return (
    <div class={`audio-panel audio-quick audio-quick--${variant}`} data-testid="audio-quick-settings">
      <div class="audio-panel__row">
        <label class="audio-panel__label" for="audio-quick-source">{t('audio.voice.label')}</label>
        <select
          id="audio-quick-source"
          class="audio-select"
          value={selected}
          data-testid="audio-quick-source"
          onChange={e => pick((e.target as HTMLSelectElement).value)}
        >
          {ordered.map(s => (
            <option key={s.provider.id} value={s.provider.id} disabled={!s.usable}>
              {labelOf(s.provider.id, s.provider.kind, s.provider.label)}
            </option>
          ))}
        </select>
        {unusable.length > 0 && (
          <p class="audio-note" data-testid="audio-source-reasons">
            {unusable.map(s => <span key={s.provider.id} class="audio-source__reason">{unusableText(s, moduleAbbr, language, tt)}</span>)}
          </p>
        )}
      </div>

      {engine && voices.length > 0 && (
        <div class="audio-quick__sub">
          {voices.length >= 2 && (
            <div class="audio-panel__row">
              <label class="audio-panel__label" for="audio-quick-voice">{t('audio.voice.which')}</label>
              <select
                id="audio-quick-voice"
                class="audio-select"
                value={voiceId}
                onChange={e => audioStore.setEngineVoice(engine, language, (e.target as HTMLSelectElement).value)}
              >
                {voices.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
          )}
          {voice && (
            <div class="audio-quick__voice" data-testid="audio-quick-voice-state">
              <span class="audio-note">
                {[
                  voices.length < 2 ? voice.label : null,
                  voice.downloadBytes ? formatBytes(voice.downloadBytes) : null,
                  voiceReady === true ? t('audio.settings.onDevice') : voiceReady === false ? t('audio.settings.downloadsOnPlay') : null,
                ].filter(Boolean).join(' · ')}
              </span>
              {voiceReady && (
                <button type="button" class="audio-panel__more" onClick={() => { void removeVoice(); }}>{t('audio.settings.remove')}</button>
              )}
            </div>
          )}
        </div>
      )}

      <SettingsForm
        fields={toggleFields}
        values={toggleValues}
        idPrefix={`audio-quick-${variant}`}
        onChange={(key, value) => { audioSettings.set(key, value); }}
      />

      <AudioOfflineChoices variant="settings" />

      {canDownload && (
        <button type="button" class="audio-panel__more" data-testid="audio-quick-downloads" onClick={() => downloadsDialog.open(moduleAbbr)}>
          {t('audio.downloads.open')} <i class="fa-solid fa-cloud-arrow-down" aria-hidden="true" />
        </button>
      )}

      {!!usage?.chapterBytes && (
        <div class="audio-quick__voice">
          <span class="audio-note">{t('audio.settings.storageChapters', { size: formatBytes(usage.chapterBytes), count: usage.chapterCount })}</span>
          <button type="button" class="audio-panel__more" onClick={() => { void clearChapters(openAudioCaches()).then(refreshUsage); }}>{t('audio.settings.clear')}</button>
        </div>
      )}
    </div>
  );
}
