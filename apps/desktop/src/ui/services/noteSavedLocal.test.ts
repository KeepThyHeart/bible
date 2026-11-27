import { describe, it, expect, vi } from 'vitest';
import { announceLocalNoteSaved, onLocalNoteSaved } from './noteSavedLocal';

describe('noteSavedLocal', () => {
  it('fires after the announcer\'s continuation, not synchronously', async () => {
    const cb = vi.fn();
    const off = onLocalNoteSaved(cb);
    const order: string[] = [];
    cb.mockImplementation(() => order.push('listener'));
    announceLocalNoteSaved({ path: 'a.bn', updated: 'U1', origin: 'x' });
    await Promise.resolve(); // the saver's continuation (microtask) runs first
    order.push('saver stored updated');
    expect(cb).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['saver stored updated', 'listener']);
    expect(cb).toHaveBeenCalledWith({ path: 'a.bn', updated: 'U1', origin: 'x' });
    off();
  });

  it('listeners can skip their own origin; unsubscribe stops delivery', async () => {
    const seen: Array<string | undefined> = [];
    const off = onLocalNoteSaved((e) => { if (e.origin !== 'me') seen.push(e.origin); });
    announceLocalNoteSaved({ path: 'a', updated: '1', origin: 'me' });
    announceLocalNoteSaved({ path: 'a', updated: '2', origin: 'other' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['other']);
    off();
    announceLocalNoteSaved({ path: 'a', updated: '3', origin: 'z' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['other']);
  });

  it('a throwing listener does not block the others', async () => {
    const ok = vi.fn();
    const off1 = onLocalNoteSaved(() => { throw new Error('boom'); });
    const off2 = onLocalNoteSaved(ok);
    announceLocalNoteSaved({ path: 'a', updated: '1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ok).toHaveBeenCalled();
    off1(); off2();
  });
});
