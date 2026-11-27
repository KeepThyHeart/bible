/**
 * Pack installers for the web app (task 0075): modules go through the module asset manager, every
 * other pack item through the main asset manager. Both install pinned (an explicit user action).
 * Abort rejects with the asset manager's own `aborted` AssetError, which PackRun understands.
 *
 * Licence: GPL-3.0-or-later.
 */

import type { IAssetManager, IPackInstaller } from '@bible/core/browser';
import { getAssetManager } from '../assets/webAssets';
import { installModuleAsset } from './moduleAssets';

export interface WebPackInstallerDeps {
  installModule?: typeof installModuleAsset;
  assetManager?: () => IAssetManager;
  /**
   * Cache the pronunciation overlay for an installed speech voice (its language, plus the Bible
   * modules in it), so generated speech sounds the same offline. Default: `prefetchPronunciationForVoice`.
   * Never throws; a failure here must not fail the voice's install.
   */
  prefetchPronunciation?: (voiceId: string, signal: AbortSignal) => Promise<void>;
  /**
   * The same overlay for a Bible module that has just installed: for each installed Piper voice in
   * its language (the pack may install the voice first). Default: `prefetchPronunciationForModule`.
   * `voiceIds` are the installed voices found through the asset manager. Never throws.
   */
  prefetchPronunciationForModule?: (moduleAbbr: string, installedVoiceIds: string[], signal: AbortSignal) => Promise<void>;
}

/**
 * After a Bible module installs: cache the overlay when an installed Piper voice speaks its
 * language, so the result does not depend on whether the voice or the module came first.
 */
export async function prefetchPronunciationForModule(moduleAbbr: string, installedVoiceIds: string[], signal: AbortSignal): Promise<void> {
  try {
    if (installedVoiceIds.length === 0) return;
    const [{ getAudioConfig }, { moduleStore }] = await Promise.all([
      import('../modules/audio/lib/config'),
      import('../stores/moduleStore'),
    ]);
    const config = getAudioConfig();
    const lang = (tag?: string) => tag?.toLowerCase().split(/[-_]/)[0];
    const moduleLang = lang(moduleStore.getBibleModules().find((m) => m.abbreviation === moduleAbbr)?.language_code);
    const voices = config?.engines.find((e) => e.id === 'piper')?.voices ?? [];
    const voice = voices.find((v) => installedVoiceIds.includes(v.id) && moduleLang !== undefined && lang(v.language) === moduleLang);
    if (voice) await prefetchPronunciationForVoice(voice.id, signal);
  } catch { /* the overlay is an extra */ }
}

/**
 * Fetch the overlay files for a `tts-voice` through the same `PronunciationStore` (same base,
 * same models cache) the audio system reads, which keeps them. A 404 means "no overlay".
 */
export async function prefetchPronunciationForVoice(voiceId: string, signal: AbortSignal): Promise<void> {
  try {
    const { getAudioConfig } = await import('../modules/audio/lib/config');
    const config = getAudioConfig();
    const voice = config?.engines.find((e) => e.id === 'piper')?.voices.find((v) => v.id === voiceId);
    if (!config || !voice) return;
    const [{ PronunciationStore, createAssetCache, AUDIO_CACHE_NAMES, resolveBase }, { pronunciationLocale }, { moduleStore }, { offlineStore }] = await Promise.all([
      import('@bible/audio'),
      import('@bible/core/browser'),
      import('../stores/moduleStore'),
      import('../stores/offlineStore'),
    ]);
    const locale = pronunciationLocale(voice.language);
    const language = locale.split('-')[0];
    const base = resolveBase(config.base, import.meta.env.BASE_URL);
    const store = new PronunciationStore({ base: `${base.replace(/\/+$/, '')}/pronunciation`, cache: createAssetCache(AUDIO_CACHE_NAMES.models) });
    const langOf = (abbr: string) => moduleStore.getBibleModules().find((m) => m.abbreviation === abbr)?.language_code?.toLowerCase().split(/[-_]/)[0];
    const modules = offlineStore.downloadedModules
      .filter((m) => m.type === 'bible' && langOf(m.abbreviation) === language)
      .map((m) => m.abbreviation);
    // The lexicon is per locale; with no module of this language yet, one request still caches it.
    for (const abbr of modules.length > 0 ? modules : ['_']) {
      if (signal.aborted) return;
      await store.overlay(abbr, locale);
    }
  } catch { /* the overlay is an extra; the voice is installed */ }
}

export function createWebPackInstallers(deps: WebPackInstallerDeps = {}): { module: IPackInstaller; asset: IPackInstaller } {
  const installModule = deps.installModule ?? installModuleAsset;
  const assetManager = deps.assetManager ?? getAssetManager;
  const prefetch = deps.prefetchPronunciation ?? prefetchPronunciationForVoice;
  const prefetchForModule = deps.prefetchPronunciationForModule ?? prefetchPronunciationForModule;
  return {
    module: {
      async install(step, ctx) {
        await installModule(step.offer.ref.id, {
          pinned: true,
          signal: ctx.signal,
          onProgress: (loaded, total) => ctx.onBytes(loaded, total),
        });
        // The voice may have installed before this module: its overlay is fetched now.
        const voices = assetManager()?.getSnapshot?.().entries
          .filter((e) => e.kind === 'tts-voice' && e.status === 'installed').map((e) => e.id) ?? [];
        if (voices.length > 0) await prefetchForModule(step.offer.ref.id, voices, ctx.signal).catch(() => {});
      },
    },
    asset: {
      async install(step, ctx) {
        await assetManager().install(step.offer.ref.id, {
          pinned: true,
          signal: ctx.signal,
          onProgress: (p) => ctx.onBytes(p.loaded, p.total),
        });
        // A voice pack carries the pronunciation overlay for its language and modules.
        const am = assetManager();
        const isVoice = am.getSnapshot?.().entries.some((e) => e.id === step.offer.ref.id && e.kind === 'tts-voice');
        if (isVoice) await prefetch(step.offer.ref.id, ctx.signal).catch(() => {});
      },
    },
  };
}
