import { LocalSpeechPrefs, SPEECH_PREFS_KEY } from './prefs';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('LocalSpeechPrefs', () => {
  it('defaults, persists and sanitizes', () => {
    const s = mem();
    const p = new LocalSpeechPrefs(() => s);
    expect(p.get()).toEqual({ model: 'auto', device: 'auto' });
    p.set({ model: 'tiny', device: 'wasm' });
    expect(new LocalSpeechPrefs(() => s).get()).toEqual({ model: 'tiny', device: 'wasm' });
    s.m.set(SPEECH_PREFS_KEY, '{"model":"huge","device":1}');
    expect(p.get()).toEqual({ model: 'auto', device: 'auto' });
    s.m.set(SPEECH_PREFS_KEY, 'not json');
    expect(p.get()).toEqual({ model: 'auto', device: 'auto' });
  });

  it('falls back to memory when storage throws or is missing', () => {
    const bad = () => {
      throw new Error('denied');
    };
    const p = new LocalSpeechPrefs(bad);
    p.set({ model: 'base', device: 'auto' });
    expect(p.get().model).toBe('base');
    const q = new LocalSpeechPrefs(() => undefined);
    q.set({ model: 'tiny', device: 'auto' });
    expect(q.get().model).toBe('tiny');
  });
});
