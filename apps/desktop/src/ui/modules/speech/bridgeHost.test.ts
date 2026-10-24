import { describe, it, expect, vi, beforeEach } from 'vitest';
import { answer, installBridgeHost, getSpeechService, resetSpeechServiceForTests, speechPrefs } from './bridgeHost';

beforeEach(() => {
  resetSpeechServiceForTests();
  window.localStorage.clear();
});

describe('answer', () => {
  it('calls the named method with the args and wraps the value', async () => {
    const speak = vi.fn().mockResolvedValue({ completed: true });
    const r = await answer({ callId: 1, method: 'speak', args: [{ text: 'x' }] }, async () => ({ speak }) as never);
    expect(r).toEqual({ ok: true, value: { completed: true } });
    expect(speak).toHaveBeenCalledWith({ text: 'x' });
  });

  it('turns a throw into an error result', async () => {
    const r = await answer({ callId: 2, method: 'status', args: [] }, async () => ({ status: () => Promise.reject(new Error('busy')) }) as never);
    expect(r).toEqual({ ok: false, error: 'busy' });
  });

  it('reports an unknown method, and a service that fails to load', async () => {
    expect(await answer({ callId: 3, method: 'nope' as never, args: [] }, async () => ({}) as never)).toMatchObject({ ok: false });
    const r = await answer({ callId: 4, method: 'status', args: [] }, () => Promise.reject(new Error('no engine')));
    expect(r).toEqual({ ok: false, error: 'no engine' });
  });
});

describe('installBridgeHost', () => {
  it('announces ready, replies to calls and unsubscribes', async () => {
    let cb: ((c: unknown) => void) | undefined;
    const off = vi.fn();
    const events = { on: vi.fn((_ns: string, _e: string, f: (c: unknown) => void) => ((cb = f), off)) };
    const client = { reply: vi.fn().mockResolvedValue(undefined), ready: vi.fn().mockResolvedValue(undefined) };
    const getService = vi.fn(async () => ({ status: async () => ({ listen: 'ready' }) }) as never);
    const dispose = installBridgeHost(client, events, getService);
    expect(events.on).toHaveBeenCalledWith('speech', 'call', expect.any(Function));
    expect(client.ready).toHaveBeenCalled();
    expect(getService).not.toHaveBeenCalled(); // engine stays unloaded until a call arrives
    cb!({ callId: 7, method: 'status', args: [] });
    await vi.waitFor(() => expect(client.reply).toHaveBeenCalledWith(7, { ok: true, value: { listen: 'ready' } }));
    dispose();
    expect(off).toHaveBeenCalled();
  });
});

describe('getSpeechService', () => {
  it('imports the engine lazily, once, with the desktop file source and prefs', async () => {
    const service = { id: 'svc' };
    const createSpeechService = vi.fn(() => service);
    const loadEngine = vi.fn(async () => ({ createSpeechService }) as never);
    const a = await getSpeechService({ loadEngine });
    const b = await getSpeechService({ loadEngine });
    expect(a).toBe(service);
    expect(b).toBe(service);
    expect(loadEngine).toHaveBeenCalledTimes(1);
    const arg = (createSpeechService.mock.calls[0] as unknown[])[0] as { files: unknown; ortBase: string; prefs: unknown };
    expect(arg.ortBase).toMatch(/\/ort\/$/);
    expect(arg.prefs).toBe(speechPrefs);
  });

  it('allows a retry after a failed import', async () => {
    await expect(getSpeechService({ loadEngine: () => Promise.reject(new Error('x')) })).rejects.toThrow('x');
    const svc = await getSpeechService({ loadEngine: async () => ({ createSpeechService: () => ({ ok: 1 }) }) as never });
    expect(svc).toEqual({ ok: 1 });
  });
});

describe('speechPrefs', () => {
  it('defaults to auto, round-trips and ignores junk', () => {
    expect(speechPrefs.get()).toEqual({ model: 'auto', device: 'auto' });
    speechPrefs.set({ model: 'tiny', device: 'wasm' });
    expect(speechPrefs.get()).toEqual({ model: 'tiny', device: 'wasm' });
    window.localStorage.setItem('kth.speech.prefs', '{"model":"huge"');
    expect(speechPrefs.get()).toEqual({ model: 'auto', device: 'auto' });
  });
});
