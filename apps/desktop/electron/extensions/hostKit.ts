/**
 * The extension UI kit, served at `ext-ui://host/kit/1/kth-kit.js` and `.../kth.css`.
 *
 * The kit is `packages/ui`'s custom elements (`kth-reference-picker`, ...) bundled as one classic-script IIFE on
 * preact/compat, plus one flat stylesheet. Both come from the `virtual:kth-kit` module, which
 * `scripts/kthKitPlugin.mjs` builds with esbuild (through `packages/ui/scripts/build-kit.mjs`) at bundle time
 * and inlines into the main-process bundle as two strings, exactly as `hostThemeCss.ts` and `hostControlsCss.ts`
 * inline `?raw` CSS. That is why:
 *
 *   - answers come from memory: a packaged app ships only `out/main/index.js`, so there is no file to read, and
 *     no electron-builder config needs to change;
 *   - no "build the kit first" step exists: dev, desktop vitest and the release `package:*` scripts all run the
 *     plugin themselves, and an esbuild error fails the build instead of shipping a stale kit.
 *
 * No CSP change is needed. The panel CSP already allows `script-src ext-ui://host` and `style-src ext-ui://host`
 * (a classic `<script src>` and `<link>`), and `connect-src` is not widened: the kit never calls `fetch`.
 */

import { KIT_CSS, KIT_JS } from 'virtual:kth-kit';

/** The kit major this build serves; the path segment in `kit/<major>/`. Must be in core's `UI_KIT_VERSIONS`. */
export const HOST_KIT_MAJOR = '1';

/** `kit/<major>/kth-kit.js`. */
export function getHostKitJs(): string {
  return KIT_JS;
}

/** `kit/<major>/kth.css`. */
export function getHostKitCss(): string {
  return KIT_CSS;
}
