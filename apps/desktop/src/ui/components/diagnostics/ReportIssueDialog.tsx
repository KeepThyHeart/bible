/**
 * ReportIssueDialog - user-initiated "Report an Issue" modal, opened from the
 * Help menu (see {@link registerDiagnosticsCommands}).
 *
 * Two modes driven by the "Include diagnostic information" checkbox:
 *   - checked   -> calls `diagnostics:submit-manual-report` (attaches a state
 *                 snapshot and environment info)
 *   - unchecked -> calls `diagnostics:submit-feedback` (description-only,
 *                 no snapshot, no OS info)
 *
 * Submitting only *enqueues*. The payload is written to
 * `{userData}/diagnostics/queue/` and a background uploader POSTs it later, on
 * a 30-minute tick - and that uploader does nothing at all unless diagnostics
 * is enabled and an endpoint URL is set, both of which are off by default.
 *
 * That is why the thank-you has two wordings rather than one. The dialog used
 * to simply vanish on success, which told the user nothing; saying "sent"
 * instead would be worse, because on a default install nothing has been sent
 * and nothing is going to be until they configure a destination. The handler's
 * receipt (`SubmitReceipt.willUpload`) is what decides which sentence is true.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../contexts/useI18n';
import { getDiagnosticsPrivacyBlurb } from './privacyBlurb';

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
 * Did the main process say this report will actually be uploaded?
 *
 * Anything unrecognised - an older main process still returning the bare
 * report id, an envelope shape that changed - reads as `false`. The
 * saved-on-this-computer wording is true whether or not an endpoint exists;
 * "it has been sent" is only true when the receipt says so, so the unknown
 * case must fall to the claim that cannot be wrong.
 */
function willUploadFromEnvelope(x: unknown): boolean {
  if (!isOkEnvelope<unknown>(x)) return false;
  const value = x.value;
  if (!value || typeof value !== 'object') return false;
  return (value as { willUpload?: unknown }).willUpload === true;
}

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  borderRadius: 4,
  border: 'none',
  background: 'var(--theme-accent, #2563eb)',
  color: '#fff',
  cursor: 'pointer',
};

const ReportIssueDialog: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Non-null once the report has been accepted: the dialog switches to the
  // thank-you panel, and the flag picks which of the two honest sentences it
  // shows.
  const [sent, setSent] = useState<{ willUpload: boolean } | null>(null);

  const reset = useCallback((): void => {
    setDescription('');
    setIncludeDiagnostics(true);
    setSnapshot(null);
    setSnapshotLoading(false);
    setSubmitting(false);
    setSubmitError(null);
    setSent(null);
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
    const handler = (): void => {
      reset();
      setOpen(true);
    };
    window.addEventListener('command:help:reportIssue', handler);
    return () => {
      window.removeEventListener('command:help:reportIssue', handler);
    };
  }, [reset]);

  useEffect(() => {
    if (open && includeDiagnostics) {
      void fetchSnapshotIfNeeded();
    }
  }, [open, includeDiagnostics, fetchSnapshotIfNeeded]);

  const close = useCallback((): void => {
    setOpen(false);
    reset();
  }, [reset]);

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');
      const envelope = includeDiagnostics
        ? await api.submitManualReport({ description: trimmed, includeDiagnostics: true })
        : await api.submitFeedback({ description: trimmed });
      if (!isOkEnvelope<unknown>(envelope)) {
        setSubmitError(errorMessageFromEnvelope(envelope));
        return;
      }
      // Confirm rather than vanish: an immediate `close()` would be
      // indistinguishable from the dialog being dismissed, leaving no point
      // at which the user is told the report was accepted.
      setSent({ willUpload: willUploadFromEnvelope(envelope) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSubmitError(message);
      window.electron?.log?.error?.('[ReportIssueDialog] submit failed', err);
    } finally {
      setSubmitting(false);
    }
  }, [description, includeDiagnostics]);

  // Escape maps to exactly what the Cancel button does - including discarding a
  // half-typed description - and is ignored mid-submit, matching that button's
  // disabled state. On the thank-you panel there is nothing left to discard, so
  // it simply dismisses.
  const dialogRef = useFocusTrap<HTMLDivElement>(open, () => {
    if (!submitting) close();
  });

  if (!open) return null;

  const sendDisabled = submitting || description.trim().length === 0;

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
          style={{ fontSize: 18, fontWeight: 600, marginTop: 0, marginBottom: 12 }}
        >
          {t('reportIssueDialog.title')}
        </h2>

        {sent ? (
          <div role="status" data-testid="report-issue-success">
            <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0' }}>
              {t('reportIssueDialog.successTitle')}
            </p>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
                color: 'var(--theme-text-secondary, #555)',
              }}
            >
              {sent.willUpload
                ? t('reportIssueDialog.successBodySent')
                : t('reportIssueDialog.successBodySaved')}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={close} style={PRIMARY_BUTTON_STYLE}>
                {t('reportIssueDialog.close')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', fontSize: 13, marginTop: 8 }}>
              {t('reportIssueDialog.descriptionLabel')}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder={t('reportIssueDialog.descriptionPlaceholder')}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: 8,
                  fontFamily: 'inherit',
                  fontSize: 13,
                  border: '1px solid var(--theme-border, #ccc)',
                  borderRadius: 4,
                  backgroundColor: 'var(--theme-bg-primary, #fff)',
                  color: 'inherit',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 12,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={includeDiagnostics}
                onChange={(e) => setIncludeDiagnostics(e.target.checked)}
              />
              {t('reportIssueDialog.includeDiagnostics')}
            </label>

            {includeDiagnostics && (
              <div style={{ marginTop: 12 }}>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    lineHeight: 1.5,
                    margin: 0,
                    color: 'var(--theme-text-secondary, #555)',
                  }}
                >
                  {getDiagnosticsPrivacyBlurb(t)}
                </pre>

                <details style={{ marginTop: 8, fontSize: 12 }}>
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
                      fontSize: 11,
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
                  fontSize: 13,
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
                  fontSize: 13,
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
                style={{
                  ...PRIMARY_BUTTON_STYLE,
                  background: sendDisabled
                    ? 'var(--theme-accent-disabled, #94a3b8)'
                    : 'var(--theme-accent, #2563eb)',
                  cursor: sendDisabled ? 'default' : 'pointer',
                }}
              >
                {t('reportIssueDialog.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportIssueDialog;
