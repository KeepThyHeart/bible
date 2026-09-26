/**
 * The extension UI kit and the `?theme=` selector on the reserved `ext-ui://host/` origin.
 *
 * `hostKit.ts` gets the kit from the `virtual:kth-kit` module, which `scripts/kthKitPlugin.mjs` builds in memory
 * with esbuild when this file is loaded: no prebuilt `packages/ui/dist-kit` is needed (or read).
 * Serving rules under test: exact-path allowlist, per-resource content type, nosniff, the panel CSP, and the
 * fail-closed answers for near-miss paths. The CSP itself is pinned by `ExtUiCsp.test.ts` and is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createExtUiHandler, buildExtensionPanelCsp, EXT_UI_HOST_HOSTNAME, EXT_UI_SCHEME } from '../extUiProtocol';
import {
  buildHostThemeCss,
  getActiveHostTheme,
  getActiveHostThemeCss,
  resetActiveHostThemeForTests,
  setActiveHostTheme,
} from '../hostThemeCss';
import { HOST_KIT_MAJOR } from '../hostKit';
import { UI_KIT_VERSIONS } from '@bible/core/browser';
import type { ExtensionHost } from '../ExtensionHost';

function emptyHost(): ExtensionHost {
  return { getExtension: async () => undefined } as unknown as ExtensionHost;
}

const at = (path: string) => new Request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/${path}`);

describe('ext-ui://host/kit/1/', () => {
  const handle = createExtUiHandler(emptyHost());

  it('serves a major the core allowlist knows', () => {
    expect(UI_KIT_VERSIONS).toContain(HOST_KIT_MAJOR);
    expect(HOST_KIT_MAJOR).toBe('1');
  });

  it('serves kth-kit.js as JavaScript with the panel headers', async () => {
    const res = await handle(at('kit/1/kth-kit.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBe(buildExtensionPanelCsp());
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const body = await res.text();
    expect(body).toContain('KthKit');
    expect(body).toContain('customElements');
    // Nothing of the host may be baked into a script every panel loads.
    for (const banned of ['window.electron', 'ipcRenderer', '__BIBLE_']) expect(body).not.toContain(banned);
  });

  it('serves kth.css as CSS, flat and built on the host tokens', async () => {
    const res = await handle(at('kit/1/kth.css'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Security-Policy')).toBe(buildExtensionPanelCsp());
    const css = await res.text();
    expect(css).toContain('.kth-btn');
    expect(css).toContain('var(--theme-');
    expect(css).not.toContain('@import');
  });

  it('ignores a query string on the kit files', async () => {
    expect((await handle(at('kit/1/kth-kit.js?v=1'))).status).toBe(200);
    expect((await handle(at('kit/1/kth.css?theme=dark'))).status).toBe(200);
  });

  it('is served even with no extensions installed, and never asks the registry', async () => {
    let lookups = 0;
    const shadowing = {
      getExtension: async (id: string) => {
        lookups++;
        return { installPath: `/tmp/${id}` };
      },
    } as unknown as ExtensionHost;
    const h = createExtUiHandler(shadowing);
    expect((await h(at('kit/1/kth-kit.js'))).status).toBe(200);
    expect((await h(at('kit/1/kth.css'))).status).toBe(200);
    expect(lookups).toBe(0);
  });

  // Exact-path allowlist: every near miss is a 404 (no prefix, case, version or extension matching).
  it.each([
    'kit',
    'kit/',
    'kit/1',
    'kit/1/',
    'kit/2/kth-kit.js',
    'kit/01/kth-kit.js',
    'kit//1/kth-kit.js',
    'kit/1/kth-kit.js/',
    'kit/1/kth-kit.js.map',
    'kit/1/kth-kit.mjs',
    'kit/1/KTH-KIT.JS',
    'Kit/1/kth-kit.js',
    'kit/1/kth.css.map',
    'kit/1/theme.css',
    'kit/1/..%2f..%2fetc%2fpasswd',
    'kit/1/kth-kit.js%00',
    'kit/1/kth-kit.js%20',
    'kth-kit.js',
    'theme.css/kit/1/kth-kit.js',
  ])('answers 404 for %s', async (path) => {
    expect((await handle(at(path))).status).toBe(404);
  });

  it('answers 400 (not a rejection) for a malformed percent escape', async () => {
    const onHost = await handle(at('kit/1/%E0%A4%A'));
    expect(onHost.status).toBe(400);
    const onExtension = await handle(new Request(`${EXT_UI_SCHEME}://ext.a.b/%E0%A4%A`));
    expect(onExtension.status).toBe(400);
  });
});

describe('ext-ui://host/theme.css?theme=<id>', () => {
  const handle = createExtUiHandler(emptyHost());

  beforeEach(() => resetActiveHostThemeForTests());
  afterEach(() => resetActiveHostThemeForTests());

  it('serves the named theme when it is a known id, whatever the active theme is', async () => {
    setActiveHostTheme('light');
    const res = await handle(at('theme.css?theme=midnight'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(await res.text()).toBe(buildHostThemeCss('midnight'));
  });

  it('falls back to the active theme for an unknown, empty or missing id', async () => {
    setActiveHostTheme('light');
    const active = getActiveHostThemeCss();
    for (const path of ['theme.css?theme=bogus', 'theme.css?theme=', 'theme.css', 'theme.css?theme=constructor', 'theme.css?other=midnight']) {
      expect(await (await handle(at(path))).text(), path).toBe(active);
    }
  });

  it('never changes the active theme', async () => {
    setActiveHostTheme('light');
    await handle(at('theme.css?theme=midnight'));
    await handle(at('theme.css?theme=bogus'));
    expect(getActiveHostTheme()).toBe('light');
  });
});
