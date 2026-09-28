import { useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useBackupStore, MIN_BACKUP_PASSWORD_LENGTH } from '../stores/useBackupStore';
import type { BackupFailure } from '../stores/useBackupStore';
import { useI18n } from '../contexts/useI18n';
import { activateFocusTrap } from '../utils/focusTrap';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';
import type { BackupApplyResult, BackupInspection } from '../../../electron/ipc/backupTypes';

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
          width: 560,
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

const inputStyle = {
  backgroundColor: 'var(--theme-input-bg)',
  border: '1px solid var(--theme-input-border)',
  color: 'var(--theme-text-primary)',
} as const;

const primaryButtonStyle = {
  backgroundColor: 'var(--theme-accent-primary)',
  color: 'var(--theme-accent-text)',
} as const;

const secondaryButtonStyle = {
  border: '1px solid var(--theme-accent-primary)',
  color: 'var(--theme-accent-primary)',
} as const;

/** How hard a password would be to guess offline, judged by length and variety only. */
export function passwordStrength(password: string): 'empty' | 'short' | 'fair' | 'good' {
  if (password.length === 0) return 'empty';
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) return 'short';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  return password.length >= 16 || (password.length >= 12 && kinds >= 3) ? 'good' : 'fair';
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** A specific message for each way a backup can fail, falling back to the raw message. */
function failureText(t: Translate, failure: BackupFailure): string {
  const known = [
    'passwordRequired', 'passwordMismatch', 'passwordTooShort', 'backup_password_required', 'backup_wrong_password',
    'backup_newer_format', 'backup_damaged', 'backup_not_a_backup', 'backup_restore_failed', 'backup_inspection_expired',
  ];
  return known.includes(failure.code) ? t(`backupRestoreDialog.error.${failure.code}`) : failure.message;
}

