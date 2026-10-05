import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { chunkReport } from './build/chunkReport';

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


/*
 * The client build ALWAYS contains both workers: the real `sw.js` (built from
 * src/sw.ts) and the kill switch `sw-kill.js` (public/sw-kill.js, copied
 * verbatim). Which one a browser is handed at `/sw.js`, and whether the
 * manifest is advertised, is decided at run time by the server from the
 * `features.pwa` site flag (server/middleware/serviceWorker.ts). One build can
 * therefore be flipped between PWA and plain website with a config change and a
 * restart, and a flipped-off site still reaches browsers that installed a worker.
 * See docs/features/pwa-offline.md.
 */

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
        this.error('wa-sqlite/dist/wa-sqlite-async.wasm not found in this package or the workspace root. Run pnpm install at the repo root.');
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

/**
 * Substitute `%BASE_PATH%` in index.html.
 *
 * The boot-prefetch script there is a plain inline `<script>`, so none of the
 * usual seams reach it: `define` rewrites modules only, and Vite's own
 * index.html pass rewrites `src`/`href` attributes, not JavaScript string
 * literals. It has to build absolute `/api/...` URLs that match the ones
 * `API_BASE` produces (`origin + BASE_URL`), and getting that wrong would mean
 * prefetching URLs the app never asks for -- so the value comes from the same
 * constant Vite is configured with rather than being guessed at runtime.
 */
/**
 * Serve the projection viewer's HTML for its pretty URL during development.
 *
 * In a build, `present/viewer.html` becomes a real file and Express answers
 * `/present/v/<code>` with it (see `server/index.ts`). The dev server has no
 * such route and would 404, so this rewrites the same shape before Vite's
 * static handling sees it. Without it, the viewer can only be opened in dev at
 * a URL that does not match the one people are actually given.
 */
function presentViewerDevPlugin(): Plugin {
  return {
    name: 'present-viewer-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/present\/v\/[^/?#]+/.test(req.url)) {
          req.url = '/present/viewer.html';
        } else if (req.url && /^\/present\/solo(?:[/?#]|$)/.test(req.url)) {
          // The solo viewer (`present/solo.html`): a local session, no join code.
          req.url = '/present/solo.html';
        }
        next();
      });
    },
  };
}

/**
 * Same trick as `presentViewerDevPlugin`, for `/watch` (see `present/watch.html`).
 *
 * `/watch?...` has to keep its query string (a prefilled code), unlike
 * `/present/v/<code>` where the code is a path segment -- a plain prefix test
 * would also rewrite `/watch-something-else`, so this matches the whole path
 * component exactly.
 */
function presentWatchDevPlugin(): Plugin {
  return {
    name: 'present-watch-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/watch(?:[/?#]|$)/.test(req.url)) {
          req.url = req.url.replace(/^\/watch/, '/present/watch.html');
        }
        next();
      });
    },
  };
}

function basePathPlugin(): Plugin {
  return {
    name: 'bible-base-path',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => html.replace(/%BASE_PATH%/g, basePath),
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    // Timeline minimum framing span in years (empty = built-in 200); see README "Build options".
    __TIMELINE_MIN_SPAN_YEARS__: JSON.stringify(process.env.BIBLE_TIMELINE_MIN_SPAN_YEARS?.trim() ?? ''),
  },
  resolve: {
    alias: {
      // Resolve the browser-safe core subset to its TypeScript source rather
      // than core's CommonJS dist: Vite compiles and tree-shakes it like any
      // other source file, which avoids the CJS interop that previously forced
      // the client to keep its own copies of these modules. Mirrors the
      // "@bible/core/browser" path mapping in tsconfig.json.
      '@bible/core/browser': resolve(__dirname, '../../packages/core/src/browser.ts'),
      // Shared UI kit, consumed as source. Order matters: Vite string aliases
      // match `id === key || id.startsWith(key + '/')` and the first entry wins,
      // so the more specific css entry must precede the bare package entry.
      '@bible/ui/css': resolve(__dirname, '../../packages/ui/css'),
      '@bible/ui': resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  plugins: [
    brandingPlugin(),
    basePathPlugin(),
    presentViewerDevPlugin(),
    presentWatchDevPlugin(),
    chunkReport(),
    wasmPlugin(),
    ortWasmPlugin(),
    buildIdPlugin(),
    preact(),
    VitePWA({
      // Registration is hand-rolled in src/utils/appUpdate.ts (it depends on the
      // server's `features.pwa` flag, which the plugin's static register script
      // cannot see), so the plugin must not inject its own.
      injectRegister: false,
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
        id: './',
        start_url: './',
        scope: './',
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
        // The kill switch is fetched by URL when needed; precaching it would
        // just spend the user's bandwidth on a worker they never run.
        globIgnores: ['sw-kill.js'],
      },
      // Runtime caching lives in src/sw/rules/, applied by src/sw.ts.
    }),
  ],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      /*
       * Two entry points, not one.
       *
       * The projection viewer is a separate page rather than a route inside the
       * reading app because it must not load the reading app at all: no stores,
       * no plugin host, no service worker, no icon font. It runs on whatever
       * machine is plugged into the television and has to be on screen before a
       * service starts. Naming `index.html` explicitly is required -- adding an
       * `input` map replaces Vite's implicit default rather than adding to it.
       */
      input: {
        index: resolve(__dirname, 'index.html'),
        presentViewer: resolve(__dirname, 'present/viewer.html'),
        presentWatch: resolve(__dirname, 'present/watch.html'),
        presentSolo: resolve(__dirname, 'present/solo.html'),
      },
    },
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
      // Audio Bible recordings and TTS engine files (server route, when enabled).
      [`${basePath.replace(/\/$/, '')}/audio`]: {
        target: 'http://localhost:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${basePath.replace(/\/$/, '')}`), ''),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    globals: true,
    // v0.2 modules ship no FTS5 table: build the test data's sidecar keyword
    // indexes once before the server route tests search them.
    globalSetup: ['server/__tests__/keywordIndexGlobalSetup.ts'],
  },
});
