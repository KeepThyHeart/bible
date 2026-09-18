/**
 * The embedded KJV.
 *
 * Isolated in its own module so that the static asset import — which the
 * bundler resolves at build time and cannot be made conditional — is not on the
 * import path of anything that needs to run without it. `firstRun.ts` reaches
 * this through a dynamic import and copes with its absence.
 *
 * `src/assets/bible_kjv.db` is generated, not checked in:
 *
 *     node scripts/build-cli-kjv.js
 *
 * `scripts/build.js` creates a placeholder when it is missing, so a build
 * without a module library still compiles; `firstRun` then reports that this
 * build ships no bundled Bible rather than extracting nonsense.
 */
import path from './bible_kjv.db' with { type: 'file' };

export const BUNDLED_KJV_PATH: string = path;
