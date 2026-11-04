import type { LoadProgress } from '@bible/core/speech';
import { whisperFactory } from './whisperFactory';
import { WhisperEngine, WHISPER_LANGUAGES, type WorkerLike } from './WhisperEngine';
import type { IModelFileSource } from './modelFiles';
import type { WhisperReply, WhisperRequest } from './whisperProtocol';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  sent: WhisperRequest[] = [];
  terminated = false;
  /** Return a reply to auto-send, or undefined to stay silent. */
  auto: (r: WhisperRequest) => WhisperReply[] | undefined = (r) => {
    if (r.op === 'load') return [{ id: r.id, kind: 'progress', p: { phase: 'load', loaded: 1 } }, { id: r.id, kind: 'ok' }];
    if (r.op === 'transcribe') return [{ id: r.id, kind: 'ok', value: { text: 'for God so loved', decodeMs: 7 } }];
    if (r.op === 'cancel') return undefined;
    return [{ id: r.id, kind: 'ok' }];
  };
  postMessage(m: WhisperRequest): void {
    this.sent.push(m);
    const replies = this.auto(m);
    if (replies) queueMicrotask(() => replies.forEach((r) => this.onmessage?.({ data: r })));
  }
  terminate(): void { this.terminated = true; }
  reply(r: WhisperReply) { this.onmessage?.({ data: r }); }
  ops() { return this.sent.map((r) => r.op); }
}

function fakeFiles(installed = true) {
  const state = { installed, installs: 0, reads: [] as string[] };
  const files: IModelFileSource = {
    isInstalled: async () => state.installed,
    install: async (_id, onProgress) => { state.installs++; onProgress({ phase: 'audio', loaded: 1, total: 1 }); state.installed = true; },
    read: async (id, path) => { state.reads.push(`${id}:${path}`); return new Uint8Array(4); },
    remove: async () => { state.installed = false; },
  };
  return { files, state };
}

function make(opts: { installed?: boolean; device?: 'wasm' | 'webgpu'; idle?: number; auto?: FakeWorker['auto'] } = {}) {
  const workers: FakeWorker[] = [];
  const { files, state } = fakeFiles(opts.installed);
  const engine = new WhisperEngine({
    files,
    ortBase: '/ort/',
    device: async () => opts.device ?? 'wasm',
    createWorker: () => { const w = new FakeWorker(); if (opts.auto) w.auto = opts.auto; workers.push(w); return w; },
    loadIdleTimeoutMs: opts.idle,
  });
  return { engine, workers, state };
}
const live = () => new AbortController().signal;
const noop = () => undefined;
const pcm = () => new Float32Array(16000);

describe('WhisperEngine metadata', () => {
  it('declares prompt biasing, on-device, offline, needs download', () => {
    const { engine } = make();
    expect(engine.id).toBe('whisper');
    expect(engine.capabilities).toMatchObject({ biasing: 'prompt', onDevice: true, offline: true, needsDownload: true, partials: true, streaming: false });
    expect(engine.capabilities.languages).toBe(WHISPER_LANGUAGES);
    expect(WHISPER_LANGUAGES).toContain('en');
  });

  it('lists base and tiny with the download size of this device\'s variant', async () => {
    const wasm = await make({ device: 'wasm' }).engine.listModels();
    const gpu = await make({ device: 'webgpu' }).engine.listModels();
    expect(wasm.map((m) => m.id)).toEqual(['base', 'tiny']);
    expect(wasm[0].downloadBytes).toBeGreaterThan(70e6);
    expect(wasm[0].downloadBytes).toBeLessThan(90e6);
    expect(gpu[0].downloadBytes).toBeGreaterThan(wasm[0].downloadBytes);
    expect(wasm[1].downloadBytes).toBeLessThan(wasm[0].downloadBytes);
  });

  it('isModelReady asks for the variant asset of the device', async () => {
    const files = { ...fakeFiles().files, isInstalled: vi.fn(async () => true) };
    const e = new WhisperEngine({ files, ortBase: '/', device: async () => 'webgpu' });
    expect(await e.isModelReady('base')).toBe(true);
    expect(files.isInstalled).toHaveBeenCalledWith('whisper-base-f16');
  });

  it('isSupported needs Worker, WebAssembly, AudioWorkletNode and getUserMedia', async () => {
    const g = globalThis as Record<string, unknown>;
    const save = { Worker: g.Worker, AudioWorkletNode: g.AudioWorkletNode };
    expect(await make().engine.isSupported()).toBe(false); // node: no Worker
    g.Worker = function () {}; g.AudioWorkletNode = function () {};
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: () => 0 } }, configurable: true });
    expect(await make().engine.isSupported()).toBe(true);
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete g.navigator;
    g.Worker = save.Worker; g.AudioWorkletNode = save.AudioWorkletNode;
    if (save.Worker === undefined) delete g.Worker;
    if (save.AudioWorkletNode === undefined) delete g.AudioWorkletNode;
  });
});

