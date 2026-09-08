/**
 * Extensions > Catalogs - manage where the app is willing to look for
 * extensions, and show the block rules currently in force.
 *
 * ## What this screen is responsible for
 *
 * **Making the risk acknowledgement real.** Users may add their own catalogs,
 * but must accept the risk first.
 * The gate itself lives in `ExtensionCatalogService.refresh` so no caller can
 * route around it; this screen's job is to make sure the user has actually
 * *seen* the warning before we pass `acknowledgeRisk: true`. A source added
 * without it is stored in a visible "not confirmed" state rather than lost -
 * the user keeps what they typed and can confirm later.
 *
 * **Not overstating what a catalog is.** Adding a catalog is permission to
 * read a list, not a statement of trust. Extensions from a user-added catalog
 * are classified exactly like a sideload, and the UI says so next to every
 * non-default source.
 *
 * **The blocklist is read-only here.** There is no refresh button because
 * there is no refresh channel: block rules arrive only with the manual
 * "Check for Updates" flow (decision 3), and this screen shows what that last
 * check left behind.
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import {
  hostOf,
  isMarketplaceError,
  type BlocklistEntry,
  type CatalogSource,
} from './marketplaceTypes';

function formatTimestamp(ts: number | undefined): string {
  if (ts === undefined || ts <= 0) return '—';
  return new Date(ts).toLocaleString();
}

export interface ExtensionCatalogSourcesProps {
  /** Called after any change that could alter the browsable listings. */
  onSourcesChanged?: () => void;
}

