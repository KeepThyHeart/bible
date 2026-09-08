/**
 * Component tests for the machine-generated content notice.
 *
 * Ported from the web app's `DigestDisclaimer.test.tsx` and extended for the
 * desktop-specific behaviour: metadata-driven detection, session-scoped
 * collapse, accessibility wiring, and the theming/RTL constraints the notice
 * has to honour.
 *
 * `commentaryAPI.getCommentaryInfo` is mocked so tests control what a module's
 * own metadata says. The i18n service is mocked twice: once resolving the real
 * English catalog (the default, so assertions read the wording a user sees) and
 * once returning stand-in translations, to prove nothing is hardcoded.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getCommentaryInfo = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  commentaryAPI: {
    getCommentaryInfo: (abbr: string) => getCommentaryInfo(abbr),
  },
}));

import DigestDisclaimer, { resetDisclaimerCollapseState } from './DigestDisclaimer';
import { resetModuleProvenanceCache } from './useModuleProvenance';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { enT } from '../../testing/enCatalog';

/** Mock services whose `t()` resolves the real English catalog by default. */
function createMockServices(
  translate: (key: string) => string = (key) => enT(key),
): AppServices {
  const mockI18n = {
    t: translate,
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: mockI18n as unknown as AppServices['i18n'],
  };
}

function renderDisclaimer(
  ui: React.ReactElement,
  translate?: (key: string) => string,
) {
  return render(
    <ContextProvider services={createMockServices(translate)}>{ui}</ContextProvider>,
  );
}

const DIGEST_SENTENCE =
  'This is an auto-generated summary of a range of public-domain commentaries.';
const DIGEST_CAUTION =
  'Computers sometimes make mistakes in summarizing, and commentaries sometimes have false doctrines.';

