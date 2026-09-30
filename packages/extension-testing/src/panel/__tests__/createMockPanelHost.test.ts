// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
// Relative import on purpose: exercises the real panel SDK source without a package dependency.
import { BibleExtUI } from '../../../../extension-ui/src/BibleExtUI';
import { createMockPanelHost, type MockPanelHost } from '../createMockPanelHost';

let host: MockPanelHost | undefined;
let bible: BibleExtUI | undefined;

afterEach(() => {
  bible?.dispose();
  host?.dispose();
  bible = undefined;
  host = undefined;
});

describe('createMockPanelHost', () => {
  it('answers ui.getLocale with the mocked value (direction derived from the locale)', async () => {
    host = createMockPanelHost({ locale: 'ar' });
    bible = BibleExtUI.init();
    await expect(bible.getLocale()).resolves.toEqual({ locale: 'ar', direction: 'rtl' });
    expect(host.requests).toEqual([{ method: 'ui.getLocale', args: [] }]);
  });

  it('honours an explicit direction and setLocale', async () => {
    host = createMockPanelHost({ locale: 'en', direction: 'rtl' });
    bible = BibleExtUI.init();
    await expect(bible.getLocale()).resolves.toEqual({ locale: 'en', direction: 'rtl' });
    host.setLocale('es');
    await expect(bible.getLocale()).resolves.toEqual({ locale: 'es', direction: 'ltr' });
  });

  it('answers ui.getTheme and setTheme reaches onThemeChanged', async () => {
    host = createMockPanelHost({ theme: 'sepia' });
    bible = BibleExtUI.init();
    await expect(bible.getTheme()).resolves.toEqual({ mode: 'sepia' });
    const cb = vi.fn();
    bible.onThemeChanged(cb);
    host.setTheme('dark');
    expect(cb).toHaveBeenCalledWith({ mode: 'dark' });
    await expect(bible.getTheme()).resolves.toEqual({ mode: 'dark' });
  });

  it('emit delivers arbitrary host events', () => {
    host = createMockPanelHost();
    bible = BibleExtUI.init();
    const cb = vi.fn();
    bible.onActiveVerseChanged(cb);
    host.emit('verse.activeChanged', { verseId: 43003016 });
    expect(cb).toHaveBeenCalledWith({ verseId: 43003016, source: 'host' });
  });

  it('rejects unknown methods with the real bridge text', async () => {
    host = createMockPanelHost();
    bible = BibleExtUI.init();
    await expect(bible.postToWorker({ type: 'x' })).rejects.toThrow('Unknown iframe bridge method: panel.invoke');
  });

  it('denies uikit.* methods', async () => {
    host = createMockPanelHost();
    bible = BibleExtUI.init();
    await expect(
      (bible as unknown as { rpc: { request(m: string, a: unknown[]): Promise<unknown> } }).rpc.request('uikit.anything', []),
    ).rejects.toMatchObject({ name: 'PermissionDeniedError' });
  });

  it('handlers add or override bridge methods; a throwing handler rejects', async () => {
    host = createMockPanelHost({
      handlers: {
        'panel.invoke': (args) => ({ echoed: args[0] }),
        'network.fetch': () => {
          throw new Error('offline');
        },
      },
    });
    bible = BibleExtUI.init();
    await expect(bible.postToWorker({ a: 1 })).resolves.toEqual({ echoed: { a: 1 } });
    await expect(bible.fetch('https://example.com')).rejects.toThrow('offline');
  });

  it('dispose restores globalThis.parent', () => {
    const before = (globalThis as { parent: unknown }).parent;
    host = createMockPanelHost();
    expect((globalThis as { parent: unknown }).parent).not.toBe(before);
    host.dispose();
    expect((globalThis as { parent: unknown }).parent).toBe(before);
  });
});