export function ExtensionCatalogSources({
  onSourcesChanged,
}: ExtensionCatalogSourcesProps): JSX.Element {
  const { t } = useI18n();
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  // Add-source form.
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [riskAccepted, setRiskAccepted] = useState(false);

  const refreshLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, rules] = await Promise.all([
        window.electron.extensions.catalog.listSources(),
        window.electron.extensions.blocklist.list(),
      ]);
      setSources(list as CatalogSource[]);
      setBlocklist(rules as BlocklistEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const handleAdd = useCallback(async () => {
    const url = newUrl.trim();
    if (url.length === 0) return;
    setError(null);
    try {
      // `riskAccepted` is forwarded verbatim. Passing `true` unconditionally
      // would make the checkbox decorative and defeat the whole gate.
      const result = await window.electron.extensions.catalog.addSource(
        url,
        newLabel.trim().length > 0 ? newLabel.trim() : undefined,
        riskAccepted,
      );
      if (isMarketplaceError(result)) {
        setError(result.message);
        return;
      }
      setNewUrl('');
      setNewLabel('');
      setRiskAccepted(false);
      setShowAdd(false);
      await refreshLists();
      onSourcesChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [newUrl, newLabel, riskAccepted, refreshLists, onSourcesChanged]);

  const withBusy = useCallback(
    async (url: string, fn: () => Promise<unknown>) => {
      setBusyUrl(url);
      setError(null);
      try {
        const result = await fn();
        if (isMarketplaceError(result)) setError(result.message);
        await refreshLists();
        onSourcesChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyUrl(null);
      }
    },
    [refreshLists, onSourcesChanged],
  );

  return (
    <div className="space-y-4" data-testid="extension-catalog-sources">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('extensions.catalogs.intro')}
        </p>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          data-testid="extension-catalog-add-toggle"
          className="px-3 py-1.5 rounded text-sm font-medium flex-shrink-0"
          style={{
            backgroundColor: 'var(--theme-bg-hover)',
            color: 'var(--theme-text-primary)',
          }}
        >
          {showAdd
            ? t('common.cancel')
            : t('extensions.catalogs.add')}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded p-3 text-sm"
          style={{
            backgroundColor: 'var(--theme-danger-soft)',
            color: 'var(--theme-danger)',
          }}
        >
          {error}
        </div>
      )}

      {showAdd && (
        <div
          className="rounded border p-3 space-y-3"
          data-testid="extension-catalog-add-form"
          style={{
            borderColor: 'var(--theme-border-primary)',
            backgroundColor: 'var(--theme-surface-primary)',
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="catalog-url" className="text-xs font-semibold">
              {t('extensions.catalogs.urlLabel')}
            </label>
            <input
              id="catalog-url"
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/catalog.json"
              data-testid="extension-catalog-url-input"
              className="px-2 py-1 rounded text-sm"
              style={{
                backgroundColor: 'var(--theme-bg-hover)',
                color: 'var(--theme-text-primary)',
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="catalog-label" className="text-xs font-semibold">
              {t('extensions.catalogs.labelLabel')}
            </label>
            <input
              id="catalog-label"
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="px-2 py-1 rounded text-sm"
              style={{
                backgroundColor: 'var(--theme-bg-hover)',
                color: 'var(--theme-text-primary)',
              }}
            />
          </div>

          {/*
            The warning is shown in full, not behind a tooltip or a link. The
            user is being asked to accept a specific risk, so the text has to
            state it plainly enough that ticking the box means something.
          */}
          <div
            className="rounded p-3 text-xs space-y-2"
            style={{
              backgroundColor: 'var(--theme-danger-soft)',
              color: 'var(--theme-danger)',
            }}
          >
            <div className="font-semibold">
              {t('extensions.catalogs.riskTitle')}
            </div>
            <p>
              {t('extensions.catalogs.riskBody')}
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={riskAccepted}
                onChange={(e) => setRiskAccepted(e.target.checked)}
                data-testid="extension-catalog-risk-checkbox"
                className="mt-0.5"
              />
              <span>
                {t('extensions.catalogs.riskAccept')}
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={newUrl.trim().length === 0}
              data-testid="extension-catalog-add-submit"
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{
                backgroundColor: 'var(--theme-accent-primary)',
                color: 'var(--theme-accent-text)',
                opacity: newUrl.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {t('extensions.catalogs.addSubmit')}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            {t('extensions.catalogs.addWithoutAck')}
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          {t('common.loading')}
        </p>
      ) : sources.length === 0 ? (
        <p
          className="text-sm italic"
          data-testid="extension-catalog-sources-empty"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {t('extensions.catalogs.none')}
        </p>
      ) : (
        <ul className="space-y-2">
          {sources.map((source) => {
            const acknowledged = source.riskAcknowledgedAt !== undefined;
            const isBusy = busyUrl === source.url;
            return (
              <li
                key={source.url}
                className="rounded border p-3"
                data-testid={`extension-catalog-source-${hostOf(source.url)}`}
                style={{
                  borderColor: 'var(--theme-border-primary)',
                  backgroundColor: 'var(--theme-surface-primary)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-medium"
                        style={{ color: 'var(--theme-text-heading)' }}
                      >
                        {source.label ?? hostOf(source.url)}
                      </span>
                      {source.isDefault && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          data-testid="extension-catalog-default-badge"
                          style={{
                            backgroundColor: 'var(--theme-bg-hover)',
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          {t('extensions.catalogs.defaultBadge')}
                        </span>
                      )}
                      {!acknowledged && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          data-testid="extension-catalog-unconfirmed-badge"
                          style={{
                            backgroundColor: 'var(--theme-danger-soft)',
                            color: 'var(--theme-danger)',
                          }}
                        >
                          {t('extensions.catalogs.unconfirmed')}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-xs mt-1 break-all"
                      style={{ color: 'var(--theme-text-muted)' }}
                    >
                      {source.url}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                      {t(
                        'extensions.catalogs.lastFetched',
                        { when: formatTimestamp(source.lastFetchedAt), },
                      )}
                    </div>
                    {!source.isDefault && (
                      <div className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                        {t('extensions.catalogs.notDefaultNote')}
                      </div>
                    )}
                    {!acknowledged && (
                      <div className="text-xs mt-1" style={{ color: 'var(--theme-danger)' }}>
                        {t('extensions.catalogs.unconfirmedNote')}
                      </div>
                    )}
                    {source.lastError && (
                      <div className="text-xs mt-1" style={{ color: 'var(--theme-danger)' }}>
                        {source.lastError}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1 flex-shrink-0">
                    {!acknowledged && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void withBusy(source.url, () =>
                            window.electron.extensions.catalog.acknowledgeRisk(source.url),
                          )
                        }
                        data-testid="extension-catalog-confirm"
                        aria-label={t('extensions.catalogs.confirmLabel', { url: source.url })}
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          backgroundColor: 'var(--theme-danger-soft)',
                          color: 'var(--theme-danger)',
                        }}
                      >
                        {t('extensions.catalogs.confirm')}
                      </button>
                    )}
                    <button
                      type="button"
                      // Disabled rather than hidden: the user should see that
                      // refreshing is possible and what is standing in the way.
                      disabled={isBusy || !acknowledged}
                      title={
                        acknowledged
                          ? undefined
                          : t('extensions.catalogs.refreshBlocked')
                      }
                      onClick={() =>
                        void withBusy(source.url, () =>
                          window.electron.extensions.catalog.refresh(source.url),
                        )
                      }
                      data-testid="extension-catalog-refresh"
                      aria-label={t('extensions.catalogs.refreshLabel', { url: source.url })}
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        backgroundColor: 'var(--theme-bg-hover)',
                        opacity: acknowledged ? 1 : 0.5,
                      }}
                    >
                      {t('extensions.catalogs.refresh')}
                    </button>
                    {!source.isDefault && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void withBusy(source.url, () =>
                            window.electron.extensions.catalog.removeSource(source.url),
                          )
                        }
                        data-testid="extension-catalog-remove"
                        aria-label={t('extensions.catalogs.removeLabel', { url: source.url })}
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          backgroundColor: 'var(--theme-danger-soft)',
                          color: 'var(--theme-danger)',
                        }}
                      >
                        {t('extensions.catalogs.remove')}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Block rules. Read-only - see the header comment. */}
      <div
        className="rounded p-3 space-y-2"
        data-testid="extension-blocklist"
        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--theme-text-heading)' }}>
          {t('extensions.blocklist.title')}
        </div>
        <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('extensions.blocklist.help')}
        </p>
        {blocklist.length === 0 ? (
          <div
            className="text-xs italic"
            data-testid="extension-blocklist-empty"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {t('extensions.blocklist.none')}
          </div>
        ) : (
          <ul className="space-y-1">
            {blocklist.map((entry, i) => (
              <li key={`${entry.id}-${i}`} className="text-xs">
                <code>{entry.id}</code>
                {entry.versions && (
                  <span style={{ color: 'var(--theme-text-muted)' }}> {entry.versions}</span>
                )}
                <span style={{ color: 'var(--theme-text-secondary)' }}> — {entry.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
