import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Identifier for this build, compiled into the client and written to
 * `build-id.json` for the server to read back at startup.
 *
 * Both sides therefore report a value produced by the same build, which is what
 * makes the client's "am I stale?" check on boot trustworthy. The timestamp
 * suffix matters: a bare commit SHA does not change when you rebuild without
 * committing, so a redeploy of uncommitted work would look identical to the
 * previous one and no client would ever update.
 */
function resolveBuildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  const stamp = Date.now().toString(36);
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return `${sha}-${stamp}`;
  } catch {
    return stamp;
  }
}

const buildId = resolveBuildId();

/**
 * Brand strings -- product name, tagline, theme colour -- are substituted into
 * index.html at build time rather than hard-coded there. The same sentence had
 * drifted into four copies (index.html, the PWA manifest below, branding.json
 * and site-config's `modules.about`); this collapses the first two onto the
 * file that is meant to own them.
 *
 * Substitution runs through `transformIndexHtml`, which Vite applies in memory
 * for both `vite dev` and `vite build`. The tracked index.html keeps its
 * %BRAND_*% placeholders and is never rewritten on disk, so a build produces no
 * diff to commit.
 *
 * A fork can rebrand without editing a tracked file by dropping in
 * admin/brand/branding.local.json, whose keys override branding.json. The root
 * .gitignore already excludes `*.local.*`, so that overlay is ignored for free
 * and never conflicts when the fork merges from upstream.
 */
const BRAND_DIR = resolve(__dirname, '../../admin/brand');

type Branding = Record<string, string>;

function loadBranding(): Branding {
  const read = (name: string): Record<string, unknown> => {
    const path = resolve(BRAND_DIR, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
  };
  const merged = { ...read('branding.json'), ...read('branding.local.json') };
  // Drop `$comment` and `_undecided`, which are arrays of prose for humans.
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => typeof value === 'string')
  ) as Branding;
}

/** Escape for interpolation into markup: attribute values and text nodes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replaces every `%BRAND_KEY%` with the matching camelCase key from branding.
 *
 * The substituted value is HTML-escaped, which is right in markup but wrong
 * inside <script>, where entities are not decoded. The inline boot scripts
 * therefore read `window.__BRAND__`, injected by the one special placeholder
 * `%BRAND_JSON%` as JSON with `<` escaped so no value can close the script
 * element early.
 *
 * An unknown key throws rather than silently emitting the raw placeholder into
 * production HTML -- a missing brand string should fail the build, not ship.
 */
function applyBranding(html: string, brand: Branding): string {
  return html.replace(/%BRAND_[A-Z0-9_]+%/g, (placeholder) => {
    if (placeholder === '%BRAND_JSON%') {
      return JSON.stringify(brand).replace(/</g, '\\u003c');
    }
    const key = placeholder
      .slice('%BRAND_'.length, -1)
      .toLowerCase()
      .replace(/_(.)/g, (_match, chr: string) => chr.toUpperCase());
    const value = brand[key];
    if (typeof value !== 'string') {
      throw new Error(
        `index.html references ${placeholder}, but admin/brand/branding.json defines no ` +
          `"${key}". Add the key there, or drop the placeholder from index.html.`
      );
    }
    return escapeHtml(value);
  });
}

const branding = loadBranding();

function brandingPlugin(): Plugin {
  return {
    name: 'brand-index-html',
    // 'pre' so the placeholders are resolved before Vite's own %ENV% pass sees
    // the file and warns about tokens it cannot resolve itself.
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => applyBranding(html, branding),
    },
  };
}


/**
 * PWA (service worker + web app manifest) is **opt-in**, built only when
 * `ENABLE_PWA=1`.
 *
 * A service worker is the only thing in this stack that can answer a *navigation*
 * from cache, and a stale app shell answering navigations is the root of every
 * boot loop this app has had. Without one, the site behaves like an ordinary
 * website: `index.html` is `no-store`, the hashed assets it names are immutable,
 * and a reload always lands on the build the server is actually serving.
 *
 * Nothing is deleted to turn it off — `src/sw.ts` and the whole offline stack are
 * intact. Set `ENABLE_PWA=1` on the build to bring them back.
 *
 * What still works with it off:
 *  - Offline Bible reading (OPFS module downloads + sql.js) — never used the worker.
 *  - Browser semantic search — @huggingface/transformers keeps its own Cache Storage
 *    entry, independent of any service worker.
 *  - Commentary / study-overview caching — moved to plain HTTP cache headers,
 *    see the `/api` cache middleware in server/index.ts.
 *
 * What is lost: installability, standalone display, and loading the app shell with
 * no network at all.
 */
