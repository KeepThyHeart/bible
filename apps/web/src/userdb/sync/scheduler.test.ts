// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createWorkerScheduler } from './scheduler';
import { deviceNameFromUserAgent } from './syncHost';

function manualTimers() {
  let next = 0;
  const q = new Map<number, { fn: () => void; ms: number }>();
  return {
    q,
    setTimeout(fn: () => void, ms: number) { q.set(++next, { fn, ms }); return next; },
    clearTimeout(h: unknown) { q.delete(h as number); },
    fire(ms: number) {
      for (const [id, t] of [...q]) if (t.ms === ms) { q.delete(id); t.fn(); }
    },
  };
}

describe('worker scheduler', () => {
  it('every(ms) re-arms after each tick and stops cleanly', () => {
    const timers = manualTimers();
    const s = createWorkerScheduler({ timers, online: null });
    let n = 0;
    const stop = s.every(1000, () => { n++; });
    timers.fire(1000);
    timers.fire(1000);
    expect(n).toBe(2);
    expect(timers.q.size).toBe(1);
    stop();
    expect(timers.q.size).toBe(0);
    timers.fire(1000);
    expect(n).toBe(2);
  });

  it('a throwing tick keeps the timer alive', () => {
    const timers = manualTimers();
    const stop = createWorkerScheduler({ timers, online: null }).every(5, () => { throw new Error('x'); });
    timers.fire(5);
    expect(timers.q.size).toBe(1);
    stop();
  });

  it('onOnline listens for the online event and unsubscribes', () => {
    const target = new EventTarget();
    const s = createWorkerScheduler({ online: target });
    let n = 0;
    const off = s.onOnline(() => { n++; });
    target.dispatchEvent(new Event('online'));
    off();
    target.dispatchEvent(new Event('online'));
    expect(n).toBe(1);
    expect(() => createWorkerScheduler({ online: null }).onOnline(() => undefined)()).not.toThrow();
  });
});

describe('device name', () => {
  it('names browser and OS without versions', () => {
    expect(deviceNameFromUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('Firefox on Linux');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'))
      .toBe('Edge on Windows');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iOS');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'))
      .toBe('Chrome on macOS');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceNameFromUserAgent(undefined)).toBe('Browser');
  });
});
