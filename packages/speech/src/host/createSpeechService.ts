/** Wires the real engine, microphone, VAD, listener and speakers into a SpeechService. */

import type { ITtsEngine } from '@bible/core/audio';
import type { ISpeaker } from '@bible/core/speech';
import { EnergyVad } from '../audio/EnergyVad';
import { WebMicrophone } from '../audio/WebMicrophone';
import { WhisperEngine } from '../engine/WhisperEngine';
import type { IModelFileSource } from '../engine/modelFiles';
import { PcmListener } from '../listen/PcmListener';
import { chooseModel, detectEnv, type SpeechEnv } from '../models/device';
import { WHISPER_VARIANT_IDS, assetIdFor } from '../models/whisperModels';
import { TtsEngineSpeaker } from '../tts/TtsEngineSpeaker';
import { WebSpeechSpeaker } from '../tts/WebSpeechSpeaker';
import { DEFAULT_SPEECH_PREFS, type SpeechPrefsStore, type WhisperModelId } from '../types';
import { createSpeechPrefs } from './prefs';
import { SpeechService } from './SpeechService';

export interface SpeechServiceOptions {
  files: IModelFileSource;
  /** Where the ONNX runtime wasm files are served (ends in `/`). */
  ortBase: string;
  prefs?: SpeechPrefsStore;
  /** Fallback voice engine for languages `speechSynthesis` has no voice for. */
  tts?: ITtsEngine;
  /** Informational: the asset catalog (see `whisperManifests`) decides the download origin. */
  modelBase?: string;
}

/** Web Speech first; the TTS engine when the browser has no voice and an installed engine voice matches. */
function composeSpeaker(web: WebSpeechSpeaker, tts?: ITtsEngine): ISpeaker & { available(lang?: string): Promise<boolean> } {
  const fallback = async (lang: string): Promise<TtsEngineSpeaker | null> => {
    if (!tts) return null;
    try {
      const prefix = lang.toLowerCase().split('-')[0];
      for (const v of await tts.listVoices()) {
        if (v.language.toLowerCase().split('-')[0] === prefix && (await tts.isVoiceReady(v.id))) {
          return new TtsEngineSpeaker(tts, v.id);
        }
      }
    } catch {
      /* no fallback voice */
    }
    return null;
  };
  return {
    available: async (lang = 'en') => (await web.available(lang)) || !!(await fallback(lang)),
    async speak(text, o, signal) {
      if (await web.available(o.language)) return web.speak(text, o, signal);
      const alt = await fallback(o.language);
      if (!alt) throw new Error('No voice available');
      return alt.speak(text, o, signal);
    },
    earcon: (kind) => web.earcon(kind),
  };
}

export function createSpeechService(o: SpeechServiceOptions): SpeechService {
  const prefs = o.prefs ?? createSpeechPrefs();
  let env: Promise<SpeechEnv> | undefined;
  const choice = async () => chooseModel(prefs.get() ?? DEFAULT_SPEECH_PREFS, await (env ??= detectEnv()));
  let current: string = 'base';
  const choose = async () => (current = (await choice()).model);

  const engine = new WhisperEngine({ files: o.files, ortBase: o.ortBase, device: async () => (await choice()).device });
  const listener = new PcmListener({
    mic: new WebMicrophone(),
    vad: () => new EnergyVad(),
    engine,
    modelId: () => current,
  });
  void choose();
  return new SpeechService({
    engine,
    listener,
    speaker: composeSpeaker(new WebSpeechSpeaker(), o.tts),
    chooseModel: choose,
    removeModel: async (id) => {
      for (const v of WHISPER_VARIANT_IDS) await o.files.remove(assetIdFor(id as WhisperModelId, v));
    },
  });
}

