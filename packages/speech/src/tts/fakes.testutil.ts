/** Test fakes for speechSynthesis and AudioContext. */
export class FakeNode {
  onended: (() => void) | null = null;
  frequency = { value: 0 };
  gain = { value: 0 };
  type = '';
  buffer: unknown = null;
  started = false;
  stopped = false;
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
    queueMicrotask(() => this.onended?.());
  }
  stop() {
    this.stopped = true;
  }
}

export class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  nodes: FakeNode[] = [];
  sources: FakeNode[] = [];
  createGain() { return new FakeNode(); }
  createOscillator() { const n = new FakeNode(); this.nodes.push(n); return n; }
  createBuffer(_c: number, length: number, sampleRate: number) {
    return { length, sampleRate, copyToChannel() {} };
  }
  createBufferSource() { const n = new FakeNode(); this.sources.push(n); return n; }
  async resume() { this.state = 'running'; }
}

export class FakeUtterance {
  voice: unknown; lang = ''; rate = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

export class FakeSynth {
  spoken: FakeUtterance[] = [];
  cancelled = 0;
  mode: 'ok' | 'error' | 'hang' = 'ok';
  listeners: Array<() => void> = [];
  constructor(public voices: unknown[]) {}
  getVoices() { return this.voices as SpeechSynthesisVoice[]; }
  addEventListener(_: string, cb: () => void) { this.listeners.push(cb); }
  removeEventListener(_: string, cb: () => void) { this.listeners = this.listeners.filter((l) => l !== cb); }
  speak(u: FakeUtterance) {
    this.spoken.push(u);
    if (this.mode === 'ok') queueMicrotask(() => u.onend?.());
    if (this.mode === 'error') queueMicrotask(() => u.onerror?.({ error: 'synthesis-failed' }));
  }
  cancel() {
    this.cancelled++;
    const u = this.spoken[this.spoken.length - 1];
    if (u && this.mode === 'hang') queueMicrotask(() => u.onerror?.({ error: 'canceled' }));
  }
}