const pwaEnabled = process.env.ENABLE_PWA === '1' || process.env.ENABLE_PWA === 'true';

/**
 * Emit a self-destroying `sw.js` when the PWA is off.
 *
 * Disabling registration only stops *new* clients. Every browser that already
 * installed a worker keeps running it forever and never reaches the app code that
 * would tear it down — that is precisely the wedged client we need to reach. But
 * browsers re-fetch the worker script itself on every navigation (bypassing the
 * HTTP cache), so shipping a replacement at the same URL is the one channel that
 * still gets through to a looping client.
 *
 * The two large content caches are kept: they are plain content, and re-downloading
 * them to switch off a feature flag would be its own problem.
 */
function killServiceWorkerPlugin(): Plugin {
  const source = `/*
 * Keep Thy Heart service-worker kill switch.
 *
 * The PWA is disabled in this build (see ENABLE_PWA in vite.config.ts). This
 * file exists only to replace an older, still-installed worker and remove it.
 * It registers no fetch handler, so while it is alive every request goes
 * straight to the network.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var PRESERVE = ['embedding-model', 'semantic-index', 'transformers-cache'];
    try {
      var names = await caches.keys();
      await Promise.all(names.map(function (n) {
        return PRESERVE.indexOf(n) === -1 ? caches.delete(n) : Promise.resolve(false);
      }));
    } catch (e) { /* best effort — unregistering matters more */ }
    await self.registration.unregister();
  })());
});
`;
  return {
    name: 'bible-kill-service-worker',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Emit the build ID alongside the client bundle so the server can serve it. */
function buildIdPlugin(): Plugin {
  return {
    name: 'bible-build-id',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-id.json',
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

/**
 * Self-host the ONNX Runtime wasm backend that @huggingface/transformers loads.
 *
 * transformers.js ships the model loader but fetches ort's wasm backend
 * (`ort-wasm-simd-threaded.jsep.mjs` + its `.wasm`) from jsDelivr at runtime
 * unless told otherwise. Our CSP is `default-src 'self'`, so that fetch is
 * refused and Ideas Search dies with
 *   "no available backend found. ERR: [wasm] TypeError: Failed to fetch
 *    dynamically imported module: https://cdn.jsdelivr.net/npm/..."
 * — and even without the CSP it would be an external dependency in an app that
 * is meant to work offline. Both files live in node_modules already, so we copy
 * them into the bundle and point `env.backends.onnx.wasm.wasmPaths` at them
 * (see src/search/searchWorker.ts).
 */
function ortWasmPlugin(): Plugin {
  const ORT_DIR = resolve(__dirname, 'node_modules/@huggingface/transformers/dist');
  const ORT_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
  const readOrt = (name: string): Buffer | null => {
    for (const dir of [ORT_DIR, resolve(__dirname, '../../node_modules/@huggingface/transformers/dist')]) {
      try {
        return readFileSync(resolve(dir, name));
      } catch { /* try the next candidate */ }
    }
    return null;
  };
  return {
    name: 'bible-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].split('/').pop();
        if (!req.url?.includes('/ort/') || !name || !ORT_FILES.includes(name)) return next();
        const data = readOrt(name);
        if (!data) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(data);
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) {
        const data = readOrt(name);
        if (!data) {
          this.warn(`ONNX Runtime asset ${name} not found; browser Ideas Search will fall back to the CDN and be blocked by CSP.`);
          continue;
        }
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: data });
      }
    },
  };
}

/**
 * Resolve a path inside an installed dependency, tolerating hoisting.
 *
 * npm workspaces install dependencies to the repo root, so this package's own
 * node_modules usually does not hold them -- though it can, when a version
 * conflict forces a nested copy. Checking both is what makes the build work
 * either way. Hardcoding the package-local path silently worked until the app
 * became a workspace, then failed at `generateBundle` with a bare ENOENT.
 */
function resolveDependencyPath(relativePath: string): string | null {
  const candidates = [
    resolve(__dirname, 'node_modules', relativePath),
    resolve(__dirname, '../../node_modules', relativePath),
  ];
  return candidates.find(existsSync) ?? null;
}

