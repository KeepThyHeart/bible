/**
 * Extensions panel. Lists installed extensions and offers: install from .zip,
 * per-permission revocation, crash log viewer, settings rendered from
 * `contributes.configuration`, "Open install folder", and an "Activate now"
 * button.
 *
 * Two sibling tabs - Browse and Catalogs - put the marketplace
 * beside the installed list rather than in a separate dialog. Installing
 * from a catalog and sideloading a .zip end in the same place, which is the
 * point: a catalog is a delivery route, not a different kind of extension.
 *
 * Lives inside `PreferencesDialog` under the `extensions` section.
 */

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ExtensionCatalogBrowser } from './extensions/ExtensionCatalogBrowser';
import { ExtensionCatalogSources } from './extensions/ExtensionCatalogSources';
import type { BlockDecision } from './extensions/marketplaceTypes';

type ExtensionsTab = 'installed' | 'browse' | 'catalogs';

interface ExtensionStateInfo {
  manifest: {
    id: string;
    version: string;
    name: string | { key: string };
    publisher?: string;
    description?: string | { key: string };
    permissions?: string[];
    contributes?: {
      configuration?: ConfigurationSchema;
    };
  };
  installPath: string;
  enabled: boolean;
  status: string;
  grantedPermissions: string[];
  installedAt: number;
  updatedAt: number;
  crashCountSession: number;
  lastError?: string;
  /** True for an unpacked extension loaded in Developer Mode. */
  devMode?: boolean;
  /** Provenance tier derived by the host. Absent is treated as untrusted. */
  trustTier?: 'untrusted' | 'signed' | 'marketplace';
}

interface ConfigurationSchema {
  type?: 'object';
  properties?: Record<string, ConfigurationProperty>;
}

interface ConfigurationProperty {
  type?: 'string' | 'number' | 'boolean';
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

interface CrashRecord {
  ts: number;
  exitCode: number | null;
  stderrTail: string;
  lastRpcMethod?: string;
}

interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  fields?: Record<string, unknown>;
}

function displayName(name: ExtensionStateInfo['manifest']['name']): string {
  if (typeof name === 'string') return name;
  return name.key;
}

// Theme tokens only. The former `--theme-danger-bg` / `--theme-text-tertiary`
// names are not declared in themes.css, so those rules were silently falling
// through to their hard-coded light-theme hex fallbacks in every theme.
const STATUS_COLORS: Record<string, string> = {
  active: 'var(--theme-success)',
  installed: 'var(--theme-text-secondary)',
  disabled: 'var(--theme-text-muted)',
  loading: 'var(--theme-accent-primary)',
  failed: 'var(--theme-danger)',
  'auto-disabled': 'var(--theme-danger)',
  'setup-required': 'var(--theme-warning)',
};

/**
 * Persistent provenance badge on every extension row.
 *
 * "Untrusted" is shown rather than hidden, and an absent tier renders as
 * untrusted: the badge's job is to keep the user aware that sideloaded code is
 * running long after the install dialog is gone, so the safest reading of
 * missing data is the one that keeps the warning visible.
 *
 * `signed` and `marketplace` are the exceptions worth calling out, so those get
 * a neutral/positive treatment and untrusted gets the warning colour.
 */
const TrustBadge: React.FC<{ trustTier?: 'untrusted' | 'signed' | 'marketplace' }> = ({
  trustTier,
}) => {
  const { t } = useI18n();
  const isUntrusted = trustTier !== 'signed' && trustTier !== 'marketplace';
  const label =
    trustTier === 'marketplace'
      ? t('extensions.trust.marketplaceBadge')
      : trustTier === 'signed'
        ? t('extensions.trust.signedBadge')
        : t('extensions.trust.untrustedBadge');

  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      data-testid="extension-trust-badge"
      data-trust-tier={trustTier ?? 'untrusted'}
      title={
        isUntrusted
          ? t('extensions.trust.untrustedTooltip')
          : t('extensions.trust.signedTooltip')
      }
      style={{
        backgroundColor: isUntrusted ? 'var(--theme-danger-soft)' : 'var(--theme-bg-hover)',
        color: isUntrusted ? 'var(--theme-danger)' : 'var(--theme-text-secondary)',
      }}
    >
      {label}
    </span>
  );
};

