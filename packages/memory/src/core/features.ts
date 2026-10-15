import { FEATURE_FLAGS } from '@bible/core/Settings/FeatureFlags';

/**
 * Memory feature flags.
 *
 * Recite aloud and hands-free mode sit behind the product feature flag `recite`
 * (`FEATURE_FLAGS` in @bible/core, the same name the speech engine's manifests and
 * `isEnabled('recite')` use). It defaults to ON (desktop, 1.0); the web hosts override it to
 * off. With the flag off the exercise picker, passage actions, plan tiles, settings
 * block and the start/command entry points are hidden or inert.
 */
export const RECITE_ENABLED: boolean = FEATURE_FLAGS.recite.default;

let reciteOverride: boolean | null = null;

/** Whether recite / hands-free is on. Every gate in core and UI reads this. */
export function reciteEnabled(): boolean {
  return reciteOverride ?? RECITE_ENABLED;
}

/** Test hook: force the flag on/off; pass `null` to restore the constant. */
export function setReciteEnabledForTests(value: boolean | null): void {
  reciteOverride = value;
}
