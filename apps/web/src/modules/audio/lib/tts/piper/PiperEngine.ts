/**
 * Piper (VITS voices through ONNX Runtime and an espeak-ng phonemizer) as an
 * `ITtsEngine`. Everything engine-independent lives in `WorkerTtsEngine`; this
 * class only says where the worker is, what the two payloads contain, and how a
 * voice's files are stored (the shared models cache, keyed by URL).
 */

import type { AssetManifest, IAssetManager, LoadProgress, TtsEngineConfig } from '@bible/core/browser';
import type { IAssetCache } from '@bible/core/browser';
import { FetchTransport } from '../../../../../assets/FetchTransport';
import { PIPER_RUNTIME_ID, loadPiperManifests } from './piperAssets';
import { getReadyAssetManager } from '../../../../../assets/webAssets';
import { AUDIO_CACHE_NAMES, createAssetCache } from '../../AssetCache';
import { WorkerTtsEngine, type WorkerLike, type WorkerTtsEngineOptions } from '../WorkerTtsEngine';
import { PIPER_LANGUAGES, PIPER_RUNTIME_BYTES, PIPER_RUNTIME_FILES, absoluteUrl, joinUrl } from './piperConfig';
import { piperFactory } from './piperFactory';
import type { PiperInitPayload, PiperPreparePayload } from './piperHandlers';

export interface PiperEngineOptions extends WorkerTtsEngineOptions {
  /** Test seam: the worker to talk to. */
  createWorker?: () => WorkerLike;
  /** Test seam: where voices are stored. */
  cache?: IAssetCache;
  /** Test seam: the asset manager that downloads the runtime and voices (default: the shared web one). */
  assets?: IAssetManager;
  /** Test seam: the manifests of the runtime and voices (default: `index.json`, else synthesised from the config). */
  loadManifests?: () => Promise<AssetManifest[]>;
}

export class PiperEngine extends WorkerTtsEngine {
  readonly id = piperFactory.id;
  readonly label = piperFactory.label;
  readonly capabilities = { ...piperFactory.capabilities, languages: PIPER_LANGUAGES, approxRuntimeBytes: PIPER_RUNTIME_BYTES };

  private readonly cache: IAssetCache;
  private readonly workerFactory: () => WorkerLike;
  private readonly assetBase: string;
  private readonly assetsOverride: IAssetManager | undefined;
  private readonly loadManifests: () => Promise<AssetManifest[]>;
  private manifests: Promise<AssetManifest[]> | null = null;

  constructor(config: TtsEngineConfig, opts: PiperEngineOptions = {}) {
    super(config, opts);
    this.cache = opts.cache ?? createAssetCache(AUDIO_CACHE_NAMES.models);
    this.assetBase = absoluteUrl(config.assetBase);
    this.assetsOverride = opts.assets;
    this.loadManifests = opts.loadManifests
      ?? (() => { const t = new FetchTransport(); return loadPiperManifests(config, (u, sig) => t.getText(u, sig)); });
    this.workerFactory = opts.createWorker
      ?? (() => new Worker(new URL('./piperWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  }

  protected createWorker(): WorkerLike {
    return this.workerFactory();
  }

  protected initPayload(): PiperInitPayload {
    return { assetBase: this.assetBase };
  }

  private voiceUrls(voiceId: string): string[] {
    const files = this.config.voices.find(v => v.id === voiceId)?.files ?? [];
    return files.map(f => joinUrl(this.assetBase, f));
  }

  protected override preparePayload(voiceId: string): PiperPreparePayload {
    return { files: this.voiceUrls(voiceId) };
  }

  private assets(): Promise<IAssetManager> {
    return this.assetsOverride ? Promise.resolve(this.assetsOverride) : getReadyAssetManager();
  }

  private manifestOf(id: string): Promise<AssetManifest | undefined> {
    this.manifests ??= this.loadManifests().catch(() => { this.manifests = null; return []; });
    return this.manifests.then(list => list.find(m => m.id === id));
  }

  /** The runtime, then the voice, through the asset manager (verified, resumable); the worker then only reads the cache. */
  override async prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    const assets = await this.assets();
    const phaseOf = (phase: 'engine' | 'voice') => (p: { loaded: number; total: number }) =>
      onProgress({ phase, loaded: p.loaded, total: p.total > 0 ? p.total : undefined });
    const runtime = await this.manifestOf(PIPER_RUNTIME_ID);
    await assets.install(runtime ?? PIPER_RUNTIME_ID, { signal, pinned: true, onProgress: phaseOf('engine') });
    const voice = await this.manifestOf(voiceId);
    await assets.install(voice ?? voiceId, { signal, pinned: true, onProgress: phaseOf('voice') });
    await this.loadVoiceIntoWorker(voiceId, onProgress, signal);
  }

  private async legacyCached(voiceId: string): Promise<boolean> {
    const urls = this.voiceUrls(voiceId);
    if (urls.length === 0) return false;
    // "Ready" means it can be spoken without a download, so the runtime counts too.
    const runtime = [PIPER_RUNTIME_FILES.ortWasm, PIPER_RUNTIME_FILES.phonemizerWasm, PIPER_RUNTIME_FILES.phonemizerData]
      .map(f => joinUrl(this.assetBase, f));
    for (const url of [...urls, ...runtime]) {
      if (!(await this.cache.has(url))) return false;
    }
    return true;
  }

  protected async isVoiceCached(voiceId: string): Promise<boolean> {
    const assets = await this.assets();
    if (assets.installed(PIPER_RUNTIME_ID) && assets.installed(voiceId)) return true;
    // Downloaded before the asset manager existed: register the files that are already there.
    if (!(await this.legacyCached(voiceId))) return false;
    const [runtime, voice] = await Promise.all([this.manifestOf(PIPER_RUNTIME_ID), this.manifestOf(voiceId)]);
    if (!runtime || !voice) return false;
    if (!assets.installed(PIPER_RUNTIME_ID) && !(await assets.adopt(runtime))) return false;
    return assets.installed(voiceId) ? true : assets.adopt(voice);
  }

  protected async deleteCachedVoice(voiceId: string): Promise<void> {
    // The runtime is shared by every voice and stays.
    await (await this.assets()).remove(voiceId);
    for (const url of this.voiceUrls(voiceId)) await this.cache.delete(url);
  }
}
