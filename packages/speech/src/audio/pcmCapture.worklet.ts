/// <reference lib="webworker" />
/**
 * AudioWorklet: downmix to mono, resample to 16 kHz, post 20 ms frames (320 samples, transferred).
 * Runs in AudioWorkletGlobalScope; only the pure resampler is imported (Vite bundles it).
 */
import { createResampleState, resampleTo16k } from './resample';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export const FRAME_SAMPLES = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private state = createResampleState();
  private acc = new Float32Array(FRAME_SAMPLES);
  private n = 0;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0];
    if (!ch || ch.length === 0) return true;
    const len = ch[0].length;
    const mono = new Float32Array(len);
    for (const c of ch) for (let i = 0; i < len; i++) mono[i] += c[i] / ch.length;
    const pcm = resampleTo16k(mono, sampleRate, this.state);
    for (let i = 0; i < pcm.length; i++) {
      this.acc[this.n++] = pcm[i];
      if (this.n === FRAME_SAMPLES) {
        const frame = this.acc;
        this.acc = new Float32Array(FRAME_SAMPLES);
        this.n = 0;
        this.port.postMessage(frame, [frame.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor as unknown as new () => AudioWorkletProcessor);
