import { WebMicrophone, micErrorCode } from './WebMicrophone';

vi.mock('./workletUrl', () => ({ PCM_WORKLET_URL: '/w.js', PCM_WORKLET_NAME: 'pcm-capture' }));

const g = globalThis as any;
let track: { stop: ReturnType<typeof vi.fn> };
let ctxs: any[];
let nodes: any[];
let gum: ReturnType<typeof vi.fn>;

beforeEach(() => {
  track = { stop: vi.fn() };
  ctxs = [];
  nodes = [];
  gum = vi.fn(async () => ({ getTracks: () => [track] }));
  Object.defineProperty(g, 'navigator', { value: { mediaDevices: { getUserMedia: gum } }, configurable: true, writable: true });
  g.AudioContext = class {
    state = 'suspended';
    audioWorklet = { addModule: vi.fn(async () => {}) };
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    source = { connect: vi.fn(), disconnect: vi.fn() };
    createMediaStreamSource = () => this.source;
    constructor() {
      ctxs.push(this);
    }
  };
  g.AudioWorkletNode = class {
    port: any = { onmessage: null };
    disconnect = vi.fn();
    constructor(public ctx: any, public name: string) {
      nodes.push(this);
    }
  };
});

const opts = { echoCancellation: true, noiseSuppression: false };

describe('WebMicrophone', () => {
  it('opens, delivers frames, and closes', async () => {
    const mic = new WebMicrophone();
    const s = await mic.open(opts, new AbortController().signal);
    expect(gum).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });
    expect(ctxs[0].resume).toHaveBeenCalled();
    expect(ctxs[0].audioWorklet.addModule).toHaveBeenCalledWith('/w.js');
    expect(nodes[0].name).toBe('pcm-capture');
    const got: Float32Array[] = [];
    const off = s.onFrame((f) => got.push(f));
    const frame = new Float32Array(320);
    nodes[0].port.onmessage({ data: frame });
    off();
    nodes[0].port.onmessage({ data: frame });
    expect(got).toEqual([frame]);
    s.close();
    s.close();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(nodes[0].disconnect).toHaveBeenCalled();
  });

  it('shares one context and loads the module once', async () => {
    const mic = new WebMicrophone();
    (await mic.open(opts, new AbortController().signal)).close();
    (await mic.open(opts, new AbortController().signal)).close();
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0].audioWorklet.addModule).toHaveBeenCalledTimes(1);
  });

  it('maps getUserMedia errors', async () => {
    for (const [name, code] of [
      ['NotAllowedError', 'mic-denied'],
      ['SecurityError', 'mic-denied'],
      ['NotReadableError', 'mic-busy'],
      ['OverconstrainedError', 'mic-busy'],
      ['NotFoundError', 'mic-busy'],
    ] as const) {
      gum.mockRejectedValueOnce(Object.assign(new Error('x'), { name }));
      const err = await new WebMicrophone().open(opts, new AbortController().signal).catch((e) => e);
      expect(err.name).toBe(code);
      expect(micErrorCode({ name })).toBe(code);
    }
    gum.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    const err = await new WebMicrophone().open(opts, new AbortController().signal).catch((e) => e);
    expect(err.message).toBe('No microphone found');
  });

  it('releases the mic when abort fires after open', async () => {
    const ac = new AbortController();
    await new WebMicrophone().open(opts, ac.signal);
    ac.abort();
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the tracks when the worklet fails to load', async () => {
    g.AudioContext = class {
      state = 'running';
      audioWorklet = { addModule: async () => Promise.reject(new Error('boom')) };
    };
    const err = await new WebMicrophone().open(opts, new AbortController().signal).catch((e) => e);
    expect(err.name).toBe('mic-busy');
    expect(track.stop).toHaveBeenCalled();
  });
});
