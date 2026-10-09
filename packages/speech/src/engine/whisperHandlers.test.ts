import {
  MemCache, OFFLINE_HOST, buildDecoderPrefix, createWhisperHandlers, installOfflineFetch, serveWhisper,
  type ModelLike, type TokenizerLike, type TransformersLike,
} from './whisperHandlers';
import type { WhisperReply, WhisperRequest } from './whisperProtocol';

const SPECIAL: Record<string, number> = {
  '<|startofprev|>': 1, '<|startoftranscript|>': 2, '<|en|>': 3, '<|es|>': 4, '<|transcribe|>': 5, '<|notimestamps|>': 6, '<|endoftext|>': 7,
};

/** Words map to ids >= 100; ids < 100 are special. */
function fakeTokenizer(): TokenizerLike & { vocab: string[] } {
  const vocab: string[] = [];
  return {
    vocab,
    encode(text) {
      if (text in SPECIAL) return [SPECIAL[text]];
      return text.split(/\s+/).filter(Boolean).map((w) => {
        let i = vocab.indexOf(w);
        if (i < 0) i = vocab.push(w) - 1;
        return 100 + i;
      });
    },
    decode(ids, o) {
      return ids.filter((i) => i >= 100 || !o?.skip_special_tokens).map((i) => (i >= 100 ? vocab[i - 100] : `<${i}>`)).join(' ');
    },
  };
}

function fakeTf(says: string[], log: { generate: Array<Record<string, unknown>>; calls: string[]; env?: unknown } = { generate: [], calls: [] }) {
  const tok = fakeTokenizer();
  let n = 0;
  const model: ModelLike = {
    async generate(o) {
      log.generate.push(o);
      const prefix = o.decoder_input_ids as number[];
      const say = says[Math.min(n++, says.length - 1)];
      return { tolist: () => [[...prefix, ...tok.encode(say), 7].map((x) => BigInt(x))] };
    },
    dispose: async () => { log.calls.push('dispose'); },
  };
  const tf = {
    env: { backends: { onnx: { wasm: {} } } },
    AutoTokenizer: { from_pretrained: async (id: string) => { log.calls.push(`tok:${id}`); return tok; } },
    AutoProcessor: { from_pretrained: async () => async () => ({ input_features: 'feat' }) },
    WhisperForConditionalGeneration: { from_pretrained: async (id: string, o: object) => { log.calls.push(`model:${id}:${JSON.stringify(o)}`); return model; } },
  } as unknown as TransformersLike;
  return { tf, tok, log };
}

const files = (): Record<string, ArrayBuffer> => ({ 'config.json': new ArrayBuffer(4), 'onnx/encoder_model_quantized.onnx': new ArrayBuffer(8) });
const loadArgs = { modelId: 'whisper-base-q8', device: 'wasm' as const, dtype: { encoder_model: 'q8' }, files: files() };
const live = () => new AbortController().signal;

describe('buildDecoderPrefix', () => {
  const tok = fakeTokenizer();
  it('builds the four-token prefix without a prompt', () => {
    expect(buildDecoderPrefix(tok, 'en-US')).toEqual([2, 3, 5, 6]);
    expect(buildDecoderPrefix(tok, 'es')).toEqual([2, 4, 5, 6]);
  });
  it('puts startofprev + prompt first, capped to the last 120 tokens', () => {
    expect(buildDecoderPrefix(tok, 'en', [100, 101])).toEqual([1, 100, 101, 2, 3, 5, 6]);
    const long = Array.from({ length: 150 }, (_, i) => 100 + i);
    const p = buildDecoderPrefix(tok, 'en', long);
    expect(p.slice(1, -4)).toEqual(long.slice(30));
  });
  it('rejects a language the tokenizer does not know', () => {
    expect(() => buildDecoderPrefix({ encode: () => [], decode: () => '' }, 'xx')).toThrow(/Unsupported/);
  });
});

describe('MemCache', () => {
  it('serves filled keys and nothing after clear', async () => {
    const c = new MemCache();
    c.fill('https://h/m/', { 'a.json': new TextEncoder().encode('{"x":1}').buffer as ArrayBuffer });
    expect(await (await c.match('https://h/m/a.json'))!.json()).toEqual({ x: 1 });
    expect(await c.match('https://h/m/b.json')).toBeUndefined();
    c.clear();
    expect(await c.match('https://h/m/a.json')).toBeUndefined();
  });
});

