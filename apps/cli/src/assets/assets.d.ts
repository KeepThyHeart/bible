/**
 * Bun's `with { type: 'file' }` imports resolve to a path string at build time.
 * TypeScript has no idea what a `.db` import is, so it needs telling.
 */
declare module '*.db' {
  /** Path to the file — inside the embedded virtual filesystem once compiled. */
  const path: string;
  export default path;
}
