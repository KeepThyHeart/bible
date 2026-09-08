import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BackupRestoreDialog } from './BackupRestoreDialog';
import { useBackupStore } from '../stores/useBackupStore';
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

describe('BackupRestoreDialog', () => {
  const closeDialog = vi.fn();
  const setActiveTab = vi.fn();
  const setBackupPassword = vi.fn();
  const setBackupConfirmPassword = vi.fn();
  const setIncludeHistory = vi.fn();
  const startBackup = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useBackupStore.setState({
      isDialogOpen: true,
      activeTab: 'backup',
      backupPassword: '',
      backupConfirmPassword: '',
      includeHistory: false,
      isBackingUp: false,
      backupResult: null,
      restoreFilePath: '',
      restorePassword: '',
      restoreMode: 'merge',
      isValidating: false,
      isRestoring: false,
      backupMetadata: null,
      validationError: null,
      restoreResult: null,
      closeDialog,
      setActiveTab,
      setBackupPassword,
      setBackupConfirmPassword,
      setIncludeHistory,
      startBackup,
      selectRestoreFile: vi.fn(),
      setRestorePassword: vi.fn(),
      setRestoreMode: vi.fn(),
      validateBackup: vi.fn().mockResolvedValue(undefined),
      startRestore: vi.fn().mockResolvedValue(undefined),
      resetState: vi.fn(),
      openDialog: vi.fn(),
    });
  });

  it('renders nothing when dialog is closed', () => {
    useBackupStore.setState({ isDialogOpen: false });
    renderWithProviders(<BackupRestoreDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when open', () => {
    renderWithProviders(<BackupRestoreDialog />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows title Backup & Restore', () => {
    renderWithProviders(<BackupRestoreDialog />);
    expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
  });

  it('shows Create Backup and Restore Backup tabs', () => {
    renderWithProviders(<BackupRestoreDialog />);
    // Both tabs appear
    const tabList = screen.getByRole('tablist');
    expect(tabList).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
  });

  it('shows Create Backup tab as active by default', () => {
    renderWithProviders(<BackupRestoreDialog />);
    const createTab = screen.getByRole('tab', { name: 'Create Backup' });
    expect(createTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Restore tab when clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BackupRestoreDialog />);
    await user.click(screen.getByRole('tab', { name: 'Restore Backup' }));
    expect(setActiveTab).toHaveBeenCalledWith('restore');
  });

  it('shows password input in backup tab', () => {
    renderWithProviders(<BackupRestoreDialog />);
    const passwordInput = screen.getByPlaceholderText(enString('backupRestoreDialog.enterPasswordPlaceholder'));
    expect(passwordInput).toBeInTheDocument();
  });

  it('closes when X button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BackupRestoreDialog />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeDialog).toHaveBeenCalled();
  });

  it('closes when Escape key is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BackupRestoreDialog />);
    await user.keyboard('{Escape}');
    expect(closeDialog).toHaveBeenCalled();
  });

  it('disables Create Backup button when password is empty', () => {
    renderWithProviders(<BackupRestoreDialog />);
    const createButton = screen.getByRole('button', { name: /create backup/i });
    expect(createButton).toBeDisabled();
  });
});
