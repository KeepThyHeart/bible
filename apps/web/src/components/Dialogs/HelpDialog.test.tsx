/**
 * Component tests for HelpDialog.
 *
 * Pattern: Simple props-driven dialog — no store needed.
 * i18n is mocked to return translation keys as-is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.context) return `${key}:${opts.context}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { HelpDialog } from './HelpDialog';

describe('HelpDialog', () => {
  const onClose = vi.fn();

  /** Stub /api/config with the given payload; the dialog fetches it on open. */
  function stubConfig(payload: Record<string, unknown>): void {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response)));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default to desktop width
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
    // No docs site configured unless a test says otherwise.
    stubConfig({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ------------------------------------------------------------------
  // Open / closed state
  // ------------------------------------------------------------------
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<HelpDialog isOpen={false} onClose={onClose} />);
    expect(container.querySelector('.help-dialog')).toBeNull();
  });

  it('renders the dialog when isOpen is true', () => {
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(container.querySelector('.help-dialog')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Close interactions
  // ------------------------------------------------------------------
  it('calls onClose when the close button is clicked', () => {
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    const closeBtn = container.querySelector<HTMLElement>('.help-dialog__close')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the overlay is clicked', () => {
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    const overlay = container.querySelector<HTMLElement>('.settings-panel-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the dialog', () => {
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    const dialog = container.querySelector<HTMLElement>('.help-dialog')!;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when a different key is pressed', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Content sections — desktop
  // ------------------------------------------------------------------
  it('renders the title', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(screen.getByText('title')).toBeTruthy();
  });

  it('renders the gettingStarted section heading', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(screen.getByText('gettingStarted.title')).toBeTruthy();
  });

  it('renders the settings section', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(screen.getByText('settings.title')).toBeTruthy();
  });

  it('renders the shortcuts section on desktop', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(screen.getByText('shortcuts.title')).toBeTruthy();
  });

  it('renders Ctrl+K shortcut on desktop', () => {
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    const kbds = container.querySelectorAll('kbd');
    const ctrlK = Array.from(kbds).find(k => k.textContent === 'Ctrl+K');
    expect(ctrlK).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Documentation website link
  // ------------------------------------------------------------------
  it('renders the docs link when /api/config supplies a docsUrl', async () => {
    stubConfig({ docsUrl: 'https://docs.example.com/guide' });
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    const link = await screen.findByTestId('help-docs-link');
    expect(link.getAttribute('href')).toBe('https://docs.example.com/guide');
    // External navigation must not hand the docs site a window opener handle.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders no docs link when the config omits docsUrl', async () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('help-docs-link')).toBeNull();
  });

  it('renders no docs link when docsUrl is empty', async () => {
    stubConfig({ docsUrl: '' });
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('help-docs-link')).toBeNull();
  });

  it('does not fetch config while closed', () => {
    render(<HelpDialog isOpen={false} onClose={onClose} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Feedback entry point
  // ------------------------------------------------------------------
  it('renders the feedback entry point when onSendFeedback is supplied', () => {
    const onSendFeedback = vi.fn();
    render(<HelpDialog isOpen={true} onClose={onClose} onSendFeedback={onSendFeedback} />);
    fireEvent.click(screen.getByTestId('help-feedback-btn'));
    expect(onSendFeedback).toHaveBeenCalled();
  });

  it('renders no feedback entry point without onSendFeedback', () => {
    render(<HelpDialog isOpen={true} onClose={onClose} />);
    expect(screen.queryByTestId('help-feedback-btn')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Mobile layout differences
  // ------------------------------------------------------------------
  it('does not render the shortcuts section on mobile', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });
    fireEvent(window, new Event('resize'));
    // Re-render to pick up mobile state
    const { container } = render(<HelpDialog isOpen={true} onClose={onClose} />);
    // Shortcuts table only appears on desktop
    const shortcutsTable = container.querySelector('.help-dialog__shortcuts');
    expect(shortcutsTable).toBeNull();
  });
});
