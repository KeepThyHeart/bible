/**
 * Ambient declaration for the `virtual:kth-kit` module that `scripts/kthKitPlugin.mjs` provides at bundle time
 * (electron-vite main build and vitest). Same narrow-declaration style as `cssRaw.d.ts`.
 */
declare module 'virtual:kth-kit' {
  /** The kit script (`kth-kit.js`): a minified classic-script IIFE that assigns `globalThis.KthKit`. */
  export const KIT_JS: string;
  /** The kit stylesheet (`kth.css`): KTH tokens map, base rules, contract, scheme and component classes. */
  export const KIT_CSS: string;
}
