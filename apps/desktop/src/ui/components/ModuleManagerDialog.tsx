import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODULE_TYPES } from '@bible/core';
import { useI18n } from '../contexts/useI18n';
import { useModuleStore, ModuleType } from '../stores/useModuleStore';
import type { ModuleInstallFilter, ModuleManagerTab } from '../stores/module/types';
import { useNetworkStore } from '../stores/useNetworkStore';
import { moduleAPI } from '../stores/module/moduleAPI';
import { mergeAndSortModules, getTabTypes, type ModuleRow } from '../stores/module/moduleRows';
import ModuleTable from './moduleManager/ModuleTable';
import { findRowDownload } from './moduleManager/ModuleRow';
import ModuleDetailsPanel from './moduleManager/ModuleDetailsPanel';
import { MODULE_TYPE_LABELS, useTd } from './moduleManager/moduleManagerI18n';
import { TabStrip } from './shared/TabStrip';
import DownloadProgressPanel from './DownloadProgressPanel';
import RepositorySettings from './RepositorySettings';
import FeaturePackPanel from './FeaturePackPanel';
import ConfirmDialog from './shared/ConfirmDialog';
import { activateFocusTrap } from '../utils/focusTrap';
import type { ModulePackInstallSummary } from '../../../electron/services/ModulePackService';

/**
 * Extension check mirroring `isModulePackPath` (electron/services/ModulePackService.ts)
 * for the drop handler. Both extensions get the same trust gate below -
 * `.zip` is not a lesser-checked shortcut, since deciding trust from a
 * filename extension (something the file itself controls) would let a
 * hostile archive simply rename its way past verification.
 */
function isPackFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.biblepack');
}

/** Combine two pack install summaries - used when more than one archive is dropped at once. */
function mergePackSummaries(a: ModulePackInstallSummary, b: ModulePackInstallSummary): ModulePackInstallSummary {
  return {
    found: a.found + b.found,
    installed: [...a.installed, ...b.installed],
    failed: [...a.failed, ...b.failed],
    skipped: [...a.skipped, ...b.skipped],
  };
}

/**
 * Per-module results panel for a batch/pack install: which module files were
 * found in the archive, which installed, which failed (and why), and which
 * archive entries were skipped (and why - non-module file, zip-slip
 * rejection, over a size/count limit).
 */
