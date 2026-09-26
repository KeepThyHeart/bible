import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BackupRestoreDialog, passwordStrength, groupSections } from './BackupRestoreDialog';
import { useBackupStore } from '../stores/useBackupStore';
import type { BackupInspection } from '../../../electron/ipc/backupTypes';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enString, enT } from '../testing/enCatalog';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const baseState = {
  isDialogOpen: true,
  activeTab: 'backup' as const,
  backupPassword: '',
  backupConfirmPassword: '',
  includeHistory: false,
  isBackingUp: false,
  backupResult: null,
  isExporting: false,
  exportResult: null,
  restoreFilePath: '',
  restorePassword: '',
  needsPassword: false,
  isInspecting: false,
  inspection: null,
  inspectFailure: null,
  restoreMode: 'merge' as const,
  selectedSections: [] as string[],
  isRestoring: false,
  restoreResult: null,
};

function inspection(overrides: Partial<BackupInspection> = {}): BackupInspection {
  const section = (id: string, cls: string, count: number, extra = {}) => ({
    id, kind: 'table', class: cls, count, targetExists: true, defaultOn: { replace: true, merge: cls === 'content' }, droppedColumns: [], missingColumns: [], ...extra,
  });
  return {
    token: 't1', fileName: 'x.bbk', encrypted: true,
    source: { app: { name: 'Keep Thy Heart', version: '0.1.0', platform: 'test' }, createdAt: '2026-09-26T14:03:11Z', userSchemaVersion: 1 },
    sections: [
      section('user.user_note', 'content', 12), section('user.verse_link', 'content', 30), section('notes', 'content', 5, { kind: 'files' }),
      section('user.session', 'workspace', 2), section('user.user_search_history', 'history', 9),
      section('modules', 'excluded', 3, { kind: 'info' }), section('user.journal_entry', 'content', 1, { targetExists: false }),
    ],
    unknownSections: [], extensions: [], noteFiles: 5, historyNoteFiles: 0, warnings: [],
    defaults: { replace: ['user.user_note', 'user.verse_link', 'notes', 'user.session', 'user.user_search_history'], merge: ['user.user_note', 'user.verse_link', 'notes'] },
    ...overrides,
  } as unknown as BackupInspection;
}

describe('password strength hint', () => {
  it('judges by length and variety', () => {
    expect(passwordStrength('')).toBe('empty');
    expect(passwordStrength('short')).toBe('short');
    expect(passwordStrength('abcdefghij')).toBe('fair');
    expect(passwordStrength('Correct-horse-9')).toBe('good');
    expect(passwordStrength('a'.repeat(16))).toBe('good');
  });
});

describe('groupSections', () => {
  it('groups by class, skips info and sections this database cannot take', () => {
    const groups = groupSections(inspection());
    expect(groups.map((g) => g.id)).toEqual(['content', 'workspace', 'history']);
    expect(groups[0].ids).toEqual(['user.user_note', 'user.verse_link', 'notes']);
    expect(groups[0].count).toBe(47);
  });
});

