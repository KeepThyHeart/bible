/**
 * ReportIssueDialog - the in-app "Give Feedback" and "Report an Issue" modal.
 *
 * One dialog, two entry points, two modes:
 *
 *   - `command:help:giveFeedback` -> feedback mode. A short message and an
 *     optional contact, like the web app's feedback form. Always calls
 *     `diagnostics:submit-feedback` (no snapshot, no OS info). Reached from
 *     the header Help "?" panel and Help -> Give Feedback.
 *   - `command:help:reportIssue` -> issue mode, the original dialog. The
 *     "Include diagnostic information" checkbox picks the channel:
 *       unchecked -> `diagnostics:submit-feedback` (description-only). This is
 *                    the default: diagnostic data is opt-in, per report.
 *       checked   -> `diagnostics:submit-manual-report` (state snapshot and
 *                    environment info attached).
 *
 * Both modes share one send path, which is the point of keeping them in one
 * component:
 *
 *   1. Submit enqueues the payload in `{userData}/diagnostics/queue/`. From
 *      here on it cannot be lost - a failed send is retried by the uploader.
 *   2. Immediately `diagnostics:deliver-report` asks the main process to try
 *      sending that report now, and the dialog shows "Sending...".
 *   3. If that settles within {@link DELIVERY_DEADLINE_MS} (it usually takes
 *      well under a second) the dialog says what really happened: sent, or
 *      saved-and-why (web requests off, no connection, no destination).
 *   4. If it has not settled by then, the dialog says the message is saved
 *      and will finish sending in the background, and can be closed. If it is
 *      still open when delivery settles, it updates to the real outcome.
 *
 * Delivery goes through the uploader and its NetworkGateway, so the app's
 * network permission model holds: with Privacy -> Allow Web Requests off
 * nothing is contacted, and the dialog says so plainly instead of "sent".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../contexts/useI18n';
import { getDiagnosticsPrivacyBlurb } from './privacyBlurb';
import {
  deliverWithDeadline,
  type DeliveryResult,
} from './deliverWithDeadline';

export { DELIVERY_DEADLINE_MS } from './deliverWithDeadline';

interface ResultEnvelope<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

function isOkEnvelope<T>(x: unknown): x is { ok: true; value: T } {
  return !!x && typeof x === 'object' && (x as { ok?: boolean }).ok === true;
}

function errorMessageFromEnvelope(x: unknown): string {
  if (x && typeof x === 'object') {
    const env = x as ResultEnvelope<unknown>;
    if (env.ok === false && env.error?.message) return env.error.message;
  }
  return 'Unknown error';
}

/**
 * Read the submit receipt. Anything unrecognised - an older main process
 * still returning the bare report id, an envelope shape that changed - reads
 * as "will not upload, id unknown", which lands on the saved-on-this-computer
 * wording: true whether or not anything is ever sent.
 */
function receiptFromEnvelope(x: unknown): { reportId: string | null; willUpload: boolean } {
  if (!isOkEnvelope<unknown>(x)) return { reportId: null, willUpload: false };
  const value = x.value;
  if (!value || typeof value !== 'object') return { reportId: null, willUpload: false };
  const v = value as { reportId?: unknown; willUpload?: unknown };
  return {
    reportId: typeof v.reportId === 'string' && v.reportId ? v.reportId : null,
    willUpload: v.willUpload === true,
  };
}

export type DialogMode = 'feedback' | 'issue';

/**
 * What the finished panel tells the user. Each maps to exactly one sentence,
 * chosen so it is true for that state:
 *
 *  - `sent`        - the endpoint accepted it.
 *  - `background`  - still sending after the deadline; it is on disk either way.
 *  - `webOff`      - Privacy -> Allow Web Requests is off; names the switch.
 *  - `waiting`     - no connection / server unreachable / rate-limited.
 *  - `noEndpoint`  - this build or user has no destination configured.
 */
export type DeliveryNotice = 'sent' | 'background' | 'webOff' | 'waiting' | 'noEndpoint';

