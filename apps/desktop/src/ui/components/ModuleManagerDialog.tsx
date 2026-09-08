import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useModuleStore, ModuleType } from '../stores/useModuleStore';
import { moduleAPI } from '../stores/module/moduleAPI';
import ModuleList from './ModuleList';
import DownloadProgressPanel from './DownloadProgressPanel';
import RepositorySettings from './RepositorySettings';
import FeaturePackPanel from './FeaturePackPanel';
import { activateFocusTrap } from '../utils/focusTrap';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';
import type { ModulePackInstallSummary } from '../../../electron/services/ModulePackService';

/** Extension check mirroring `isModulePackPath` (electron/services/ModulePackService.ts) for the drop handler. */
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
   * When set, the dialog opens on the Available tab pre-filtered to this module
   * type - an empty study pane sends the user straight to the modules
   * that would fill it. `null` opens with no filter (the default).
   */
  initialModuleType?: ModuleType | null;
}

type ViewModeId = 'available' | 'installed' | 'updates' | 'features' | 'repositories';

/**
 * View-mode tabs. Labels are catalog keys with English fallbacks - a tab label
 * is read aloud, so it has to translate like any other visible string.
 */
const VIEW_MODES: Array<{ id: ViewModeId; key: string; testId?: string }> = [
  { id: 'available', key: 'moduleManager.tabAvailable', testId: 'module-manager-available-tab' },
  { id: 'installed', key: 'moduleManager.tabInstalled', testId: 'module-manager-installed-tab' },
  { id: 'updates', key: 'moduleManager.tabUpdates' },
  { id: 'features', key: 'moduleManager.tabFeatures', testId: 'module-manager-features-tab' },
  { id: 'repositories', key: 'moduleManager.tabRepositories', testId: 'module-manager-repositories-tab' },
];

/**
 * ARIA-conformant view-mode tablist for ModuleManagerDialog.
 * Uses `useTabKeyboardNav` for arrow/Home/End keyboard movement.
 */