describe('installOfflineFetch', () => {
  it('answers 404 for the offline host and passes other URLs through', async () => {
    const real = vi.fn(async () => new Response('ok'));
    const prev = globalThis.fetch;
    globalThis.fetch = real as unknown as typeof fetch;
    const undo = installOfflineFetch();
    expect((await fetch(`${OFFLINE_HOST}whisper/x/added_tokens.json`)).status).toBe(404);
    expect(real).not.toHaveBeenCalled();
    expect(await (await fetch('https://app.test/ort/a.wasm')).text()).toBe('ok');
    undo();
    expect(globalThis.fetch).toBe(real);
    globalThis.fetch = prev;
  });
});

describe('createWhisperHandlers', () => {
  it('init configures env for the in-memory cache', async () => {
    const { tf } = fakeTf(['x']);
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    expect(tf.env).toMatchObject({
      allowLocalModels: false, allowRemoteModels: true, remoteHost: OFFLINE_HOST, remotePathTemplate: '{model}/',
      useBrowserCache: false, useCustomCache: true,
    });
    expect(tf.env.backends.onnx.wasm).toEqual({ wasmPaths: '/ort/', numThreads: 1 });
    await h.dispose();
  });

  it('load requires init, builds the model with device and dtype, warms up and reports progress', async () => {
    const { tf, log } = fakeTf(['']);
    const h = createWhisperHandlers(tf);
    await expect(h.load({ ...loadArgs, files: files() }, () => undefined)).rejects.toMatchObject({ code: 'not-ready' });
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    const seen: number[] = [];
    await h.load({ ...loadArgs, files: files() }, (p) => seen.push(p.loaded));
    expect(log.calls).toContain('tok:whisper/whisper-base-q8');
    expect(log.calls).toContain('model:whisper/whisper-base-q8:{"device":"wasm","dtype":{"encoder_model":"q8"}}');
    expect(log.generate).toHaveLength(1); // warm-up
    expect(seen.at(-1)).toBe(4);
    // the cache is cleared after loading
    expect(await (tf.env.customCache as MemCache).match(`${OFFLINE_HOST}whisper/whisper-base-q8/config.json`)).toBeUndefined();
    await h.dispose();
  });

  it('exposes the files to the cache while loading', async () => {
    const { tf } = fakeTf(['']);
    let during: Response | undefined;
    const orig = tf.AutoTokenizer.from_pretrained;
    tf.AutoTokenizer.from_pretrained = async (id, o) => {
      during = await (tf.env.customCache as MemCache).match(`${OFFLINE_HOST}${id}/config.json`);
      return orig(id, o);
    };
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await h.load({ ...loadArgs, files: files() }, () => undefined);
    expect(during?.status).toBe(200);
    await h.dispose();
  });

  it('transcribe prompts with the bias, decodes only generated tokens and cleans the text', async () => {
    const { tf, tok, log } = fakeTf(['', 'for God so loved the world']);
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await h.load({ ...loadArgs, files: files() }, () => undefined);
    log.generate.length = 0;
    const r = await h.transcribe({ pcm: new Float32Array(16000 * 3), language: 'en-US', prompt: 'Nicodemus, begotten' }, live());
    expect(r.text).toBe('for God so loved the world');
    const g = log.generate[0];
    expect(g.inputs).toBe('feat');
    const prefix = g.decoder_input_ids as number[];
    expect(prefix[0]).toBe(1);
    expect(prefix.slice(-4)).toEqual([2, 3, 5, 6]);
    expect(tok.decode(prefix.slice(1, -4))).toBe('Nicodemus, begotten');
    expect(g.max_new_tokens).toBe(Math.min(224 - prefix.length, 3 * 6 + 8));
    await h.dispose();
  });

  it('drops a transcript that merely echoes the prompt', async () => {
    const { tf } = fakeTf(['', 'Nicodemus, begotten']);
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await h.load({ ...loadArgs, files: files() }, () => undefined);
    const r = await h.transcribe({ pcm: new Float32Array(16000 * 3), language: 'en', prompt: 'Nicodemus, begotten' }, live());
    expect(r.text).toBe('');
    await h.dispose();
  });

  it('splits long audio into chunks, carries the previous tail as prompt and joins texts', async () => {
    const { tf, log } = fakeTf(['', 'first part', 'second part']);
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await h.load({ ...loadArgs, files: files() }, () => undefined);
    log.generate.length = 0;
    const r = await h.transcribe({ pcm: new Float32Array(16000 * 40).fill(0.1), language: 'en', prompt: '' }, live());
    expect(log.generate).toHaveLength(2);
    expect(r.text).toBe('first part second part');
    expect((log.generate[0].decoder_input_ids as number[])[0]).toBe(2); // no prompt on chunk 1
    expect((log.generate[1].decoder_input_ids as number[])[0]).toBe(1); // previous tail on chunk 2
    await h.dispose();
  });

  it('stops between chunks when aborted and refuses to run without a model', async () => {
    const { tf } = fakeTf(['', 'a']);
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await expect(h.transcribe({ pcm: new Float32Array(10), language: 'en', prompt: '' }, live())).rejects.toMatchObject({ code: 'not-ready' });
    await h.load({ ...loadArgs, files: files() }, () => undefined);
    const ac = new AbortController();
    ac.abort();
    await expect(h.transcribe({ pcm: new Float32Array(16000), language: 'en', prompt: '' }, ac.signal)).rejects.toMatchObject({ code: 'aborted' });
    await h.dispose();
  });

  it('a failing load disposes and clears', async () => {
    const { tf } = fakeTf(['']);
    tf.WhisperForConditionalGeneration.from_pretrained = async () => { throw new Error('no webgpu'); };
    const h = createWhisperHandlers(tf);
    await h.init({ ortBase: '/ort/', numThreads: 1 });
    await expect(h.load({ ...loadArgs, files: files() }, () => undefined)).rejects.toThrow('no webgpu');
    await expect(h.transcribe({ pcm: new Float32Array(10), language: 'en', prompt: '' }, live())).rejects.toMatchObject({ code: 'not-ready' });
    await h.dispose();
  });
});

