/**
 * CrashReportDialog - in-app prompt shown after an unhandled main-process
 * error. Listens for the `diagnostics:crash-detected` event (forwarded from
 * preload), fetches the queued payload, and lets the user review it, add an
 * optional description, and either send or discard.
 *
 * Current limitation: "Send Report" just marks the queued report with
 * `pending_send: true`. The actual upload pipeline is not implemented yet.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getDiagnosticsPrivacyBlurb } from './privacyBlurb';
import { useI18n } from '../../contexts/useI18n';

interface CrashDetectedPayload {
  id: string;
}

// The shape returned by `diagnostics:get-report` - kept loose here because
// this component only reads `error.message` and the raw JSON blob for
// display. The main process is the source of truth for the schema.
interface LooseReport {
  type?: string;
  report_id?: string;
  error?: { message?: string };
  [key: string]: unknown;
}

const unwrap = <T,>(envelope: unknown): T | null => {
  if (!envelope || typeof envelope !== 'object') return null;
  const e = envelope as { ok?: boolean; value?: T };
  return e.ok ? (e.value ?? null) : null;
};

const CrashReportDialog: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [payload, setPayload] = useState<LooseReport | null>(null);
  const [description, setDescription] = useState('');
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadReport = useCallback(async (id: string): Promise<void> => {
    try {
      const raw = await window.electron.diagnostics.getReport(id);
      const p = unwrap<LooseReport>(raw);
      setPayload(p);
    } catch (err) {
      window.electron?.log?.error?.('[CrashReportDialog] getReport failed', err);
    }
  }, []);

  useEffect(() => {
    const off = window.electron?.diagnostics?.onCrashDetected?.((p: CrashDetectedPayload) => {
      setReportId(p.id);
      setDescription('');
      setDontAskAgain(false);
      setOpen(true);
      void loadReport(p.id);
    });
    return () => {
      off?.();
    };
  }, [loadReport]);

  const close = useCallback((): void => {
    setOpen(false);
    setPayload(null);
    setReportId(null);
  }, []);

  const handleDontSend = useCallback(async (): Promise<void> => {
    if (!reportId) {
      close();
      return;
    }
    setSubmitting(true);
    try {
      await window.electron.diagnostics.deleteReport(reportId);
      if (dontAskAgain) {
        await window.electron.diagnostics.setConfig({ dontAskAgain: true });
      }
    } catch (err) {
      window.electron?.log?.error?.('[CrashReportDialog] deleteReport failed', err);
    } finally {
      setSubmitting(false);
      close();
    }
  }, [reportId, dontAskAgain, close]);

  const handleSend = useCallback(async (): Promise<void> => {
    if (!reportId) {
      close();
      return;
    }
    setSubmitting(true);
    try {
      await window.electron.diagnostics.submitCrashReport({
        reportId,
        description: description.trim() || undefined,
      });
      if (dontAskAgain) {
        await window.electron.diagnostics.setConfig({ dontAskAgain: true });
      }
    } catch (err) {
      window.electron?.log?.error?.('[CrashReportDialog] submit failed', err);
    } finally {
      setSubmitting(false);
      close();
    }
  }, [reportId, description, dontAskAgain, close]);

  // Escape dismisses the prompt without deciding - deliberately not wired to
  // "Don't Send", which also deletes the queued report and can persist
  // "don't ask again"; that is too destructive for a stray keypress. The report
  // stays queued and can still be sent later. Ignored mid-submit, matching the
  // disabled state of both buttons.
  const dialogRef = useFocusTrap<HTMLDivElement>(open, () => {
    if (!submitting) close();
  });

  if (!open) return null;

  const errorMessage = payload?.error?.message ?? 'An unexpected error occurred.';

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
      aria-labelledby="crash-report-dialog-title"
    >
      <div
        style={{
          maxWidth: 560,
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
          id="crash-report-dialog-title"
          style={{ fontSize: 18, fontWeight: 600, marginTop: 0, marginBottom: 12 }}
        >
          {t('crashReportDialog.somethingWentWrong')}
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>
          {t('crashReportDialog.description')}
        </p>
        <p
          style={{
            fontSize: 13,
            fontFamily: 'monospace',
            padding: 8,
            backgroundColor: 'var(--theme-bg-secondary, #f5f5f5)',
            borderRadius: 4,
            margin: '12px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {errorMessage}
        </p>

        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: 1.5,
            margin: '12px 0',
            color: 'var(--theme-text-secondary, #555)',
          }}
        >
          {getDiagnosticsPrivacyBlurb(t)}
        </pre>

        <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>
          Describe what happened (optional):
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              padding: 6,
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

        <details style={{ marginTop: 12, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer' }}>{t('crashReportDialog.viewRawReport')}</summary>
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
            {payload ? JSON.stringify(payload, null, 2) : 'Loading…'}
          </pre>
        </details>

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
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          Don&apos;t ask again
        </label>

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
            onClick={handleDontSend}
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
            Don&apos;t Send
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={submitting}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              borderRadius: 4,
              border: 'none',
              background: 'var(--theme-accent, #2563eb)',
              color: '#fff',
              cursor: submitting ? 'default' : 'pointer',
            }}
          >
            {t('crashReportDialog.sendReport')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CrashReportDialog;