describe('BackupRestoreDialog', () => {
  const closeDialog = vi.fn();
  const setActiveTab = vi.fn();
  const actions = () => ({
    closeDialog, setActiveTab,
    setBackupPassword: vi.fn(), setBackupConfirmPassword: vi.fn(), setIncludeHistory: vi.fn(),
    startBackup: vi.fn().mockResolvedValue(undefined), startExport: vi.fn().mockResolvedValue(undefined),
    selectRestoreFile: vi.fn(), setRestorePassword: vi.fn(), unlockBackup: vi.fn().mockResolvedValue(undefined),
    setRestoreMode: vi.fn(), setSectionSelected: vi.fn(), startRestore: vi.fn().mockResolvedValue(undefined),
    resetState: vi.fn(), openDialog: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useBackupStore.setState({ ...baseState, ...actions() });
  });

  it('renders nothing when dialog is closed', () => {
    useBackupStore.setState({ isDialogOpen: false });
    renderWithProviders(<BackupRestoreDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog with the title and two tabs, Create Backup active', () => {
    renderWithProviders(<BackupRestoreDialog />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Create Backup' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the Restore tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BackupRestoreDialog />);
    await user.click(screen.getByRole('tab', { name: 'Restore Backup' }));
    expect(setActiveTab).toHaveBeenCalledWith('restore');
  });

  it('closes with the X button and with Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BackupRestoreDialog />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(closeDialog).toHaveBeenCalledTimes(2);
  });

  describe('backup tab', () => {
    it('shows password fields and disables Create Backup until a password is entered', () => {
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByPlaceholderText(enString('backupRestoreDialog.enterPasswordPlaceholder'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create backup/i })).toBeDisabled();
    });

    it('shows a strength hint that says the password is too short', () => {
      useBackupStore.setState({ backupPassword: 'abc' });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('status')).toHaveTextContent('Too short: use at least 10 characters.');
    });

    it('starts a backup', async () => {
      const user = userEvent.setup();
      const startBackup = vi.fn().mockResolvedValue(undefined);
      useBackupStore.setState({ backupPassword: 'a long enough pass', startBackup });
      renderWithProviders(<BackupRestoreDialog />);
      await user.click(screen.getByRole('button', { name: 'Create Backup' }));
      expect(startBackup).toHaveBeenCalled();
    });

    it('offers an unencrypted export only behind a warning, and starts it', async () => {
      const user = userEvent.setup();
      const startExport = vi.fn().mockResolvedValue(undefined);
      useBackupStore.setState({ startExport });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByText(/anyone can open and read/i)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Export Unencrypted Copy' }));
      expect(startExport).toHaveBeenCalled();
    });

    it('shows the result of a backup, and a specific message for a failure', () => {
      useBackupStore.setState({ backupResult: { summary: { path: '/tmp/a.bbk', createdAt: 'x', sizeBytes: 2048, sections: 3, warnings: [] } } });
      const { unmount } = renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Backup created: /tmp/a.bbk (2.0 KB).');
      unmount();
      useBackupStore.setState({ backupResult: { failure: { code: 'passwordMismatch', message: 'raw' } } });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.');
    });
  });

  describe('restore tab', () => {
    beforeEach(() => useBackupStore.setState({ activeTab: 'restore' }));

    it('asks for a password only when the chosen file is encrypted, and unlocks', async () => {
      const user = userEvent.setup();
      const unlockBackup = vi.fn().mockResolvedValue(undefined);
      useBackupStore.setState({ restoreFilePath: '/x.bbk', needsPassword: true, restorePassword: 'pw', unlockBackup });
      renderWithProviders(<BackupRestoreDialog />);
      await user.click(screen.getByRole('button', { name: 'Unlock' }));
      expect(unlockBackup).toHaveBeenCalled();
    });

    it('does not show a password field for an unencrypted export', () => {
      useBackupStore.setState({ restoreFilePath: '/x.zip', inspection: inspection({ encrypted: false }), selectedSections: ['user.user_note'] });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.queryByPlaceholderText(enString('backupRestoreDialog.enterPasswordPlaceholder'))).not.toBeInTheDocument();
      expect(screen.getByText('Unencrypted export')).toBeInTheDocument();
    });

    it('shows a specific message for a wrong password and for a damaged file', () => {
      useBackupStore.setState({ needsPassword: true, inspectFailure: { code: 'backup_wrong_password', message: 'x' } });
      const { unmount } = renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('alert')).toHaveTextContent('That password does not open this backup.');
      unmount();
      useBackupStore.setState({ needsPassword: false, inspectFailure: { code: 'backup_damaged', message: 'x' } });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('alert')).toHaveTextContent('damaged or incomplete');
    });

    it('lists what can be restored as checkboxes, hiding what this database cannot take', () => {
      useBackupStore.setState({ inspection: inspection(), selectedSections: ['user.user_note', 'user.verse_link', 'notes'] });
      renderWithProviders(<BackupRestoreDialog />);
      const boxes = screen.getAllByRole('checkbox');
      expect(boxes).toHaveLength(3);
      expect(boxes[0]).toBeChecked();
      expect(boxes[1]).not.toBeChecked();
      expect(boxes[2]).not.toBeChecked();
    });

    it('toggles a whole group', async () => {
      const user = userEvent.setup();
      const setSectionSelected = vi.fn();
      useBackupStore.setState({ inspection: inspection(), selectedSections: ['user.user_note', 'user.verse_link', 'notes'], setSectionSelected });
      renderWithProviders(<BackupRestoreDialog />);
      await user.click(screen.getAllByRole('checkbox')[1]);
      expect(setSectionSelected).toHaveBeenCalledWith(['user.session'], true);
    });

    it('explains both modes, warns on replace, and switches mode', async () => {
      const user = userEvent.setup();
      const setRestoreMode = vi.fn();
      useBackupStore.setState({ inspection: inspection(), selectedSections: ['user.user_note'], restoreMode: 'replace', setRestoreMode });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByText(/Replace mode empties the selected data/)).toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: /Merge/ }));
      expect(setRestoreMode).toHaveBeenCalledWith('merge');
    });

    it('shows the preview of the default selection and the warnings', () => {
      const insp = inspection({
        warnings: [{ code: 'moduleIds', params: { sections: 'a' } }],
        preview: {
          merge: { mode: 'merge', ok: true, perTable: [{ table: 'user_note', cleared: 0, inserted: 4, matched: 8, updated: 0, dropped: {}, nulled: 0 }], droppedColumns: [], skippedSections: [], notes: { written: 0, identical: 0, conflictCopies: [], historyWritten: 0, skippedExisting: 0 }, extDbs: [], fileErrors: [], warnings: [] },
          replace: { mode: 'replace', ok: true, perTable: [], droppedColumns: [], skippedSections: [], notes: { written: 0, identical: 0, conflictCopies: [], historyWritten: 0, skippedExisting: 0 }, extDbs: [], fileErrors: [], warnings: [] },
        },
      });
      useBackupStore.setState({ inspection: insp, selectedSections: insp.defaults.merge });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByText('Adding about 4 item(s); 8 are already here and will not be duplicated.')).toBeInTheDocument();
      expect(screen.getByText(/refer to Bible modules by number/)).toBeInTheDocument();
    });

    it('disables Restore when nothing is selected, and restores otherwise', async () => {
      const user = userEvent.setup();
      const startRestore = vi.fn().mockResolvedValue(undefined);
      useBackupStore.setState({ inspection: inspection(), selectedSections: [], startRestore });
      const { unmount } = renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByRole('button', { name: 'Restore Backup' })).toBeDisabled();
      unmount();
      useBackupStore.setState({ selectedSections: ['user.user_note'] });
      renderWithProviders(<BackupRestoreDialog />);
      await user.click(screen.getByRole('button', { name: 'Restore Backup' }));
      expect(startRestore).toHaveBeenCalled();
    });

    it('reports the outcome, including the safety copy and files that failed', () => {
      useBackupStore.setState({
        restoreResult: {
          result: {
            snapshotDir: '/data/pre-restore/2026',
            report: {
              mode: 'merge', ok: false, warnings: [], droppedColumns: [], skippedSections: [], extDbs: [],
              perTable: [{ table: 'user_note', cleared: 0, inserted: 3, matched: 1, updated: 0, dropped: {}, nulled: 0 }],
              notes: { written: 2, identical: 0, conflictCopies: [{ original: 'a.bn', copy: 'a (restored).bn' }], historyWritten: 0, skippedExisting: 0 },
              fileErrors: [{ path: 'x.bn', message: 'disk full' }],
            },
          },
        },
      });
      renderWithProviders(<BackupRestoreDialog />);
      expect(screen.getByText(/3 item\(s\) restored, 1 already present/)).toBeInTheDocument();
      expect(screen.getByText(/safety copy of your data before the restore is in \/data\/pre-restore\/2026/)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('1 file(s) could not be written');
    });
  });
});