/** `null` means the server refused the report outright (it is not queued). */
export function noticeForResult(result: DeliveryResult): DeliveryNotice | null {
  if (result.status === 'sent') return 'sent';
  if (result.status === 'rejected') return null;
  switch (result.reason) {
    case 'web-requests-off':
      return 'webOff';
    case 'no-endpoint':
      return 'noEndpoint';
    default:
      return 'waiting';
  }
}

const NOTICE_KEYS: Record<DeliveryNotice, string> = {
  sent: 'reportIssueDialog.deliverySent',
  background: 'reportIssueDialog.deliveryBackground',
  webOff: 'reportIssueDialog.deliveryWebRequestsOff',
  waiting: 'reportIssueDialog.deliveryWaiting',
  noEndpoint: 'reportIssueDialog.successBodySaved',
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '0.8125rem',
  borderRadius: 4,
  border: 'none',
  background: 'var(--theme-accent-primary, #2563eb)',
  color: 'var(--theme-accent-text, #fff)',
  cursor: 'pointer',
};

const FIELD_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: 8,
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  border: '1px solid var(--theme-border, #ccc)',
  borderRadius: 4,
  backgroundColor: 'var(--theme-bg-primary, #fff)',
  color: 'inherit',
  boxSizing: 'border-box',
};

/** Matches FEEDBACK_CONTACT_MAX_LENGTH in electron/services/DiagnosticsService.ts. */
const CONTACT_MAX_LENGTH = 200;

