/**
 * Password strength (contracts 0063 §9; W3-B implements).
 *
 * Implementation note (plan-refresh §2 C0): the estimator is loaded lazily with dynamic imports of
 * `@zxcvbn-ts/core` and `@zxcvbn-ts/language-common` inside the function body (never at module top), so the
 * dictionaries stay out of the web entry chunk. The import lines are added together with the dependency
 * (`@zxcvbn-ts/*` in core `dependencies`, `ALLOWED_EXTERNAL` in browserBarrel.test.ts); the stub has none so
 * core typechecks before the packages are installed.
 */
import { notImplemented } from './notImplemented';

export function passwordStrength(pw: string, userInputs?: string[]): Promise<{ score: 0 | 1 | 2 | 3 | 4; feedback: string[] }> {
  throw notImplemented(pw, userInputs);
}
