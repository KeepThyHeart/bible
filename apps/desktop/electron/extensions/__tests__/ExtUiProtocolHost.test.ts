/**
 * The reserved `ext-ui://host/` origin, and the design tokens it serves.
 *
 * Background: extension panels render in a sandboxed iframe on
 * `ext-ui://<extensionId>`, an origin that shares nothing with the app's
 * renderer - no stylesheet, no `<html data-theme>`, no custom properties. All
 * a panel used to get was `ui.getTheme`'s two-field `ThemeInfo`, so every panel
 * re-derived the app's visual language from a theme id and a guess and was
 * permanently slightly wrong. `ext-ui://host/theme.css` closes that by serving
 * the app's real `--theme-*` token set for the active theme.
 *
 * Reserving a hostname inside a scheme whose hostname IS the extension id is
 * the security-sensitive part of that, so most of what follows is about the
 * reservation rather than about CSS:
 *
 *   - it must resolve;
 *   - an unknown hostname must still be the dead end it always was;
 *   - nothing under `host/` may become a filesystem path;
 *   - and no extension may ever be able to claim the name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { validateManifest } from '@bible/core/Extensions/ExtensionManifestValidator';

import {
  createExtUiHandler,
  EXT_UI_HOST_HOSTNAME,
  EXT_UI_SCHEME,
} from '../extUiProtocol';
import {
  buildHostThemeCss,
  getActiveHostTheme,
  getActiveHostThemeCss,
  HOST_THEME_IDS,
  resetActiveHostThemeForTests,
  setActiveHostTheme,
  DEFAULT_HOST_THEME_ID,
} from '../hostThemeCss';
import type { ExtensionHost } from '../ExtensionHost';

/**
 * An `ExtensionHost` that has nothing installed.
 *
 * Deliberately empty: every test here is about a request that must NOT reach
 * an install directory, so a registry that can only answer "not installed" is
 * the strongest fixture - if the reserved branch ever stopped short-circuiting,
 * these tests would fail with a 404 rather than quietly passing against a
 * stubbed extension.
 */
function emptyHost(): ExtensionHost {
  return {
    getExtension: async () => undefined,
  } as unknown as ExtensionHost;
}

function request(url: string): Request {
  return new Request(url);
}