const ReportIssueDialog: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>('issue');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  // Opt-in: diagnostic data is attached only when the user ticks the box.
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Non-null once the report has been accepted: the dialog switches to the
  // finished panel, and the notice picks its sentence.
  const [notice, setNotice] = useState<DeliveryNotice | null>(null);
  // Bumped on every open/close so a delivery that settles after the dialog
  // was closed (or reopened for a new message) cannot repaint it.
  const sessionRef = useRef(0);

  const reset = useCallback((): void => {
    sessionRef.current += 1;
    setDescription('');
    setContact('');
    setIncludeDiagnostics(false);
    setSnapshot(null);
    setSnapshotLoading(false);
    setSubmitting(false);
    setSubmitError(null);
    setNotice(null);
  }, []);

  // Lazily fetch the state snapshot the first time the checkbox is enabled,
  // then cache for the lifetime of this dialog instance.
  const fetchSnapshotIfNeeded = useCallback(async (): Promise<void> => {
    if (snapshot !== null || snapshotLoading) return;
    setSnapshotLoading(true);
    try {
      const raw = await window.electron?.diagnostics?.getStateSnapshot?.();
      if (isOkEnvelope<unknown>(raw)) {
        setSnapshot(raw.value);
      } else {
        setSnapshot({
          _note: 'Unable to fetch state snapshot',
          error: errorMessageFromEnvelope(raw),
        });
      }
    } catch (err) {
      window.electron?.log?.error?.('[ReportIssueDialog] getStateSnapshot failed', err);
      setSnapshot({ _note: 'Unable to fetch state snapshot' });
    } finally {
      setSnapshotLoading(false);
    }
  }, [snapshot, snapshotLoading]);

  useEffect(() => {
    const openAs = (next: DialogMode) => (): void => {
      reset();
      setMode(next);
      setOpen(true);
    };
    const onIssue = openAs('issue');
    const onFeedback = openAs('feedback');
    window.addEventListener('command:help:reportIssue', onIssue);
    window.addEventListener('command:help:giveFeedback', onFeedback);
    return () => {
      window.removeEventListener('command:help:reportIssue', onIssue);
      window.removeEventListener('command:help:giveFeedback', onFeedback);
    };
  }, [reset]);

  const attachDiagnostics = mode === 'issue' && includeDiagnostics;

  useEffect(() => {
    if (open && attachDiagnostics) {
      void fetchSnapshotIfNeeded();
    }
  }, [open, attachDiagnostics, fetchSnapshotIfNeeded]);

  const close = useCallback((): void => {
    setOpen(false);
    reset();
  }, [reset]);

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = description.trim();
    if (!trimmed) return;
    const session = sessionRef.current;
    const stillHere = (): boolean => sessionRef.current === session;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');

      // 1. Durable enqueue. Until this resolves OK nothing has been saved.
      let envelope: unknown;
      if (attachDiagnostics) {
        envelope = await api.submitManualReport({ description: trimmed, includeDiagnostics: true });
      } else if (mode === 'feedback' && contact.trim()) {
        envelope = await api.submitFeedback({ description: trimmed, contact: contact.trim() });
      } else {
        envelope = await api.submitFeedback({ description: trimmed });
      }
      if (!stillHere()) return;
      if (!isOkEnvelope<unknown>(envelope)) {
        setSubmitError(errorMessageFromEnvelope(envelope));
        setSubmitting(false);
        return;
      }

      const receipt = receiptFromEnvelope(envelope);
      if (!receipt.willUpload) {
        setNotice('noEndpoint');
        setSubmitting(false);
        return;
      }
      const deliverReport = api.deliverReport;
      if (!receipt.reportId || typeof deliverReport !== 'function') {
        // Queued, and the main process started sending it, but there is no
        // way to ask how that went: the honest sentence is "in the background".
        setNotice('background');
        setSubmitting(false);
        return;
      }

      // 2-4. Try to send it now; stop waiting at the deadline.
      const reportId = receipt.reportId;
      const outcome = await deliverWithDeadline(() => deliverReport(reportId));
      if (!stillHere()) return;
      setSubmitting(false);

      const show = (result: DeliveryResult): void => {
        const next = noticeForResult(result);
        if (next) {
          setNotice(next);
        } else {
          // Refused outright and dropped from the queue - so not "saved".
          // Back to the form with the text intact, to try again.
          setNotice(null);
          setSubmitError(t('reportIssueDialog.deliveryRejected'));
        }
      };

      if (outcome.kind === 'settled') {
        show(outcome.result);
      } else {
        setNotice('background');
        void outcome.later.then((result) => {
          if (stillHere()) show(result);
        });
      }
    } catch (err) {
      if (!stillHere()) return;
      const message = err instanceof Error ? err.message : String(err);
      setSubmitError(message);
      setSubmitting(false);
      window.electron?.log?.error?.('[ReportIssueDialog] submit failed', err);
    }
  }, [description, contact, mode, attachDiagnostics, t]);

  // Escape maps to exactly what the Cancel button does - including discarding a
  // half-typed description - and is ignored mid-submit, matching that button's
  // disabled state. On the finished panel there is nothing left to discard, so
  // it simply dismisses.
  const dialogRef = useFocusTrap<HTMLDivElement>(open, () => {
    if (!submitting) close();
  });

  if (!open) return null;

  const sendDisabled = submitting || description.trim().length === 0;
  const isFeedback = mode === 'feedback';

  return (
    <div
      ref={dialogRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-dialog-title"
      data-testid={isFeedback ? 'feedback-dialog' : 'report-issue-dialog'}
    >
      <div
        style={{
          maxWidth: 600,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          backgroundColor: 'var(--theme-bg-primary, #ffffff)',
          color: 'var(--theme-text-primary, #111)',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h2
          id="report-issue-dialog-title"
          style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 0, marginBottom: 12 }}
        >
          {isFeedback ? t('feedbackDialog.title') : t('reportIssueDialog.title')}
        </h2>

        {notice ? (
          <div role="status" data-testid="report-issue-success" data-delivery={notice}>
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, margin: '0 0 8px 0' }}>
              {t('reportIssueDialog.successTitle')}
            </p>
            <p
              style={{
                fontSize: '0.8125rem',
                lineHeight: 1.5,
                margin: 0,
                color: 'var(--theme-text-secondary, #555)',
              }}
            >
              {t(NOTICE_KEYS[notice])}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={close} style={PRIMARY_BUTTON_STYLE}>
                {t('reportIssueDialog.close')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: '0.8125rem', marginTop: 8 }}>
              {isFeedback ? t('feedbackDialog.messageLabel') : t('reportIssueDialog.descriptionLabel')}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={isFeedback ? 5 : 6}
                disabled={submitting}
                placeholder={
                  isFeedback
                    ? t('feedbackDialog.messagePlaceholder')
                    : t('reportIssueDialog.descriptionPlaceholder')
                }
                data-testid="report-issue-description"
                style={{ ...FIELD_STYLE, resize: 'vertical' }}
              />
            </label>

            {isFeedback ? (
              <>
                <label style={{ display: 'block', fontSize: '0.8125rem', marginTop: 12 }}>
                  {t('feedbackDialog.contactLabel')}
                  <input
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    maxLength={CONTACT_MAX_LENGTH}
                    disabled={submitting}
                    placeholder={t('feedbackDialog.contactPlaceholder')}
                    data-testid="feedback-contact"
                    style={FIELD_STYLE}
                  />
                </label>
                <p
                  style={{
                    fontSize: '0.75rem',
                    lineHeight: 1.5,
                    margin: '8px 0 0 0',
                    color: 'var(--theme-text-secondary, #555)',
                  }}
                >
                  {t('feedbackDialog.privacyNote')}{' '}
                  <button
                    type="button"
                    onClick={() => setMode('issue')}
                    disabled={submitting}
                    data-testid="feedback-switch-to-issue"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: 'var(--theme-accent-primary, #2563eb)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    {t('feedbackDialog.switchToIssue')}
                  </button>
                </p>
              </>
            ) : (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                  fontSize: '0.8125rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={includeDiagnostics}
                  disabled={submitting}
                  onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                />
                {t('reportIssueDialog.includeDiagnostics')}
              </label>
            )}

            {attachDiagnostics && (
              <div style={{ marginTop: 12 }}>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    fontSize: '0.75rem',
                    lineHeight: 1.5,
                    margin: 0,
                    color: 'var(--theme-text-secondary, #555)',
                  }}
                >
                  {getDiagnosticsPrivacyBlurb(t)}
                </pre>

                <details style={{ marginTop: 8, fontSize: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {t('reportIssueDialog.viewDiagnosticData')}
                  </summary>
                  <pre
                    style={{
                      maxHeight: 220,
                      overflow: 'auto',
                      padding: 8,
                      margin: '8px 0 0 0',
                      backgroundColor: 'var(--theme-bg-secondary, #f5f5f5)',
                      borderRadius: 4,
                      fontSize: '0.6875rem',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {snapshotLoading
                      ? t('reportIssueDialog.snapshotLoading')
                      : snapshot !== null
                        ? JSON.stringify(snapshot, null, 2)
                        : t('reportIssueDialog.snapshotEmpty')}
                  </pre>
                </details>
              </div>
            )}

            {submitError && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: 8,
                  fontSize: '0.8125rem',
                  color: 'var(--theme-error-text, #991b1b)',
                  backgroundColor: 'var(--theme-error-bg, #fee2e2)',
                  border: '1px solid var(--theme-error-border, #fecaca)',
                  borderRadius: 4,
                }}
              >
                {t('reportIssueDialog.sendError', { message: submitError, })}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                style={{
                  padding: '6px 14px',
                  fontSize: '0.8125rem',
                  borderRadius: 4,
                  border: '1px solid var(--theme-border, #ccc)',
                  background: 'var(--theme-bg-secondary, #f5f5f5)',
                  color: 'inherit',
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {t('reportIssueDialog.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sendDisabled}
                aria-busy={submitting}
                data-testid="report-issue-send"
                style={{
                  ...PRIMARY_BUTTON_STYLE,
                  background: sendDisabled
                    ? 'var(--theme-accent-disabled, #94a3b8)'
                    : 'var(--theme-accent-primary, #2563eb)',
                  cursor: sendDisabled ? 'default' : 'pointer',
                }}
              >
                {submitting ? t('reportIssueDialog.sending') : t('reportIssueDialog.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportIssueDialog;
