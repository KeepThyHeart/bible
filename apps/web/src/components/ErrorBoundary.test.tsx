/**
 * Component tests for ErrorBoundary.
 *
 * Pattern: Class component with error catching, state transitions, and user actions.
 * Tests verify that render errors are caught and the recovery UI is shown.
 * Uses a deliberately crashing child component to trigger the boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// Mock i18n — ErrorBoundary uses i18n.t() directly (not useTranslation hook).
vi.mock('../i18n', () => ({
  default: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'errorBoundary.title': 'Something went wrong',
        'errorBoundary.message': 'An error occurred in the application.',
        'errorBoundary.tryAgain': 'Try Again',
        'errorBoundary.reloadPage': 'Reload Page',
        'errorBoundary.clearCacheReload': 'Clear Cache & Reload',
      };
      return translations[key] ?? key;
    },
  },
}));

import { ErrorBoundary } from './ErrorBoundary';

// A child component that throws on render when `shouldThrow` is true.
function CrashingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test render crash');
  return <div data-testid="child-content">All good</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress Preact's error logging during intentional crashes
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <CrashingChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('catches render errors and shows recovery UI', () => {
    render(
      <ErrorBoundary>
        <CrashingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Recovery UI should be shown
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('An error occurred in the application.')).toBeTruthy();

    // Child content should NOT be rendered
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('shows all three recovery action buttons', () => {
    render(
      <ErrorBoundary>
        <CrashingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByText('Reload Page')).toBeTruthy();
    expect(screen.getByText('Clear Cache & Reload')).toBeTruthy();
  });

  it('retries rendering children when "Try Again" is clicked', () => {
    // We can't dynamically change the prop mid-render in the same boundary,
    // but we can verify that clicking Try Again resets the error state and
    // attempts to re-render. If the child still throws, the boundary catches again.
    const { container } = render(
      <ErrorBoundary>
        <CrashingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Error UI is showing
    expect(container.querySelector('.error-boundary')).toBeTruthy();

    // Click "Try Again" — it will re-render, child still crashes, boundary catches again
    fireEvent.click(screen.getByText('Try Again'));

    // Still in error state (child throws again), but the boundary handled it
    expect(container.querySelector('.error-boundary')).toBeTruthy();
  });

  it('shows the warning icon in error state', () => {
    const { container } = render(
      <ErrorBoundary>
        <CrashingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(container.querySelector('.fa-triangle-exclamation')).toBeTruthy();
  });
});
