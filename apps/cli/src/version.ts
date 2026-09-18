/**
 * Build identity.
 *
 * `VERSION` is replaced at compile time by `scripts/build.js` via
 * `--define`, so the compiled executable reports the version from
 * `package.json` without reading it at runtime (there is no `package.json`
 * beside a single-file executable).
 */
declare const __BIBLE_CLI_VERSION__: string | undefined;

export const VERSION: string =
  typeof __BIBLE_CLI_VERSION__ === 'string' ? __BIBLE_CLI_VERSION__ : '0.1.0-dev';

export const PRODUCT = 'bible';
