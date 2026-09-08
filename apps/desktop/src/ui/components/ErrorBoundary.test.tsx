import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';
import { i18nService } from '../services/I18nService';
import { enString, loadEnCatalog } from '../testing/enCatalog';

// Suppress React's noisy error boundary console output during tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
  // The boundary is a class component and reads the service singleton
  // directly, so the English has to be loaded into it rather than stubbed.
  i18nService.loadCatalog('en', 'en', loadEnCatalog());
});
afterEach(() => {
  console.error = originalConsoleError;
});

// A component that throws on demand
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test render explosion');
  }
  return <div>Child rendered OK</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
  });

  it('displays fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText(enString('errorBoundary.somethingWentWrong'))).toBeInTheDocument();
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: enString('errorBoundary.reload') })).toBeInTheDocument();
  });

  it('shows error details in the expandable section', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Test render explosion')).toBeInTheDocument();
  });

  it('recovers when the Reload button is clicked', async () => {
    const user = userEvent.setup();

    // We need a component whose throw behavior we can control between renders.
    // ErrorBoundary resets state on Reload, re-rendering children.
    // We'll use a ref-like approach via module-level variable.
    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) throw new Error('Boom');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText(enString('errorBoundary.somethingWentWrong'))).toBeInTheDocument();

    // Stop throwing before clicking Reload
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: enString('errorBoundary.reload') }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('logs the error via window.electron.log.error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(window.electron.log.error).toHaveBeenCalledWith(
      expect.stringContaining('Test render explosion'),
    );
  });
});
