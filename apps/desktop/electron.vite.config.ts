import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

// Capture the current git commit SHA at build time so the diagnostics
// uploader can tag reports with the exact source revision they came from.
// Falls back to an empty string if git isn't available (e.g. a source zip
// build) - the uploader treats an empty buildId as "unknown".
function resolveBuildId(): string {
  const fromEnv = process.env.BIBLE_BUILD_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const BUILD_ID = resolveBuildId();

// -- Build-time branding / deployment configuration --------------------------
// Public-facing names and URLs are supplied at build time and baked into the
// bundles rather than hard-coded in source, so one codebase can produce the
// official build, a neutral-branding build and a fork's build with
// no source edits. `electron/config/appConfig.ts` reads these defines and
// applies the runtime fallbacks; see `README.md#build-configuration`.
//
// Precedence: environment variable -> `admin/brand/branding.json`, overlaid by
// `branding.local.json` (for the values that have one) -> a literal default here
// or in `appConfig.ts`.
function envOrEmpty(name: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : '';
}

const BRAND_DIR = resolve(__dirname, '..', '..', 'admin', 'brand');

/**
 * Read a settled value out of `admin/brand/branding.json`, overlaid by
 * `admin/brand/branding.local.json` when that exists.
 *
 * The overlay is how a fork rebrands without editing a tracked file; it is read
 * exactly as `brandingPlugin()` in `apps/web/vite.config.ts` reads it, so the
 * two apps cannot disagree about the brand.
 *
 * `branding.json` is the single source of truth for public-facing names and
 * URLs (see `scripts/check-branding.js`). Using it as the DEFAULT for a build
 * variable - rather than duplicating the literal into package scripts and the
 * release workflow - is what keeps the two from drifting: change the URL in one
 * place and every build follows.
 *
 * The environment still wins, which is what makes these build parameters: a
 * fork, a staging host, or the neutral-branding profile overrides without
 * editing tracked files.
 *
 * A value still listed in `_undecided` is treated as absent. That distinction
 * matters for the catalog URL specifically: `initMainDatabase.ts` seeds the
 * official repository row only when it is non-empty, precisely so a provisional
 * URL is never baked into a build where it would 404 and make the Module
 * Manager look broken.
 */
function brandingValue(key: string): string {
  const read = (name: string): Record<string, unknown> => {
    const path = resolve(BRAND_DIR, name);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  };
  const branding = { ...read('branding.json'), ...read('branding.local.json') } as Record<string, unknown> & {
    _undecided?: string[];
  };
  if (branding._undecided?.includes(key)) return '';
  const value = branding[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '';
  } catch {
    return '';
  }
}

const PRODUCT_NAME = envOrEmpty('BIBLE_PRODUCT_NAME') || 'Keep Thy Heart Bible Reader';
const ISSUE_REPORT_URL = envOrEmpty('BIBLE_ISSUE_REPORT_URL');
const MODULE_CATALOG_URL =
  envOrEmpty('BIBLE_MODULE_CATALOG_URL') || brandingValue('moduleRepositoryUrl');
const COPYRIGHT_YEAR = envOrEmpty('BIBLE_COPYRIGHT_YEAR') || String(new Date().getFullYear());
const APP_VERSION = envOrEmpty('BIBLE_APP_VERSION') || resolveAppVersion();
// Not defaulted from `branding.json`'s `siteUrl`: the docs site is served under
// a `desktop/` sub-path, which `appConfig.ts` encodes in DEFAULT_DOCS_URL. An
// env value (including the literal `none`, which opts a build out) still wins.
const DOCS_URL = envOrEmpty('BIBLE_DOCS_URL');
// Where user-submitted reports are POSTed, and the shared token that endpoint
// requires. Both default to empty, which keeps a stock build silent: the
// uploader does nothing without an endpoint, and an endpoint that expects a
// token rejects a build that has none.
const DIAGNOSTICS_URL = envOrEmpty('BIBLE_DIAGNOSTICS_URL');
const DIAGNOSTICS_TOKEN = envOrEmpty('BIBLE_DIAGNOSTICS_TOKEN');
const ABOUT_TEXT = envOrEmpty('BIBLE_ABOUT_TEXT');

const APP_CONFIG_DEFINES: Record<string, string> = {
  __BIBLE_PRODUCT_NAME__: JSON.stringify(PRODUCT_NAME),
  __BIBLE_ISSUE_REPORT_URL__: JSON.stringify(ISSUE_REPORT_URL),
  __BIBLE_MODULE_CATALOG_URL__: JSON.stringify(MODULE_CATALOG_URL),
  __BIBLE_COPYRIGHT_YEAR__: JSON.stringify(COPYRIGHT_YEAR),
  __BIBLE_APP_VERSION__: JSON.stringify(APP_VERSION),
  __BIBLE_DOCS_URL__: JSON.stringify(DOCS_URL),
  __BIBLE_DIAGNOSTICS_URL__: JSON.stringify(DIAGNOSTICS_URL),
  __BIBLE_DIAGNOSTICS_TOKEN__: JSON.stringify(DIAGNOSTICS_TOKEN),
  __BIBLE_ABOUT_TEXT__: JSON.stringify(ABOUT_TEXT),
};

/**
 * Builds the QuickJS guest runtime bundle (`out/main/extension-runtime/guest.js`).
 *
 * This cannot ride along in the main rollup build: everything else in `main`
 * targets Electron's Node (CommonJS, Node built-ins available), whereas the
 * guest is evaluated inside a QuickJS realm that has no module system and no
 * Node at all. It therefore needs its own bundler pass with `platform:
 * 'neutral'` - which is also a useful tripwire, because any accidental import
 * of a Node built-in into guest code fails the build here rather than
 * exploding at activation time.
 */
function quickjsGuestBundlePlugin(): Plugin {
  return {
    name: 'bible-quickjs-guest-bundle',
    apply: 'build',
    async closeBundle(): Promise<void> {
      const esbuild = await import('esbuild');
      const outfile = resolve(__dirname, 'out/main/extension-runtime/guest.js');
      const result = await esbuild.build({
        entryPoints: [resolve(__dirname, 'extension-runtime/guest/index.ts')],
        outfile,
        bundle: true,
        format: 'iife',
        // No Node and no browser: the realm has neither. Anything that needs
        // `fs`, `process` or `window` is a bug and will fail to resolve.
        platform: 'neutral',
        target: 'es2020',
        // QuickJS ships no `globalThis` polyfill needs, but esbuild's default
        // `mainFields` for neutral is `main` only; source is what we want.
        mainFields: ['module', 'main'],
        conditions: ['import', 'default'],
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        alias: { '@bible/core': resolve(__dirname, '../../packages/core/src') },
        metafile: true,
      });
      const bytes = result.metafile.outputs[
        Object.keys(result.metafile.outputs)[0] as string
      ]?.bytes;
      // eslint-disable-next-line no-console
      console.log(`[quickjs-guest] ${outfile} — ${bytes ?? '?'} bytes`);
    },
  };
}

/**
 * Replaces `%BIBLE_PRODUCT_NAME%` in the entry HTML files with the configured
 * product name. Runs `pre` so Vite's own `%ENV%` handling never sees (and
 * warns about) the placeholder.
 */
function brandingHtmlPlugin(): Plugin {
  return {
    name: 'bible-branding-html',
    enforce: 'pre',
    transformIndexHtml(html: string): string {
      return html.replace(/%BIBLE_PRODUCT_NAME%/g, PRODUCT_NAME);
    },
  };
}

export default defineConfig({
  main: {
    // `@bible/core` must be BUNDLED into out/main/index.js, not externalized.
    // It is an npm-workspace dependency: `node_modules/@bible/core` is a symlink
    // to `packages/core`, whose real files live outside `apps/desktop`.
    // electron-builder's asar packager refuses to archive files resolved outside
    // the app directory, which is why asar had to be disabled. Bundling removes
    // the symlink entirely - the emitted bundle has no `require("@bible/core")`.
    //
    // This is safe because @bible/core has ZERO runtime dependencies (its
    // better-sqlite3 entry is a devDependency used only by tests) and imports no
    // native modules. Its only filesystem reads are `__dirname`-relative
    // (loadMigrations.findMigrationsDirectory, VerseOfTheDayService.defaultFilePath)
    // and neither is called from the desktop app - the desktop runs its schema
    // via inline SQL in electron/utils/initMainDatabase.ts. If a future desktop
    // code path starts calling either, it must pass an explicit path instead of
    // relying on __dirname, which now resolves to out/main.
    //
    // Genuinely native modules stay external AND unpacked from the asar (see
    // `asarUnpack` in electron-builder*.yml) - .node binaries cannot be dlopen'd
    // from inside an archive.
    //
    // Because it is bundled here, `@bible/core` is a BUILD-TIME dependency and is
    // listed in the desktop package's `devDependencies`. It must stay there:
    // electron-builder copies `dependencies` into the app by walking the real npm
    // tree, and `files:` filters cannot veto that. Since node_modules/@bible/core
    // is a workspace symlink, moving it back to `dependencies` breaks asar
    // packaging with "packages/core/LICENSE must be under apps/desktop/".
    //
    // `keytar` is in `optionalDependencies`, which the plugin does not read, so it
    // is named here: it is native, and must stay a runtime `require` that
    // encryptionKeyManager can catch when the module is absent.
    plugins: [externalizeDepsPlugin({ exclude: ['@bible/core'], include: ['keytar'] }), quickjsGuestBundlePlugin()],
    resolve: {
      alias: {
        // Resolve to core's TypeScript SOURCE, not its `dist`. `packages/core`
        // compiles to CommonJS, and its entry is a chain of tsc `__exportStar`
        // calls; rollup cannot statically determine named exports through those,
        // so bundling dist fails with `"X" is not exported by ../core/dist/index.js`.
        // The renderer config below already aliases to source for the same reason.
        // `npm run build:core` is still required - the desktop's typecheck and
        // the web package consume `packages/core/dist`.
        '@bible/core': resolve(__dirname, '../../packages/core/src')
      }
    },
    define: {
      __BIBLE_BUILD_ID__: JSON.stringify(BUILD_ID),
      ...APP_CONFIG_DEFINES,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          // Bundled extension worker entry. Lives next to
          // `out/main/index.js` so it ships in the same Vite build pass and
          // ExtensionHost can resolve it via `__dirname/extension-runtime/index.js`.
          'extension-runtime/index': resolve(__dirname, 'extension-runtime/index.ts')
        },
        external: ['better-sqlite3-multiple-ciphers', '@huggingface/transformers', 'onnxruntime-common', 'onnxruntime-node']
      }
    }
  },
  preload: {
    // electron-log must be BUNDLED into the preload (not externalized): the
    // packaged main window runs sandbox: true (electron/main.ts), where a
    // preload's require() can only resolve `electron` + builtins, never an npm
    // module. Externalizing it emits require("electron-log/renderer"), which
    // throws "module not found" under sandbox and aborts the whole preload
    // (blank window). Excluding it inlines electron-log/renderer; require("electron")
    // stays external (provided by the runtime).
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })],
    // The preload hands the resolved app config across the context bridge, so
    // it needs the same defines the main bundle gets.
    define: {
      ...APP_CONFIG_DEFINES,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      // Force ONE copy of React into the renderer bundle. The React libraries
      // this app uses resolve their peer against the workspace root, where npm
      // hoists a 19.x copy that nothing declares, while the app itself pins
      // 18.3.1. Bundling both yields a renderer whose hooks throw on first
      // render. Kept in step with the same list in vitest.config.ts.
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': resolve(__dirname, 'src/ui'),
        '@data': resolve(__dirname, 'src/Data'),
        '@services': resolve(__dirname, 'src/Services'),
        '@controllers': resolve(__dirname, 'src/Controllers'),
        // Alias to source files to avoid better-sqlite3 dependency
        '@bible/core': resolve(__dirname, '../../packages/core/src')
      }
    },
    optimizeDeps: {
      exclude: ['better-sqlite3-multiple-ciphers']
    },
    // Renderer code normally reads the config off the preload bridge, but the
    // defines give it a correct build-time fallback when the bridge is absent
    // (detached windows during boot, unit tests, `vite preview`).
    define: {
      ...APP_CONFIG_DEFINES,
    },
    plugins: [brandingHtmlPlugin(), react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          detached: resolve(__dirname, 'detached.html')
        },
        external: ['better-sqlite3-multiple-ciphers']
      }
    }
  }
});
