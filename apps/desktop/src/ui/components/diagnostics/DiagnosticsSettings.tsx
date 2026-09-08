/**
 * DiagnosticsSettings - Preferences > Diagnostics section.
 *
 * Section component intended to live inside PreferencesDialog. It does NOT
 * render its own modal chrome.
 *
 * Capabilities:
 *   - Toggle master "send diagnostic reports" flag (enabled).
 *   - Toggle "don't show the crash report dialog automatically" (dontAskAgain).
 *   - Edit the endpoint URL (persisted on blur).
 *   - Inspect / delete individual queued reports.
 *   - Delete all queued reports (with confirm).
 *
 * A "Send all now" button invoking the uploader is not implemented yet; a
 * marker comment indicates where to add that control.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getDiagnosticsPrivacyBlurb } from './privacyBlurb';
import { useI18n } from '../../contexts/useI18n';

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

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

// Local mirrors of the main-process shapes (avoid reaching across packages).
interface DiagnosticsConfigShape {
  enabled: boolean;
  endpointUrl: string;
  dontAskAgain: boolean;
}

interface QueueEntry {
  id: string;
  type: string;
  ts: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DiagnosticsSettings: React.FC = () => {
  const { t } = useI18n();
  const [config, setConfig] = useState<DiagnosticsConfigShape | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState<string>('');

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState<boolean>(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedJson, setExpandedJson] = useState<string>('');
  const [expandedLoading, setExpandedLoading] = useState<boolean>(false);

  const [flushing, setFlushing] = useState<boolean>(false);
  const [flushMessage, setFlushMessage] = useState<string | null>(null);

  // --- load config ---------------------------------------------------------
  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');
      const raw = await api.getConfig();
      if (isOkEnvelope<DiagnosticsConfigShape>(raw)) {
        setConfig(raw.value);
        setEndpointDraft(raw.value.endpointUrl ?? '');
        setConfigError(null);
      } else {
        setConfigError(errorMessageFromEnvelope(raw));
      }
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // --- load queue ----------------------------------------------------------
  const loadQueue = useCallback(async (): Promise<void> => {
    setQueueLoading(true);
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');
      const raw = await api.getQueue();
      if (isOkEnvelope<QueueEntry[]>(raw)) {
        setQueue(raw.value);
        setQueueError(null);
      } else {
        setQueueError(errorMessageFromEnvelope(raw));
      }
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadQueue();
  }, [loadConfig, loadQueue]);

  // --- persist config patch ------------------------------------------------
  const persistConfig = useCallback(
    async (patch: Partial<DiagnosticsConfigShape>): Promise<void> => {
      try {
        const api = window.electron?.diagnostics;
        if (!api) throw new Error('Diagnostics IPC unavailable');
        const raw = await api.setConfig(patch as Record<string, unknown>);
        if (isOkEnvelope<DiagnosticsConfigShape>(raw)) {
          setConfig(raw.value);
          setEndpointDraft(raw.value.endpointUrl ?? '');
          setConfigError(null);
        } else {
          setConfigError(errorMessageFromEnvelope(raw));
        }
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  const handleToggleEnabled = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      void persistConfig({ enabled: e.target.checked });
    },
    [persistConfig]
  );

  const handleToggleDontAskAgain = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      void persistConfig({ dontAskAgain: e.target.checked });
    },
    [persistConfig]
  );

  const handleEndpointBlur = useCallback((): void => {
    if (!config) return;
    const trimmed = endpointDraft.trim();
    if (trimmed === config.endpointUrl) return;
    void persistConfig({ endpointUrl: trimmed });
  }, [config, endpointDraft, persistConfig]);

  // --- queue actions -------------------------------------------------------
  const handleView = useCallback(
    async (id: string): Promise<void> => {
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedJson('');
        return;
      }
      setExpandedId(id);
      setExpandedJson('');
      setExpandedLoading(true);
      try {
        const api = window.electron?.diagnostics;
        if (!api) throw new Error('Diagnostics IPC unavailable');
        const raw = await api.getReport(id);
        if (isOkEnvelope<unknown>(raw)) {
          setExpandedJson(JSON.stringify(raw.value, null, 2));
        } else {
          setExpandedJson(`// Error: ${errorMessageFromEnvelope(raw)}`);
        }
      } catch (err) {
        setExpandedJson(
          `// Error: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setExpandedLoading(false);
      }
    },
    [expandedId]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      try {
        const api = window.electron?.diagnostics;
        if (!api) throw new Error('Diagnostics IPC unavailable');
        await api.deleteReport(id);
        if (expandedId === id) {
          setExpandedId(null);
          setExpandedJson('');
        }
        await loadQueue();
      } catch (err) {
        setQueueError(err instanceof Error ? err.message : String(err));
      }
    },
    [expandedId, loadQueue]
  );

  const handleFlushNow = useCallback(async (): Promise<void> => {
    setFlushing(true);
    setFlushMessage(null);
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');
      const raw = await api.flushNow();
      if (isOkEnvelope<{ sent: number; failed: number; skipped: number }>(raw)) {
        const { sent, failed, skipped } = raw.value;
        setFlushMessage(
          t('diagnosticsSettings.flushResult', { sent, failed, skipped })
        );
      } else {
        setFlushMessage(
          t('diagnosticsSettings.flushError', { message: errorMessageFromEnvelope(raw), })
        );
      }
      await loadQueue();
    } catch (err) {
      setFlushMessage(
        t(
          'diagnosticsSettings.flushError',
          { message: err instanceof Error ? err.message : String(err), },
        )
      );
    } finally {
      setFlushing(false);
    }
  }, [loadQueue, t]);

  const handleDeleteAll = useCallback(async (): Promise<void> => {
    if (queue.length === 0) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      // A real ICU plural in every catalog, so this goes through `t()`:
      // `tf()`'s fallback path only substitutes `{name}` and cannot render a
      // plural block at all.
      t('diagnosticsSettings.deleteAllConfirm', { count: queue.length }),
    );
    if (!ok) return;
    try {
      const api = window.electron?.diagnostics;
      if (!api) throw new Error('Diagnostics IPC unavailable');
      await api.deleteAll();
      setExpandedId(null);
      setExpandedJson('');
      await loadQueue();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    }
  }, [queue.length, loadQueue, t]);

  // --- render --------------------------------------------------------------

  const endpointEmpty = !config || !config.endpointUrl.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Privacy blurb */}
      <section>
        <p
          style={{
            fontSize: 13,
            marginTop: 0,
            marginBottom: 8,
            color: 'var(--theme-text-secondary)',
          }}
        >
          {t('diagnosticsSettings.intro')}
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: 12,
            margin: 0,
            padding: 12,
            backgroundColor: 'var(--theme-bg-tertiary)',
            border: '1px solid var(--theme-border-primary)',
            borderRadius: 4,
            color: 'var(--theme-text-secondary)',
          }}
        >
          {getDiagnosticsPrivacyBlurb(t)}
        </pre>
      </section>

      {configError && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--theme-danger-text)',
            border: '1px solid var(--theme-danger-border)',
            backgroundColor: 'var(--theme-danger-soft)',
            padding: 8,
            borderRadius: 4,
          }}
        >
          {configError}
        </div>
      )}

      {/* Toggles */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            cursor: config ? 'pointer' : 'default',
          }}
        >
          <input
            type="checkbox"
            checked={config?.enabled ?? false}
            disabled={!config}
            onChange={handleToggleEnabled}
          />
          <span>{t('diagnosticsSettings.sendDiagnosticReportsWhenErrorsOccur')}</span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 14,
            cursor: config ? 'pointer' : 'default',
          }}
        >
          <input
            type="checkbox"
            checked={config?.dontAskAgain ?? false}
            disabled={!config}
            onChange={handleToggleDontAskAgain}
          />
          <span>Don&apos;t show the crash report dialog automatically</span>
        </label>
      </section>

      {/* Endpoint */}
      <section>
        <label
          htmlFor="diagnostics-endpoint-url"
          style={{
            display: 'block',
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 4,
            color: 'var(--theme-text-primary)',
          }}
        >
          {t('diagnosticsSettings.endpointUrl')}
        </label>
        <input
          id="diagnostics-endpoint-url"
          type="text"
          value={endpointDraft}
          disabled={!config}
          aria-describedby={endpointEmpty ? 'diagnostics-endpoint-hint' : undefined}
          placeholder="https://example.com/diagnostics"
          onChange={(e) => setEndpointDraft(e.target.value)}
          onBlur={handleEndpointBlur}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            border: '1px solid var(--theme-border-primary)',
            borderRadius: 4,
            backgroundColor: 'var(--theme-bg-primary)',
            color: 'var(--theme-text-primary)',
            fontFamily: 'inherit',
          }}
        />
        {endpointEmpty && (
          <p
            id="diagnostics-endpoint-hint"
            style={{
              fontSize: 12,
              marginTop: 4,
              marginBottom: 0,
              color: 'var(--theme-text-secondary)',
              fontStyle: 'italic',
            }}
          >
            {t('diagnosticsSettings.noEndpointConfiguredReportsAreQueued')}
          </p>
        )}
      </section>

      {/* Queue */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <h4
            style={{
              fontSize: 14,
              fontWeight: 600,
              margin: 0,
              color: 'var(--theme-text-primary)',
            }}
          >
            {t('diagnosticsSettings.queuedReports')} {queue.length > 0 && `(${queue.length})`}
          </h4>
          <button
            type="button"
            onClick={() => void loadQueue()}
            disabled={queueLoading}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--theme-border-primary)',
              borderRadius: 4,
              color: 'var(--theme-text-secondary)',
              cursor: queueLoading ? 'default' : 'pointer',
            }}
          >
            {queueLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {queueError && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: 'var(--theme-danger-text)',
              marginBottom: 8,
            }}
          >
            {queueError}
          </div>
        )}

        {/* Manual uploader trigger. Disabled when no endpoint is configured
            (there's nothing to POST to) or while a flush is in flight. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={() => void handleFlushNow()}
            disabled={flushing || endpointEmpty}
            title={
              endpointEmpty
                ? t('diagnosticsSettings.sendDisabledHint')
                : undefined
            }
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--theme-border-primary)',
              borderRadius: 4,
              color: 'var(--theme-text-primary)',
              cursor: flushing || endpointEmpty ? 'default' : 'pointer',
              opacity: flushing || endpointEmpty ? 0.6 : 1,
            }}
          >
            {flushing ? 'Sending…' : 'Send all now'}
          </button>
          {/* Single polite status region for the queue actions. */}
          <span
            aria-live="polite"
            style={{
              fontSize: 12,
              color: 'var(--theme-text-secondary)',
            }}
          >
            {flushMessage ?? ''}
          </span>
        </div>

        {queue.length === 0 && !queueLoading ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--theme-text-secondary)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            {t('diagnosticsSettings.noReportsQueued')}
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: '1px solid var(--theme-border-primary)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            {queue.map((entry, idx) => {
              const expanded = expandedId === entry.id;
              return (
                <li
                  key={entry.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--theme-border-primary)',
                    backgroundColor: 'var(--theme-bg-primary)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--theme-text-primary)',
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            borderRadius: 3,
                            backgroundColor: 'var(--theme-bg-tertiary)',
                            color: 'var(--theme-text-secondary)',
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}
                        >
                          {entry.type}
                        </span>
                        <span
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: 12,
                            color: 'var(--theme-text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={entry.id}
                        >
                          {entry.id}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--theme-text-secondary)',
                          marginTop: 2,
                        }}
                      >
                        {entry.ts}
                      </div>
                    </div>
                    {/* Both actions repeat per row, so each name carries the
                        report it acts on. */}
                    <button
                      type="button"
                      onClick={() => void handleView(entry.id)}
                      aria-expanded={expanded}
                      aria-controls={`diagnostics-report-${entry.id}`}
                      aria-label={
                        expanded
                          ? t('diagnosticsSettings.hideReportLabel', { id: entry.id })
                          : t('diagnosticsSettings.viewReportLabel', { id: entry.id })
                      }
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'transparent',
                        border: '1px solid var(--theme-border-primary)',
                        borderRadius: 4,
                        color: 'var(--theme-text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      {expanded ? 'Hide' : 'View'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry.id)}
                      aria-label={t('diagnosticsSettings.deleteReportLabel', { id: entry.id })}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'transparent',
                        border: '1px solid var(--theme-danger-border)',
                        borderRadius: 4,
                        color: 'var(--theme-danger-text)',
                        cursor: 'pointer',
                      }}
                    >
                      {t('diagnosticsSettings.delete')}
                    </button>
                  </div>
                  {expanded && (
                    <div
                      id={`diagnostics-report-${entry.id}`}
                      style={{
                        borderTop: '1px solid var(--theme-border-primary)',
                        backgroundColor: 'var(--theme-bg-tertiary)',
                        padding: 12,
                      }}
                    >
                      {expandedLoading ? (
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          {t('diagnosticsSettings.loading')}
                        </span>
                      ) : (
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 11,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: 300,
                            overflow: 'auto',
                            color: 'var(--theme-text-primary)',
                          }}
                        >
                          {expandedJson}
                        </pre>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {queue.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => void handleDeleteAll()}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid var(--theme-danger-border)',
                borderRadius: 4,
                color: 'var(--theme-danger-text)',
                cursor: 'pointer',
              }}
            >
              {t('diagnosticsSettings.deleteAll')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default DiagnosticsSettings;
