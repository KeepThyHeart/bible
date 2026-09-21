/**
 * Ambient declaration for Vite's `?raw` import suffix.
 *
 * `hostThemeCss.ts` imports `themes.css?raw` so the stylesheet text is inlined
 * into the main-process bundle at build time. That is deliberate: the token
 * values have to be available in a PACKAGED app, where `src/ui/styles/` does
 * not exist on disk at all (only `out/main/index.js` and the renderer bundle
 * ship), so reading the file at runtime would work in `electron-vite dev` and
 * then 404 for every real user. Inlining it makes the dev and packaged paths
 * identical.
 *
 * Vite/Vitest resolve the suffix; `tsc --noEmit` does not know about it, hence
 * this declaration. It is intentionally narrow - only `*.css?raw`, not a
 * blanket `*?raw` - so an accidental `?raw` import of something large (a font,
 * a database fixture) still fails typecheck instead of quietly bloating the
 * main bundle.
 */
declare module '*.css?raw' {
  const content: string;
  export default content;
}
