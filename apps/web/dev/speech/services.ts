/**
 * The harness's own wiring of the speech service.
 *
 * It mirrors `createSpeechService` but puts a switch in front of the microphone, so a WAV clip can
 * stand in for the mic (and the live audio can be recorded for fixtures) without a second engine.
 */

import type { IMicrophone, MicStream } from '@bible/core/speech';
import {
  EnergyVad, PcmListener, SpeechService, WebMicrophone, WebSpeechSpeaker, WhisperEngine,
  assetIdFor, chooseModel, createSpeechPrefs, detectEnv, whisperManifests,
} from '@bible/speech';
import type { SpeechPrefsStore, WhisperModelId } from '@bible/speech';

type SpeechEnv = Awaited<ReturnType<typeof detectEnv>>;
import { getReadyAssetManager, registerCatalogSource } from '../../src/assets/webAssets';
import { brandedModelBase, webModelFiles, webOrtBase } from '../../src/speech/webSpeech';
import type { FakeMic } from './fakeMic';

const MAX_RECORD_FRAMES = 50 * 120; // 120 s

/** Routes `open` to the real mic or the fake one; reports levels and keeps a recording of what it passed on. */
export class SwitchMic implements IMicrophone {
  fake: FakeMic | null = null;
  useFake = false;
  private levelCbs = new Set<(db: number) => void>();
  private recorded: Float32Array[] = [];
  private openCount = 0;

  constructor(private readonly real: IMicrophone) {}

  get active(): boolean {
    return this.openCount > 0;
  }

  onLevel(cb: (dbfs: number) => void): () => void {
    this.levelCbs.add(cb);
    return () => this.levelCbs.delete(cb);
  }

  /** Start a fresh recording of what flows through the mic. */
  resetRecording(): void {
    this.recorded = [];
  }

  /** The recorded audio (16 kHz mono) since the last reset. */
  recording(): Float32Array {
    const out = new Float32Array(this.recorded.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of this.recorded) {
      out.set(f, at);
      at += f.length;
    }
    return out;
  }

  async open(o: { echoCancellation: boolean; noiseSuppression: boolean }, signal: AbortSignal): Promise<MicStream> {
    const source = this.useFake && this.fake ? this.fake : this.real;
    const inner = await source.open(o, signal);
    this.openCount++;
    let unsub: (() => void) | undefined;
    let closed = false;
    return {
      onFrame: (cb) => {
        unsub?.();
        unsub = inner.onFrame((f) => {
          let sum = 0;
          for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
          const db = 20 * Math.log10(Math.sqrt(sum / f.length) || 1e-9);
          this.levelCbs.forEach((l) => l(db));
          if (this.recorded.length < MAX_RECORD_FRAMES) this.recorded.push(f.slice());
          cb(f);
        });
        return () => unsub?.();
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.openCount--;
        unsub?.();
        inner.close();
        this.levelCbs.forEach((l) => l(-100));
      },
    };
  }
}

export interface HarnessServices {
  service: SpeechService;
  engine: WhisperEngine;
  mic: SwitchMic;
  prefs: SpeechPrefsStore;
  env(): Promise<SpeechEnv>;
  /** Model and device the current prefs call for. */
  choice(): Promise<{ model: WhisperModelId; device: string }>;
}

export async function buildServices(): Promise<HarnessServices> {
  const modelBase = brandedModelBase();
  const manifests = whisperManifests(modelBase || undefined);
  registerCatalogSource(async () => manifests);
  const files = webModelFiles(await getReadyAssetManager(), manifests);
  const prefs = createSpeechPrefs();
  let envP: Promise<SpeechEnv> | undefined;
  const env = (): Promise<SpeechEnv> => (envP ??= detectEnv());
  const choice = async () => chooseModel(prefs.get(), await env());
  let current: string = 'base';
  const choose = async (): Promise<string> => (current = (await choice()).model);

  const engine = new WhisperEngine({ files, ortBase: webOrtBase(), device: async () => (await choice()).device });
  const mic = new SwitchMic(new WebMicrophone());
  const listener = new PcmListener({ mic, vad: () => new EnergyVad(), engine, modelId: () => current });
  await choose();
  const service = new SpeechService({
    engine,
    listener,
    speaker: new WebSpeechSpeaker(),
    chooseModel: choose,
    removeModel: async (id) => {
      for (const v of ['q8', 'f16'] as const) await files.remove(assetIdFor(id as WhisperModelId, v));
    },
  });
  return { service, engine, mic, prefs, env, choice };
}