const ViewModeTabs: React.FC<{
  viewMode: ViewModeId;
  setViewMode: (mode: ViewModeId) => void;
}> = ({ viewMode, setViewMode }) => {
  const { t } = useI18n();
  const activeIndex = VIEW_MODES.findIndex(m => m.id === viewMode);
  const { tablistRef, onKeyDown } = useTabKeyboardNav({
    tabCount: VIEW_MODES.length,
    activeIndex,
    onActivate: (index) => setViewMode(VIEW_MODES[index].id),
  });
  return (
    <div className="px-6 pt-4 border-b border-border">
      <div
        className="flex gap-1"
        role="tablist"
        aria-label={t('moduleManager.viewsLabel')}
        ref={tablistRef}
        onKeyDown={onKeyDown}
      >
        {VIEW_MODES.map((mode) => {
          const isActive = viewMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="tab"
              id={`module-manager-tab-${mode.id}`}
              aria-selected={isActive}
              aria-controls={`module-manager-panel-${mode.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setViewMode(mode.id)}
              data-testid={mode.testId}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                isActive
                  ? 'bg-surface text-accent border-t-2 border-s border-e border-accent'
                  : 'bg-background-tertiary text-text-secondary hover:bg-background-active'
              }`}
            >
              {t(mode.key)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ModuleManagerDialog: React.FC<ModuleManagerDialogProps> = ({ onClose, initialModuleType }) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const appliedInitialFilterRef = useRef(false);
  const [searchInput, setSearchInput] = useState('');
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

  const {
    isInitialized,
    initError,
    viewMode,
    loadingAvailable,
    loadingInstalled,
    error,
    activeDownloads,
    repositories,
    activeFilter,
    initialize,
    setViewMode,
    searchModules,
    setFilter,
    clearFilter,
    refreshAllCatalogs,
    clearError,
    startDownloadPolling,
    stopDownloadPolling,
    loadInstalledModules
  } = useModuleStore();

  // Initialize on mount
  useEffect(() => {
    if (!isInitialized && !initError) {
      initialize();
    }
  }, [isInitialized, initError, initialize]);

  // D2: when opened from an empty study pane, land on the Available tab filtered
  // to the pane's module type. Applied once, after init, so it isn't clobbered
  // by the store's own initialization.
  useEffect(() => {
    if (!isInitialized) return;
    if (appliedInitialFilterRef.current) return;
    appliedInitialFilterRef.current = true;
    if (initialModuleType) {
      setViewMode('available');
      setFilter({ moduleType: initialModuleType });
    }
  }, [isInitialized, initialModuleType, setViewMode, setFilter]);

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

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchInput(query);
    searchModules(query);
  };

  // Handle module type filter
  const handleTypeFilter = (type: ModuleType | null) => {
    if (type === null) {
      clearFilter();
    } else {
      setFilter({ moduleType: type });
    }
  };

  // Handle refresh catalog
  const handleRefreshCatalog = async () => {
    await refreshAllCatalogs();
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
          const summary = await moduleAPI.installPackFromPath(archivePath, true);
          combinedPackSummary = combinedPackSummary ? mergePackSummaries(combinedPackSummary, summary) : summary;
          if (summary.failed.length > 0) hasError = true;
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
    ? new Date(officialRepo.lastFetched).toLocaleDateString()
    : 'Never';

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

        {/* Error Banner */}
        {error && (
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

        {/* View Mode Tabs */}
        <ViewModeTabs viewMode={viewMode} setViewMode={setViewMode} />


        {/* Toolbar (hidden on the tabs that render their own panel - module
            search, type filter and catalog refresh have nothing to act on) */}
        {viewMode !== 'repositories' && viewMode !== 'features' && (
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

            {/* Module Type Filter */}
            {viewMode === 'available' && (
              <select
                value={
                  activeFilter.moduleType
                    ? Array.isArray(activeFilter.moduleType)
                      ? activeFilter.moduleType[0]
                      : activeFilter.moduleType
                    : 'all'
                }
                onChange={(e) =>
                  handleTypeFilter(e.target.value === 'all' ? null : e.target.value as ModuleType)
                }
                aria-label={t('moduleManager.typeFilterLabel')}
                className="px-3 py-2 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="all">{t('moduleManagerDialog.typeAll')}</option>
                <option value="bible">{t('moduleManagerDialog.typeBibles')}</option>
                <option value="commentary">{t('moduleManagerDialog.typeCommentaries')}</option>
                <option value="dictionary">{t('moduleManagerDialog.typeDictionaries')}</option>
                <option value="book">{t('moduleManagerDialog.typeBooks')}</option>
                <option value="devotional">{t('moduleManagerDialog.typeDevotionals')}</option>
                <option value="lexicon">{t('moduleManagerDialog.typeLexicons')}</option>
                <option value="topical_index">{t('moduleManagerDialog.typeTopicalIndexes')}</option>
                <option value="cross_reference">{t('moduleManagerDialog.typeCrossReferences')}</option>
                <option value="tag_graph">{t('moduleManagerDialog.typeTagGraphs')}</option>
              </select>
            )}

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
            {viewMode === 'available' && (
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
            )}

            {/* Last Updated */}
            {viewMode === 'available' && (
              <div className="text-xs text-text-tertiary whitespace-nowrap">
                {t('moduleManagerDialog.lastUpdated', { date: lastUpdated })}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Main Content */}
        <div
          className="flex-1 overflow-y-auto"
          role="tabpanel"
          id={`module-manager-panel-${viewMode}`}
          aria-labelledby={`module-manager-tab-${viewMode}`}
        >
          {viewMode === 'repositories' ? (
            <RepositorySettings />
          ) : viewMode === 'features' ? (
            <FeaturePackPanel />
          ) : (
            <ModuleList viewMode={viewMode} />
          )}
        </div>

        {/* Downloads Panel (if active downloads exist) */}
        {activeDownloads.length > 0 && <DownloadProgressPanel />}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-surface-secondary">
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              {viewMode === 'available' && (
                <span>
                  {loadingAvailable
                    ? t('moduleManagerDialog.loading')
                    : t('moduleManagerDialog.footerAvailable')}
                </span>
              )}
              {viewMode === 'installed' && (
                <span>
                  {loadingInstalled
                    ? t('moduleManagerDialog.loading')
                    : t('moduleManagerDialog.footerInstalled')}
                </span>
              )}
              {viewMode === 'updates' && <span>{t('moduleManagerDialog.checkUpdates')}</span>}
              {viewMode === 'features' && (
                <span>
                  {t('moduleManagerDialog.footerFeatures')}
                </span>
              )}
              {viewMode === 'repositories' && (
                <span>{t('moduleManagerDialog.manageRepos')}</span>
              )}
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