describe('WhisperEngine prepare', () => {
  it('installs when missing, reads every file, inits then loads with device and dtype', async () => {
    const { engine, workers, state } = make({ installed: false });
    const progress: LoadProgress[] = [];
    await engine.prepare('base', (p) => progress.push(p), live());
    expect(state.installs).toBe(1);
    expect(state.reads).toHaveLength(7);
    expect(state.reads).toContain('whisper-base-q8:onnx/encoder_model_quantized.onnx');
    const w = workers[0];
    expect(w.ops()).toEqual(['init', 'load']);
    expect(w.sent[0]).toMatchObject({ op: 'init', ortBase: '/ort/', numThreads: 1 });
    const load = w.sent[1] as Extract<WhisperRequest, { op: 'load' }>;
    expect(load).toMatchObject({ modelId: 'whisper-base-q8', device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
    expect(Object.keys(load.files)).toHaveLength(7);
    expect(progress.at(-1)).toMatchObject({ phase: 'engine' });
    expect(progress.at(-1)!.loaded).toBe(progress.at(-1)!.total);
  });

  it('skips the install when already installed and rejects unknown models', async () => {
    const { engine, state } = make();
    await engine.prepare('tiny', noop, live());
    expect(state.installs).toBe(0);
    await expect(engine.prepare('huge', noop, live())).rejects.toThrow(/Unknown/);
  });

  it('falls back to the wasm build when the webgpu session fails and q8 is installed', async () => {
    let loads = 0;
    const { engine, workers } = make({
      device: 'webgpu',
      auto: (r) => {
        if (r.op === 'load' && loads++ === 0) return [{ id: r.id, kind: 'error', error: { code: 'engine', message: 'no gpu' } }];
        return [{ id: r.id, kind: 'ok' }];
      },
    });
    await engine.prepare('base', noop, live());
    const sent = workers[0].sent.filter((r) => r.op === 'load') as Array<Extract<WhisperRequest, { op: 'load' }>>;
    expect(sent.map((l) => l.device)).toEqual(['webgpu', 'wasm']);
    expect(sent[1].modelId).toBe('whisper-base-q8');
  });
});

describe('WhisperEngine transcribe', () => {
  it('requires prepare first', async () => {
    await expect(make().engine.transcribe(pcm(), { language: 'en' }, live())).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('posts a pcm copy, language and bias prompt and returns a Transcript', async () => {
    const { engine, workers } = make();
    await engine.prepare('base', noop, live());
    const input = pcm();
    const t = await engine.transcribe(input, { language: 'en-US', bias: { phrases: ['Nicodemus', 'begotten'], level: 'names' } }, live());
    expect(t).toMatchObject({
      text: 'for God so loved', final: true, engineId: 'whisper', modelId: 'base', audioMs: 1000, decodeMs: 7,
    });
    expect(t.words.map((w) => w.text)).toEqual(['for', 'God', 'so', 'loved']);
    const sent = workers[0].sent.find((r) => r.op === 'transcribe') as Extract<WhisperRequest, { op: 'transcribe' }>;
    expect(sent).toMatchObject({ language: 'en-US', prompt: 'Nicodemus, begotten' });
    expect(sent.pcm).not.toBe(input);
    expect(input.length).toBe(16000);
  });

  it('serialises transcribes', async () => {
    const { engine, workers } = make();
    await engine.prepare('base', noop, live());
    const w = workers[0];
    const held: WhisperRequest[] = [];
    w.auto = (r) => { if (r.op === 'transcribe') { held.push(r); return undefined; } return undefined; };
    const a = engine.transcribe(pcm(), { language: 'en' }, live());
    const b = engine.transcribe(pcm(), { language: 'en' }, live());
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 5));
    expect(held).toHaveLength(1);
    w.reply({ id: held[0].id, kind: 'ok', value: { text: 'a', decodeMs: 1 } });
    await expect(a).resolves.toMatchObject({ text: 'a' });
    await vi.waitFor(() => expect(held).toHaveLength(2));
    w.reply({ id: held[1].id, kind: 'ok', value: { text: 'b', decodeMs: 1 } });
    await expect(b).resolves.toMatchObject({ text: 'b' });
  });

  it('abort rejects at once, posts a cancel, keeps the worker and drops the late reply', async () => {
    const { engine, workers } = make();
    await engine.prepare('base', noop, live());
    const w = workers[0];
    let id = 0;
    w.auto = (r) => { if (r.op === 'transcribe') id = r.id; return undefined; };
    const ac = new AbortController();
    const p = engine.transcribe(pcm(), { language: 'en' }, ac.signal);
    await vi.waitFor(() => expect(id).toBeGreaterThan(0));
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted', name: 'AbortError' });
    expect(w.sent.at(-1)).toMatchObject({ op: 'cancel', target: id });
    expect(w.terminated).toBe(false);
    w.reply({ id, kind: 'ok', value: { text: 'late', decodeMs: 1 } }); // dropped, no throw
    w.auto = (r) => (r.op === 'transcribe' ? [{ id: r.id, kind: 'ok', value: { text: 'next', decodeMs: 1 } }] : undefined);
    await expect(engine.transcribe(pcm(), { language: 'en' }, live())).resolves.toMatchObject({ text: 'next' });
    expect(workers).toHaveLength(1);
  });

  it('rejects immediately when already aborted', async () => {
    const { engine } = make();
    const ac = new AbortController();
    ac.abort();
    await expect(engine.transcribe(pcm(), { language: 'en' }, ac.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('maps worker error replies', async () => {
    const { engine, workers } = make();
    await engine.prepare('base', noop, live());
    workers[0].auto = (r) => [{ id: r.id, kind: 'error', error: { code: 'engine', message: 'boom' } }];
    await expect(engine.transcribe(pcm(), { language: 'en' }, live())).rejects.toMatchObject({ code: 'engine', message: 'boom' });
  });

  it('on a worker crash rejects pending calls, then respawns, re-inits and reloads the model', async () => {
    const { engine, workers, state } = make();
    await engine.prepare('base', noop, live());
    const first = workers[0];
    first.auto = () => undefined;
    const p = engine.transcribe(pcm(), { language: 'en' }, live());
    await vi.waitFor(() => expect(first.sent.some((r) => r.op === 'transcribe')).toBe(true));
    first.onerror?.(new Error('oom'));
    await expect(p).rejects.toMatchObject({ code: 'engine' });
    expect(first.terminated).toBe(true);
    const reads = state.reads.length;
    await expect(engine.transcribe(pcm(), { language: 'en' }, live())).resolves.toMatchObject({ text: 'for God so loved' });
    expect(workers).toHaveLength(2);
    expect(workers[1].ops()).toEqual(['init', 'load', 'transcribe']);
    expect(state.reads.length).toBe(reads + 7);
  });

  it('treats a stalled load as a crash', async () => {
    const { engine, workers } = make({ idle: 20, auto: (r) => (r.op === 'init' ? [{ id: r.id, kind: 'ok' }] : undefined) });
    await expect(engine.prepare('base', noop, live())).rejects.toMatchObject({ code: 'engine' });
    expect(workers[0].terminated).toBe(true);
  });

  it('dispose terminates the worker and forgets the model', async () => {
    const { engine, workers } = make();
    await engine.prepare('base', noop, live());
    engine.dispose();
    expect(workers[0].terminated).toBe(true);
    await expect(engine.transcribe(pcm(), { language: 'en' }, live())).rejects.toMatchObject({ code: 'not-ready' });
  });
});

describe('whisperFactory', () => {
  it('has id whisper and loads a WhisperEngine when enabled', async () => {
    const { files } = fakeFiles();
    const f = whisperFactory({ files, ortBase: '/', device: async () => 'wasm' });
    expect(f.id).toBe('whisper');
    const e = await f.load({ id: 'whisper', enabled: true, assetBase: '' });
    expect(e).toBeInstanceOf(WhisperEngine);
    await expect(f.load({ id: 'whisper', enabled: false, assetBase: '' })).rejects.toThrow();
  });
});
