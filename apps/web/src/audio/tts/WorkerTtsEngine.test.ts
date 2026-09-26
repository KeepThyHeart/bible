import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioVoice, LoadProgress, SynthesisRequest, TtsEngineCapabilities, TtsEngineConfig } from '@bible/core/browser';
import { WorkerTtsEngine, type WorkerLike } from './WorkerTtsEngine';
import { serveTtsWorker, type WorkerScopeLike } from './serveTtsWorker';
import type { TtsWorkerHandlers, TtsWorkerReply, TtsWorkerRequest } from './ttsWorkerProtocol';

const tick = () => new Promise<void>(r => setTimeout(r, 0));

class FakeWorker implements WorkerLike {
  sent: TtsWorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: { data: TtsWorkerReply }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  throwOnPost = false;
  postMessage(m: TtsWorkerRequest) {
    if (this.throwOnPost) throw new Error('DataCloneError');
    this.sent.push(m);
  }
  terminate() { this.terminated = true; }
  reply(data: TtsWorkerReply) { this.onmessage?.({ data }); }
  ops(): string[] { return this.sent.map(m => m.op); }
  last(op: string): TtsWorkerRequest { return [...this.sent].reverse().find(m => m.op === op)!; }
  /** Answer every request of `op` that has not been answered yet. */
  autoAnswer(value: (m: TtsWorkerRequest) => unknown = () => undefined) {
    const answered = new Set<number>();
    const timer = setInterval(() => {
      for (const m of this.sent) {
        if (answered.has(m.id) || m.op === 'cancel' || m.op === 'dispose') continue;
        answered.add(m.id);
        this.reply({ id: m.id, kind: 'ok', value: value(m) });
      }
    }, 1);
    return () => clearInterval(timer);
  }
}

const caps: TtsEngineCapabilities = { rate: { min: 0.5, max: 2, step: 0.1 }, nativeRate: true, languages: ['en'], backends: ['wasm'], approxRuntimeBytes: 1 };
const config: TtsEngineConfig = {
  id: 't', enabled: true, assetBase: '/audio/tts/t',
  voices: [{ id: 'v1', label: 'V1', language: 'en-US', files: ['v1.onnx', 'v1.json'], downloadBytes: 10 }],
};

class TestEngine extends WorkerTtsEngine {
  readonly id = 't';
  readonly label = 'Test';
  readonly capabilities = caps;
  workers: FakeWorker[] = [];
  cached = new Set<string>();
  deleted: string[] = [];
  supportedExtra = true;
  protected createWorker(): WorkerLike { const w = new FakeWorker(); this.workers.push(w); return w; }
  protected initPayload() { return { assetBase: this.config.assetBase }; }
  protected async isVoiceCached(id: string) { return this.cached.has(id); }
  protected async deleteCachedVoice(id: string) { this.deleted.push(id); this.cached.delete(id); }
  protected async extraSupportCheck() { return this.supportedExtra; }
  get w(): FakeWorker { return this.workers[this.workers.length - 1]; }
}

const req: SynthesisRequest = { text: 'hello', voiceId: 'v1', rate: 1 };
const pcm = () => ({ pcm: new Float32Array(10), sampleRate: 8000 });
const signal = () => new AbortController().signal;

let engine: TestEngine;
beforeEach(() => { engine = new TestEngine(config, { synthesizeTimeoutMs: 1000, prepareIdleTimeoutMs: 1000 }); });
afterEach(() => { vi.useRealTimers(); });

