import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOnboardingStore,
  useOnboardingStore,
  TOUR_STEP_COUNT,
  WELCOME_DISMISSED_STORAGE_KEY,
  TOUR_COMPLETED_STORAGE_KEY,
} from '../useOnboardingStore';

/**
 * A fresh store instance is exactly what the app builds at module load on the
 * next launch, so building one here is a faithful stand-in for a restart.
 */
const restart = () => createOnboardingStore().getState();

describe('useOnboardingStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The module-level singleton is shared across test files; reset the parts
    // of it these tests touch.
    useOnboardingStore.setState({
      welcomeDismissed: false,
      tourCompleted: false,
      isTourActive: false,
      tourStepIndex: 0,
    });
  });

  describe('welcome bar persistence', () => {
    it('starts undismissed on a profile that has never run the app', () => {
      expect(restart().welcomeDismissed).toBe(false);
    });

    it('keeps the welcome bar dismissed across a reload', () => {
      const first = createOnboardingStore();
      first.getState().dismissWelcome();
      expect(first.getState().welcomeDismissed).toBe(true);

      // Simulated restart: a brand-new store reading the same localStorage.
      expect(restart().welcomeDismissed).toBe(true);
    });

    it('writes the dismissal under a stable storage key', () => {
      createOnboardingStore().getState().dismissWelcome();
      expect(window.localStorage.getItem(WELCOME_DISMISSED_STORAGE_KEY)).toBe('true');
    });

    it('treats a corrupt stored value as not dismissed rather than throwing', () => {
      window.localStorage.setItem(WELCOME_DISMISSED_STORAGE_KEY, '{not-a-bool}');
      expect(restart().welcomeDismissed).toBe(false);
    });
  });

  describe('tour completion persistence', () => {
    it('records completion so the welcome bar stops advertising the tour', () => {
      const store = createOnboardingStore();
      store.getState().startTour();
      store.getState().endTour();

      expect(window.localStorage.getItem(TOUR_COMPLETED_STORAGE_KEY)).toBe('true');
      expect(restart().tourCompleted).toBe(true);
    });

    it('never restores an in-progress tour after a reload', () => {
      const store = createOnboardingStore();
      store.getState().startTour();
      store.getState().nextStep();
      expect(store.getState().isTourActive).toBe(true);

      const afterRestart = restart();
      expect(afterRestart.isTourActive).toBe(false);
      expect(afterRestart.tourStepIndex).toBe(0);
    });

    it('stays re-runnable after completion', () => {
      const store = createOnboardingStore();
      store.getState().endTour();

      store.getState().startTour();
      expect(store.getState().isTourActive).toBe(true);
      expect(store.getState().tourStepIndex).toBe(0);
    });
  });

  describe('step navigation', () => {
    it('advances and rewinds within range', () => {
      const store = createOnboardingStore();
      store.getState().startTour();

      store.getState().nextStep();
      expect(store.getState().tourStepIndex).toBe(1);

      store.getState().previousStep();
      expect(store.getState().tourStepIndex).toBe(0);
    });

    it('does not rewind past the first step', () => {
      const store = createOnboardingStore();
      store.getState().startTour();
      store.getState().previousStep();
      expect(store.getState().tourStepIndex).toBe(0);
    });

    it('ends the tour when advancing past the last step', () => {
      const store = createOnboardingStore();
      store.getState().startTour();
      for (let i = 0; i < TOUR_STEP_COUNT; i++) store.getState().nextStep();

      expect(store.getState().isTourActive).toBe(false);
      expect(store.getState().tourCompleted).toBe(true);
    });

    it('clamps goToStep into range', () => {
      const store = createOnboardingStore();
      store.getState().startTour();

      store.getState().goToStep(999);
      expect(store.getState().tourStepIndex).toBe(TOUR_STEP_COUNT - 1);

      store.getState().goToStep(-5);
      expect(store.getState().tourStepIndex).toBe(0);
    });
  });
});