describe('serveWhisper', () => {
  const setup = () => {
    const out: WhisperReply[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const handlers = {
      init: vi.fn(async () => undefined),
      load: vi.fn(async (_o: unknown, progress: (p: { phase: 'load'; loaded: number }) => void) => { progress({ phase: 'load', loaded: 1 }); }),
      transcribe: vi.fn(async (o: { language: string }, signal: AbortSignal) => {
        if (o.language === 'slow') await gate;
        if (o.language === 'boom') throw new Error('kaput');
        if (signal.aborted) throw Object.assign(new Error('x'), { code: 'aborted' });
        return { text: 'hi', decodeMs: 1 };
      }),
      dispose: vi.fn(async () => undefined),
    };
    const handle = serveWhisper((r) => out.push(r), handlers as never);
    const tr = (id: number, language = 'en'): WhisperRequest => ({ id, op: 'transcribe', pcm: new Float32Array(1), language, prompt: '' });
    return { out, handle, handlers, tr, release };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('replies progress then ok, and maps errors', async () => {
    const { out, handle, tr } = setup();
    handle({ id: 1, op: 'load', modelId: 'm', device: 'wasm', dtype: {}, files: {} });
    handle(tr(2, 'boom'));
    await tick();
    expect(out).toEqual([
      { id: 1, kind: 'progress', p: { phase: 'load', loaded: 1 } },
      { id: 1, kind: 'ok', value: undefined },
      { id: 2, kind: 'error', error: { code: 'engine', message: 'kaput' } },
    ]);
  });

  it('runs requests serially and skips a cancelled queued one', async () => {
    const { out, handle, handlers, tr, release } = setup();
    handle(tr(1, 'slow'));
    handle(tr(2));
    handle({ id: 3, op: 'cancel', target: 2 });
    await tick();
    expect(handlers.transcribe).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(out.map((r) => [r.id, r.kind])).toEqual([[1, 'ok'], [2, 'error']]);
    expect(out[1]).toMatchObject({ error: { code: 'aborted' } });
    expect(handlers.transcribe).toHaveBeenCalledTimes(1);
  });
});
