/**
 * Extensions > Browse - the catalog listings the app has cached, and the
 * button that downloads one.
 *
 * ## What this screen is responsible for
 *
 * **Showing where a listing came from.** Only the app's configured default
 * catalog confers the `marketplace` tier; a listing from a catalog the user
 * added is classified exactly like a sideload. That distinction is on every
 * card, not buried in a settings screen, because it is the single most useful
 * thing to know before installing something.
 *
 * **Saying what installing will and will not do.** A catalog install runs the
 * same permission prompt a sideload does and leaves the extension *disabled*.
 * Consent covers permissions, not execution - browsing a list must never put
 * running code on someone's machine in one click.
 *
 * **Reading from cache, fetching only on request.** `listAvailable` returns
 * what the last refresh left behind, so this screen renders offline and makes
 * no network request on mount. Refreshing is a button in Extensions > Catalogs.
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import {
  formatSize,
  hostOf,
  isMarketplaceError,
  type CatalogListing,
} from './marketplaceTypes';

export interface ExtensionCatalogBrowserProps {
  /** Ids already installed, so the browser can mark them instead of offering a duplicate install. */
  installedIds: string[];
  /** Called after a successful install so the Installed tab can refresh. */
  onInstalled?: () => void;
  /** Switches the parent to the Catalogs tab from the empty state. */
  onManageCatalogs?: () => void;
}

export function ExtensionCatalogBrowser({
  installedIds,
  onInstalled,
  onManageCatalogs,
}: ExtensionCatalogBrowserProps): JSX.Element {
  const { t } = useI18n();
  const [listings, setListings] = useState<CatalogListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.electron.extensions.catalog.listAvailable();
      setListings(list as CatalogListing[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstall = useCallback(
    async (listing: CatalogListing) => {
      setBusyId(listing.id);
      setError(null);
      setInstalled(null);
      try {
        const result = await window.electron.extensions.catalog.install(
          listing.id,
          listing.sourceUrl,
        );
        if (isMarketplaceError(result)) {
          // Declining the permission prompt is a decision, not a failure, so
          // it does not get an error banner.
          if (result.code !== 'ConsentDenied' && result.code !== 'Cancelled') {
            setError(result.message);
          }
          return;
        }
        setInstalled(listing.id);
        onInstalled?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [onInstalled],
  );

  const needle = query.trim().toLowerCase();
  const visible =
    needle.length === 0
      ? listings
      : listings.filter(
          (l) =>
            l.name.toLowerCase().includes(needle) ||
            l.id.toLowerCase().includes(needle) ||
            (l.description ?? '').toLowerCase().includes(needle),
        );

  return (
    <div className="space-y-4" data-testid="extension-catalog-browser">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('extensions.browse.intro')}
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('extensions.browse.filter')}
          aria-label={t('extensions.browse.filterLabel')}
          data-testid="extension-catalog-filter"
          className="px-2 py-1 rounded text-sm flex-shrink-0"
          style={{
            backgroundColor: 'var(--theme-bg-hover)',
            color: 'var(--theme-text-primary)',
          }}
        />
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

      {installed && (
        <div
          role="status"
          className="rounded p-3 text-sm"
          data-testid="extension-catalog-installed-notice"
          style={{
            backgroundColor: 'var(--theme-bg-hover)',
            color: 'var(--theme-text-primary)',
          }}
        >
          {t('extensions.browse.installedNotice', { id: installed })}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          {t('common.loading')}
        </p>
      ) : listings.length === 0 ? (
        <div
          className="text-sm space-y-2"
          data-testid="extension-catalog-browser-empty"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <p className="italic">
            {t('extensions.browse.none')}
          </p>
          {onManageCatalogs && (
            <button
              type="button"
              onClick={onManageCatalogs}
              data-testid="extension-catalog-browser-manage"
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{
                backgroundColor: 'var(--theme-bg-hover)',
                color: 'var(--theme-text-primary)',
              }}
            >
              {t('extensions.browse.manageCatalogs')}
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm italic" style={{ color: 'var(--theme-text-muted)' }}>
          {t('extensions.browse.noMatches')}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((listing) => {
            const alreadyInstalled = installedIds.includes(listing.id);
            const isBusy = busyId === listing.id;
            const size = formatSize(listing.sizeBytes);
            return (
              <li
                key={`${listing.sourceUrl}::${listing.id}`}
                className="rounded border p-3"
                data-testid={`extension-listing-${listing.id}`}
                style={{
                  borderColor: 'var(--theme-border-primary)',
                  backgroundColor: 'var(--theme-surface-primary)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: 'var(--theme-text-heading)' }}>
                        {listing.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                        v{listing.version}
                      </span>
                      {/*
                        The provenance label. `fromDefaultCatalog` is the only
                        thing that can lead to a `marketplace` badge once
                        installed, so it is stated up front - and its absence is
                        stated just as plainly rather than left blank.
                      */}
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        data-testid="extension-listing-source-badge"
                        data-from-default={listing.fromDefaultCatalog ? 'true' : 'false'}
                        title={
                          listing.fromDefaultCatalog
                            ? t('extensions.browse.defaultSourceTooltip')
                            : t('extensions.browse.userSourceTooltip')
                        }
                        style={{
                          backgroundColor: listing.fromDefaultCatalog
                            ? 'var(--theme-bg-hover)'
                            : 'var(--theme-danger-soft)',
                          color: listing.fromDefaultCatalog
                            ? 'var(--theme-text-secondary)'
                            : 'var(--theme-danger)',
                        }}
                      >
                        {listing.fromDefaultCatalog
                          ? t('extensions.browse.defaultSource')
                          : t('extensions.browse.userSource')}
                      </span>
                      {alreadyInstalled && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          data-testid="extension-listing-installed-badge"
                          style={{
                            backgroundColor: 'var(--theme-bg-hover)',
                            color: 'var(--theme-success)',
                          }}
                        >
                          {t('extensions.browse.installedBadge')}
                        </span>
                      )}
                    </div>
                    {listing.description && (
                      <div className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
                        {listing.description}
                      </div>
                    )}
                    <div className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                      <code>{listing.id}</code>
                      {listing.publisher && <span> · {listing.publisher}</span>}
                      {size && <span> · {size}</span>}
                      <span> · {hostOf(listing.sourceUrl)}</span>
                    </div>
                    {(listing.permissions ?? []).length > 0 && (
                      <div className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                        {t(
                          'extensions.browse.permissions',
                          { list: (listing.permissions ?? []).join(', '), },
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex-shrink-0">
                    <button
                      type="button"
                      disabled={isBusy || alreadyInstalled}
                      onClick={() => void handleInstall(listing)}
                      data-testid={`extension-listing-install-${listing.id}`}
                      aria-label={t('extensions.browse.installLabel', { name: listing.name, })}
                      className="px-3 py-1.5 rounded text-sm font-medium"
                      style={{
                        backgroundColor: alreadyInstalled
                          ? 'var(--theme-bg-hover)'
                          : 'var(--theme-accent-primary)',
                        color: alreadyInstalled
                          ? 'var(--theme-text-muted)'
                          : 'var(--theme-accent-text)',
                        opacity: isBusy ? 0.6 : 1,
                      }}
                    >
                      {alreadyInstalled
                        ? t('extensions.browse.installedBadge')
                        : isBusy
                          ? t('extensions.browse.installing')
                          : t('extensions.browse.install')}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
