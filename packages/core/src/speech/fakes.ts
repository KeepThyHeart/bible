/**
 * Test doubles for the speech contracts. Pure TS, no timers, no audio.
 */

import type {
  EarconKind,
  ISpeechApi,
  SpeechStatusDto,
  StartListeningDto,
  UtteranceOutcomeDto,
} from './apiTypes';
import type {
  IListener,
  ISpeaker,
  ListenOptions,
  ListenOutcome,
  RecognizedWord,
  SttCapabilities,
  Transcript,
} from './types';

/** Split text on whitespace into RecognizedWord[] (no timings). */
export function words(text: string): RecognizedWord[] {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => ({ text: w }));
}

function makeTranscript(say: string | RecognizedWord[]): Transcript {
  const ws = typeof say === 'string' ? words(say) : say;
  return {
    text: ws.map((w) => w.text).join(' '),
    words: ws,
    final: true,
    engineId: 'fake',
    modelId: 'fake',
    audioMs: 0,
    decodeMs: 0,
  };
}

export type SpeechErrorCode = 'mic-denied' | 'mic-busy' | 'engine' | 'not-ready';

export type ScriptItem =
  | { say: string | RecognizedWord[]; duringSpeak?: boolean }
  | { silence: true }
  | { error: SpeechErrorCode };

const FAKE_CAPS: SttCapabilities = {
  streaming: false,
  partials: false,
  wordTimestamps: false,
  wordConfidence: false,
  biasing: 'none',
  onDevice: true,
  offline: true,
  needsDownload: false,
  languages: ['en-US'],
};

/** Scripted IListener: each listen() consumes the next item; an exhausted script yields no-speech. */
export class FakeListener implements IListener {
  readonly id = 'fake';
  readonly capabilities: SttCapabilities = FAKE_CAPS;
  readonly calls: ListenOptions[] = [];
  private readonly script: ScriptItem[];

  constructor(script: ScriptItem[] = []) {
    this.script = [...script];
  }

  async listen(o: ListenOptions, signal: AbortSignal): Promise<ListenOutcome> {
    this.calls.push(o);
    if (signal.aborted) return { kind: 'aborted' };
    const item = this.script.shift();
    if (!item) return { kind: 'no-speech' };
    if ('silence' in item) return { kind: 'no-speech' };
    if ('error' in item) {
      const code = item.error === 'mic-denied' || item.error === 'mic-busy' ? item.error : 'engine';
      return { kind: 'error', code, message: item.error };
    }
    return { kind: 'speech', transcript: makeTranscript(item.say) };
  }
}

/** Records calls; never plays anything. */
export class FakeSpeaker implements ISpeaker {
  readonly spoken: { text: string; language: string; rate?: number }[] = [];
  readonly earcons: string[] = [];

  async speak(
    text: string,
    o: { language: string; voiceId?: string; rate?: number },
    _signal: AbortSignal,
  ): Promise<void> {
    this.spoken.push({ text, language: o.language, ...(o.rate !== undefined ? { rate: o.rate } : {}) });
  }

  async earcon(kind: 'listen' | 'ok' | 'miss' | 'done'): Promise<void> {
    this.earcons.push(kind);
  }
}

export interface FakeSpeechApiOptions {
  script?: ScriptItem[];
  granted?: { listen: boolean; speak: boolean };
  status?: Partial<SpeechStatusDto>;
  /**
   * Called at the start of each API call (`'speak'`, `'earcon'`, `'startListening'`,
   * `'nextUtterance'`, `'stopListening'`, `'cancel'`). Return a promise to hold the call
   * pending, then resolve it later (race tests).
   */
  gate?: (method: string) => Promise<void> | void;
}

/**
 * In-memory ISpeechApi. `script` items are consumed by `nextUtterance`. An item with
 * `duringSpeak: true` is dropped (never delivered) if it is pulled while a speak/earcon
 * is in flight, which proves half duplex. After `stopListening`/`cancel`, `nextUtterance`
 * returns `ended/stopped`.
 */
export class FakeSpeechApi implements ISpeechApi {
  readonly script: ScriptItem[];
  readonly spoken: { text: string; language?: string; rate?: number }[] = [];
  readonly earcons: EarconKind[] = [];
  readonly starts: StartListeningDto[] = [];
  granted: { listen: boolean; speak: boolean };
  statusOverride: Partial<SpeechStatusDto>;
  gate: ((method: string) => Promise<void> | void) | undefined;
  /** Number of speak/earcon calls currently in flight. */
  speaking = 0;

  private nextId = 1;
  private activeId: string | null = null;
  private readonly stopped = new Set<string>();

  constructor(o: FakeSpeechApiOptions = {}) {
    this.script = [...(o.script ?? [])];
    this.granted = o.granted ?? { listen: true, speak: true };
    this.statusOverride = o.status ?? {};
    this.gate = o.gate;
  }

  async status(): Promise<SpeechStatusDto> {
    return {
      granted: { ...this.granted },
      listen: 'ready',
      speak: 'ready',
      languages: ['en-US'],
      engineLabel: 'Fake',
      onDevice: true,
      ...this.statusOverride,
    };
  }

  async speak(text: string, o?: { language?: string; rate?: number }): Promise<{ completed: boolean }> {
    this.speaking++;
    try {
      await this.gate?.('speak');
    } finally {
      this.speaking--;
    }
    this.spoken.push({
      text,
      ...(o?.language !== undefined ? { language: o.language } : {}),
      ...(o?.rate !== undefined ? { rate: o.rate } : {}),
    });
    return { completed: true };
  }

  async earcon(kind: EarconKind): Promise<void> {
    this.speaking++;
    try {
      await this.gate?.('earcon');
    } finally {
      this.speaking--;
    }
    this.earcons.push(kind);
  }

  async startListening(o: StartListeningDto): Promise<{ listenId: string }> {
    await this.gate?.('startListening');
    this.starts.push(o);
    const listenId = `listen-${this.nextId++}`;
    this.activeId = listenId;
    return { listenId };
  }

  async nextUtterance(listenId: string, _o: { noSpeechTimeoutMs: number }): Promise<UtteranceOutcomeDto> {
    // Snapshot half-duplex state at call time, before any gate holds the call.
    const duringSpeak = this.speaking > 0;
    await this.gate?.('nextUtterance');
    if (this.stopped.has(listenId) || this.activeId !== listenId) {
      return { kind: 'ended', reason: 'stopped' };
    }
    for (;;) {
      const item = this.script.shift();
      if (!item) return { kind: 'no-speech' };
      if ('say' in item && item.duringSpeak && (duringSpeak || this.speaking > 0)) continue; // dropped: mic was gated
      if ('silence' in item) return { kind: 'no-speech' };
      if ('error' in item) return { kind: 'error', code: item.error, message: item.error };
      return { kind: 'speech', transcript: makeTranscript(item.say) };
    }
  }

  async stopListening(listenId: string): Promise<void> {
    await this.gate?.('stopListening');
    this.stopped.add(listenId);
    if (this.activeId === listenId) this.activeId = null;
  }

  async cancel(): Promise<void> {
    await this.gate?.('cancel');
    if (this.activeId) this.stopped.add(this.activeId);
    this.activeId = null;
  }
}
