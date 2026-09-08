/**
 * Anchor and copy metadata for the guided tour.
 *
 * Kept apart from the component so the step list can be unit-tested and so the
 * DOM contract (which selectors the tour depends on) is stated in one place.
 *
 * Every selector here is an attribute that exists purely for the tour or for
 * tests. If a selector resolves to nothing - a pane the user has closed, a
 * search bar hidden at a narrow width - the step still renders, centred and
 * without a spotlight, rather than dropping out of the sequence. A tour that
 * silently skips steps is harder to reason about than one that degrades.
 */

import type { TourStepId } from '../../stores/useOnboardingStore';
import { TOUR_STEP_IDS } from '../../stores/useOnboardingStore';

export interface TourStepDefinition {
  id: TourStepId;
  /**
   * Candidate CSS selectors for the element to spotlight, in priority order.
   * The first one that resolves wins. Empty means "no spotlight, centre it".
   */
  anchors: string[];
  /** Copy key stem; resolves to `<stem>.title`, `<stem>.body`. */
  keyStem: string;
}

export const TOUR_STEPS: TourStepDefinition[] = [
  {
    id: 'bible',
    anchors: ['[data-tour-pane="bible"]', '[data-testid="bible-pane"]'],
    keyStem: 'onboarding.tour.bible',
  },
  {
    id: 'study',
    anchors: [
      '[data-tour-pane="study"]',
      '[data-tour-pane="commentary"]',
      '[data-testid="commentary-pane"]',
    ],
    keyStem: 'onboarding.tour.study',
  },
  {
    id: 'search',
    anchors: ['[data-testid="search-input"]'],
    keyStem: 'onboarding.tour.search',
  },
  {
    id: 'addPane',
    anchors: ['[data-tour-anchor="add-pane"]'],
    keyStem: 'onboarding.tour.addPane',
  },
  {
    id: 'finish',
    anchors: [],
    keyStem: 'onboarding.tour.finish',
  },
];

// Fails the build (and any test that imports this module) if the step list and
// the persisted step ids ever drift apart.
if (TOUR_STEPS.length !== TOUR_STEP_IDS.length) {
  throw new Error('[onboarding] TOUR_STEPS and TOUR_STEP_IDS are out of sync');
}

/** Resolve the first anchor selector that matches something in the document. */
export function resolveAnchorElement(step: TourStepDefinition): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const selector of step.anchors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}
