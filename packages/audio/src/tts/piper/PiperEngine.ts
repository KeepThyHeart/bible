/**
 * Piper (VITS voices through ONNX Runtime and an espeak-ng phonemizer) as an
 * `ITtsEngine`. Everything engine-independent lives in `WorkerTtsEngine`; this
 * class only says where the worker is, what the two payloads contain, and how a
 * voice's files are installed (an asset manager the app supplies: web, the shared
 * browser one; desktop, the main-process one over IPC).
 */

import type { AssetManifest, InstallOptions, LoadProgress, TtsEngineConfig } from '@bible/core/browser';
import type { IAssetCache } from '@bible/core/browser';
import { PIPER_RUNTIME_ID, loadPiperManifests, type TextFetcher } from './piperAssets';
import { AUDIO_CACHE_NAMES, createAssetCache } from '../../AssetCache';
import { WorkerTtsEngine, type WorkerLike, type WorkerTtsEngineOptions } from '../WorkerTtsEngine';
import { PIPER_LANGUAGES, PIPER_RUNTIME_BYTES, PIPER_RUNTIME_FILES, absoluteUrl, joinUrl } from './piperConfig';
import { piperFactory } from './piperFactory';
import type { PiperInitPayload, PiperPreparePayload, PiperStorage } from './piperHandlers';

/**
 * The part of an asset manager Piper uses (`IAssetManager` satisfies it). `installed` may
 * answer asynchronously (an app whose manager lives in another process).
 */
export interface PiperAssetPort {
  /** Truthy when the asset is installed. */
  installed(id: string): unknown;
  install(target: AssetManifest | string, opts: InstallOptions): Promise<unknown>;
  /** Register files already present from before the manager existed; false when there is nothing to adopt. */
  adopt(manifest: AssetManifest): Promise<boolean>;
  remove(id: string): Promise<void>;
}

export interface PiperEngineOptions extends WorkerTtsEngineOptions {
  /** The asset manager that downloads the runtime and voices, or a getter for it (it may need to start first). */
  assets: PiperAssetPort | (() => Promise<PiperAssetPort>);
  /** Bytes of the runtime download (with anything installed alongside it), for the download gate. Default: its manifest, else an estimate. */
  runtimeBytes?: () => number | undefined;
  /** GET a text file (`<assetBase>/index.json`), null on 404. Default: `fetch`. */
  fetchText?: TextFetcher;
  /** How the worker reads the installed files (see `PiperStorage`). Default 'cache'. */
  storage?: PiperStorage;
  /** Test seam: the worker to talk to. */
  createWorker?: () => WorkerLike;
  /** Where files downloaded before the asset manager existed are looked for (default: the models cache). */
  cache?: IAssetCache;
  /** Test seam: the manifests of the runtime and voices (default: `index.json`, else synthesised from the config). */
  loadManifests?: () => Promise<AssetManifest[]>;
}

/** GET as text with `fetch`: null on 404, throws on other failures. */
export const fetchText: TextFetcher = async (url, signal) => {
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.text();
};

export class PiperEngine extends WorkerTtsEngine {
  readonly id = piperFactory.id;
  readonly label = piperFactory.label;
  readonly capabilities = { ...piperFactory.capabilities, languages: PIPER_LANGUAGES, approxRuntimeBytes: PIPER_RUNTIME_BYTES };

  private readonly cache: IAssetCache;
  private readonly workerFactory: () => WorkerLike;
  private readonly assetBase: string;
  private readonly assetsOpt: PiperEngineOptions['assets'];
  private readonly storage: PiperStorage;
  private readonly loadManifests: () => Promise<AssetManifest[]>;
  private manifests: Promise<AssetManifest[]> | null = null;
  private readonly runtimeBytesOpt: PiperEngineOptions['runtimeBytes'];

  constructor(config: TtsEngineConfig, opts: PiperEngineOptions) {
    super(config, opts);
    this.cache = opts.cache ?? createAssetCache(AUDIO_CACHE_NAMES.models);
    this.assetBase = absoluteUrl(config.assetBase);
    this.assetsOpt = opts.assets;
    this.storage = opts.storage ?? 'cache';
    this.runtimeBytesOpt = opts.runtimeBytes;
    const getText = opts.fetchText ?? fetchText;
    this.loadManifests = opts.loadManifests ?? (() => loadPiperManifests(config, getText));
    this.workerFactory = opts.createWorker
      ?? (() => new Worker(new URL('./piperWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  }

  protected createWorker(): WorkerLike {
    return this.workerFactory();
  }

  protected initPayload(): PiperInitPayload {
    return { assetBase: this.assetBase, storage: this.storage };
  }

  private voiceUrls(voiceId: string): string[] {
    const files = this.config.voices.find(v => v.id === voiceId)?.files ?? [];
    return files.map(f => joinUrl(this.assetBase, f));
  }

  protected override preparePayload(voiceId: string): PiperPreparePayload {
    return { files: this.voiceUrls(voiceId) };
  }

  private assets(): Promise<PiperAssetPort> {
    const a = this.assetsOpt;
    return typeof a === 'function' ? a() : Promise.resolve(a);
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

  /** The voice's size plus the shared runtime's while that is not installed yet. */
  async pendingBytes(voiceId: string): Promise<number | undefined> {
    if (await this.isVoiceReady(voiceId)) return 0;
    const assets = await this.assets();
    const voice = this.config.voices.find(v => v.id === voiceId);
    const voiceBytes = (await assets.installed(voiceId)) ? 0 : voice?.downloadBytes ?? 0;
    const runtimeBytes = (await assets.installed(PIPER_RUNTIME_ID)) ? 0 : (this.runtimeBytesOpt?.() || undefined) ?? (await this.manifestOf(PIPER_RUNTIME_ID).catch(() => undefined))?.size ?? PIPER_RUNTIME_BYTES;
    return voiceBytes + runtimeBytes;
  }

  protected async isVoiceCached(voiceId: string): Promise<boolean> {
    const assets = await this.assets();
    if (await assets.installed(PIPER_RUNTIME_ID) && await assets.installed(voiceId)) return true;
    // Downloaded before the asset manager existed: register the files that are already there.
    if (!(await this.legacyCached(voiceId))) return false;
    const [runtime, voice] = await Promise.all([this.manifestOf(PIPER_RUNTIME_ID), this.manifestOf(voiceId)]);
    if (!runtime || !voice) return false;
    if (!(await assets.installed(PIPER_RUNTIME_ID)) && !(await assets.adopt(runtime))) return false;
    return (await assets.installed(voiceId)) ? true : assets.adopt(voice);
  }

  protected async deleteCachedVoice(voiceId: string): Promise<void> {
    // The runtime is shared by every voice and stays.
    await (await this.assets()).remove(voiceId);
    for (const url of this.voiceUrls(voiceId)) await this.cache.delete(url);
  }
}
