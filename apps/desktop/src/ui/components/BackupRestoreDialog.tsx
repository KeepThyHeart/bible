import { useEffect, useCallback, useRef } from 'react';
import { useBackupStore } from '../stores/useBackupStore';
import { useI18n } from '../contexts/useI18n';
import { activateFocusTrap } from '../utils/focusTrap';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';

const BACKUP_TABS: Array<{ id: 'backup' | 'restore'; labelKey: string }> = [
  { id: 'backup', labelKey: 'backupRestoreDialog.tabBackup' },
  { id: 'restore', labelKey: 'backupRestoreDialog.tabRestore' },
];

export function BackupRestoreDialog() {
  const { t } = useI18n();
  const store = useBackupStore();
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      store.closeDialog();
    }
  }, [store]);

  useEffect(() => {
    if (!store.isDialogOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.isDialogOpen, handleKeyDown]);

  // Focus trap
  useEffect(() => {
    if (!store.isDialogOpen) return;
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, [store.isDialogOpen]);

  const activeTabIndex = BACKUP_TABS.findIndex(t => t.id === store.activeTab);
  const { tablistRef, onKeyDown: onTabKeyDown } = useTabKeyboardNav({
    tabCount: BACKUP_TABS.length,
    activeIndex: activeTabIndex,
    onActivate: (index) => store.setActiveTab(BACKUP_TABS[index].id),
  });

  if (!store.isDialogOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-restore-title"
        className="rounded-lg shadow-xl flex flex-col"
        style={{
          width: 520,
          maxHeight: '80vh',
          backgroundColor: 'var(--theme-bg-primary)',
          border: '1px solid var(--theme-border-primary)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
        >
          <h2 id="backup-restore-title" className="text-lg font-semibold" style={{ color: 'var(--theme-text-heading)' }}>
            {t('backupRestoreDialog.backupRestore')}
          </h2>
          <button
            onClick={store.closeDialog}
            className="p-1"
            style={{ color: 'var(--theme-text-secondary)' }}
            aria-label={t('backupRestoreDialog.close')}
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex"
          style={{ borderBottom: '1px solid var(--theme-border-primary)' }}
          role="tablist"
          aria-label={t('backupRestoreDialog.backupOrRestore')}
          ref={tablistRef}
          onKeyDown={onTabKeyDown}
        >
          {BACKUP_TABS.map((tab) => {
            const isActive = store.activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`backup-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`backup-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => store.setActiveTab(tab.id)}
                className="flex-1 py-2 px-4 text-sm font-medium transition-colors"
                style={{
                  borderBottom: isActive
                    ? '2px solid var(--theme-accent-primary)'
                    : '2px solid transparent',
                  color: isActive
                    ? 'var(--theme-accent-primary)'
                    : 'var(--theme-text-secondary)',
                }}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div
          className="p-4 overflow-y-auto flex-1"
          role="tabpanel"
          id={`backup-panel-${store.activeTab}`}
          aria-labelledby={`backup-tab-${store.activeTab}`}
        >
          {store.activeTab === 'backup' ? <BackupTab /> : <RestoreTab />}
        </div>
      </div>
    </div>
  );
}

function BackupTab() {
  const store = useBackupStore();
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('backupRestoreDialog.backupIntro')}
      </p>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.passwordLabel')}</label>
        <input
          type="password"
          value={store.backupPassword}
          onChange={(e) => store.setBackupPassword(e.target.value)}
          placeholder={t('backupRestoreDialog.enterPasswordPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--theme-input-bg)',
            border: '1px solid var(--theme-input-border)',
            color: 'var(--theme-text-primary)',
          }}
          disabled={store.isBackingUp}
        />
      </div>

      {/* Confirm Password */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.confirmPasswordLabel')}</label>
        <input
          type="password"
          value={store.backupConfirmPassword}
          onChange={(e) => store.setBackupConfirmPassword(e.target.value)}
          placeholder={t('backupRestoreDialog.confirmPasswordPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--theme-input-bg)',
            border: '1px solid var(--theme-input-border)',
            color: 'var(--theme-text-primary)',
          }}
          disabled={store.isBackingUp}
        />
      </div>

      {/* Include History */}
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--theme-text-primary)' }}>
        <input
          type="checkbox"
          checked={store.includeHistory}
          onChange={(e) => store.setIncludeHistory(e.target.checked)}
          className="rounded"
          disabled={store.isBackingUp}
        />
        Include search and navigation history
      </label>

      {/* Create Button */}
      <button
        onClick={store.startBackup}
        disabled={store.isBackingUp || !store.backupPassword}
        className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        style={{
          backgroundColor: 'var(--theme-accent-primary)',
          color: 'var(--theme-accent-text)',
        }}
      >
        {store.isBackingUp ? 'Creating Backup...' : 'Create Backup'}
      </button>

      {/* Result */}
      {store.backupResult && (
        <div
          className="p-3 rounded text-sm"
          style={{
            backgroundColor: store.backupResult.success ? 'var(--theme-success-soft)' : 'var(--theme-danger-soft)',
            color: store.backupResult.success ? 'var(--theme-success-text)' : 'var(--theme-danger-text)',
          }}
        >
          {store.backupResult.success
            ? `Backup created successfully!`
            : `Error: ${store.backupResult.error}`
          }
        </div>
      )}
    </div>
  );
}

function RestoreTab() {
  const store = useBackupStore();
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('backupRestoreDialog.restoreYourDataFromAPreviously')}
      </p>

      {/* File Selection */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.backupFileLabel')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={store.restoreFilePath}
            readOnly
            placeholder={t('backupRestoreDialog.noFileSelectedPlaceholder')}
            className="flex-1 px-3 py-2 text-sm rounded"
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              border: '1px solid var(--theme-input-border)',
              color: 'var(--theme-text-primary)',
            }}
          />
          <button
            onClick={store.selectRestoreFile}
            disabled={store.isRestoring}
            className="px-3 py-2 text-sm rounded"
            style={{
              border: '1px solid var(--theme-border-primary)',
              color: 'var(--theme-text-primary)',
            }}
          >
            {t('backupRestoreDialog.browse')}
          </button>
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.passwordLabel')}</label>
        <input
          type="password"
          value={store.restorePassword}
          onChange={(e) => store.setRestorePassword(e.target.value)}
          placeholder={t('backupRestoreDialog.enterPasswordPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--theme-input-bg)',
            border: '1px solid var(--theme-input-border)',
            color: 'var(--theme-text-primary)',
          }}
          disabled={store.isRestoring}
        />
      </div>

      {/* Validate Button */}
      {!store.backupMetadata && (
        <button
          onClick={store.validateBackup}
          disabled={store.isValidating || !store.restoreFilePath || !store.restorePassword}
          className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          style={{
            border: '1px solid var(--theme-accent-primary)',
            color: 'var(--theme-accent-primary)',
          }}
        >
          {store.isValidating ? 'Validating...' : 'Validate Backup'}
        </button>
      )}

      {/* Validation Error */}
      {store.validationError && (
        <div className="p-3 rounded text-sm" style={{ backgroundColor: 'var(--theme-danger-soft)', color: 'var(--theme-danger-text)' }}>
          {store.validationError}
        </div>
      )}

      {/* Backup Info */}
      {store.backupMetadata && (
        <>
          <div
            className="p-3 rounded text-sm"
            style={{
              backgroundColor: 'var(--theme-bg-secondary)',
              border: '1px solid var(--theme-border-primary)',
            }}
          >
            <h4 className="font-medium mb-2" style={{ color: 'var(--theme-text-heading)' }}>{t('backupRestoreDialog.backupDetailsHeading')}</h4>
            <div className="space-y-1" style={{ color: 'var(--theme-text-secondary)' }}>
              <p>{t('backupRestoreDialog.created', { v1: new Date(store.backupMetadata.createdAt).toLocaleString() })}</p>
              <p>{t('backupRestoreDialog.tables', { v1: Object.keys(store.backupMetadata.tables).length })}</p>
              <p>
                {t('backupRestoreDialog.recordsLabel')}{' '}
                {Object.values(store.backupMetadata.tables).reduce((a, b) => a + b, 0)}
              </p>
              {Object.entries(store.backupMetadata.tables).map(([table, count]) => (
                <p key={table} className="ps-4 text-xs">
                  {table}: {count} rows
                </p>
              ))}
              {store.backupMetadata.noteFiles !== undefined && (
                <p>{t('backupRestoreDialog.noteFiles', { v1: store.backupMetadata.noteFiles })}</p>
              )}
            </div>
          </div>

          {/* Restore Mode */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.restoreModeLabel')}</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={store.restoreMode === 'merge'}
                  onChange={() => store.setRestoreMode('merge')}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.mergeOption')}</p>
                  <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                    {t('backupRestoreDialog.keepsExistingDataOverwritesDuplicatesFrom')}
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="restoreMode"
                  checked={store.restoreMode === 'replace'}
                  onChange={() => store.setRestoreMode('replace')}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.replaceOption')}</p>
                  <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                    {t('backupRestoreDialog.deletesAllExistingDataThenImports')}
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Warning for Replace mode */}
          {store.restoreMode === 'replace' && (
            <div className="p-3 rounded text-sm" style={{ backgroundColor: 'var(--theme-warning-soft)', color: 'var(--theme-warning-text)' }}>
              {t('backupRestoreDialog.replaceWarning')}
            </div>
          )}

          {/* Restore Button */}
          <button
            onClick={store.startRestore}
            disabled={store.isRestoring}
            className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            style={{
              backgroundColor: 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
            }}
          >
            {store.isRestoring ? 'Restoring...' : 'Restore Backup'}
          </button>
        </>
      )}

      {/* Restore Result */}
      {store.restoreResult && (
        <div
          className="p-3 rounded text-sm"
          style={{
            backgroundColor: store.restoreResult.success ? 'var(--theme-success-soft)' : 'var(--theme-danger-soft)',
            color: store.restoreResult.success ? 'var(--theme-success-text)' : 'var(--theme-danger-text)',
          }}
        >
          {store.restoreResult.success
            ? `Restore complete! ${store.restoreResult.tablesRestored?.length || 0} tables restored`
              + (store.restoreResult.noteFilesRestored
                  ? `, ${store.restoreResult.noteFilesRestored} note file(s) restored`
                  : '')
              + `. Please restart the app to see changes.`
            : `Error: ${store.restoreResult.error}`
          }
        </div>
      )}
    </div>
  );
}
