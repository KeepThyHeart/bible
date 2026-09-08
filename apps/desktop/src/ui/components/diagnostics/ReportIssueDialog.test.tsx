/**
 * "Report an Issue" -> what the user is told afterwards.
 *
 * The interesting part is not that a confirmation appears; it is that the
 * confirmation is *true*. Submitting only writes the payload into
 * `{userData}/diagnostics/queue/`, and the background uploader does nothing at
 * all unless diagnostics is enabled with an endpoint URL - both off by
 * default. So there are two wordings, chosen by `SubmitReceipt.willUpload`,
 * and the dangerous failure mode is claiming "sent" on a default install where
 * nothing has been or will be sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  // Echo the key back: `tf()` treats a bare echo as "no such key" and renders
  // its English source, so these assertions read the shipped English copy.
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

import ReportIssueDialog from './ReportIssueDialog';
import { enT } from '../../testing/enCatalog';

const submitManualReport = vi.fn();
const submitFeedback = vi.fn();
const getStateSnapshot = vi.fn();

type ElectronWindow = typeof globalThis & { electron?: unknown };

// `vitest.setup.ts` defines window.electron as writable-but-not-configurable,
// so it can be reassigned but never deleted - restore the stub instead.
const originalElectron = (globalThis as ElectronWindow).electron;

function installBridge(): void {
  (globalThis as ElectronWindow).electron = {
    diagnostics: {
      submitManualReport: (...args: unknown[]) => submitManualReport(...args),
      submitFeedback: (...args: unknown[]) => submitFeedback(...args),
      getStateSnapshot: () => getStateSnapshot(),
    },
    log: { error: vi.fn(), info: vi.fn() },
  };
}

function openDialog(): void {
  render(<ReportIssueDialog />);
  fireEvent(window, new CustomEvent('command:help:reportIssue'));
}

function typeDescription(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

function send(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('ReportIssueDialog', () => {
  beforeEach(() => {
    submitManualReport.mockReset();
    submitFeedback.mockReset();
    getStateSnapshot.mockReset();
    getStateSnapshot.mockResolvedValue({ ok: true, value: { panes: [] } });
    installBridge();
  });

  afterEach(() => {
    (globalThis as ElectronWindow).electron = originalElectron;
  });

  it('opens on the Help-menu command and closes on Cancel', async () => {
    openDialog();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('confirms delivery when an endpoint is configured', async () => {
    submitManualReport.mockResolvedValue({
      ok: true,
      value: { reportId: 'r1', willUpload: true },
    });

    openDialog();
    await screen.findByRole('dialog');
    typeDescription('the xref link did nothing');
    send();

    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveTextContent('Thank you');
    expect(success).toHaveTextContent(/has been sent/);
    // The honest-but-wrong-here wording must not also be on screen.
    expect(success).not.toHaveTextContent(/saved on this computer/);
  });

  it('says the report is only saved locally when nothing will collect it', async () => {
    // The default install: diagnostics off, no endpoint. Claiming "sent" here
    // would be a lie - nothing has left the machine and nothing will.
    submitManualReport.mockResolvedValue({
      ok: true,
      value: { reportId: 'r2', willUpload: false },
    });

    openDialog();
    await screen.findByRole('dialog');
    typeDescription('commentary font is too small');
    send();

    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveTextContent('Thank you');
    expect(success).toHaveTextContent(/saved on this computer/);
    expect(success).toHaveTextContent(/Preferences → Diagnostics/);
    expect(success).not.toHaveTextContent(/has been sent/);
  });

  it('falls back to the saved-locally wording when the receipt says nothing', async () => {
    // An older main process returned the bare report id. Unknown must not be
    // read as "delivered".
    submitFeedback.mockResolvedValue({ ok: true, value: '2026-01-01-feedback-ab12' });

    openDialog();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox'));
    typeDescription('bigger commentary font please');
    send();

    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveTextContent(/saved on this computer/);
    expect(submitFeedback).toHaveBeenCalledWith({
      description: 'bigger commentary font please',
    });
  });

  it('stays open on the thank-you panel until it is dismissed', async () => {
    // Closing the dialog the instant the envelope comes back would be
    // indistinguishable from the dialog being dismissed.
    submitManualReport.mockResolvedValue({
      ok: true,
      value: { reportId: 'r3', willUpload: true },
    });

    openDialog();
    await screen.findByRole('dialog');
    typeDescription('something broke');
    send();

    await screen.findByTestId('report-issue-success');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The form is gone - one action, not a second Send.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves the error branch alone — no thank-you, and the text survives', async () => {
    submitManualReport.mockResolvedValue({
      ok: false,
      error: { code: 'unavailable', message: 'Diagnostics queue not initialized' },
    });

    openDialog();
    await screen.findByRole('dialog');
    typeDescription('a description worth keeping');
    send();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not send report: Diagnostics queue not initialized');
    expect(screen.queryByTestId('report-issue-success')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('a description worth keeping');
  });

  it('reopens on a clean form after a report was sent', async () => {
    submitManualReport.mockResolvedValue({
      ok: true,
      value: { reportId: 'r4', willUpload: true },
    });

    openDialog();
    await screen.findByRole('dialog');
    typeDescription('first report');
    send();
    await screen.findByTestId('report-issue-success');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent(window, new CustomEvent('command:help:reportIssue'));
    await screen.findByRole('dialog');
    // Not still showing the previous submission's thank-you.
    expect(screen.queryByTestId('report-issue-success')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
