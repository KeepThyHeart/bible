// Vite plugin: builds packages/ui's extension UI kit with esbuild at bundle time and exposes it as the virtual
// module `virtual:kth-kit` (string exports KIT_JS and KIT_CSS). Used by electron.vite.config.ts (main build) and
// vitest.config.ts.
//
// Why a build-time pass rather than `?raw` of a prebuilt file: `npm run dev`, desktop vitest and the release
// workflow's `package:*` scripts never build other workspaces, so any "build the kit first" ordering breaks
// one of them. This runs on every path, needs no checked-in blob, and an esbuild error fails the build loudly.
// The precedent is quickjsGuestBundlePlugin in electron.vite.config.ts, which also runs esbuild inside the build.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = 'virtual:kth-kit';
const RESOLVED = '\0' + ID;

/**
 * @param {string} buildKitPath absolute path of packages/ui/scripts/build-kit.mjs (passed in by the config, whose
 *   bundler rewrites import.meta.url, so this file never derives paths from it)
 * @returns {import('vite').Plugin}
 */
export function kthKitPlugin(buildKitPath) {
  return {
    name: 'bible-kth-kit',
    resolveId(id) {
      return id === ID ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      const mod = await import(pathToFileURL(buildKitPath).href);
      const { js, css, metafile } = await mod.buildKit({ write: false }); // throws: the Vite build fails loudly
      if (!js.includes('KthKit') || !css.includes('--kth-')) this.error('kth kit build produced unexpected output');
      // Rebuild in dev when a bundled source changes.
      for (const input of Object.keys(metafile.inputs)) {
        if (!input.includes('node_modules')) this.addWatchFile(resolve(mod.UI_ROOT, input));
      }
      return `export const KIT_JS = ${JSON.stringify(js)};\nexport const KIT_CSS = ${JSON.stringify(css)};\n`;
    },
  };
}
