/**
 * First-run onboarding state.
 *
 * Three independent pieces of state live here:
 *
 *  - `languageChosen` - whether the user has answered the first-run language
 *    question. Persisted. Note this is NOT the locale itself: the locale lives
 *    in `bible.ui.locale` (see `utils/documentDirection.ts`) and is written by
 *    `i18n.setLocale`. The two are separate because "the UI is in English"
 *    and "the user was asked and said English" are different facts - the
 *    first is true on every fresh install before anyone has been asked
 *    anything, and showing the picker keys off the second.
 *  - `welcomeDismissed` - the one-line welcome bar shown on first run. Once
 *    dismissed it must never come back, so it is persisted.
 *  - `tourCompleted` - whether the guided tour has been finished or skipped
 *    at least once. Persisted purely so the welcome bar can stop advertising
 *    something the user has already seen; the tour itself stays re-runnable
 *    from Help -> Take a Tour forever.
 *  - `isTourActive` / `tourStepIndex` - ephemeral, never persisted. A tour that
 *    resumed itself after a restart would be a modal blocking launch, which is
 *    exactly what this feature must not be.
 *
 * Persistence is `localStorage`, matching `useSearchStore`'s semantic-mode flag
 * and `utils/documentDirection.ts`. It is shared across every window of the
 * renderer origin, so a detached pane sees the same flags with no IPC.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';

/** `localStorage` key recording that the first-run language question was answered. */
export const LANGUAGE_CHOSEN_STORAGE_KEY = 'bible.onboarding.languageChosen';
/** `localStorage` key for the dismissed state of the first-run welcome bar. */
export const WELCOME_DISMISSED_STORAGE_KEY = 'bible.onboarding.welcomeDismissed';
/** `localStorage` key recording that the guided tour has been run at least once. */
export const TOUR_COMPLETED_STORAGE_KEY = 'bible.onboarding.tourCompleted';

/**
 * Ordered ids of the guided-tour steps.
 *
 * Deliberately five or fewer: a tour long enough to need a progress bar is a
 * tour nobody finishes. Each id maps to a copy key (`onboarding.tour.<id>.*`)
 * and to an anchor selector in `components/onboarding/tourSteps.ts`.
 */
export const TOUR_STEP_IDS = ['bible', 'study', 'search', 'addPane', 'finish'] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

export const TOUR_STEP_COUNT = TOUR_STEP_IDS.length;

function readFlag(key: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    // localStorage throws in hardened/private contexts - never fatal.
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Ignore storage errors (private mode, quota, ...). Worst case the user sees
    // the welcome bar once more; that is better than a crash on launch.
  }
}

export interface OnboardingState {
  /**
   * True once the user has answered the first-run language question (by
   * picking a language or explicitly keeping the detected one). Persisted.
   */
  languageChosen: boolean;
  /** True once the user has dismissed the first-run welcome bar. Persisted. */
  welcomeDismissed: boolean;
  /** True once the tour has been finished or skipped at least once. Persisted. */
  tourCompleted: boolean;
  /** Whether the guided tour overlay is on screen right now. Never persisted. */
  isTourActive: boolean;
  /** Index into `TOUR_STEP_IDS`. Meaningless while `isTourActive` is false. */
  tourStepIndex: number;

  /**
   * Record that the language question has been answered. Idempotent, and
   * deliberately separate from actually switching locale - the caller does
   * that through `i18n.setLocale` so the single persistence path in
   * `documentDirection.ts` still owns the locale value itself.
   */
  markLanguageChosen(): void;
  /** Hide the welcome bar permanently. */
  dismissWelcome(): void;
  /** Open the tour at its first step. Safe to call while a tour is running. */
  startTour(): void;
  /**
   * Close the tour. Used by both "Done" and Escape - a user who escapes has
   * seen enough of it that re-advertising the tour would be nagging.
   */
  endTour(): void;
  /** Advance one step, ending the tour after the last one. */
  nextStep(): void;
  /** Go back one step. No-op on the first step. */
  previousStep(): void;
  /** Jump to a step index, clamped into range. */
  goToStep(index: number): void;
}

/**
 * Build a store instance, hydrating the persisted flags from `localStorage`.
 *
 * Exported so tests can simulate an app restart: mutate one instance, build a
 * second, and assert the second one came up with the persisted value.
 */
export function createOnboardingStore(): UseBoundStore<StoreApi<OnboardingState>> {
  return create<OnboardingState>((set, get) => ({
    languageChosen: readFlag(LANGUAGE_CHOSEN_STORAGE_KEY),
    welcomeDismissed: readFlag(WELCOME_DISMISSED_STORAGE_KEY),
    tourCompleted: readFlag(TOUR_COMPLETED_STORAGE_KEY),
    isTourActive: false,
    tourStepIndex: 0,

    markLanguageChosen: () => {
      writeFlag(LANGUAGE_CHOSEN_STORAGE_KEY, true);
      set({ languageChosen: true });
    },

    dismissWelcome: () => {
      writeFlag(WELCOME_DISMISSED_STORAGE_KEY, true);
      set({ welcomeDismissed: true });
    },

    startTour: () => {
      set({ isTourActive: true, tourStepIndex: 0 });
    },

    endTour: () => {
      writeFlag(TOUR_COMPLETED_STORAGE_KEY, true);
      set({ isTourActive: false, tourStepIndex: 0, tourCompleted: true });
    },

    nextStep: () => {
      const next = get().tourStepIndex + 1;
      if (next >= TOUR_STEP_COUNT) {
        get().endTour();
        return;
      }
      set({ tourStepIndex: next });
    },

    previousStep: () => {
      set({ tourStepIndex: Math.max(0, get().tourStepIndex - 1) });
    },

    goToStep: (index: number) => {
      set({ tourStepIndex: Math.min(TOUR_STEP_COUNT - 1, Math.max(0, index)) });
    },
  }));
}

export const useOnboardingStore = createOnboardingStore();
