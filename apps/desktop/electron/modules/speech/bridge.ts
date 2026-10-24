/**
 * Main-side `ISpeechApi` that forwards each call to the renderer, where the speech engine runs.
 * Transcripts and audio only pass through; nothing here logs call arguments or results.
 */
import type {
  EarconKind,
  ISpeechApi,
  SpeechStatusDto,
  StartListeningDto,
  UtteranceOutcomeDto,
} from '@bible/core/speech';
import type { SpeechBridgeCall, SpeechBridgeResult, SpeechMethod } from './types';

export const READY_WAIT_MS = 5_000;
export const SPEECH_NOT_AVAILABLE = 'Speech is not available right now.';

export interface BridgeOptions {
  /** Deliver a call to the renderer. Throw when there is no window. */
  send(call: SpeechBridgeCall): void;
  readyWaitMs?: number;
  /** Per-method timeouts in ms (defaults below). */
  timeouts?: Partial<Record<SpeechMethod, number>>;
  /** Called before the first listen (macOS microphone permission). Errors are ignored. */
  askMicrophone?(): Promise<unknown>;
}

const DEFAULT_TIMEOUTS: Record<SpeechMethod, number> = {
  status: 5_000,
  speak: 120_000,
  earcon: 10_000,
  startListening: 60_000,
  nextUtterance: 60_000,
  stopListening: 10_000,
  cancel: 10_000,
};

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const UNAVAILABLE_STATUS: SpeechStatusDto = {
  granted: { listen: true, speak: true },
  listen: 'unavailable',
  speak: 'unavailable',
  languages: [],
  engineLabel: '',
  onDevice: true,
};

export class RendererSpeechBridge implements ISpeechApi {
  private ready = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readyWaiters: Array<() => void> = [];
  private micAsked = false;

  constructor(private readonly o: BridgeOptions) {}

  /** The renderer's bridge host is listening. A second call means the renderer reloaded: old calls die. */
  markReady(): void {
    if (this.ready) this.rejectAll(new Error('The speech engine restarted.'));
    this.ready = true;
    for (const w of this.readyWaiters.splice(0)) w();
  }

  /** The renderer answered a call. Unknown ids (late replies after a timeout) are ignored. */
  reply(callId: number, result: SpeechBridgeResult): void {
    const p = this.pending.get(callId);
    if (!p) return;
    this.pending.delete(callId);
    clearTimeout(p.timer);
    if (result.ok) p.resolve(result.value);
    else p.reject(new Error(result.error));
  }

  /** The window is gone: pending calls reject and the bridge waits for the next `ready`. */
  windowGone(): void {
    this.ready = false;
    this.rejectAll(new Error(SPEECH_NOT_AVAILABLE));
  }

  dispose(): void {
    this.windowGone();
    for (const w of this.readyWaiters.splice(0)) w();
  }

  async status(): Promise<SpeechStatusDto> {
    if (!(await this.waitReady())) return { ...UNAVAILABLE_STATUS };
    try {
      return (await this.call('status', [])) as SpeechStatusDto;
    } catch {
      return { ...UNAVAILABLE_STATUS };
    }
  }

  async speak(text: string, o?: { language?: string; rate?: number }): Promise<{ completed: boolean }> {
    return (await this.callReady('speak', [text, o])) as { completed: boolean };
  }

  async earcon(kind: EarconKind): Promise<void> {
    await this.callReady('earcon', [kind]);
  }

  async startListening(o: StartListeningDto): Promise<{ listenId: string }> {
    if (!this.micAsked && this.o.askMicrophone) {
      this.micAsked = true;
      try {
        await this.o.askMicrophone();
      } catch {
        /* the renderer's getUserMedia reports a denial as mic-denied */
      }
    }
    return (await this.callReady('startListening', [o])) as { listenId: string };
  }

  async nextUtterance(listenId: string, o: { noSpeechTimeoutMs: number }): Promise<UtteranceOutcomeDto> {
    const timeout = Math.max(0, o.noSpeechTimeoutMs) + 60_000;
    return (await this.callReady('nextUtterance', [listenId, o], timeout)) as UtteranceOutcomeDto;
  }

  async stopListening(listenId: string): Promise<void> {
    if (!this.ready) return;
    await this.call('stopListening', [listenId]);
  }

  async cancel(): Promise<void> {
    if (!this.ready) return;
    await this.call('cancel', []);
  }

  private async callReady(method: SpeechMethod, args: unknown[], timeoutMs?: number): Promise<unknown> {
    if (!(await this.waitReady())) throw new Error(SPEECH_NOT_AVAILABLE);
    return this.call(method, args, timeoutMs);
  }

  private waitReady(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve(this.ready);
      };
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== done);
        resolve(false);
      }, this.o.readyWaitMs ?? READY_WAIT_MS);
      this.readyWaiters.push(done);
    });
  }

  private call(method: SpeechMethod, args: unknown[], timeoutMs?: number): Promise<unknown> {
    const callId = this.nextId++;
    const ms = timeoutMs ?? this.o.timeouts?.[method] ?? DEFAULT_TIMEOUTS[method];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`Speech ${method} timed out.`));
      }, ms);
      this.pending.set(callId, { resolve, reject, timer });
      try {
        this.o.send({ callId, method, args });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(callId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}