export function ExtensionsSection(): JSX.Element {
  const { t } = useI18n();
  const [extensions, setExtensions] = useState<ExtensionStateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [openCrashId, setOpenCrashId] = useState<string | null>(null);
  const [crashRecords, setCrashRecords] = useState<CrashRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [developerMode, setDeveloperMode] = useState(false);
  const [activeTab, setActiveTab] = useState<ExtensionsTab>('installed');
  /**
   * Blocked installed extensions, keyed by id. Resolved by the host rather
   * than matched here: deciding whether a rule's semver range covers an
   * installed version is the enforcement code's job, and a second
   * implementation in the UI is a second chance to disagree with it.
   */
  const [blocked, setBlocked] = useState<Record<string, BlockDecision>>({});

  const crashDialogRef = useFocusTrap<HTMLDivElement>(openCrashId !== null);
  const logDialogRef = useFocusTrap<HTMLDivElement>(openLogId !== null);

  // Escape closes whichever log viewer is open.
  useEffect(() => {
    if (openCrashId === null && openLogId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpenCrashId(null);
      setOpenLogId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openCrashId, openLogId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.electron.extensions.list();
      setExtensions(list as ExtensionStateInfo[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // Separate and non-fatal: a host without the marketplace wired up still
    // has a perfectly usable installed list, and failing the whole refresh
    // over a missing blocklist would be a worse outcome than no badges.
    try {
      const map = await window.electron.extensions.blocklist.checkInstalled();
      setBlocked((map ?? {}) as Record<string, BlockDecision>);
    } catch {
      setBlocked({});
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Developer Mode is owned by the main process, so read it rather than
  // assume a default - the UI is reflecting a setting, not holding it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const on = await window.electron.extensions.getDeveloperMode();
        if (!cancelled) setDeveloperMode(on === true);
      } catch {
        /* leave it off; the host is the authority either way */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleDeveloperMode = useCallback(async () => {
    setError(null);
    try {
      const next = await window.electron.extensions.setDeveloperMode(!developerMode);
      setDeveloperMode(next === true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [developerMode]);

  const handleLoadUnpacked = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electron.extensions.pickFolderAndLoadUnpacked();
      if (result && (result as { ok: boolean }).ok === false) {
        const code = (result as { code?: string }).code;
        if (code !== 'Cancelled' && code !== 'ConsentDenied') {
          setError((result as { message?: string }).message ?? 'Load failed');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refresh();
  }, [refresh]);

  const handleReloadUnpacked = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const result = await window.electron.extensions.reloadUnpacked(id);
        if (result && (result as { ok: boolean }).ok === false) {
          setError((result as { message?: string }).message ?? 'Reload failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [refresh],
  );

  const withBusy = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setBusyId(id);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const handleInstall = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electron.extensions.pickFolderAndInstall();
      if (result && (result as { ok: boolean }).ok === false) {
        const code = (result as { code?: string }).code;
        if (code !== 'Cancelled' && code !== 'ConsentDenied') {
          setError((result as { message?: string }).message ?? 'Install failed');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refresh();
  }, [refresh]);

  const handleInstallZip = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electron.extensions.pickZipAndInstall();
      if (result && (result as { ok: boolean }).ok === false) {
        const code = (result as { code?: string }).code;
        if (code !== 'Cancelled' && code !== 'ConsentDenied') {
          setError((result as { message?: string }).message ?? 'Install failed');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refresh();
  }, [refresh]);

  const handleViewCrash = useCallback(async (id: string) => {
    setOpenCrashId(id);
    try {
      const records = await window.electron.extensions.getCrashLog(id, 10);
      setCrashRecords(records as CrashRecord[]);
    } catch (err) {
      setCrashRecords([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleExpand = useCallback(async (ext: ExtensionStateInfo) => {
    if (expandedId === ext.manifest.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ext.manifest.id);
    if (ext.manifest.contributes?.configuration) {
      try {
        const values = await window.electron.extensions.getSettings(ext.manifest.id);
        setSettings(values);
      } catch {
        setSettings({});
      }
    } else {
      setSettings({});
    }
  }, [expandedId]);

  const handleTogglePermission = useCallback(
    async (id: string, current: string[], permission: string) => {
      const next = current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission];
      try {
        await window.electron.extensions.updatePermissions(id, next);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const handleSettingChange = useCallback(
    async (extensionId: string, key: string, value: unknown) => {
      const next = { ...settings, [key]: value };
      setSettings(next);
      try {
        await window.electron.extensions.setSettings(extensionId, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [settings],
  );

  const handleOpenFolder = useCallback(async (id: string) => {
    try {
      await window.electron.extensions.openInstallFolder(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleViewLog = useCallback(async (id: string) => {
    setOpenLogId(id);
    try {
      const entries = await window.electron.extensions.getLog(id, 200);
      setLogEntries(entries as LogEntry[]);
    } catch (err) {
      setLogEntries([
        { ts: Date.now(), level: 'error', message: `Failed to load log: ${(err as Error).message}` },
      ]);
    }
  }, []);

  const tabs: Array<{ id: ExtensionsTab; label: string }> = [
    { id: 'installed', label: t('extensions.tabs.installed') },
    { id: 'browse', label: t('extensions.tabs.browse') },
    { id: 'catalogs', label: t('extensions.tabs.catalogs') },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('extensions.tabs.label')}
        className="flex gap-1"
        style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`extensions-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 py-1.5 text-sm"
            style={{
              color:
                activeTab === tab.id
                  ? 'var(--theme-text-heading)'
                  : 'var(--theme-text-secondary)',
              borderBottom:
                activeTab === tab.id
                  ? '2px solid var(--theme-accent-primary)'
                  : '2px solid transparent',
              fontWeight: activeTab === tab.id ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'browse' && (
        <ExtensionCatalogBrowser
          installedIds={extensions.map((e) => e.manifest.id)}
          onInstalled={() => void refresh()}
          onManageCatalogs={() => setActiveTab('catalogs')}
        />
      )}

      {activeTab === 'catalogs' && <ExtensionCatalogSources />}

      {activeTab === 'installed' && (
        <>
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('extensionsSection.extensionsAddNewFunctionalityToThe')}
          <code className="mx-1 px-1 rounded" style={{ backgroundColor: 'var(--theme-bg-hover)' }}>extension.json</code>
          manifest.
        </p>
        <div className="flex gap-2">
          <button type="button"
            onClick={handleInstall}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              backgroundColor: 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
            }}
          >
            {t('extensionsSection.installFromFolder')}
          </button>
          <button type="button"
            onClick={handleInstallZip}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              backgroundColor: 'var(--theme-bg-hover)',
              color: 'var(--theme-text-primary)',
            }}
          >
            {t('extensionsSection.installFromZip')}
          </button>
        </div>
      </div>

      {/*
        Developer Mode. Kept visually quiet and below the normal install
        controls: it is a tool for people building extensions, not a feature
        most users should feel invited to switch on.
      */}
      <div
        className="rounded p-3 space-y-2"
        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
        data-testid="extensions-developer-mode"
      >
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={developerMode}
            onChange={() => void handleToggleDeveloperMode()}
            data-testid="extensions-developer-mode-toggle"
          />
          <span style={{ color: 'var(--theme-text-primary)' }}>
            {t('extensionsSection.developerMode')}
          </span>
        </label>
        <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('extensionsSection.developerModeHelp')}
        </p>
        {developerMode && (
          <button
            type="button"
            onClick={() => void handleLoadUnpacked()}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              backgroundColor: 'var(--theme-bg-secondary)',
              color: 'var(--theme-text-primary)',
            }}
            data-testid="extensions-load-unpacked"
          >
            {t('extensionsSection.loadUnpacked')}
          </button>
        )}
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

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          {t('extensionsSection.loading')}
        </p>
      ) : extensions.length === 0 ? (
        <p className="text-sm italic" style={{ color: 'var(--theme-text-muted)' }}>
          {t('extensionsSection.noExtensionsInstalled')}
        </p>
      ) : (
        <ul className="space-y-2">
          {extensions.map((ext) => {
            const id = ext.manifest.id;
            const isBusy = busyId === id;
            // Every row repeats the same button labels, so each accessible
            // name has to say which extension it acts on.
            const extName = displayName(ext.manifest.name);
            const blockDecision = blocked[id];
            return (
              <li
                key={id}
                className="rounded border p-3"
                style={{
                  borderColor: 'var(--theme-border-primary)',
                  backgroundColor: 'var(--theme-surface-primary)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: 'var(--theme-text-heading)' }}>
                        {displayName(ext.manifest.name)}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                        v{ext.manifest.version}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: 'var(--theme-bg-hover)',
                          color: STATUS_COLORS[ext.status] ?? 'var(--theme-text-secondary)',
                        }}
                      >
                        {ext.status}
                      </span>
                      <TrustBadge trustTier={ext.trustTier} />
                      {blockDecision && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          data-testid="extension-blocked-badge"
                          title={blockDecision.reason}
                          style={{
                            backgroundColor: 'var(--theme-danger-soft)',
                            color: 'var(--theme-danger)',
                          }}
                        >
                          {t('extensions.blocklist.badge')}
                        </span>
                      )}
                      {ext.devMode === true && (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-medium"
                          data-testid="extension-dev-badge"
                          title={t('extensionsSection.unpackedTooltip', { path: ext.installPath })}
                          style={{
                            backgroundColor: 'var(--theme-bg-hover)',
                            color: 'var(--theme-text-secondary)',
                          }}
                        >
                          {t('extensionsSection.unpackedBadge')}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-xs mt-1 truncate"
                      style={{ color: 'var(--theme-text-muted)' }}
                      title={id}
                    >
                      {id}
                    </div>
                    {ext.lastError && (
                      <div
                        className="text-xs mt-1"
                        style={{ color: 'var(--theme-danger)' }}
                      >
                        {ext.lastError}
                      </div>
                    )}
                    {/*
                      Blocked says why, and says what was *not* done. An
                      editor that silently removes something you installed is
                      the behaviour this is deliberately not.
                    */}
                    {blockDecision && (
                      <div
                        className="text-xs mt-1"
                        data-testid="extension-blocked-reason"
                        style={{ color: 'var(--theme-danger)' }}
                      >
                        {t('extensions.blocklist.rowReason', { reason: blockDecision.reason })}
                        {blockDecision.url && (
                          <>
                            {' '}
                            <a
                              href={blockDecision.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: 'underline' }}
                            >
                              {t('extensions.blocklist.moreInfo')}
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 flex-shrink-0">
                    {ext.enabled ? (
                      <button type="button"
                        disabled={isBusy}
                        onClick={() => withBusy(id, () => window.electron.extensions.disable(id))}
                        aria-label={t('extensionsSection.disableLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                      >
                        {t('extensionsSection.disable')}
                      </button>
                    ) : (
                      <button type="button"
                        disabled={isBusy}
                        onClick={() => withBusy(id, () => window.electron.extensions.enable(id))}
                        aria-label={t('extensionsSection.enableLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                      >
                        {t('extensionsSection.enable')}
                      </button>
                    )}
                    {ext.status === 'active' ? (
                      <button type="button"
                        disabled={isBusy}
                        onClick={() => withBusy(id, () => window.electron.extensions.deactivate(id))}
                        aria-label={t('extensionsSection.stopLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                      >
                        {t('extensionsSection.stop')}
                      </button>
                    ) : (
                      ext.enabled && ext.status !== 'auto-disabled' && (
                        <button type="button"
                          // Blocked activation is refused by the host, so the
                          // button is disabled rather than left to fail - but
                          // it stays visible, because hiding it would make the
                          // block look like a missing feature.
                          disabled={isBusy || blockDecision !== undefined}
                          title={blockDecision ? blockDecision.reason : undefined}
                          onClick={() => withBusy(id, () => window.electron.extensions.activate(id))}
                          aria-label={t('extensionsSection.activateLabel', { name: extName })}
                          className="px-2 py-1 rounded text-xs"
                          style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                        >
                          {t('extensionsSection.activate')}
                        </button>
                      )
                    )}
                    {ext.status === 'auto-disabled' && (
                      <button type="button"
                        disabled={isBusy}
                        onClick={() =>
                          withBusy(id, () => window.electron.extensions.resetCrashState(id))
                        }
                        aria-label={t('extensionsSection.resetCrashesLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                      >
                        {t('extensionsSection.resetCrashes')}
                      </button>
                    )}
                    <button type="button"
                      disabled={isBusy}
                      onClick={() => handleViewLog(id)}
                      aria-label={t('extensionsSection.viewLogLabel', { name: extName })}
                      className="px-2 py-1 rounded text-xs"
                      style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                    >
                      {t('extensionsSection.viewLog')}
                    </button>
                    {ext.crashCountSession > 0 && (
                      <button type="button"
                        disabled={isBusy}
                        onClick={() => handleViewCrash(id)}
                        aria-label={t('extensionsSection.crashLogLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{
                          backgroundColor: 'var(--theme-danger-soft)',
                          color: 'var(--theme-danger)',
                        }}
                      >
                        {t('extensionsSection.crashLog', { v1: ext.crashCountSession })}
                      </button>
                    )}
                    {ext.devMode === true && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleReloadUnpacked(id)}
                        data-testid={`extension-reload-${id}`}
                        aria-label={t('extensionsSection.reloadLabel', { name: extName })}
                        className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                      >
                        {t('extensionsSection.reload')}
                      </button>
                    )}
                    <button type="button"
                      disabled={isBusy}
                      onClick={() => handleOpenFolder(id)}
                      aria-label={t('extensionsSection.openFolderLabel', { name: extName })}
                      className="px-2 py-1 rounded text-xs"
                      style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                    >
                      {t('extensionsSection.openFolder')}
                    </button>
                    <button type="button"
                      disabled={isBusy}
                      onClick={() => handleExpand(ext)}
                      aria-expanded={expandedId === id}
                      aria-controls={`extension-details-${id}`}
                      aria-label={t('extensionsSection.detailsLabel', { name: extName })}
                      className="px-2 py-1 rounded text-xs"
                      style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                    >
                      {expandedId === id ? 'Hide details' : 'Details…'}
                    </button>
                    <button type="button"
                      disabled={isBusy}
                      onClick={() => withBusy(id, () => window.electron.extensions.uninstall(id))}
                      aria-label={t('extensionsSection.uninstallLabel', { name: extName })}
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        backgroundColor: 'var(--theme-danger-soft)',
                        color: 'var(--theme-danger)',
                      }}
                    >
                      {t('extensionsSection.uninstall')}
                    </button>
                  </div>
                </div>

                {expandedId === id && (
                  <div
                    id={`extension-details-${id}`}
                    className="mt-3 pt-3 space-y-3"
                    style={{ borderTop: '1px solid var(--theme-border-primary)' }}
                  >
                    {/* Permissions revocation */}
                    <div>
                      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--theme-text-heading)' }}>
                        {t('extensionsSection.permissions')}
                      </div>
                      {(ext.manifest.permissions ?? []).length === 0 ? (
                        <div className="text-xs italic" style={{ color: 'var(--theme-text-muted)' }}>
                          {t('extensionsSection.noneRequested')}
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {(ext.manifest.permissions ?? []).map((p) => {
                            const granted = ext.grantedPermissions.includes(p);
                            return (
                              <li key={p} className="text-xs">
                                {/* Wrapping <label> gives the checkbox a real
                                    name instead of leaving it unlabelled. */}
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={granted}
                                    onChange={() =>
                                      handleTogglePermission(id, ext.grantedPermissions, p)
                                    }
                                  />
                                  <code>{p}</code>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Settings rendered from contributes.configuration */}
                    {ext.manifest.contributes?.configuration?.properties && (
                      <div>
                        <div
                          className="text-xs font-semibold mb-1"
                          style={{ color: 'var(--theme-text-heading)' }}
                        >
                          {t('extensionsSection.settings')}
                        </div>
                        <div className="space-y-2">
                          {Object.entries(ext.manifest.contributes.configuration.properties).map(
                            ([key, schema]) => {
                              const value = settings[key] ?? schema.default;
                              const inputId = `${id}-${key}`;
                              return (
                                <div key={key} className="flex flex-col gap-1">
                                  <label htmlFor={inputId} className="text-xs">
                                    <code>{key}</code>
                                    {schema.description && (
                                      <span
                                        className="ms-2 italic"
                                        style={{ color: 'var(--theme-text-muted)' }}
                                      >
                                        {schema.description}
                                      </span>
                                    )}
                                  </label>
                                  {schema.type === 'boolean' ? (
                                    <input
                                      id={inputId}
                                      type="checkbox"
                                      checked={Boolean(value)}
                                      onChange={(e) => handleSettingChange(id, key, e.target.checked)}
                                    />
                                  ) : schema.enum ? (
                                    <select
                                      id={inputId}
                                      value={String(value ?? '')}
                                      onChange={(e) => handleSettingChange(id, key, e.target.value)}
                                      className="px-2 py-1 rounded text-xs"
                                      style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                                    >
                                      {schema.enum.map((opt) => (
                                        <option key={String(opt)} value={String(opt)}>
                                          {String(opt)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      id={inputId}
                                      type={schema.type === 'number' ? 'number' : 'text'}
                                      value={value === undefined || value === null ? '' : String(value)}
                                      onChange={(e) =>
                                        handleSettingChange(
                                          id,
                                          key,
                                          schema.type === 'number'
                                            ? Number(e.target.value)
                                            : e.target.value,
                                        )
                                      }
                                      className="px-2 py-1 rounded text-xs"
                                      style={{ backgroundColor: 'var(--theme-bg-hover)' }}
                                    />
                                  )}
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}

      {openCrashId && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[60]"
          style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
          onClick={() => setOpenCrashId(null)}
        >
          <div
            ref={crashDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-crash-log-title"
            className="rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            style={{
              backgroundColor: 'var(--theme-surface-elevated)',
              border: '1px solid var(--theme-border-primary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
            >
              <div
                id="extension-crash-log-title"
                className="font-semibold"
                style={{ color: 'var(--theme-text-heading)' }}
              >
                {t('extensionsSection.crashLog2', { v1: openCrashId })}
              </div>
              <div className="flex gap-2">
                <button type="button"
                  onClick={async () => {
                    if (!openCrashId) return;
                    await window.electron.extensions.resetCrashState(openCrashId);
                    setOpenCrashId(null);
                    await refresh();
                  }}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--theme-bg-hover)',
                    color: 'var(--theme-text-primary)',
                  }}
                >
                  {t('extensionsSection.resetCrashState')}
                </button>
                <button type="button"
                  onClick={() => setOpenCrashId(null)}
                  aria-label={t('extensionsSection.closeCrashLogLabel')}
                  className="text-sm"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {t('extensionsSection.close')}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 font-mono text-xs">
              {crashRecords.length === 0 ? (
                <div style={{ color: 'var(--theme-text-muted)' }}>{t('extensionsSection.noCrashesRecorded')}</div>
              ) : (
                crashRecords.map((c, i) => (
                  <div
                    key={i}
                    className="py-2"
                    style={{ borderTop: i > 0 ? '1px solid var(--theme-border-primary)' : 'none' }}
                  >
                    <div style={{ color: 'var(--theme-danger)', fontWeight: 600 }}>
                      [{new Date(c.ts).toISOString()}] exit code {c.exitCode ?? 'null'}
                      {c.lastRpcMethod && ` · last call: ${c.lastRpcMethod}`}
                    </div>
                    {c.stderrTail && (
                      <pre
                        className="mt-1 p-2 whitespace-pre-wrap"
                        style={{
                          backgroundColor: 'var(--theme-bg-hover)',
                          borderRadius: 4,
                          maxHeight: 200,
                          overflowY: 'auto',
                        }}
                      >
                        {c.stderrTail}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {openLogId && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[60]"
          style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
          onClick={() => setOpenLogId(null)}
        >
          <div
            ref={logDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-log-title"
            className="rounded-lg shadow-2xl w-full max-w-2xl max-h-[70vh] overflow-hidden flex flex-col"
            style={{
              backgroundColor: 'var(--theme-surface-elevated)',
              border: '1px solid var(--theme-border-primary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
            >
              <div
                id="extension-log-title"
                className="font-semibold"
                style={{ color: 'var(--theme-text-heading)' }}
              >
                {t('extensionsSection.log', { v1: openLogId })}
              </div>
              <button type="button"
                onClick={() => setOpenLogId(null)}
                aria-label={t('extensionsSection.closeLogLabel')}
                className="text-sm"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                {t('extensionsSection.close')}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 font-mono text-xs">
              {logEntries.length === 0 ? (
                <div style={{ color: 'var(--theme-text-muted)' }}>{t('extensionsSection.noEntries')}</div>
              ) : (
                logEntries.map((e, i) => (
                  <div
                    key={i}
                    className="py-0.5"
                    style={{
                      color:
                        e.level === 'error'
                          ? 'var(--theme-danger)'
                          : e.level === 'warn'
                            ? 'var(--theme-warning)'
                            : 'var(--theme-text-secondary)',
                    }}
                  >
                    [{new Date(e.ts).toISOString()}] [{e.level}] {e.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
