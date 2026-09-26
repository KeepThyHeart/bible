// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadKit, HOST_KIT_JS, type KthKitGlobal, type KitRpc } from './kit';

const rpc: KitRpc = { getLocale: () => Promise.resolve({ locale: 'en', direction: 'ltr' }) };

function fakeKit(version = '1', init = vi.fn(() => Promise.resolve())): KthKitGlobal {
  return { version, tags: ['kth-reference-picker'], init };
}
const scripts = (): HTMLScriptElement[] =>
  Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.getAttribute('src') === HOST_KIT_JS);

afterEach(() => {
  vi.useRealTimers();
  delete window.KthKit;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('loadKit', () => {
  it('with KthKit already present adds no script and calls init({rpc, components})', async () => {
    const init = vi.fn(() => Promise.resolve());
    const kit = fakeKit('1', init);
    window.KthKit = kit;
    const h = loadKit(rpc, { components: ['kth-reference-picker'] });
    await expect(h.ready).resolves.toBe(kit);
    expect(scripts()).toHaveLength(0);
    expect(init).toHaveBeenCalledWith({ rpc, components: ['kth-reference-picker'] });
    expect(h.version).toBe('1');
  });

  it('adds one classic script, and reuses an existing one', async () => {
    const h1 = loadKit(rpc);
    const h2 = loadKit(rpc);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(false);
    expect(scripts()[0].type).toBe('');
    h1.dispose();
    h2.dispose();
  });

  it('resolves after load once KthKit exists', async () => {
    const h = loadKit(rpc);
    const kit = fakeKit();
    window.KthKit = kit;
    scripts()[0].dispatchEvent(new Event('load'));
    await expect(h.ready).resolves.toBe(kit);
    expect(kit.init).toHaveBeenCalledTimes(1);
  });

  it('rejects on script error', async () => {
    const h = loadKit(rpc);
    scripts()[0].dispatchEvent(new Event('error'));
    await expect(h.ready).rejects.toThrow(/Failed to load/);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const h = loadKit(rpc, { timeoutMs: 500 });
    const assertion = expect(h.ready).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('rejects an incompatible major version', async () => {
    window.KthKit = fakeKit('2');
    await expect(loadKit(rpc).ready).rejects.toThrow(/not available/);
  });

  it('rejects when load fires but KthKit is missing', async () => {
    const h = loadKit(rpc);
    scripts()[0].dispatchEvent(new Event('load'));
    await expect(h.ready).rejects.toThrow(/not available/);
  });

  it('propagates an init rejection', async () => {
    window.KthKit = fakeKit('1', vi.fn(() => Promise.reject(new Error('boom'))));
    await expect(loadKit(rpc).ready).rejects.toThrow('boom');
  });

  it('after dispose a later load settles nothing', async () => {
    const h = loadKit(rpc);
    const kit = fakeKit();
    h.dispose();
    window.KthKit = kit;
    scripts()[0].dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(kit.init).not.toHaveBeenCalled();
    const settled = vi.fn();
    void h.ready.then(settled, settled);
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).not.toHaveBeenCalled();
  });
});
