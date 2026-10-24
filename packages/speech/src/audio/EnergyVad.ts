import type { IVoiceActivityDetector } from '@bible/core/speech';

export interface EnergyVadOptions {
  /** dB above the noise floor that counts as speech (default 9). */
  marginDb?: number;
  /** Absolute dBFS gate (default -50). */
  minDb?: number;
  /** Consecutive speech frames before onset (default 3). */
  onsetFrames?: number;
  /** Frames of speech kept after the last speech frame (default 8). */
  hangoverFrames?: number;
}

const INIT_FRAMES = 10; // 200 ms at 20 ms frames
const FLOOR_MIN = -70;
const FLOOR_MAX = -30;
const INIT_FLOOR_MAX = -42; // speech that starts at frame 0 must still clear floor + margin
const EMA = 0.05;

/** Frame-energy VAD: adaptive noise floor, onset debounce, hangover. Pure and deterministic. */
export class EnergyVad implements IVoiceActivityDetector {
  private readonly margin: number;
  private readonly minDb: number;
  private readonly onset: number;
  private readonly hang: number;
  private floor = FLOOR_MIN;
  private init: number[] = [];
  private run = 0;
  private inSpeech = false;
  private hangLeft = 0;

  constructor(o: EnergyVadOptions = {}) {
    this.margin = o.marginDb ?? 9;
    this.minDb = o.minDb ?? -50;
    this.onset = o.onsetFrames ?? 3;
    this.hang = o.hangoverFrames ?? 8;
  }

  reset(): void {
    this.floor = FLOOR_MIN;
    this.init = [];
    this.run = 0;
    this.inSpeech = false;
    this.hangLeft = 0;
  }

  process(frame: Float32Array): 'speech' | 'silence' {
    let s = 0;
    for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
    const db = 10 * Math.log10(s / Math.max(1, frame.length) + 1e-12);

    if (this.init.length < INIT_FRAMES) {
      this.init.push(db);
      this.floor = Math.min(INIT_FLOOR_MAX, clamp(Math.min(...this.init))); // the quietest frame so far: robust to speech in the first 200 ms
      return 'silence';
    }

    const loud = db > this.floor + this.margin && db > this.minDb;
    if (loud) {
      this.run++;
      if (this.run >= this.onset) {
        this.inSpeech = true;
        this.hangLeft = this.hang;
      }
    } else {
      this.run = 0;
      if (!this.inSpeech) this.floor = clamp(this.floor + EMA * (db - this.floor));
    }
    if (this.inSpeech && !loud) {
      if (this.hangLeft-- <= 0) this.inSpeech = false;
    }
    return this.inSpeech ? 'speech' : 'silence';
  }
}

function clamp(v: number): number {
  return Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, v));
}
