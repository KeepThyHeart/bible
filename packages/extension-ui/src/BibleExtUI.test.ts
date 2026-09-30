// @vitest-environment jsdom
/**
 * `BibleExtUI.onActiveVerseChanged` / `showVersePopup` / `hideVersePopup`
 * (P1.11: the panel iframe SDK).
 *
 * Mirrors the fake postMessage harness in `RpcClient.test.ts` - `BibleExtUI`
 * is a thin wrapper over the same `RpcClient`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BibleExtUI } from './BibleExtUI';

let capturedMessages: Array<{ data: unknown }> = [];
let messageHandler: ((event: MessageEvent) => void) | undefined;

beforeEach(() => {
  capturedMessages = [];
  (globalThis as unknown as { parent: { postMessage: (data: unknown, origin: string) => void } }).parent = {
    postMessage: (data: unknown) => {
      capturedMessages.push({ data });
    },
  };
  const originalAdd = window.addEventListener;
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, handler: EventListenerOrEventListenerObject) => {
      if (type === 'message' && typeof handler === 'function') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
      originalAdd.call(window, type, handler);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  messageHandler = undefined;
});

function simulateEvent(channel: string, payload: unknown): void {
  messageHandler?.(new MessageEvent('message', { data: { kind: 'event', channel, payload } }));
}

describe('BibleExtUI.onActiveVerseChanged', () => {
  it('calls back with { verseId, source } for a well-formed host payload', () => {
    const bible = BibleExtUI.init();
    const cb = vi.fn();
    bible.onActiveVerseChanged(cb);

    simulateEvent('verse.activeChanged', { verseId: 43003016, source: 'host' });

    expect(cb).toHaveBeenCalledWith({ verseId: 43003016, source: 'host' });
  });

  it('defaults source to "host" when the host omits it', () => {
    const bible = BibleExtUI.init();
    const cb = vi.fn();
    bible.onActiveVerseChanged(cb);

    simulateEvent('verse.activeChanged', { verseId: 1001001 });

    expect(cb).toHaveBeenCalledWith({ verseId: 1001001, source: 'host' });
  });

  it('ignores a malformed payload rather than calling back with garbage', () => {
    const bible = BibleExtUI.init();
    const cb = vi.fn();
    bible.onActiveVerseChanged(cb);

    simulateEvent('verse.activeChanged', 43003016); // the old (pre-fix) bare-number shape
    simulateEvent('verse.activeChanged', null);

    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned Disposable', () => {
    const bible = BibleExtUI.init();
    const cb = vi.fn();
    const sub = bible.onActiveVerseChanged(cb);
    sub.dispose();

    simulateEvent('verse.activeChanged', { verseId: 1, source: 'host' });

    expect(cb).not.toHaveBeenCalled();
  });
});

describe('BibleExtUI verse popups', () => {
  it('showVersePopup sends a ui.showVersePopup request with verseId and rect', () => {
    const bible = BibleExtUI.init();
    bible.showVersePopup(43003016, { x: 10, y: 20, width: 100, height: 16 });

    expect(capturedMessages).toHaveLength(1);
    const sent = capturedMessages[0]!.data as { method: string; args: unknown[] };
    expect(sent.method).toBe('ui.showVersePopup');
    expect(sent.args).toEqual([43003016, { x: 10, y: 20, width: 100, height: 16 }]);
  });

  it('hideVersePopup sends a ui.hideVersePopup request with no args', () => {
    const bible = BibleExtUI.init();
    bible.hideVersePopup();

    expect(capturedMessages).toHaveLength(1);
    const sent = capturedMessages[0]!.data as { method: string; args: unknown[] };
    expect(sent.method).toBe('ui.hideVersePopup');
    expect(sent.args).toEqual([]);
  });
});

describe('BibleExtUI.getLocale', () => {
  it('sends a ui.getLocale request with no args and resolves with the host reply', async () => {
    const bible = BibleExtUI.init();
    const pending = bible.getLocale();

    expect(capturedMessages).toHaveLength(1);
    const sent = capturedMessages[0]!.data as { id: string; method: string; args: unknown[] };
    expect(sent.method).toBe('ui.getLocale');
    expect(sent.args).toEqual([]);

    messageHandler?.(
      new MessageEvent('message', {
        data: { kind: 'response', id: sent.id, result: { locale: 'ar', direction: 'rtl' } },
      }),
    );
    await expect(pending).resolves.toEqual({ locale: 'ar', direction: 'rtl' });
  });
});

describe('BibleExtUI.useHostStyles / loadKit', () => {
  it('useHostStyles re-links the theme sheet when the host sends theme.changed', () => {
    document.head.innerHTML = '';
    const bible = BibleExtUI.init();
    const h = bible.useHostStyles({ kthCss: false });
    simulateEvent('theme.changed', { mode: 'midnight' });
    const hrefs = Array.from(document.querySelectorAll('link')).map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(['ext-ui://host/theme.css', 'ext-ui://host/theme.css?theme=midnight']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    h.dispose();
    document.head.innerHTML = '';
  });

  it('loadKit adds the host kit script', () => {
    const bible = BibleExtUI.init();
    const handle = bible.loadKit();
    expect(document.querySelector('script[src="ext-ui://host/kit/1/kth-kit.js"]')).not.toBeNull();
    handle.dispose();
    document.head.innerHTML = '';
  });
});
