import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WelcomeBar from './WelcomeBar';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import {
  useOnboardingStore,
  createOnboardingStore,
  WELCOME_DISMISSED_STORAGE_KEY,
} from '../../stores/useOnboardingStore';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => `[${key}]`,
      currentLocale: 'en' as const,
      currentDirection: 'ltr' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderBar() {
  return render(
    <ContextProvider services={createMockServices()}>
      <WelcomeBar />
    </ContextProvider>,
  );
}

describe('WelcomeBar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingStore.setState({
      welcomeDismissed: false,
      tourCompleted: false,
      isTourActive: false,
      tourStepIndex: 0,
    });
  });

  it('shows on a profile that has never dismissed it', () => {
    renderBar();
    expect(screen.getByTestId('onboarding-welcome-bar')).toBeInTheDocument();
  });

  it('is a labelled region rather than a dialog, so it blocks nothing', () => {
    renderBar();
    const bar = screen.getByTestId('onboarding-welcome-bar');
    expect(bar).toHaveAttribute('role', 'region');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('gives the dismiss control an accessible name, not just a glyph', () => {
    renderBar();
    expect(screen.getByTestId('onboarding-welcome-dismiss')).toHaveAccessibleName();
  });

  it('disappears once dismissed and stays gone after a reload', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId('onboarding-welcome-dismiss'));
    expect(screen.queryByTestId('onboarding-welcome-bar')).toBeNull();

    // The flag reached storage, so a store built on the next launch reads it.
    expect(window.localStorage.getItem(WELCOME_DISMISSED_STORAGE_KEY)).toBe('true');
    expect(createOnboardingStore().getState().welcomeDismissed).toBe(true);
  });

  it('starts the tour and retires itself in one click', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByTestId('onboarding-welcome-tour'));

    expect(useOnboardingStore.getState().isTourActive).toBe(true);
    expect(useOnboardingStore.getState().welcomeDismissed).toBe(true);
    expect(screen.queryByTestId('onboarding-welcome-bar')).toBeNull();
  });

  it('renders nothing at all once the tour has been completed', () => {
    useOnboardingStore.setState({ tourCompleted: true });
    renderBar();
    expect(screen.queryByTestId('onboarding-welcome-bar')).toBeNull();
  });
});
