/**
 * Server-side engines. Each is an `ITtsEngine` (core's interface, the one the browser engines
 * implement) plus a definition the CLI uses to pick, describe and credit it.
 * A third engine is one `EngineDefinition` in `registry.ts` plus its adapter.
 */

import type { AudioCredit, AudioVoice, ITtsEngine } from '../core';

export type Quantization = 'q8' | 'fp32';

export interface EngineContext {
  /** Models and voices are downloaded here, never into git. */
  cacheDir: string;
  /** ONNX Runtime intra-op threads for this engine instance. */
  threads: number;
  quantization: Quantization;
  log(message: string): void;
}

export interface EngineCredits { engine: AudioCredit; model: AudioCredit; voice: AudioCredit }

export interface EngineDefinition {
  id: string;
  label: string;
  /** BCP-47 language subtags the engine speaks. */
  languages: string[];
  /** Voices the tool knows by name; an engine may accept others (Piper takes any voice id). */
  voices: AudioVoice[];
  /** The voice to use when `--voice` is not given, per language subtag. */
  defaultVoice(language: string): string | undefined;
  /** An error message, or undefined when the voice id is acceptable. */
  checkVoice(voiceId: string): string | undefined;
  /** Short model description, part of the build record (a change re-renders). */
  modelLabel(ctx: Pick<EngineContext, 'quantization'>): string;
  /** Resident memory of one job, MB, for the `--jobs` advice and the dry run. */
  memoryMbPerJob(ctx: Pick<EngineContext, 'quantization'>): number;
  /** Licence record for the index. May read a cached model card. */
  credits(voiceId: string, ctx: EngineContext): Promise<EngineCredits>;
  /** Download model files in the main thread before workers start (so they do not race). */
  prefetch?(voiceId: string, ctx: EngineContext): Promise<void>;
  /** Typical render time / audio time for one job on a 6-core CPU, for the dry-run estimate. */
  nominalRtf(ctx: Pick<EngineContext, 'quantization'>): number;
  create(ctx: EngineContext): ITtsEngine;
}
