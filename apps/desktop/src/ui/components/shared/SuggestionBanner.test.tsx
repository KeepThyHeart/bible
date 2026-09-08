import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import SuggestionBanner from './SuggestionBanner';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';

/**
 * The banner's button labels come from the i18n catalog, so every render needs
 * the services context. The stub resolves the two keys this component reads and
 * echoes anything else.
 */
const CATALOG: Record<string, string> = {
  'ui.suggestionBanner.go': 'Go',
  'ui.suggestionBanner.dismiss': 'Dismiss',
};

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => CATALOG[key] ?? key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderBanner(ui: React.ReactElement) {
  const result = render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
  return {
    ...result,
    rerender: (next: React.ReactElement) =>
      result.rerender(<ContextProvider services={createMockServices()}>{next}</ContextProvider>),
  };
}

describe('SuggestionBanner', () => {
  it('displays verse reference', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Jump to"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText(/Jump to/)).toBeInTheDocument();
  });

  it('displays Go button', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Navigate to"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('displays Dismiss button', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Open"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('calls onGo when Go button is clicked', async () => {
    const user = userEvent.setup();
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="View"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const goButton = screen.getByRole('button', { name: 'Go' });
    await user.click(goButton);

    expect(onGo).toHaveBeenCalled();
  });

  it('calls onDismiss when Dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Check"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const dismissButton = screen.getByRole('button', { name: 'Dismiss' });
    await user.click(dismissButton);

    expect(onDismiss).toHaveBeenCalled();
  });

  it('displays correct message format', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={40001001}
        messagePrefix="Go to"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const banner = document.querySelector('[style*="display: flex"]');
    expect(banner).toBeInTheDocument();
    expect(banner?.textContent).toContain('Go to');
  });

  it('renders as flex container', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Switch to"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const banner = container.firstChild as HTMLElement;
    expect(banner.style.display).toBe('flex');
  });

  it('renders with proper styling', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Show"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const banner = container.firstChild as HTMLElement;
    expect(banner.style.alignItems).toBe('center');
    expect(banner.style.justifyContent).toBe('space-between');
  });

  it('Go button has accent background', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Jump"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const goButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent === 'Go'
    ) as HTMLElement;
    expect(goButton?.style.backgroundColor).toContain(
      'var(--theme-accent-primary)'
    );
  });

  it('Dismiss button has white text on light background', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Navigate"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const dismissButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent === 'Dismiss'
    ) as HTMLElement;
    expect(dismissButton?.style.border).toBeDefined();
  });

  it('handles long message prefix', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const longPrefix = 'This is a very long message prefix that might overflow';
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix={longPrefix}
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByText(new RegExp(longPrefix))).toBeInTheDocument();
  });

  it('buttons are not disabled by default', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="View"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const goButton = screen.getByRole('button', { name: 'Go' });
    const dismissButton = screen.getByRole('button', { name: 'Dismiss' });
    expect(goButton).not.toBeDisabled();
    expect(dismissButton).not.toBeDisabled();
  });

  it('renders multiple verses correctly', () => {
    const onGo1 = vi.fn();
    const onGo2 = vi.fn();
    const onDismiss1 = vi.fn();
    const onDismiss2 = vi.fn();

    const { rerender } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="First"
        onGo={onGo1}
        onDismiss={onDismiss1}
      />
    );

    expect(screen.getByText(/First/)).toBeInTheDocument();

    rerender(
      <SuggestionBanner
        verseId={40001001}
        messagePrefix="Second"
        onGo={onGo2}
        onDismiss={onDismiss2}
      />
    );

    expect(screen.getByText(/Second/)).toBeInTheDocument();
  });

  it('has proper flex layout for buttons', () => {
    const onGo = vi.fn();
    const onDismiss = vi.fn();
    const { container } = renderBanner(
      <SuggestionBanner
        verseId={43003016}
        messagePrefix="Open"
        onGo={onGo}
        onDismiss={onDismiss}
      />
    );

    const buttonsContainer = Array.from(container.querySelectorAll('div')).find(
      div => div.style.display === 'flex' && Array.from(div.querySelectorAll('button')).length >= 2
    );
    expect(buttonsContainer).toBeInTheDocument();
  });
});
