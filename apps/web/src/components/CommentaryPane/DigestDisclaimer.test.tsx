/**
 * Component tests for DigestDisclaimer.
 *
 * Pattern: Store-connected component with conditional rendering.
 * react-i18next is mocked to return keys. The real settingsStore is used and
 * reset between tests. moduleDescriptions is partially mocked so tests control
 * which disclaimer text is returned without depending on actual module data.
 * Store mutations that happen after initial render are wrapped in act().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Mock moduleDescriptions so we control the disclaimer text returned
vi.mock('../../moduleDescriptions', () => ({
  getDigestDisclaimer: () => 'Default digest disclaimer text.',
  getModuleDisclaimer: (moduleAbbr: string) => {
    if (moduleAbbr === 'TEST_MOD') return 'Test module disclaimer.';
    if (moduleAbbr === 'NO_DISCLAIMER') return undefined;
    return undefined;
  },
}));

import { DigestDisclaimer } from './DigestDisclaimer';
import { settingsStore } from '../../stores/settingsStore';

describe('DigestDisclaimer', () => {
  beforeEach(() => {
    // Clear all dismissed disclaimers before each test, through the public API:
    // `notify()` is protected on `Store`, and assigning the array directly
    // skipped the persistence `removeDismissedDisclaimerModule` also does.
    for (const module of [...settingsStore.dismissedDisclaimerModules]) {
      settingsStore.removeDismissedDisclaimerModule(module);
    }
  });

  // ── Default (no moduleAbbr) ──────────────────────────────────────────────

  it('renders the default DIGEST_DISCLAIMER text when no moduleAbbr is given', () => {
    render(<DigestDisclaimer />);
    expect(screen.getByText('Default digest disclaimer text.')).toBeTruthy();
  });

  it('renders the full disclaimer container when not dismissed', () => {
    const { container } = render(<DigestDisclaimer />);
    expect(container.querySelector('.digest-disclaimer')).toBeTruthy();
  });

  it('renders the dismiss button', () => {
    const { container } = render(<DigestDisclaimer />);
    expect(container.querySelector('.digest-disclaimer__dismiss')).toBeTruthy();
  });

  it('renders the info icon', () => {
    const { container } = render(<DigestDisclaimer />);
    expect(container.querySelector('.fa-circle-info')).toBeTruthy();
  });

  it('switches to the restore button after clicking dismiss', () => {
    const { container } = render(<DigestDisclaimer />);
    fireEvent.click(container.querySelector('.digest-disclaimer__dismiss')!);
    expect(container.querySelector('.digest-disclaimer-restore')).toBeTruthy();
    expect(container.querySelector('.digest-disclaimer')).toBeNull();
  });

  it('restore button shows default collapsed label (translation key)', () => {
    const { container } = render(<DigestDisclaimer />);
    fireEvent.click(container.querySelector('.digest-disclaimer__dismiss')!);
    expect(screen.getByText('digestDisclaimer.notice')).toBeTruthy();
  });

  it('uses custom collapsedLabel when provided', () => {
    const { container } = render(<DigestDisclaimer collapsedLabel="AI Notice" />);
    fireEvent.click(container.querySelector('.digest-disclaimer__dismiss')!);
    expect(screen.getByText('AI Notice')).toBeTruthy();
  });

  it('restores the full disclaimer after clicking the restore button', () => {
    const { container } = render(<DigestDisclaimer />);
    // Dismiss
    fireEvent.click(container.querySelector('.digest-disclaimer__dismiss')!);
    expect(container.querySelector('.digest-disclaimer-restore')).toBeTruthy();
    // Restore
    fireEvent.click(container.querySelector('.digest-disclaimer-restore')!);
    expect(container.querySelector('.digest-disclaimer')).toBeTruthy();
    expect(container.querySelector('.digest-disclaimer-restore')).toBeNull();
  });

  // ── With moduleAbbr ──────────────────────────────────────────────────────

  it('renders module-specific disclaimer when moduleAbbr is given', () => {
    render(<DigestDisclaimer moduleAbbr="TEST_MOD" />);
    expect(screen.getByText('Test module disclaimer.')).toBeTruthy();
  });

  it('returns null when the module has no disclaimer', () => {
    const { container } = render(<DigestDisclaimer moduleAbbr="NO_DISCLAIMER" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows dismissed restore button when moduleAbbr is already dismissed in store', () => {
    settingsStore.addDismissedDisclaimerModule('TEST_MOD');
    const { container } = render(<DigestDisclaimer moduleAbbr="TEST_MOD" />);
    expect(container.querySelector('.digest-disclaimer-restore')).toBeTruthy();
  });

  // ── Store reactivity ─────────────────────────────────────────────────────

  it('reacts to store changes — shows restore when another part of the app dismisses', () => {
    const { container } = render(<DigestDisclaimer />);
    // Full disclaimer visible
    expect(container.querySelector('.digest-disclaimer')).toBeTruthy();

    // External store mutation (e.g., another component dismisses it)
    act(() => {
      settingsStore.addDismissedDisclaimerModule('SYNTHESIS');
    });

    expect(container.querySelector('.digest-disclaimer-restore')).toBeTruthy();
  });

  it('reacts to store changes — shows full disclaimer when restored externally', () => {
    settingsStore.addDismissedDisclaimerModule('SYNTHESIS');
    const { container } = render(<DigestDisclaimer />);
    // Restore button visible
    expect(container.querySelector('.digest-disclaimer-restore')).toBeTruthy();

    act(() => {
      settingsStore.removeDismissedDisclaimerModule('SYNTHESIS');
    });

    expect(container.querySelector('.digest-disclaimer')).toBeTruthy();
  });
});
