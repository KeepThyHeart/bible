import { describe, it, expect, vi, afterEach } from 'vitest';
import { RendererSpeechBridge } from './bridge';
import type { SpeechBridgeCall } from './types';

afterEach(() => vi.useRealTimers());

function make(extra: Partial<ConstructorParameters<typeof RendererSpeechBridge>[0]> = {}) {
  const calls: SpeechBridgeCall[] = [];
  const bridge = new RendererSpeechBridge({ send: (c) => void calls.push(c), ...extra });
  return { bridge, calls };
}

describe('RendererSpeechBridge', () => {
  it('reports unavailable when the renderer never says ready', async () => {
    vi.useFakeTimers();
    const { bridge, calls } = make({ readyWaitMs: 1000 });
    const p = bridge.status();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).listen).toBe('unavailable');
    expect(calls).toHaveLength(0);
    const q = bridge.speak('hi');
    const assertion = expect(q).rejects.toThrow(/not available/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('waits for ready, forwards the call and resolves on reply', async () => {
    const { bridge, calls } = make();
    const p = bridge.speak('hello', { language: 'en-US' });
    bridge.markReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ callId: 1, method: 'speak', args: ['hello', { language: 'en-US' }] }]);
    bridge.reply(1, { ok: true, value: { completed: true } });
    expect(await p).toEqual({ completed: true });
  });

  it('turns an error reply into a rejection and ignores unknown ids', async () => {
    const { bridge, calls } = make();
    bridge.markReady();
    const p = bridge.earcon('ok');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    bridge.reply(99, { ok: true, value: 1 });
    bridge.reply(1, { ok: false, error: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('times out per call', async () => {
    vi.useFakeTimers();
    const { bridge } = make({ timeouts: { speak: 500 } });
    bridge.markReady();
    const p = bridge.speak('x');
    const a = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(500);
    await a;
  });

  it('nextUtterance waits noSpeechTimeoutMs plus 60 s', async () => {
    vi.useFakeTimers();
    const { bridge } = make();
    bridge.markReady();
    let settled = false;
    const p = bridge.nextUtterance('l1', { noSpeechTimeoutMs: 5000 }).catch(() => (settled = true));
    await vi.advanceTimersByTimeAsync(64_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(settled).toBe(true);
  });

  it('rejects pending calls when the window goes away or the renderer reloads', async () => {
    const { bridge, calls } = make();
    bridge.markReady();
    const p = bridge.speak('x');
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    bridge.windowGone();
    await expect(p).rejects.toThrow(/not available/);
    bridge.markReady();
    const q = bridge.speak('y');
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    bridge.markReady(); // renderer reloaded
    await expect(q).rejects.toThrow(/restarted/);
  });

  it('rejects when send throws (no window)', async () => {
    const bridge = new RendererSpeechBridge({ send: () => { throw new Error('No window.'); } });
    bridge.markReady();
    await expect(bridge.speak('x')).rejects.toThrow('No window.');
  });

  it('asks for the microphone once, before the first listen', async () => {
    const ask = vi.fn(async () => false);
    const { bridge, calls } = make({ askMicrophone: ask });
    bridge.markReady();
    const dto = { language: 'en', maxDurationMs: 1000 };
    const a = bridge.startListening(dto);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    bridge.reply(1, { ok: true, value: { listenId: 'a' } });
    await a;
    const b = bridge.startListening(dto);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    bridge.reply(2, { ok: true, value: { listenId: 'b' } });
    await b;
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('stopListening and cancel are no-ops without a renderer', async () => {
    const { bridge, calls } = make();
    await bridge.stopListening('x');
    await bridge.cancel();
    expect(calls).toHaveLength(0);
  });
});
