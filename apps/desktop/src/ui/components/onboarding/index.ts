/**
 * First-run onboarding.
 *
 * Four layers, least intrusive first:
 *  1. `PaneEmptyState` - coaching rendered by a pane that holds nothing yet.
 *     Always available, costs nothing to a user who already knows.
 *  2. `WelcomeBar` - one dismissible line of orientation on first run only.
 *  3. `GuidedTour` - an on-demand five-step pass over the main regions,
 *     re-runnable from Help -> Take a Tour.
 *  4. `LanguageFirstRun` - the one exception to the rules below: a modal
 *     asked once, before anything else, because a user who cannot read the UI
 *     cannot use any of the other three.
 *
 * Apart from `LanguageFirstRun`, nothing here gates functionality and nothing
 * here opens by itself.
 */

export { default as PaneEmptyState } from './PaneEmptyState';
export type { PaneEmptyStateProps, PaneEmptyStateAction } from './PaneEmptyState';
export { default as WelcomeBar } from './WelcomeBar';
export { default as LanguageFirstRun } from './LanguageFirstRun';
export { default as GuidedTour } from './GuidedTour';
export { TOUR_STEPS, resolveAnchorElement } from './tourSteps';
export type { TourStepDefinition } from './tourSteps';
export { useReducedMotion } from './useReducedMotion';