describe('DigestDisclaimer', () => {
  beforeEach(() => {
    getCommentaryInfo.mockReset();
    getCommentaryInfo.mockResolvedValue({ author: 'Matthew Henry' });
    resetModuleProvenanceCache();
    resetDisclaimerCollapseState();
  });

  // -- The default SYNTHESIS commentary -------------------------------------

  it('discloses the digest module on first paint, before metadata resolves', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    expect(screen.getByTestId('module-disclaimer')).toBeTruthy();
    expect(screen.getByText(DIGEST_SENTENCE)).toBeTruthy();
  });

  it('states the caution sentence as well as the provenance sentence', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    expect(screen.getByText(DIGEST_CAUTION)).toBeTruthy();
  });

  it('is announced as a note with an accessible name', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    const note = screen.getByRole('note');
    expect(note.getAttribute('aria-label')).toBe('Content provenance notice');
  });

  it('carries the id callers use for aria-describedby', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" id="notice-1" />);
    expect(screen.getByTestId('module-disclaimer').id).toBe('notice-1');
  });

  // -- Non-AI commentary ----------------------------------------------------

  it('renders nothing for a human-authored commentary such as Matthew Henry', async () => {
    const { container } = renderDisclaimer(<DigestDisclaimer moduleAbbreviation="MHC" />);
    await waitFor(() => expect(getCommentaryInfo).toHaveBeenCalledWith('MHC'));
    expect(container.querySelector('[data-testid="module-disclaimer"]')).toBeNull();
  });

  it('renders nothing when no module abbreviation is supplied', () => {
    const { container } = renderDisclaimer(<DigestDisclaimer moduleAbbreviation={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the metadata lookup fails', async () => {
    getCommentaryInfo.mockRejectedValue(new Error('no such module'));
    const { container } = renderDisclaimer(<DigestDisclaimer moduleAbbreviation="Barnes" />);
    await waitFor(() => expect(getCommentaryInfo).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="module-disclaimer"]')).toBeNull();
  });

  // -- Metadata-driven detection (not just the hardcoded abbreviation) -------

  it('discloses a NEW AI module purely from its own author metadata', async () => {
    getCommentaryInfo.mockResolvedValue({ author: 'AI-generated from open sources' });
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="FUTURE_AI" />);
    expect(
      await screen.findByText(
        'This module’s text was generated automatically rather than written by a human author.',
      ),
    ).toBeTruthy();
  });

  it('discloses from the copyright field too', async () => {
    getCommentaryInfo.mockResolvedValue({ copyright: 'Produced by a large language model' });
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="FUTURE_AI2" />);
    expect(await screen.findByTestId('module-disclaimer')).toBeTruthy();
  });

  it('fetches a module’s metadata only once across renders', async () => {
    getCommentaryInfo.mockResolvedValue({ author: 'AI-generated' });
    renderDisclaimer(
      <>
        <DigestDisclaimer moduleAbbreviation="SHARED_AI" />
        <DigestDisclaimer moduleAbbreviation="SHARED_AI" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('module-disclaimer')).toHaveLength(2));
    expect(getCommentaryInfo).toHaveBeenCalledTimes(1);
  });

  // -- Collapse behaviour ---------------------------------------------------

  it('collapses to a labelled chip that still names the provenance', async () => {
    const user = userEvent.setup();
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    await user.click(screen.getByTestId('module-disclaimer-collapse'));

    const chip = screen.getByTestId('module-disclaimer-collapsed');
    expect(chip).toBeTruthy();
    // Collapsed is quieter, not silent - it still says the text is generated.
    expect(chip.textContent).toContain('Auto-generated summary');
    expect(screen.queryByTestId('module-disclaimer')).toBeNull();
  });

  it('dismisses via an X glyph, not a down-chevron (which conventionally means "expand")', async () => {
    const user = userEvent.setup();
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);

    const dismissButton = screen.getByTestId('module-disclaimer-collapse');
    const path = dismissButton.querySelector('svg path');
    // The down-chevron this replaced was `M19 9l-7 7-7-7`. An X reads as
    // "close/dismiss" regardless of the notice's expanded/collapsed
    // orientation, unlike a chevron whose meaning is directional.
    expect(path?.getAttribute('d')).toBe('M6 18L18 6M6 6l12 12');
    expect(path?.getAttribute('d')).not.toBe('M19 9l-7 7-7-7');

    await user.click(dismissButton);
    expect(screen.getByTestId('module-disclaimer-collapsed')).toBeTruthy();
  });

  it('expands again from the collapsed chip', async () => {
    const user = userEvent.setup();
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    await user.click(screen.getByTestId('module-disclaimer-collapse'));
    await user.click(screen.getByTestId('module-disclaimer-collapsed'));
    expect(screen.getByTestId('module-disclaimer')).toBeTruthy();
    expect(screen.queryByTestId('module-disclaimer-collapsed')).toBeNull();
  });

  it('reports collapse state through aria-expanded', async () => {
    const user = userEvent.setup();
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    expect(screen.getByTestId('module-disclaimer-collapse').getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByTestId('module-disclaimer-collapse'));
    expect(screen.getByTestId('module-disclaimer-collapsed').getAttribute('aria-expanded')).toBe('false');
  });

  it('shares collapse state across every instance for the same module', async () => {
    const user = userEvent.setup();
    renderDisclaimer(
      <>
        <DigestDisclaimer moduleAbbreviation="SYNTHESIS" />
        <DigestDisclaimer moduleAbbreviation="SYNTHESIS" />
      </>,
    );
    await user.click(screen.getAllByTestId('module-disclaimer-collapse')[0]);
    expect(screen.getAllByTestId('module-disclaimer-collapsed')).toHaveLength(2);
  });

  it('does not persist collapse state anywhere — a new session discloses again', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    await user.click(screen.getByTestId('module-disclaimer-collapse'));
    unmount();
    // Nothing about the notice may reach durable storage.
    expect(Object.keys(localStorage)).not.toContain('module-disclaimer');
    expect(
      Object.keys(localStorage).some((k) => /disclaim/i.test(k)),
    ).toBe(false);
  });

  it('omits the collapse control when collapsible is false', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" collapsible={false} />);
    expect(screen.queryByTestId('module-disclaimer-collapse')).toBeNull();
    expect(screen.getByTestId('module-disclaimer')).toBeTruthy();
  });

  // -- i18n -----------------------------------------------------------------

  it('renders catalog translations when the keys exist', () => {
    const translations: Record<string, string> = {
      'moduleDisclaimer.digest.provenance': 'Resumen generado automáticamente.',
      'moduleDisclaimer.digest.caution': 'Puede contener errores.',
      'moduleDisclaimer.regionLabel': 'Aviso de procedencia',
    };
    renderDisclaimer(
      <DigestDisclaimer moduleAbbreviation="SYNTHESIS" />,
      (key) => translations[key] ?? `[${key}]`,
    );
    expect(screen.getByText('Resumen generado automáticamente.')).toBeTruthy();
    expect(screen.getByText('Puede contener errores.')).toBeTruthy();
    expect(screen.getByRole('note').getAttribute('aria-label')).toBe('Aviso de procedencia');
  });

  it('never leaks a raw [key] placeholder to the user', () => {
    const { container } = renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    expect(container.textContent).not.toMatch(/\[moduleDisclaimer\./);
    expect(container.innerHTML).not.toMatch(/\[moduleDisclaimer\./);
  });

  // -- Theming and RTL constraints ------------------------------------------

  it('uses semantic theme tokens, never fixed palette colours', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    const html = screen.getByTestId('module-disclaimer').outerHTML;
    expect(html).toMatch(/bg-info-soft/);
    expect(html).toMatch(/text-info-text/);
    expect(html).toMatch(/border-info-border/);
    expect(html).not.toMatch(/\b(bg-white|bg-blue-\d+|text-gray-\d+|border-gray-\d+|bg-gray-\d+)\b/);
  });

  it('uses logical spacing and border utilities only', () => {
    renderDisclaimer(<DigestDisclaimer moduleAbbreviation="SYNTHESIS" />);
    const html = screen.getByTestId('module-disclaimer').outerHTML;
    expect(html).toMatch(/border-s-2/);
    expect(html).not.toMatch(/\b(pl-|pr-|ml-|mr-|text-left|text-right|border-l|border-r|left-|right-)/);
  });
});