function Notice({ tone, children, role }: { tone: 'success' | 'danger' | 'warning' | 'info'; children: ReactNode; role?: string }) {
  const colors = {
    success: ['var(--theme-success-soft)', 'var(--theme-success-text)'],
    danger: ['var(--theme-danger-soft)', 'var(--theme-danger-text)'],
    warning: ['var(--theme-warning-soft)', 'var(--theme-warning-text)'],
    info: ['var(--theme-bg-secondary)', 'var(--theme-text-secondary)'],
  }[tone];
  return (
    <div role={role} className="p-3 rounded text-sm" style={{ backgroundColor: colors[0], color: colors[1] }}>
      {children}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BackupTab() {
  const store = useBackupStore();
  const { t } = useI18n();
  const strength = passwordStrength(store.backupPassword);
  const busy = store.isBackingUp || store.isExporting;

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('backupRestoreDialog.backupIntro')}
      </p>

      <div>
        <label htmlFor="backup-password" className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.passwordLabel')}</label>
        <input
          id="backup-password"
          type="password"
          value={store.backupPassword}
          onChange={(e) => store.setBackupPassword(e.target.value)}
          placeholder={t('backupRestoreDialog.enterPasswordPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
          style={inputStyle}
          disabled={busy}
          autoComplete="new-password"
        />
        {strength !== 'empty' && (
          <p className="text-xs mt-1" role="status" style={{ color: strength === 'short' ? 'var(--theme-danger-text)' : 'var(--theme-text-secondary)' }}>
            {t(`backupRestoreDialog.strength.${strength}`, { min: MIN_BACKUP_PASSWORD_LENGTH })}
          </p>
        )}
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>{t('backupRestoreDialog.passwordAdvice')}</p>
      </div>

      <div>
        <label htmlFor="backup-password-confirm" className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.confirmPasswordLabel')}</label>
        <input
          id="backup-password-confirm"
          type="password"
          value={store.backupConfirmPassword}
          onChange={(e) => store.setBackupConfirmPassword(e.target.value)}
          placeholder={t('backupRestoreDialog.confirmPasswordPlaceholder')}
          className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
          style={inputStyle}
          disabled={busy}
          autoComplete="new-password"
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--theme-text-primary)' }}>
        <input
          type="checkbox"
          checked={store.includeHistory}
          onChange={(e) => store.setIncludeHistory(e.target.checked)}
          className="rounded"
          disabled={busy}
        />
        {t('backupRestoreDialog.includeHistory')}
      </label>

      <button
        onClick={store.startBackup}
        disabled={busy || !store.backupPassword}
        className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
        style={primaryButtonStyle}
      >
        {store.isBackingUp ? t('backupRestoreDialog.creatingBackup') : t('backupRestoreDialog.createBackup')}
      </button>

      {store.backupResult && (
        'summary' in store.backupResult ? (
          <Notice tone="success" role="status">
            {t('backupRestoreDialog.backupCreated', { path: store.backupResult.summary.path, size: formatSize(store.backupResult.summary.sizeBytes) })}
            {store.backupResult.summary.warnings.length > 0 && (
              <span className="block mt-1">{t('backupRestoreDialog.backupSkipped', { count: store.backupResult.summary.warnings.length })}</span>
            )}
          </Notice>
        ) : (
          <Notice tone="danger" role="alert">{t('backupRestoreDialog.errorPrefix', { message: failureText(t, store.backupResult.failure) })}</Notice>
        )
      )}

      <details className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
        <summary className="cursor-pointer font-medium" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.exportHeading')}</summary>
        <div className="mt-2 space-y-2">
          <Notice tone="warning">{t('backupRestoreDialog.exportWarning')}</Notice>
          <button
            onClick={store.startExport}
            disabled={busy}
            className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            style={secondaryButtonStyle}
          >
            {store.isExporting ? t('backupRestoreDialog.exporting') : t('backupRestoreDialog.exportButton')}
          </button>
          {store.exportResult && (
            'summary' in store.exportResult ? (
              <Notice tone="success" role="status">
                {t('backupRestoreDialog.exportCreated', { path: store.exportResult.summary.path })}
                {store.exportResult.summary.warnings.length > 0 && (
                  <span className="block mt-1">{t('backupRestoreDialog.backupSkipped', { count: store.exportResult.summary.warnings.length })}</span>
                )}
              </Notice>
            ) : (
              <Notice tone="danger" role="alert">{t('backupRestoreDialog.errorPrefix', { message: failureText(t, store.exportResult.failure) })}</Notice>
            )
          )}
        </div>
      </details>
    </div>
  );
}

interface SectionGroup {
  id: 'content' | 'extension' | 'workspace' | 'history';
  ids: string[];
  count: number;
}

/** Group the backup's sections the way the user thinks of them. Only sections this database can take are offered. */
export function groupSections(inspection: BackupInspection): SectionGroup[] {
  const groups = new Map<string, SectionGroup>();
  for (const s of inspection.sections) {
    if (s.kind === 'info' || !s.targetExists) continue;
    if (!['content', 'extension', 'workspace', 'history'].includes(s.class)) continue;
    let g = groups.get(s.class);
    if (!g) groups.set(s.class, (g = { id: s.class as SectionGroup['id'], ids: [], count: 0 }));
    g.ids.push(s.id);
    g.count += s.count;
  }
  return ['content', 'extension', 'workspace', 'history'].flatMap((id) => groups.get(id) ?? []);
}

function RestoreTab() {
  const store = useBackupStore();
  const { t, localizer } = useI18n();
  const insp = store.inspection;
  const groups = insp ? groupSections(insp) : [];
  const selected = new Set(store.selectedSections);
  const preview = insp?.preview?.[store.restoreMode];
  const isDefaultSelection = insp
    ? insp.defaults[store.restoreMode].length === store.selectedSections.length && insp.defaults[store.restoreMode].every((id) => selected.has(id))
    : false;
  const totals = preview && isDefaultSelection
    ? preview.perTable.reduce((a, r) => ({ inserted: a.inserted + r.inserted, matched: a.matched + r.matched, cleared: a.cleared + r.cleared }), { inserted: 0, matched: 0, cleared: 0 })
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('backupRestoreDialog.restoreYourDataFromAPreviously')}
      </p>

      <div>
        <label htmlFor="restore-file" className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.backupFileLabel')}</label>
        <div className="flex gap-2">
          <input
            id="restore-file"
            type="text"
            value={store.restoreFilePath}
            readOnly
            placeholder={t('backupRestoreDialog.noFileSelectedPlaceholder')}
            className="flex-1 px-3 py-2 text-sm rounded"
            style={inputStyle}
          />
          <button
            onClick={store.selectRestoreFile}
            disabled={store.isRestoring || store.isInspecting}
            className="px-3 py-2 text-sm rounded"
            style={{ border: '1px solid var(--theme-border-primary)', color: 'var(--theme-text-primary)' }}
          >
            {t('backupRestoreDialog.browse')}
          </button>
        </div>
      </div>

      {store.isInspecting && <p className="text-sm" role="status" style={{ color: 'var(--theme-text-secondary)' }}>{t('backupRestoreDialog.opening')}</p>}

      {store.needsPassword && (
        <div>
          <label htmlFor="restore-password" className="block text-sm font-medium mb-1" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.passwordLabel')}</label>
          <div className="flex gap-2">
            <input
              id="restore-password"
              type="password"
              value={store.restorePassword}
              onChange={(e) => store.setRestorePassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void store.unlockBackup(); }}
              placeholder={t('backupRestoreDialog.enterPasswordPlaceholder')}
              className="flex-1 px-3 py-2 text-sm rounded focus:outline-none focus:ring-1"
              style={inputStyle}
              disabled={store.isInspecting}
              autoComplete="current-password"
            />
            <button
              onClick={store.unlockBackup}
              disabled={store.isInspecting || !store.restorePassword}
              className="px-3 py-2 text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              style={secondaryButtonStyle}
            >
              {t('backupRestoreDialog.unlock')}
            </button>
          </div>
        </div>
      )}

      {store.inspectFailure && <Notice tone="danger" role="alert">{failureText(t, store.inspectFailure)}</Notice>}

      {insp && (
        <>
          <div className="p-3 rounded text-sm" style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-primary)' }}>
            <h4 className="font-medium mb-2" style={{ color: 'var(--theme-text-heading)' }}>{t('backupRestoreDialog.backupDetailsHeading')}</h4>
            <div className="space-y-1" style={{ color: 'var(--theme-text-secondary)' }}>
              <p>{t('backupRestoreDialog.created', { v1: localizer.formatDate(new Date(insp.source.createdAt), { dateStyle: 'medium', timeStyle: 'medium' }) })}</p>
              <p>{t('backupRestoreDialog.madeBy', { app: insp.source.app.name, version: insp.source.app.version })}</p>
              <p>{insp.encrypted ? t('backupRestoreDialog.kindEncrypted') : t('backupRestoreDialog.kindPlain')}</p>
              <p>{t('backupRestoreDialog.noteFiles', { v1: insp.noteFiles })}</p>
            </div>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium mb-2" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.restoreModeLabel')}</legend>
            <div className="space-y-2">
              {(['merge', 'replace'] as const).map((mode) => (
                <label key={mode} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="restoreMode" checked={store.restoreMode === mode} onChange={() => store.setRestoreMode(mode)} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>{t(`backupRestoreDialog.${mode}Option`)}</p>
                    <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>{t(`backupRestoreDialog.${mode}Explain`)}</p>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="block text-sm font-medium mb-2" style={{ color: 'var(--theme-text-primary)' }}>{t('backupRestoreDialog.whatToRestore')}</legend>
            <div className="space-y-1">
              {groups.map((g) => (
                <label key={g.id} className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--theme-text-primary)' }}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={g.ids.every((id) => selected.has(id))}
                    onChange={(e) => store.setSectionSelected(g.ids, e.target.checked)}
                  />
                  <span>
                    {t(`backupRestoreDialog.group.${g.id}`)}
                    <span className="block text-xs" style={{ color: 'var(--theme-text-secondary)' }}>{t(`backupRestoreDialog.groupHint.${g.id}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {totals && (
            <Notice tone="info" role="status">
              {store.restoreMode === 'merge'
                ? t('backupRestoreDialog.previewMerge', { added: totals.inserted, present: totals.matched })
                : t('backupRestoreDialog.previewReplace', { removed: totals.cleared, restored: totals.inserted })}
            </Notice>
          )}

          {insp.warnings.map((w, i) => (
            <Notice key={`${w.code}-${i}`} tone="warning">{t(`backupRestoreDialog.warning.${w.code}`, w.params)}</Notice>
          ))}
          {insp.unknownSections.length > 0 && <Notice tone="info">{t('backupRestoreDialog.unknownSections', { count: insp.unknownSections.length })}</Notice>}

          {store.restoreMode === 'replace' && <Notice tone="warning">{t('backupRestoreDialog.replaceWarning')}</Notice>}

          <button
            onClick={store.startRestore}
            disabled={store.isRestoring || store.selectedSections.length === 0}
            className="w-full py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            style={primaryButtonStyle}
          >
            {store.isRestoring ? t('backupRestoreDialog.restoring') : t('backupRestoreDialog.restoreButton')}
          </button>
        </>
      )}

      {store.restoreResult && (
        'result' in store.restoreResult ? <RestoreOutcome result={store.restoreResult.result} /> : (
          <Notice tone="danger" role="alert">{t('backupRestoreDialog.errorPrefix', { message: failureText(t, store.restoreResult.failure) })}</Notice>
        )
      )}
    </div>
  );
}

function RestoreOutcome({ result }: { result: BackupApplyResult }) {
  const { t } = useI18n();
  const { report } = result;
  const inserted = report.perTable.reduce((n, r) => n + r.inserted, 0);
  const matched = report.perTable.reduce((n, r) => n + r.matched, 0);
  return (
    <div className="space-y-2">
      <Notice tone={report.ok ? 'success' : 'warning'} role="status">
        <p>{t('backupRestoreDialog.restoreComplete', { restored: inserted, present: matched })}</p>
        {(report.notes.written > 0 || report.notes.conflictCopies.length > 0) && (
          <p>{t('backupRestoreDialog.restoreNotes', { written: report.notes.written, copies: report.notes.conflictCopies.length })}</p>
        )}
        {report.notes.movedAsideTo && <p>{t('backupRestoreDialog.restoreMovedAside', { path: report.notes.movedAsideTo })}</p>}
        {result.snapshotDir && <p>{t('backupRestoreDialog.restoreSnapshot', { path: result.snapshotDir })}</p>}
        <p>{t('backupRestoreDialog.restartToSee')}</p>
      </Notice>
      {report.fileErrors.length > 0 && (
        <Notice tone="danger" role="alert">{t('backupRestoreDialog.restoreFileErrors', { count: report.fileErrors.length })}</Notice>
      )}
    </div>
  );
}
