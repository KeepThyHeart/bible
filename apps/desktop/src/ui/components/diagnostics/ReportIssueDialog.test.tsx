/**
 * "Give Feedback" / "Report an Issue" -> what the user is told afterwards.
 *
 * The interesting part is not that a confirmation appears; it is that the
 * confirmation is *true*. Submitting writes the payload into
 * `{userData}/diagnostics/queue/`; the dialog then asks the main process to
 * deliver it (`deliverReport`) and says "sent" only when that came back sent.
 * Otherwise it names why the message is still waiting - web requests off, no
 * connection, no destination - or, after 3 s, that it is still sending in the
 * background. The dangerous failure mode is claiming "sent" when nothing has
 * left the machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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
const deliverReport = vi.fn();

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
      deliverReport: (...args: unknown[]) => deliverReport(...args),
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

/** Opt in to attaching diagnostics (the box starts unticked). */
function tickIncludeDiagnostics(): void {
  const box = screen.getByRole('checkbox');
  expect(box).not.toBeChecked();
  fireEvent.click(box);
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
    deliverReport.mockReset();
    // Default: the endpoint takes it at once.
    deliverReport.mockResolvedValue({ ok: true, value: { status: 'sent' } });
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

  it('starts with diagnostics unticked and sends description-only feedback', async () => {
    // Diagnostic data is opt-in: a user who just types and presses Send must
    // send their words and nothing else.
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f1', willUpload: true } });

    openDialog();
    await screen.findByRole('dialog');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    typeDescription('the menu is hard to find');
    send();

    await screen.findByTestId('report-issue-success');
    expect(submitFeedback).toHaveBeenCalledWith({ description: 'the menu is hard to find' });
    expect(submitManualReport).not.toHaveBeenCalled();
    expect(getStateSnapshot).not.toHaveBeenCalled();
  });

  it('confirms delivery when an endpoint is configured', async () => {
    submitManualReport.mockResolvedValue({
      ok: true,
      value: { reportId: 'r1', willUpload: true },
    });

    openDialog();
    await screen.findByRole('dialog');
    tickIncludeDiagnostics();
    typeDescription('the xref link did nothing');
    send();

    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveTextContent('Thank you');
    expect(success).toHaveTextContent(/has been sent/);
    // The honest-but-wrong-here wording must not also be on screen.
    expect(success).not.toHaveTextContent(/saved on this computer/);
    // It asked about the very report it just queued.
    expect(deliverReport).toHaveBeenCalledWith('r1');
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
    tickIncludeDiagnostics();
    typeDescription('commentary font is too small');
    send();

    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveTextContent('Thank you');
    expect(success).toHaveTextContent(/saved on this computer/);
    expect(success).toHaveTextContent(/Preferences → Diagnostics/);
    expect(success).not.toHaveTextContent(/has been sent/);
    // Nothing would collect it, so there is nothing to wait for.
    expect(deliverReport).not.toHaveBeenCalled();
  });

  it('falls back to the saved-locally wording when the receipt says nothing', async () => {
    // An older main process returned the bare report id. Unknown must not be
    // read as "delivered".
    submitFeedback.mockResolvedValue({ ok: true, value: '2026-01-01-feedback-ab12' });

    openDialog();
    await screen.findByRole('dialog');
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
    tickIncludeDiagnostics();
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
    tickIncludeDiagnostics();
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
    tickIncludeDiagnostics();
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
    // And the diagnostics box is back to unticked: consent is per report.
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  // ---- Give Feedback mode -------------------------------------------------

  function openFeedback(): void {
    render(<ReportIssueDialog />);
    fireEvent(window, new CustomEvent('command:help:giveFeedback'));
  }

  function typeMessage(text: string): void {
    fireEvent.change(screen.getByTestId('report-issue-description'), { target: { value: text } });
  }

  it('opens as a lightweight Give Feedback form: message, optional contact, no diagnostics box', async () => {
    openFeedback();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Give Feedback');
    expect(screen.getByTestId('feedback-contact')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('sends the contact only when one was typed', async () => {
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f2', willUpload: true } });
    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('love the parallel view');
    fireEvent.change(screen.getByTestId('feedback-contact'), { target: { value: '  me@example.com ' } });
    send();
    await screen.findByTestId('report-issue-success');
    expect(submitFeedback).toHaveBeenCalledWith({
      description: 'love the parallel view',
      contact: 'me@example.com',
    });
  });

  it('can switch from feedback to a full issue report, keeping the text', async () => {
    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('the search froze');
    fireEvent.click(screen.getByTestId('feedback-switch-to-issue'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Report an Issue');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('the search froze');
  });

  it('shows a sending state, then "sent" when delivery is quick', async () => {
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f3', willUpload: true } });
    let finish!: (v: unknown) => void;
    deliverReport.mockReturnValue(new Promise((res) => (finish = res)));

    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('quick one');
    send();

    const busy = await screen.findByRole('button', { name: 'Sending…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => {
      finish({ ok: true, value: { status: 'sent' } });
    });
    const success = await screen.findByTestId('report-issue-success');
    expect(success).toHaveAttribute('data-delivery', 'sent');
    expect(success).toHaveTextContent('Your message has been sent.');
  });

  describe('after the 3 second deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('says it is sending in the background, then updates if it lands while open', async () => {
      submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f4', willUpload: true } });
      let finish!: (v: unknown) => void;
      deliverReport.mockReturnValue(new Promise((res) => (finish = res)));

      openFeedback();
      await screen.findByRole('dialog');
      typeMessage('slow network');
      send();
      await screen.findByRole('button', { name: 'Sending…' });

      // (The exact boundary is pinned in deliverWithDeadline.test.ts; this
      // timer also lets real time through, so leave a margin either side.)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(screen.queryByTestId('report-issue-success')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      const panel = await screen.findByTestId('report-issue-success');
      expect(panel).toHaveAttribute('data-delivery', 'background');
      expect(panel).toHaveTextContent(/still sending in the background/);
      // It can be closed now.
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();

      await act(async () => {
        finish({ ok: true, value: { status: 'sent' } });
      });
      await waitFor(() =>
        expect(screen.getByTestId('report-issue-success')).toHaveAttribute('data-delivery', 'sent')
      );
    });
  });

  it('names Allow Web Requests when that is what holds it back', async () => {
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f5', willUpload: true } });
    deliverReport.mockResolvedValue({ ok: true, value: { status: 'queued', reason: 'web-requests-off' } });

    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('offline user');
    send();

    const panel = await screen.findByTestId('report-issue-success');
    expect(panel).toHaveAttribute('data-delivery', 'webOff');
    expect(panel).toHaveTextContent(/Privacy → Allow Web Requests/);
    expect(panel).not.toHaveTextContent(/has been sent/);
  });

  it('says it will retry when the server could not be reached', async () => {
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f6', willUpload: true } });
    deliverReport.mockResolvedValue({ ok: true, value: { status: 'queued', reason: 'unreachable' } });

    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('server down');
    send();

    const panel = await screen.findByTestId('report-issue-success');
    expect(panel).toHaveAttribute('data-delivery', 'waiting');
    expect(panel).toHaveTextContent(/try again automatically/);
  });

  it('returns to the form with the text when the server refuses it outright', async () => {
    submitFeedback.mockResolvedValue({ ok: true, value: { reportId: 'f7', willUpload: true } });
    deliverReport.mockResolvedValue({ ok: true, value: { status: 'rejected' } });

    openFeedback();
    await screen.findByRole('dialog');
    typeMessage('rejected text');
    send();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server could not accept this message.');
    expect(screen.queryByTestId('report-issue-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-issue-description')).toHaveValue('rejected text');
  });
});
