// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preservedOnReset } from '../sw/cacheRules';
import { CACHE_RULES } from '../sw/rules/index';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const start = html.indexOf('(function detectBootLoop()');
const src = html.slice(start, html.indexOf('</script>', start));

/** Run the inline detector against fakes; `mount()` simulates the app rendering. */
function boot(store: Map<string, string>) {
  const deleted: string[] = [];
  const observers: Array<() => void> = [];
  const app: { firstChild: object | null } = { firstChild: null };
  const win: Record<string, unknown> = {
    caches: {
      keys: async () => ['workbox-precache-v2', 'embedding-model-v1', 'audio-chapters-v1', 'tts-models-v1'],
      delete: async (n: string) => { deleted.push(n); return true; },
    },
    MutationObserver: class { constructor(cb: () => void) { observers.push(cb); } observe() {} disconnect() {} },
  };
  const errors: string[] = [];
  const fn = new Function('window', 'document', 'sessionStorage', 'navigator', 'showAppError', 'caches', 'MutationObserver',
    src.replace(/^\(function/, 'return (function') + '');
  fn(win, { getElementById: () => app }, {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  }, { serviceWorker: undefined }, (m: string) => errors.push(m), win.caches, win.MutationObserver);
  return {
    tripped: win.__bibleBootLoopTripped === true,
    deleted, errors,
    mount() { app.firstChild = {}; observers.forEach(cb => cb()); },
  };
}

describe('boot-loop detector (W-062)', () => {
  it('does not trip when a human reloads a working page many times', async () => {
    const store = new Map<string, string>();
    for (let i = 0; i < 8; i++) {
      const b = boot(store);
      expect(b.tripped).toBe(false);
      b.mount(); // the app rendered, so this boot was a success
    }
  });

  it('still trips on a crash loop that never renders', () => {
    const store = new Map<string, string>();
    let tripped = false;
    for (let i = 0; i < 6; i++) tripped = boot(store).tripped;
    expect(tripped).toBe(true);
  });

  it('keeps every keepOnReset cache when it self-heals', async () => {
    const m = /var PRESERVE = (\[[^\]]*\])/.exec(src)!;
    const preserve: string[] = JSON.parse(m[1].replace(/'/g, '"'));
    for (const name of preservedOnReset(CACHE_RULES)) expect(preserve).toContain(name);

    const store = new Map<string, string>();
    let last = boot(store);
    for (let i = 0; i < 5; i++) last = boot(store);
    await new Promise(r => setTimeout(r, 0));
    expect(last.tripped).toBe(true);
    expect(last.deleted).toEqual(['workbox-precache-v2']);
  });
});