const ModulePackSummaryPanel: React.FC<{ summary: ModulePackInstallSummary; onClose: () => void }> = ({ summary, onClose }) => {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-[60] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-pack-summary-title"
        data-testid="module-pack-summary-dialog"
        className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 id="module-pack-summary-title" className="text-lg font-semibold text-text-heading">
            {t('moduleManagerDialog.packSummaryTitle')}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            {t(
              'moduleManagerDialog.packSummaryCounts',
              { found: summary.found, installedCount: summary.installed.length, failedCount: summary.failed.length, skippedCount: summary.skipped.length, },
            )}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {summary.installed.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-success mb-2">
                {t('moduleManagerDialog.packSummaryInstalled')}
              </h4>
              <ul className="text-sm text-text-primary space-y-1">
                {summary.installed.map((item, i) => (
                  <li key={`installed-${i}`}>
                    {item.moduleName ?? item.entryPath}
                    {item.overwritten ? ` (${t('moduleManagerDialog.packSummaryUpdated')})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.failed.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-danger mb-2">
                {t('moduleManagerDialog.packSummaryFailed')}
              </h4>
              <ul className="text-sm text-text-primary space-y-1">
                {summary.failed.map((item, i) => (
                  <li key={`failed-${i}`}>
                    <span className="font-medium">{item.entryPath}</span>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.skipped.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-text-secondary mb-2">
                {t('moduleManagerDialog.packSummarySkipped')}
              </h4>
              <ul className="text-sm text-text-secondary space-y-1">
                {summary.skipped.map((item, i) => (
                  <li key={`skipped-${i}`}>
                    <span className="font-medium">{item.entryPath}</span>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border bg-surface-secondary flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
          >
            {t('moduleManagerDialog.closeButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface ModuleManagerDialogProps {
  onClose: () => void;
  /**
   * When set, the dialog opens on that module type's tab (with the All filter)
   * - an empty study pane sends the user straight to the modules that would
   * fill it. `null` opens on whichever tab was last used (the default).
   */
  initialModuleType?: ModuleType | null;
}

const INSTALL_FILTERS: Array<{ id: ModuleInstallFilter; key: string; fallback: string }> = [
  { id: 'all', key: 'moduleManager.filterAll', fallback: 'All' },
  { id: 'installed', key: 'moduleManager.filterInstalled', fallback: 'Installed' },
  { id: 'updates', key: 'moduleManager.filterUpdates', fallback: 'Updates' },
];

const isPanelTab = (tab: ModuleManagerTab): tab is 'features' | 'repositories' =>
  tab === 'features' || tab === 'repositories';

const ModuleManagerDialog: React.FC<ModuleManagerDialogProps> = ({ onClose, initialModuleType }) => {
  const { t, localizer } = useI18n();
  const td = useTd();
  const dialogRef = useRef<HTMLDivElement>(null);
  const appliedInitialFilterRef = useRef(false);
  const [searchInput, setSearchInput] = useState('');
  // The selected row is local to the dialog (by abbreviation, the row key) -
  // it is not store state, so reopening the dialog starts with no panel.
  const [selectedAbbreviation, setSelectedAbbreviation] = useState<string | null>(null);
  // Abbreviations with an install/update/uninstall in flight (disables that row's buttons).
  const [busyAbbreviations, setBusyAbbreviations] = useState<ReadonlySet<string>>(() => new Set());
  const [uninstallRequest, setUninstallRequest] = useState<{ row: ModuleRow; removeUserData: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropResult, setDropResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [packSummary, setPackSummary] = useState<ModulePackInstallSummary | null>(null);
  // A pack/batch install runs many per-module conformance checks + file moves
  // synchronously behind one IPC call, which can take a while for a large
  // pack. This is a coarse "work is happening" indicator (disables the
  // upload button, shows a spinner) rather than true per-file progress -
  // streaming progress would need an event-based IPC channel akin to
  // `SemanticPackService`'s polling design, which is out of scope here.
  const [isInstalling, setIsInstalling] = useState(false);
  const dragCounterRef = useRef(0);
  // A `.biblepack` that is unsigned or signed by an untrusted key needs the
  // user's explicit "install anyway" before `installPackFromPath` is called
  // with `acceptUnverified: true` - main re-verifies regardless (see
  // `moduleHandlers.ts`), this is only ever a UI gate. Resolved by whichever
  // button on `ConfirmDialog` the user clicks.
  const [packConfirm, setPackConfirm] = useState<{
    fileName: string;
    message: string;
    resolve: (accept: boolean) => void;
  } | null>(null);

  const confirmUnverifiedPack = useCallback(
    (fileName: string, message: string): Promise<boolean> =>
      new Promise((resolve) => setPackConfirm({ fileName, message, resolve })),
    []
  );

  /**
   * Install a dropped pack archive - `.zip` exactly like `.biblepack`, see
   * `isPackFileName`'s doc comment - inspecting its signature first
   * (`module:inspect-pack`) and asking the user before installing one that
   * isn't verified. Returns the install summary, `{ errorMessage }` for an
   * invalid/tampered pack (no install attempted), or `null` if the user
   * declined - the caller treats that like a cancelled dialog, not a failure.
   */
  const installPackWithTrustCheck = useCallback(
    async (archivePath: string, fileName: string): Promise<ModulePackInstallSummary | { errorMessage: string } | null> => {
      const inspection = await moduleAPI.inspectPack(archivePath);
      if (inspection.status === 'invalid') {
        return { errorMessage: t('moduleManagerDialog.packInvalidBody') };
      }
      let acceptUnverified = false;
      if (inspection.status === 'unsigned' || inspection.status === 'untrusted') {
        const accepted = await confirmUnverifiedPack(fileName, inspection.message);
        if (!accepted) return null;
        acceptUnverified = true;
      }
      return await moduleAPI.installPackFromPath(archivePath, true, { acceptUnverified });
    },
    [confirmUnverifiedPack, t]
  );

  const {
    isInitialized,
    initError,
    activeTypeTab,
    installFilter,
    availableModules,
    installedModules,
    loadingAvailable,
    loadingInstalled,
    error,
    errorCode,
    activeDownloads,
    repositories,
    initialize,
    setActiveTypeTab,
    setInstallFilter,
    installModule,
    updateModule,
    uninstallModule,
    refreshAllCatalogs,
    clearError,
    startDownloadPolling,
    stopDownloadPolling,
    loadInstalledModules
  } = useModuleStore();
  const { allowWebRequests, requestAllow } = useNetworkStore();

  // Initialize on mount
  useEffect(() => {
    if (!isInitialized && !initError) {
      initialize();
    }
  }, [isInitialized, initError, initialize]);

  // D2: when opened from an empty study pane, land on the pane's module type
  // tab with the All filter. Applied once, after init, so it isn't clobbered
  // by the store's own initialization.
  useEffect(() => {
    if (!isInitialized) return;
    if (appliedInitialFilterRef.current) return;
    appliedInitialFilterRef.current = true;
    if (initialModuleType) {
      setActiveTypeTab(initialModuleType);
      setInstallFilter('all');
    }
  }, [isInitialized, initialModuleType, setActiveTypeTab, setInstallFilter]);

  // One merged, sorted row per module (catalog + installed joined on abbreviation).
  const rows = useMemo(
    () => mergeAndSortModules(availableModules, installedModules),
    [availableModules, installedModules]
  );

  // One tab per module type that has modules ('bible' always). A type the dialog
  // was opened on (or last left on) stays a tab even if it has no modules, so
  // an empty catalog/offline state still lands on the type the user asked for.
  const tabTypes = useMemo(() => {
    const types = getTabTypes(availableModules, installedModules);
    if (!isPanelTab(activeTypeTab) && !types.includes(activeTypeTab)) {
      types.push(activeTypeTab);
      types.sort((a, b) => MODULE_TYPES.indexOf(a) - MODULE_TYPES.indexOf(b));
    }
    return types;
  }, [availableModules, installedModules, activeTypeTab]);

  // Start/stop download polling based on active downloads
  useEffect(() => {
    const hasActiveDownloads = activeDownloads.some(
      d => d.status === 'downloading' || d.status === 'pending'
    );

    if (hasActiveDownloads) {
      startDownloadPolling();
    } else {
      stopDownloadPolling();
    }
  }, [activeDownloads, startDownloadPolling, stopDownloadPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopDownloadPolling();
    };
  }, [stopDownloadPolling]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus trap: keyboard focus stays inside the dialog until closed.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, [isInitialized]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Search filters the rows locally (name / abbreviation / description), so it
  // covers installed-only modules that are not in the catalog too.
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTypeTab(tabId as ModuleManagerTab);
    setSelectedAbbreviation(null);
  };

  // Run a row's install/update/uninstall with that row marked busy.
  const runRowAction = async (row: ModuleRow, action: () => Promise<unknown>) => {
    setBusyAbbreviations((prev) => new Set(prev).add(row.abbreviation));
    try {
      await action();
    } finally {
      setBusyAbbreviations((prev) => {
        const next = new Set(prev);
        next.delete(row.abbreviation);
        return next;
      });
    }
  };

  const handleInstallRow = (row: ModuleRow) => {
    const catalogModule = row.catalogModule;
    if (!catalogModule) return;
    void runRowAction(row, () => installModule(catalogModule.module_id));
  };

  const handleUpdateRow = (row: ModuleRow) => {
    const installedModule = row.installedModule;
    if (!installedModule) return;
    void runRowAction(row, () => updateModule(installedModule.module_id));
  };

  // Uninstall is destructive: it always goes through the confirm dialog first.
  const handleUninstallRow = (row: ModuleRow, removeUserData: boolean) => {
    if (!row.installedModule) return;
    setUninstallRequest({ row, removeUserData });
  };

  const confirmUninstall = () => {
    const request = uninstallRequest;
    setUninstallRequest(null);
    const installedModule = request?.row.installedModule;
    if (!request || !installedModule) return;
    void runRowAction(request.row, () => uninstallModule(installedModule.module_id, request.removeUserData));
  };

  // Handle refresh catalog
  const handleRefreshCatalog = async () => {
    await refreshAllCatalogs();
  };

  // Offline banner's "Turn on" - same confirmation-gated path as the menu
  // checkbox and the Preferences toggle (see `useNetworkStore`). A refresh is
  // only worth attempting once the switch is confirmed on; a cancelled
  // dialog leaves the banner exactly as it was.
  const handleTurnOnNetwork = async () => {
    const allowed = await requestAllow(true);
    if (allowed) await refreshAllCatalogs();
  };

  // Handle file upload - the dialog supports selecting multiple plain module
  // files at once, or a single pack archive (.zip/.biblepack) bundling many
  // modules. `result.kind` distinguishes the still-common single-file case
  // (unchanged toast feedback) from a batch/pack install (a per-module
  // results panel, since a single toast can't usefully summarize N outcomes).
  const handleUploadModule = async () => {
    setIsInstalling(true);
    try {
      const result = await moduleAPI.installFromFile();

      if (result === null) {
        // User cancelled the file dialog - no feedback needed.
        return;
      }

      if (result.kind === 'single') {
        setDropResult({
          message: t('moduleManagerDialog.installSuccess', { name: result.moduleName }),
          isError: false,
        });
        setTimeout(() => setDropResult(null), 4000);
      } else {
        setPackSummary(result.summary);
      }
      await loadInstalledModules();
    } catch (error) {
      setDropResult({
        message: t('moduleManagerDialog.installError', { message: (error as Error).message }),
        isError: true,
      });
      setTimeout(() => setDropResult(null), 4000);
    } finally {
      setIsInstalling(false);
    }
  };

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (isInstalling) return; // an install is already in flight - ignore concurrent drops

    const files = Array.from(e.dataTransfer.files);
    const moduleFiles = files.filter(f =>
      f.name.endsWith('.db') || f.name.endsWith('.gz')
    );
    const packFiles = files.filter(f => isPackFileName(f.name));

    if (moduleFiles.length === 0 && packFiles.length === 0) {
      setDropResult({
        message: t('moduleManagerDialog.noValidFiles'),
        isError: true,
      });
      setTimeout(() => setDropResult(null), 4000);
      return;
    }

    const results: string[] = [];
    let hasError = false;
    let combinedPackSummary: ModulePackInstallSummary | null = null;

    setIsInstalling(true);
    try {
      for (const file of moduleFiles) {
        try {
          // Electron 32 removed `File.path`; resolve the real path via the
          // preload's webUtils bridge instead (B2). The bridge also authorizes
          // the resolved path for the install call that follows.
          const filePath = await window.electron.webUtils.getPathForFile(file);
          const result = await moduleAPI.installFromPath(filePath, true);
          const action = result.overwritten ? 'Updated' : 'Installed';
          results.push(`${action} "${result.moduleName}"`);
        } catch (error) {
          results.push(`Error: ${file.name} - ${(error as Error).message}`);
          hasError = true;
        }
      }

      for (const file of packFiles) {
        try {
          const archivePath = await window.electron.webUtils.getPathForFile(file);
          const result = await installPackWithTrustCheck(archivePath, file.name);
          if (result === null) continue; // user declined an unverified pack - not an error
          if ('errorMessage' in result) {
            results.push(`Error: ${file.name} - ${result.errorMessage}`);
            hasError = true;
            continue;
          }
          combinedPackSummary = combinedPackSummary ? mergePackSummaries(combinedPackSummary, result) : result;
          if (result.failed.length > 0) hasError = true;
        } catch (error) {
          results.push(`Error: ${file.name} - ${(error as Error).message}`);
          hasError = true;
        }
      }
    } finally {
      setIsInstalling(false);
    }

    // Refresh the installed modules list
    await loadInstalledModules();

    if (combinedPackSummary) {
      setPackSummary(combinedPackSummary);
    }
    if (results.length > 0) {
      setDropResult({
        message: results.join('; '),
        isError: hasError
      });
      setTimeout(() => setDropResult(null), 5000);
    }
  };

  if (initError) {
    return (
      <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50">
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="module-manager-error-title"
          className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        >
          <h2 id="module-manager-error-title" className="text-xl font-semibold text-danger mb-4">{t('moduleManagerDialog.initErrorHeading')}</h2>
          <p className="text-text-primary mb-6">{initError}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
            >
              {t('moduleManagerDialog.closeButton')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('moduleManagerDialog.initializing')}
          className="bg-surface rounded-lg shadow-xl w-full max-w-md p-6"
        >
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            <p className="text-text-primary">{t('moduleManagerDialog.initializing')}</p>
          </div>
        </div>
      </div>
    );
  }

  const officialRepo = repositories.find(r => r.type === 'official');
  const lastUpdated = officialRepo?.lastFetched
    ? localizer.formatDate(new Date(officialRepo.lastFetched))
    : td('moduleManager.lastUpdatedNever', 'Never');

  const panelTab = isPanelTab(activeTypeTab);
  const selectedRow = isPanelTab(activeTypeTab)
    ? undefined
    : rows.find(r => r.abbreviation === selectedAbbreviation && r.module_type === activeTypeTab);
  const typeLabel = (type: ModuleType) => td(MODULE_TYPE_LABELS[type].key, MODULE_TYPE_LABELS[type].fallback);
  const tabs = tabTypes.map(type => ({
    id: type,
    label: typeLabel(type),
    testId: `module-manager-type-tab-${type}`,
  }));
  const trailingTabs = [
    {
      id: 'features',
      label: td('moduleManager.tabFeaturePacks', 'Feature packs'),
      testId: 'module-manager-features-tab',
    },
    {
      id: 'repositories',
      label: td('moduleManager.tabSources', 'Sources'),
      testId: 'module-manager-repositories-tab',
    },
  ];

  return (
    <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50 p-4" data-testid="module-manager-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-manager-title"
        className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col relative"
        data-testid="module-manager-dialog"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag-and-drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-accent/10 border-4 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
            <div className="bg-surface rounded-xl shadow-lg px-8 py-6 text-center">
              <svg className="w-12 h-12 mx-auto mb-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-lg font-semibold text-accent">{t('moduleManagerDialog.dropHere')}</p>
              <p className="text-sm text-text-secondary mt-1">{t('moduleManagerDialog.dropHint')}</p>
            </div>
          </div>
        )}

        {/* Batch / pack install results panel */}
        {packSummary && (
          <ModulePackSummaryPanel summary={packSummary} onClose={() => setPackSummary(null)} />
        )}

        {/* "Install anyway?" for an unsigned/untrusted .biblepack */}
        <ConfirmDialog
          open={packConfirm !== null}
          title={t('moduleManagerDialog.packUnverifiedTitle')}
          message={packConfirm ? `${packConfirm.message} ${t('moduleManagerDialog.packUnverifiedHint')}` : ''}
          confirmLabel={t('moduleManagerDialog.installAnyway')}
          onConfirm={() => {
            packConfirm?.resolve(true);
            setPackConfirm(null);
          }}
          onCancel={() => {
            packConfirm?.resolve(false);
            setPackConfirm(null);
          }}
        />

        {/* Drop result notification */}
        {dropResult && (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg text-sm font-medium ${
            dropResult.isError
              ? 'bg-danger-soft text-danger-text border border-danger-border'
              : 'bg-success-soft text-success-text border border-success-border'
          }`}>
            {dropResult.message}
          </div>
        )}

        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="module-manager-title" className="text-2xl font-semibold text-text-heading">{t('moduleManagerDialog.title')}</h2>
              <p className="text-sm text-text-secondary mt-1">
                {t('moduleManagerDialog.subtitle')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary transition-colors"
              aria-label={t('moduleManagerDialog.closeLabel')}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Error Banner - `network_blocked` gets the offline banner below
            instead, so the two never stack for the same underlying cause. */}
        {error && errorCode !== 'network_blocked' && (
          <div className="px-6 py-3 bg-danger-soft border-b border-danger-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-danger"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-danger-text">{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-danger hover:text-danger-text transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Module-type tabs, plus the Feature packs / Sources panels on the right */}
        <TabStrip
          tabs={tabs}
          trailingTabs={trailingTabs}
          activeId={activeTypeTab}
          onChange={handleTabChange}
          ariaLabel={t('moduleManager.viewsLabel')}
        />

        {/* Toolbar (hidden on the tabs that render their own panel - module
            search, install filter and catalog refresh have nothing to act on) */}
        {!panelTab && (
        <div className="px-6 py-3 bg-surface-secondary border-b border-border">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                placeholder={t('moduleManagerDialog.searchPlaceholder')}
                aria-label={t('moduleManagerDialog.searchPlaceholder')}
                className="w-full px-4 py-2 ps-10 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              />
              <svg
                className="absolute start-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            {/* All / Installed / Updates filter chips */}
            <div
              role="group"
              aria-label={td('moduleManager.installFilterLabel', 'Filter by install status')}
              className="flex gap-1"
              data-testid="module-manager-install-filter"
            >
              {INSTALL_FILTERS.map(({ id, key, fallback }) => {
                const isActive = installFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={isActive}
                    data-testid={`module-manager-filter-${id}`}
                    onClick={() => setInstallFilter(id)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      isActive
                        ? 'bg-accent text-text-on-accent border-accent'
                        : 'bg-surface text-text-secondary border-border hover:bg-background-hover'
                    }`}
                  >
                    {td(key, fallback)}
                  </button>
                );
              })}
            </div>

            {/* Upload Module File(s) / Pack */}
            <button
              onClick={handleUploadModule}
              disabled={isInstalling}
              className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title={t('moduleManagerDialog.uploadTitle')}
            >
              <svg
                className={`w-4 h-4 ${isInstalling ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={isInstalling
                    ? 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                    : 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12'}
                />
              </svg>
              {isInstalling
                ? t('moduleManagerDialog.installing')
                : t('moduleManagerDialog.uploadModule')}
            </button>

            {/* Refresh Catalog */}
            <button
              onClick={handleRefreshCatalog}
              disabled={loadingAvailable}
              className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg
                className={`w-4 h-4 ${loadingAvailable ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {t('moduleManagerDialog.refresh')}
            </button>

            {/* Last Updated */}
            <div className="text-xs text-text-tertiary whitespace-nowrap">
              {t('moduleManagerDialog.lastUpdated', { date: lastUpdated })}
            </div>
          </div>
        </div>
        )}

        {/* Offline banner - persistent (not dismissible like the error banner
            above), because it describes a mode, not a one-off failure. Shown
            on the module tabs whenever the catalog can't be reached (not under
            the Installed filter, which needs no catalog), so a
            `NetworkBlockedError` from Refresh never has to fall back to a
            generic "no modules found, adjust your filter". */}
        {!panelTab && installFilter !== 'installed' && !allowWebRequests && (
          <div
            className="px-6 py-3 bg-warning-soft border-b border-warning-border flex items-center justify-between gap-4"
            data-testid="module-manager-offline-banner"
          >
            <span className="text-sm text-warning-text">{t('moduleManagerDialog.offlineBanner')}</span>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => void handleTurnOnNetwork()}
                data-testid="module-manager-offline-turn-on"
                className="px-3 py-1.5 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
              >
                {t('moduleManagerDialog.turnOnNetwork')}
              </button>
              <button
                type="button"
                onClick={handleUploadModule}
                disabled={isInstalling}
                data-testid="module-manager-offline-install-file"
                className="px-3 py-1.5 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('moduleManagerDialog.installFromFile')}
              </button>
            </div>
          </div>
        )}

        {/* Main Content: the active tab's panel, plus the module details panel
            (in-dialog, not a nested modal) once a row is selected. */}
        <div className="flex-1 min-h-0 flex">
          <div
            className="flex-1 min-w-0 overflow-y-auto"
            role="tabpanel"
            id={`panel-${activeTypeTab}`}
            aria-labelledby={`tab-${activeTypeTab}`}
          >
            {activeTypeTab === 'repositories' ? (
              <RepositorySettings />
            ) : activeTypeTab === 'features' ? (
              <FeaturePackPanel />
            ) : (
              <ModuleTable
                type={activeTypeTab}
                rows={rows}
                installFilter={installFilter}
                searchQuery={searchInput}
                selectedAbbreviation={selectedRow?.abbreviation ?? null}
                loading={loadingAvailable || loadingInstalled}
                offline={!allowWebRequests}
                busyAbbreviations={busyAbbreviations}
                activeDownloads={activeDownloads}
                ariaLabel={typeLabel(activeTypeTab)}
                onSelect={(row) => setSelectedAbbreviation(row.abbreviation)}
                onInstall={handleInstallRow}
                onUpdate={handleUpdateRow}
              />
            )}
          </div>
          {selectedRow && (
            <div className="w-96 max-w-[45%] flex-shrink-0 border-s border-border overflow-y-auto">
              <ModuleDetailsPanel
                key={selectedRow.abbreviation}
                row={selectedRow}
                activeDownload={findRowDownload(selectedRow, activeDownloads)}
                isOffline={!allowWebRequests}
                onClose={() => setSelectedAbbreviation(null)}
                onInstall={handleInstallRow}
                onUpdate={handleUpdateRow}
                onUninstall={handleUninstallRow}
              />
            </div>
          )}
        </div>

        {/* Confirm before uninstalling a module */}
        <ConfirmDialog
          open={uninstallRequest !== null}
          destructive
          title={td('moduleManager.uninstallConfirmTitle', 'Uninstall module')}
          message={
            uninstallRequest
              ? uninstallRequest.removeUserData
                ? td(
                    'moduleManager.uninstallConfirmBodyRemoveData',
                    'Uninstall "{name}" and remove your notes and highlights for it? This cannot be undone.',
                    { name: uninstallRequest.row.name }
                  )
                : td(
                    'moduleManager.uninstallConfirmBody',
                    'Uninstall "{name}"? Your notes and highlights for it are kept.',
                    { name: uninstallRequest.row.name }
                  )
              : ''
          }
          confirmLabel={td('moduleCard.uninstall', 'Uninstall')}
          onConfirm={confirmUninstall}
          onCancel={() => setUninstallRequest(null)}
        />

        {/* Downloads Panel (if active downloads exist) */}
        {activeDownloads.length > 0 && <DownloadProgressPanel />}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-surface-secondary">
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              {activeTypeTab === 'features' && <span>{t('moduleManagerDialog.footerFeatures')}</span>}
              {activeTypeTab === 'repositories' && <span>{t('moduleManagerDialog.manageRepos')}</span>}
              {!panelTab && installFilter === 'all' && (
                <span>
                  {loadingAvailable
                    ? t('moduleManagerDialog.loading')
                    : t('moduleManagerDialog.footerAvailable')}
                </span>
              )}
              {!panelTab && installFilter === 'installed' && (
                <span>
                  {loadingInstalled
                    ? t('moduleManagerDialog.loading')
                    : t('moduleManagerDialog.footerInstalled')}
                </span>
              )}
              {!panelTab && installFilter === 'updates' && <span>{t('moduleManagerDialog.checkUpdates')}</span>}
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
            >
              {t('moduleManagerDialog.closeButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModuleManagerDialog;