describe('ext-ui:// reserved host origin', () => {
  const handle = createExtUiHandler(emptyHost());

  beforeEach(() => resetActiveHostThemeForTests());
  afterEach(() => resetActiveHostThemeForTests());

  it('resolves ext-ui://host/theme.css even with no extensions installed', async () => {
    const res = await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(await res.text()).toContain('--theme-bg-primary');
  });

  it('serves real token names, not a placeholder or an empty block', async () => {
    const res = await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`));
    const css = await res.text();

    // A representative slice across the naming groups themes.css documents:
    // backgrounds, surfaces, text, borders, accent and status.
    for (const token of [
      '--theme-bg-primary:',
      '--theme-surface-primary:',
      '--theme-text-primary:',
      '--theme-border-focus:',
      '--theme-accent-primary:',
      '--theme-danger:',
    ]) {
      expect(css, `token sheet is missing ${token}`).toContain(token);
    }

    // The `*-rgb` triplets must ship too: Tailwind-style alpha modifiers and
    // the app's own `rgb(var(--x) / 0.12)` idiom need the raw triplet, and a
    // panel that only got the resolved colours could not reproduce them.
    expect(css).toMatch(/--theme-bg-primary-rgb:\s*\d+ \d+ \d+;/);
  });

  it('sends the panel CSP, nosniff and no-store', async () => {
    const res = await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`));

    // Same policy an extension-served document gets - a host-served document
    // must not be governed by a weaker one.
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // The body changes when the user switches theme, under the same URL. A
    // cached copy would pin an open panel to the previous palette.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('404s any other path under host/', async () => {
    for (const path of ['', '/', '/index.html', '/theme.css.map', '/tokens/theme.css']) {
      const res = await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}${path}`));
      expect(
        [400, 404],
        `${path || '<empty>'} should not be served`,
      ).toContain(res.status);
    }
  });

  it('refuses a path escape under host/ instead of touching the filesystem', async () => {
    // `host/` is an allowlist over synthesized responses, so there is no
    // install directory to escape from - but the attempt must still be refused,
    // in every encoding a panel could dress it up in.
    //
    // Note what these are NOT: `/%2e%2e/theme.css` and `/subdir/../theme.css`
    // are absent on purpose. The URL parser flattens dot segments (including
    // percent-encoded ones) before anything here sees the path, so both arrive
    // as the plain `/theme.css` they resolve to and are served - correctly,
    // because that is what they name. Asserting a 404 for those would be
    // asserting a bug. What must not survive is a traversal that is still a
    // traversal after parsing, which is what `%2f` produces: the parser does
    // not decode it, so `decodeURIComponent` hands the handler a literal
    // `../` that never reached the normalizer.
    const escapes = [
      '/../../../etc/passwd',
      '/..%2f..%2ftheme.css',
      '/%2e%2e%2ftheme.css',
      '/..%5c..%5ctheme.css',
      '/theme.css%00.png',
    ];
    for (const path of escapes) {
      const res = await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}${path}`));
      expect(res.status, `${path} must not resolve`).toBe(404);
    }
  });

  it('leaves an unknown hostname the dead end it always was', async () => {
    const res = await handle(request(`${EXT_UI_SCHEME}://ext.made-up.thing/index.html`));

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Extension not installed');
  });

  it('matches the reservation case-insensitively', async () => {
    // Chromium lowercases the host of a `standard:` scheme, so in the app this
    // case never arises. It arises everywhere else: WHATWG `URL` leaves the
    // host of an unregistered (non-special) scheme verbatim, which is why this
    // assertion fails without an explicit `toLowerCase()` in the handler. The
    // reservation should not depend on which parser saw the URL first.
    const res = await handle(request(`${EXT_UI_SCHEME}://HOST/theme.css`));
    expect(res.status).toBe(200);
  });
});

describe('the reserved hostname cannot be claimed by an extension', () => {
  it('is unreachable as a manifest id', () => {
    // The reservation is safe because `host` is not a well-formed extension
    // id: every id must match `^ext\.<segment>\.<segment>$`. If that grammar
    // is ever loosened, this test fails and the reservation needs re-examining
    // (the handler would still win - it checks the reserved name BEFORE the
    // registry - but the extension would become silently unservable, which the
    // author deserves to be told about at install time instead).
    const manifest = {
      id: EXT_UI_HOST_HOSTNAME,
      name: { key: 'extension.name' },
      version: '1.0.0',
      publisher: 'example',
      engines: { bibleApp: '^1.0.0' },
      main: 'dist/extension.js',
      permissions: [],
      activationEvents: ['onStartup'],
    };

    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === '/id')).toBe(true);
    }
  });

  it('wins over the registry even if such an extension existed', async () => {
    // Defense in depth for the case the grammar above is relaxed: a host that
    // WOULD happily resolve `host` to an install directory still never gets
    // asked, because the reserved branch answers first.
    let lookups = 0;
    const shadowingHost = {
      getExtension: async (id: string) => {
        lookups++;
        return { installPath: `/tmp/${id}` };
      },
    } as unknown as ExtensionHost;

    const res = await createExtUiHandler(shadowingHost)(
      request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(lookups, 'the reserved hostname must never reach the registry').toBe(0);
  });
});