describe('WorkerTtsEngine', () => {
  it('lists voices without their file lists, and is supported only with Worker, WebAssembly and the extra check', async () => {
    const voices: AudioVoice[] = await engine.listVoices();
    expect(voices).toEqual([{ id: 'v1', label: 'V1', language: 'en-US', downloadBytes: 10 }]);
    expect('files' in voices[0]).toBe(false);
    const hadWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = class {};
    try {
      expect(await engine.isSupported()).toBe(true);
      engine.supportedExtra = false;
      expect(await engine.isSupported()).toBe(false);
      engine.supportedExtra = true;
      delete (globalThis as { Worker?: unknown }).Worker;
      expect(await engine.isSupported()).toBe(false);
    } finally {
      if (hadWorker) (globalThis as { Worker?: unknown }).Worker = hadWorker;
    }
  });

  it('creates the worker lazily, inits it once, prepares the voice with progress, then synthesizes', async () => {
    expect(engine.workers.length).toBe(0);
    const progress: LoadProgress[] = [];
    const p = engine.prepare('v1', x => progress.push(x), signal());
    await tick();
    expect(engine.workers.length).toBe(1);
    expect(engine.w.ops()).toEqual(['init']);
    engine.w.reply({ id: engine.w.last('init').id, kind: 'ok' });
    await tick();
    const prep = engine.w.last('prepare') as Extract<TtsWorkerRequest, { op: 'prepare' }>;
    expect(prep.payload).toEqual({ files: ['v1.onnx', 'v1.json'], assetBase: '/audio/tts/t' });
    engine.w.reply({ id: prep.id, kind: 'progress', p: { phase: 'voice', loaded: 5, total: 10 } });
    engine.w.reply({ id: prep.id, kind: 'ok' });
    await p;
    expect(progress).toEqual([{ phase: 'voice', loaded: 5, total: 10 }]);
    expect(await engine.isVoiceReady('v1')).toBe(true);

    const stop = engine.w.autoAnswer(() => pcm());
    const result = await engine.synthesize(req, signal());
    stop();
    expect(result.sampleRate).toBe(8000);
    expect(engine.w.ops().filter(o => o === 'init').length).toBe(1);
  });

  it('isVoiceReady also consults the persistent store', async () => {
    expect(await engine.isVoiceReady('v1')).toBe(false);
    engine.cached.add('v1');
    expect(await engine.isVoiceReady('v1')).toBe(true);
  });

  it('prepares an unloaded voice on the way to a synthesize', async () => {
    const stop = (() => { const t = setInterval(() => engine.workers.forEach(w => w.autoAnswer(() => pcm())), 1); return () => clearInterval(t); })();
    await engine.synthesize(req, signal());
    stop();
    expect(engine.w.ops().slice(0, 3)).toEqual(['init', 'prepare', 'synthesize']);
  });

  async function preparedEngine() {
    const setup = engine.prepare('v1', () => {}, signal());
    await tick();
    engine.w.reply({ id: engine.w.last('init').id, kind: 'ok' });
    await tick();
    engine.w.reply({ id: engine.w.last('prepare').id, kind: 'ok' });
    await setup;
  }

  it('abort rejects at once, posts a cancel, keeps the worker, and ignores the late reply', async () => {
    await preparedEngine();

    const ctrl = new AbortController();
    const p = engine.synthesize(req, ctrl.signal);
    await tick();
    const target = engine.w.last('synthesize').id;
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(engine.w.sent.some(m => m.op === 'cancel' && (m as { target: number }).target === target)).toBe(true);
    expect(engine.w.terminated).toBe(false);
    engine.w.reply({ id: target, kind: 'ok', value: pcm() }); // the late result: dropped
    // The same worker still serves the next call.
    const next = engine.synthesize(req, signal());
    await tick();
    engine.w.reply({ id: engine.w.last('synthesize').id, kind: 'ok', value: pcm() });
    await expect(next).resolves.toMatchObject({ sampleRate: 8000 });
    expect(engine.workers.length).toBe(1);
  });

  it('an already aborted signal never reaches the worker', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(engine.synthesize(req, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(engine.workers.length).toBe(0);
  });

  it('a worker error rejects every pending call (engine, retryable) and terminates; the next call starts a new worker, inits again and re-prepares the voice', async () => {
    await preparedEngine();
    const a = engine.synthesize(req, signal());
    const b = engine.synthesize({ ...req, text: 'two' }, signal());
    await tick();
    const first = engine.w;
    first.onerror?.(new Error('boom'));
    await expect(a).rejects.toMatchObject({ code: 'engine', retryable: true });
    await expect(b).rejects.toMatchObject({ code: 'engine', retryable: true });
    expect(first.terminated).toBe(true);

    const c = engine.synthesize(req, signal());
    await tick();
    expect(engine.workers.length).toBe(2);
    const second = engine.w;
    second.reply({ id: second.last('init').id, kind: 'ok' });
    await tick();
    second.reply({ id: second.last('prepare').id, kind: 'ok' });
    await tick();
    second.reply({ id: second.last('synthesize').id, kind: 'ok', value: pcm() });
    await expect(c).resolves.toBeDefined();
    expect(second.ops()).toEqual(['init', 'prepare', 'synthesize']);
  });

  it('an unreadable message and a failing postMessage are crashes too', async () => {
    await preparedEngine();
    const p = engine.synthesize(req, signal());
    await tick();
    engine.w.onmessageerror?.(new Event('messageerror'));
    await expect(p).rejects.toMatchObject({ code: 'engine' });

    await preparedEngine();
    engine.w.throwOnPost = true;
    await expect(engine.synthesize(req, signal())).rejects.toMatchObject({ code: 'engine', retryable: true });
    expect(engine.w.terminated).toBe(true);
  });

  it('a synthesize that never answers is treated as a wedged worker after the timeout', async () => {
    await preparedEngine();
    vi.useFakeTimers();
    const p = engine.synthesize(req, signal());
    const assertion = expect(p).rejects.toMatchObject({ code: 'engine', retryable: true });
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(engine.w.terminated).toBe(true);
  });

  it('a slow download that keeps reporting progress is not timed out; silence is', async () => {
    vi.useFakeTimers();
    const p = engine.prepare('v1', () => {}, signal());
    await vi.advanceTimersByTimeAsync(0);
    engine.w.reply({ id: engine.w.last('init').id, kind: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    const id = engine.w.last('prepare').id;
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(800);
      engine.w.reply({ id, kind: 'progress', p: { phase: 'voice', loaded: i, total: 10 } });
    }
    expect(engine.w.terminated).toBe(false);
    const assertion = expect(p).rejects.toMatchObject({ code: 'engine' });
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(engine.w.terminated).toBe(true);
  });

  it('a failed init kills the worker so the next call starts fresh', async () => {
    const p = engine.prepare('v1', () => {}, signal());
    await tick();
    engine.w.reply({ id: engine.w.last('init').id, kind: 'error', error: { code: 'unsupported', message: 'no wasm', retryable: false } });
    await expect(p).rejects.toMatchObject({ code: 'unsupported' });
    await tick();
    expect(engine.workers[0].terminated).toBe(true);
    const again = engine.prepare('v1', () => {}, signal());
    await tick();
    expect(engine.workers.length).toBe(2);
    again.catch(() => {});
  });

  it('error replies from the worker keep their code', async () => {
    await preparedEngine();
    const p = engine.synthesize(req, signal());
    await tick();
    engine.w.reply({ id: engine.w.last('synthesize').id, kind: 'error', error: { code: 'network', message: 'x', retryable: true } });
    await expect(p).rejects.toMatchObject({ code: 'network', retryable: true });
    expect(engine.w.terminated).toBe(false);
  });

  it('evictVoice forgets the voice, tells the worker and deletes the stored files', async () => {
    await preparedEngine();
    engine.cached.add('v1');
    const done = engine.evictVoice('v1');
    await tick();
    engine.w.reply({ id: engine.w.last('evict').id, kind: 'ok' });
    await done;
    expect(engine.deleted).toEqual(['v1']);
    expect(await engine.isVoiceReady('v1')).toBe(false);
  });

  it('dispose rejects what is pending, terminates the worker and is idempotent', async () => {
    await preparedEngine();
    const p = engine.synthesize(req, signal());
    await tick();
    const w = engine.w;
    engine.dispose();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(w.terminated).toBe(true);
    expect(w.ops()).toContain('dispose');
    expect(() => engine.dispose()).not.toThrow();
  });
});

describe('serveTtsWorker', () => {
  function scope() {
    const posted: Array<{ msg: TtsWorkerReply; transfer?: Transferable[] }> = [];
    let listener: ((e: { data: TtsWorkerRequest }) => void) | null = null;
    const s: WorkerScopeLike = {
      postMessage: (msg, transfer) => { posted.push({ msg, transfer }); },
      addEventListener: (_t, l) => { listener = l; },
    };
    return { s, posted, send: (m: TtsWorkerRequest) => listener!({ data: m }) };
  }

  it('runs requests one at a time, in order, and transfers the PCM buffer', async () => {
    const { s, posted, send } = scope();
    const order: string[] = [];
    let release!: () => void;
    const handlers: TtsWorkerHandlers = {
      init: async () => { order.push('init'); },
      prepare: async () => { order.push('prepare'); },
      synthesize: async r => {
        order.push(`synth:${r.text}`);
        if (r.text === 'slow') await new Promise<void>(res => { release = res; });
        return { pcm: new Float32Array(4), sampleRate: 8000 };
      },
      evict: async () => {},
    };
    serveTtsWorker(s, handlers);
    send({ id: 1, op: 'init', payload: {} });
    send({ id: 2, op: 'synthesize', req: { text: 'slow', voiceId: 'v', rate: 1 } });
    send({ id: 3, op: 'synthesize', req: { text: 'fast', voiceId: 'v', rate: 1 } });
    await tick();
    expect(order).toEqual(['init', 'synth:slow']); // the third waits its turn
    release();
    await tick(); await tick();
    expect(order).toEqual(['init', 'synth:slow', 'synth:fast']);
    const oks = posted.filter(p => p.msg.kind === 'ok').map(p => p.msg.id);
    expect(oks).toEqual([1, 2, 3]);
    expect(posted.find(p => p.msg.id === 2)!.transfer).toHaveLength(1);
  });

  it('skips a queued request that was cancelled, and aborts a running one', async () => {
    const { s, posted, send } = scope();
    const ran: number[] = [];
    let seenSignal: AbortSignal | undefined;
    let release!: () => void;
    serveTtsWorker(s, {
      init: async () => {},
      prepare: async (_v, _p, _pr, signal) => { ran.push(1); seenSignal = signal; await new Promise<void>(res => { release = res; }); },
      synthesize: async () => { ran.push(2); return { pcm: new Float32Array(1), sampleRate: 1 }; },
      evict: async () => {},
    });
    send({ id: 1, op: 'prepare', voiceId: 'v' });
    send({ id: 2, op: 'synthesize', req: { text: 'a', voiceId: 'v', rate: 1 } });
    await tick();
    send({ id: 3, op: 'cancel', target: 2 }); // queued behind the prepare
    send({ id: 4, op: 'cancel', target: 1 }); // running
    expect(seenSignal!.aborted).toBe(true);
    release();
    await tick(); await tick();
    expect(ran).toEqual([1]); // the synthesize never started
    expect(posted.map(p => p.msg.id)).toEqual([1]);
  });

  it('turns thrown values into error replies with a code, and keeps serving', async () => {
    const { s, posted, send } = scope();
    serveTtsWorker(s, {
      init: async () => { throw { code: 'unsupported', message: 'no', retryable: false }; },
      prepare: async () => { throw new TypeError('Failed to fetch'); },
      synthesize: async () => { throw new Error('inference blew up'); },
      evict: async () => {},
    });
    send({ id: 1, op: 'init', payload: {} });
    send({ id: 2, op: 'prepare', voiceId: 'v' });
    send({ id: 3, op: 'synthesize', req: { text: 'a', voiceId: 'v', rate: 1 } });
    await tick(); await tick();
    const errors = posted.map(p => p.msg).filter((m): m is Extract<TtsWorkerReply, { kind: 'error' }> => m.kind === 'error');
    expect(errors.map(e => e.error.code)).toEqual(['unsupported', 'network', 'engine']);
  });

  it('relays prepare progress', async () => {
    const { s, posted, send } = scope();
    serveTtsWorker(s, {
      init: async () => {},
      prepare: async (_v, _p, progress) => { progress({ phase: 'voice', loaded: 1, total: 2 }); },
      synthesize: async () => ({ pcm: new Float32Array(1), sampleRate: 1 }),
      evict: async () => {},
    });
    send({ id: 1, op: 'prepare', voiceId: 'v' });
    await tick();
    expect(posted.map(p => p.msg.kind)).toEqual(['progress', 'ok']);
  });
});