/** Serve wa-sqlite .wasm files with correct MIME type in dev, copy to dist in build. */
function wasmPlugin(): Plugin {
  return {
    name: 'wa-sqlite-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.endsWith('.wasm')) {
          const wasmPath = resolveDependencyPath(`wa-sqlite/dist/${req.url.split('/').pop()!}`);
          try {
            const data = readFileSync(wasmPath!);
            res.setHeader('Content-Type', 'application/wasm');
            res.end(data);
            return;
          } catch { /* fall through to next middleware */ }
        }
        next();
      });
    },
    generateBundle() {
      // Copy the wasm file into the build output so the worker can load it in production
      const wasmPath = resolveDependencyPath('wa-sqlite/dist/wa-sqlite-async.wasm');
      if (!wasmPath) {
        // Fail with the cause rather than a bare ENOENT from readFileSync.
        this.error('wa-sqlite/dist/wa-sqlite-async.wasm not found in this package or the workspace root. Run npm install at the repo root.');
        return;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'wa-sqlite-async.wasm',
        source: readFileSync(wasmPath),
      });
    },
  };
}

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __PWA_ENABLED__: JSON.stringify(pwaEnabled),
  },
  resolve: {
    alias: {
      // Resolve the browser-safe core subset to its TypeScript source rather
      // than core's CommonJS dist: Vite compiles and tree-shakes it like any
      // other source file, which avoids the CJS interop that previously forced
      // the client to keep its own copies of these modules. Mirrors the
      // "@bible/core/browser" path mapping in tsconfig.json.
      '@bible/core/browser': resolve(__dirname, '../../packages/core/src/browser.ts'),
      // With the plugin out of the graph, `virtual:pwa-register` has no provider.
      // A stub keeps src/utils/appUpdate.ts compiling unchanged, so re-enabling the
      // PWA is a build-flag flip and nothing more.
      ...(pwaEnabled ? {} : {
        'virtual:pwa-register': resolve(__dirname, 'src/utils/pwaRegisterStub.ts'),
      }),
    },
  },
  plugins: [
    brandingPlugin(),
    wasmPlugin(),
    ortWasmPlugin(),
    buildIdPlugin(),
    preact(),
    ...(pwaEnabled ? [] : [killServiceWorkerPlugin()]),
    ...(!pwaEnabled ? [] : [VitePWA({
      // 'prompt' here means "the plugin never reloads the page on its own" — the
      // update is applied silently by src/utils/appUpdate.ts, which reloads under
      // a sessionStorage loop guard. 'autoUpdate' would reload on its own with no
      // such guard, and an unguarded automatic reload is the whole bug class this
      // change exists to close. The user-facing confirm() dialog is gone either way.
      registerType: 'prompt',
      // Hand-written worker (src/sw.ts). The generated worker can only route on
      // URL patterns, and correct auth behaviour requires matching navigation
      // requests by `request.mode` — see the comment at the top of src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Emit crossorigin="use-credentials" on the manifest link. Manifest fetches are
      // uncredentialed by default, so behind the site password gate the browser gets a
      // 401 and logs "Manifest fetch ... failed, code 401".
      useCredentials: true,
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        // Same source as the index.html placeholders, so the installed app and
        // the browser tab can never disagree about what this thing is called.
        name: branding.productName,
        short_name: branding.productNameShort,
        description: branding.tagline,
        theme_color: branding.themeColor,
        background_color: branding.backgroundColor,
        display: 'standalone',
        start_url: './',
        categories: ['education', 'books'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      injectManifest: {
        // Precache JS/CSS/fonts/images AND index.html so the app shell can load
        // when the server is unreachable. Unlike the previous config this does
        // NOT make the shell the answer to every navigation — src/sw.ts consults
        // the network first and only reaches for this copy on network failure.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The app bundle and the transformers.js chunk both exceed workbox's
        // 2 MiB default; silently dropping them from the precache would leave
        // the offline shell unable to boot.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      // Runtime caching now lives in src/sw.ts — see that file for the
      // navigation strategy and the four content caches.
    })]),
  ],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    proxy: {
      [`${basePath.replace(/\/$/, '')}/api`]: {
        target: 'http://localhost:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${basePath.replace(/\/$/, '')}`), ''),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    globals: true,
  },
});