describe('host theme tokens follow the active theme', () => {
  beforeEach(() => resetActiveHostThemeForTests());
  afterEach(() => resetActiveHostThemeForTests());

  it('knows every theme the stylesheet defines', () => {
    // Discovered from themes.css, not restated - see hostThemeCss.ts. The
    // count is asserted loosely on purpose: adding a sixteenth theme should
    // not fail this, but losing half of them should.
    expect(HOST_THEME_IDS.length).toBeGreaterThanOrEqual(15);
    for (const id of ['light', 'dark', 'sepia', 'midnight', 'sunset']) {
      expect(HOST_THEME_IDS).toContain(id);
    }
  });

  it('starts on the same default the renderer store does', () => {
    expect(getActiveHostTheme()).toBe(DEFAULT_HOST_THEME_ID);
    expect(DEFAULT_HOST_THEME_ID).toBe('light');
  });

  it('serves different colours once the theme changes', async () => {
    const handle = createExtUiHandler(emptyHost());

    const before = await (
      await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`))
    ).text();

    expect(setActiveHostTheme('dark')).toBe(true);
    expect(getActiveHostTheme()).toBe('dark');

    const after = await (
      await handle(request(`${EXT_UI_SCHEME}://${EXT_UI_HOST_HOSTNAME}/theme.css`))
    ).text();

    expect(after).not.toBe(before);
    // Same token, different value - which is the whole contract. The `not`
    // assertion is only meaningful because the builder collapses duplicate
    // declarations: `themes.css` declares the light value first and the dark
    // block overrides it later, so a sheet that merely concatenated the
    // matching rules would still contain the white triplet somewhere.
    expect(before).toContain('--theme-bg-primary-rgb: 255 255 255;');
    expect(after).not.toContain('--theme-bg-primary-rgb: 255 255 255;');
    expect(after).toMatch(/--theme-bg-primary-rgb:\s*\d+ \d+ \d+;/);
  });

  it('replays the cascade, so a theme-specific override beats the shared default', () => {
    // themes.css declares `--theme-verse-select-rgb` once on `:root` and then
    // re-declares it for the dark-ground themes in a LATER block. Flattening
    // must keep source order or the dark themes would silently get the light
    // amber. This is the one behaviour that a naive "collect the theme block"
    // implementation gets wrong.
    const light = buildHostThemeCss('light');
    const dark = buildHostThemeCss('dark');

    expect(light).toContain('--theme-verse-select-rgb: 202 138 4;');
    expect(dark).toContain('--theme-verse-select-rgb: 250 204 21;');
    // And the override must be the ONLY value in the dark sheet - the shared
    // default it beat is collapsed away, not left sitting above it.
    const values = [...dark.matchAll(/--theme-verse-select-rgb:\s*([^;]+);/g)].map((m) => m[1]);
    expect(values).toEqual(['250 204 21']);
  });

  it('emits tokens only - no component rules from the tail of themes.css', () => {
    // themes.css is not purely tokens: it also styles `.verse-row`,
    // scrollbars, range inputs and textareas. Imposing those on an extension's
    // own layout would be a takeover, not an offer.
    const css = buildHostThemeCss('light');

    expect(css).not.toContain('.verse-row');
    expect(css).not.toContain('::-webkit-scrollbar');
    expect(css).not.toContain('@keyframes');
    expect(css).not.toContain('input[type=');
    // Exactly one rule, and it is :root.
    expect(css.match(/\{/g)?.length).toBe(1);
    expect(css).toContain(':root {');
  });

  it('refuses an unknown theme id rather than falling back to light', () => {
    expect(setActiveHostTheme('dark')).toBe(true);

    // The id arrives over IPC from the renderer, so it is validated. Silently
    // falling back would hand a dark-theme user a white panel, which is a
    // worse failure than keeping the previous (correct) palette.
    expect(setActiveHostTheme('no-such-theme')).toBe(false);
    expect(setActiveHostTheme('')).toBe(false);
    expect(setActiveHostTheme(undefined as unknown as string)).toBe(false);
    expect(getActiveHostTheme()).toBe('dark');
  });

  it('renders each theme at most once', () => {
    setActiveHostTheme('sepia');
    expect(getActiveHostThemeCss()).toBe(getActiveHostThemeCss());
  });
});
