/**
 * Piper (VITS voices through ONNX Runtime and an espeak-ng phonemizer) as an
 * `ITtsEngine`. Everything engine-independent lives in `WorkerTtsEngine`; this
 * class only says where the worker is, what the two payloads contain, and how a
 * voice's files are stored (the shared models cache, keyed by URL).
 */

import type { TtsEngineConfig } from '@bible/core/browser';
import type { IAssetCache } from '@bible/core/browser';
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
}

export class PiperEngine extends WorkerTtsEngine {
  readonly id = piperFactory.id;
  readonly label = piperFactory.label;
  readonly capabilities = { ...piperFactory.capabilities, languages: PIPER_LANGUAGES, approxRuntimeBytes: PIPER_RUNTIME_BYTES };

  private readonly cache: IAssetCache;
  private readonly workerFactory: () => WorkerLike;
  private readonly assetBase: string;

  constructor(config: TtsEngineConfig, opts: PiperEngineOptions = {}) {
    super(config, opts);
    this.cache = opts.cache ?? createAssetCache(AUDIO_CACHE_NAMES.models);
    this.assetBase = absoluteUrl(config.assetBase);
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

  protected async isVoiceCached(voiceId: string): Promise<boolean> {
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

  protected async deleteCachedVoice(voiceId: string): Promise<void> {
    // The runtime is shared by every voice and stays.
    for (const url of this.voiceUrls(voiceId)) await this.cache.delete(url);
  }
}
