/**
 * The shared control-chrome stylesheet, rendered for extension panel iframes.
 *
 * Sibling to `hostThemeCss.ts`, served at the same reserved origin
 * (`ext-ui://host/controls.css`) but far simpler: `theme.css` has to replay
 * `themes.css`'s per-theme cascade into a flattened `:root` block because the
 * token values change with the user's theme. `controls.css` has no such
 * axis - `.control-toolbar`, `.control-toolbar-button` and `.control-nav-button`
 * are plain rules built only from the `--theme-*` custom properties
 * `theme.css` already carries, so the same bytes serve every theme and every
 * request; only the *colours those classes reference* change, exactly as they
 * do for the host's own `PaneToolbar.tsx` / `PaneNavHeader.tsx`.
 *
 * Inlined at build time via Vite's `?raw` suffix, for the same reason
 * `hostThemeCss.ts` inlines `themes.css`: a packaged app ships only
 * `out/main/index.js` and the renderer bundle, not `src/ui/styles/`, so
 * reading the file off disk at runtime would work in `electron-vite dev` and
 * 404 for every real user.
 */

import controlsCss from '../../src/ui/styles/controls.css?raw';

/** The control-chrome stylesheet served at `ext-ui://host/controls.css`. */
export function getHostControlsCss(): string {
  return controlsCss;
}
