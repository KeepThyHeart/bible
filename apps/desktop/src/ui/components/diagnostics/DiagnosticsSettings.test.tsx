/**
 * Preferences > Diagnostics: the privacy blurb renders as real lists, and the
 * previously hard-coded labels go through the catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiagnosticsSettings, { parsePrivacyBlurb } from './DiagnosticsSettings';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';

const BLURB = 'What we send:\n  - A\n  - B\n\nWhat we never send:\n  - C\n\nClosing note.';

function services(t: (k: string) => string): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t,
      currentLocale: 'es' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

describe('parsePrivacyBlurb', () => {
  it('turns dash lines into list items and the rest into paragraphs', () => {
    expect(parsePrivacyBlurb(BLURB)).toEqual([
      { kind: 'p', text: 'What we send:' },
      { kind: 'ul', items: ['A', 'B'] },
      { kind: 'p', text: 'What we never send:' },
      { kind: 'ul', items: ['C'] },
      { kind: 'p', text: 'Closing note.' },
    ]);
  });
});

describe('DiagnosticsSettings', () => {
  it('renders the blurb as lists without literal dashes, and translates the formerly hard-coded labels', () => {
    const t = (key: string) =>
      ({
        'diagnostics.privacyBlurb': BLURB,
        'diagnosticsSettings.refresh': 'Actualizar',
        'diagnosticsSettings.sendAllNow': 'Enviar todo ahora',
        'diagnosticsSettings.dontShowCrashDialog': 'No mostrar el informe de fallos automaticamente',
      })[key] ?? `[${key}]`;
    render(
      <ContextProvider services={services(t)}>
        <DiagnosticsSettings />
      </ContextProvider>,
    );
    const blurb = screen.getByTestId('diagnostics-privacy-blurb');
    expect(blurb.querySelectorAll('ul')).toHaveLength(2);
    expect(blurb.querySelectorAll('li')).toHaveLength(3);
    expect(blurb.textContent).not.toContain('- ');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar todo ahora' })).toBeInTheDocument();
    expect(screen.getByText('No mostrar el informe de fallos automaticamente')).toBeInTheDocument();
  });
});
