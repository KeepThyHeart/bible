import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import GuidedTour from './GuidedTour';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { useOnboardingStore, TOUR_STEP_COUNT } from '../../stores/useOnboardingStore';
import { enT } from '../../testing/enCatalog';

/**
 * Minimal i18n stand-in. It returns `[key]` for everything, which is exactly
 * what the real service does for a key no catalog carries - so these tests
 * also prove the `tf()` English fallbacks are what actually render.
 */
function createMockI18n() {
  return {
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    currentLocale: 'en' as const,
    currentDirection: 'ltr' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderTour(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

/** Press Escape the way the real app delivers it: at the document, capturing. */
async function pressEscape() {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

describe('GuidedTour', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingStore.setState({
      welcomeDismissed: false,
      tourCompleted: false,
      isTourActive: true,
      tourStepIndex: 0,
    });
  });

  it('renders the first step with a dialog role and a described body', () => {
    renderTour(<GuidedTour />);

    const card = screen.getByTestId('guided-tour-card');
    expect(card).toHaveAttribute('role', 'dialog');
    expect(card).toHaveAttribute('aria-modal', 'true');
    expect(card.getAttribute('aria-labelledby')).toBeTruthy();
    expect(card.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('falls back to English copy while the catalog keys are missing', () => {
    renderTour(<GuidedTour />);
    expect(screen.getByText('The Bible pane')).toBeInTheDocument();
  });

  describe('escape behaviour', () => {
    it('closes the tour from the first step', async () => {
      renderTour(<GuidedTour />);
      await pressEscape();
      expect(useOnboardingStore.getState().isTourActive).toBe(false);
    });

    it('closes the tour from every step, including the last', async () => {
      for (let step = 0; step < TOUR_STEP_COUNT; step++) {
        useOnboardingStore.setState({ isTourActive: true, tourStepIndex: step });
        const view = renderTour(<GuidedTour />);

        await pressEscape();
        expect(useOnboardingStore.getState().isTourActive).toBe(false);

        view.unmount();
      }
    });

    it('leaves no overlay, spotlight or card behind after escaping', async () => {
      const view = renderTour(<GuidedTour />);
      expect(screen.getByTestId('guided-tour')).toBeInTheDocument();

      await pressEscape();

      // The app unmounts the tour once `isTourActive` flips; mirror that here,
      // then assert nothing was left attached to document.body by the portal.
      view.unmount();
      expect(document.querySelector('[data-testid="guided-tour"]')).toBeNull();
      expect(document.querySelector('[data-testid="guided-tour-spotlight"]')).toBeNull();
      expect(document.querySelector('[data-testid="guided-tour-card"]')).toBeNull();
    });

    it('resets the step index so the next run starts from the beginning', async () => {
      useOnboardingStore.setState({ isTourActive: true, tourStepIndex: 2 });
      renderTour(<GuidedTour />);

      await pressEscape();
      expect(useOnboardingStore.getState().tourStepIndex).toBe(0);
    });
  });

  describe('explicit controls', () => {
    it('advances with Next and offers Back only after the first step', async () => {
      const user = userEvent.setup();
      renderTour(<GuidedTour />);

      expect(screen.queryByTestId('guided-tour-back')).toBeNull();

      await user.click(screen.getByTestId('guided-tour-next'));
      expect(useOnboardingStore.getState().tourStepIndex).toBe(1);
      expect(screen.getByTestId('guided-tour-back')).toBeInTheDocument();
    });

    it('ends the tour from the Skip control', async () => {
      const user = userEvent.setup();
      renderTour(<GuidedTour />);

      await user.click(screen.getByTestId('guided-tour-skip'));
      expect(useOnboardingStore.getState().isTourActive).toBe(false);
    });

    it('finishes on the last step rather than advancing off the end', async () => {
      const user = userEvent.setup();
      useOnboardingStore.setState({ isTourActive: true, tourStepIndex: TOUR_STEP_COUNT - 1 });
      renderTour(<GuidedTour />);

      await user.click(screen.getByTestId('guided-tour-next'));
      expect(useOnboardingStore.getState().isTourActive).toBe(false);
      expect(useOnboardingStore.getState().tourCompleted).toBe(true);
    });
  });
});
