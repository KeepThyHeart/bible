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
 *     npm run kjv -w @bible/cli
 *
 * `scripts/build.js` builds it when it is missing, or creates a placeholder if
 * there is no module library to build it from, so the package always
 * compiles; `firstRun` then reports that this build ships no bundled Bible
 * rather than extracting nonsense.
 */
import path from './bible_kjv.db' with { type: 'file' };

export const BUNDLED_KJV_PATH: string = path;
