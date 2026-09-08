import { create } from 'zustand';
import { unwrap, IpcResultError } from '../services/ipcResult';

interface BackupMetadata {
  version: string;
  appVersion: string;
  createdAt: string;
  username: string;
  tables: Record<string, number>;
  includeHistory: boolean;
  /** Number of `.bn` note files bundled in the archive (undefined on old backups). */
  noteFiles?: number;
}

interface BackupStore {
  // Dialog state
  isDialogOpen: boolean;
  activeTab: 'backup' | 'restore';

  // Backup state
  backupPassword: string;
  backupConfirmPassword: string;
  includeHistory: boolean;
  isBackingUp: boolean;
  backupResult: { success: boolean; path?: string; error?: string } | null;

  // Restore state
  restoreFilePath: string;
  restorePassword: string;
  restoreMode: 'merge' | 'replace';
  isValidating: boolean;
  isRestoring: boolean;
  backupMetadata: BackupMetadata | null;
  validationError: string | null;
  restoreResult: { success: boolean; tablesRestored?: string[]; rowCounts?: Record<string, number>; noteFilesRestored?: number; error?: string } | null;

  // Actions
  openDialog: (tab?: 'backup' | 'restore') => void;
  closeDialog: () => void;
  setActiveTab: (tab: 'backup' | 'restore') => void;

  // Backup actions
  setBackupPassword: (password: string) => void;
  setBackupConfirmPassword: (password: string) => void;
  setIncludeHistory: (include: boolean) => void;
  startBackup: () => Promise<void>;

  // Restore actions
  selectRestoreFile: () => Promise<void>;
  setRestorePassword: (password: string) => void;
  setRestoreMode: (mode: 'merge' | 'replace') => void;
  validateBackup: () => Promise<void>;
  startRestore: () => Promise<void>;

  // Reset
  resetState: () => void;
}

const initialState = {
  isDialogOpen: false,
  activeTab: 'backup' as const,
  backupPassword: '',
  backupConfirmPassword: '',
  includeHistory: false,
  isBackingUp: false,
  backupResult: null,
  restoreFilePath: '',
  restorePassword: '',
  restoreMode: 'merge' as const,
  isValidating: false,
  isRestoring: false,
  backupMetadata: null,
  validationError: null,
  restoreResult: null,
};

export const useBackupStore = create<BackupStore>((set, get) => ({
  ...initialState,

  openDialog: (tab = 'backup') => set({ isDialogOpen: true, activeTab: tab }),
  closeDialog: () => set({ ...initialState }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Backup
  setBackupPassword: (password) => set({ backupPassword: password }),
  setBackupConfirmPassword: (password) => set({ backupConfirmPassword: password }),
  setIncludeHistory: (include) => set({ includeHistory: include }),

  startBackup: async () => {
    const { backupPassword, backupConfirmPassword, includeHistory } = get();

    if (!backupPassword) {
      set({ backupResult: { success: false, error: 'Password is required' } });
      return;
    }
    if (backupPassword !== backupConfirmPassword) {
      set({ backupResult: { success: false, error: 'Passwords do not match' } });
      return;
    }
    if (backupPassword.length < 4) {
      set({ backupResult: { success: false, error: 'Password must be at least 4 characters' } });
      return;
    }

    set({ isBackingUp: true, backupResult: null });

    try {
      const result = await unwrap(
        window.electron.backup.create({
          password: backupPassword,
          includeHistory,
        })
      );
      // `null` means the user cancelled the native save dialog - keep the
      // dialog open and clear the "in progress" flag without a result.
      if (result === null) {
        set({ isBackingUp: false });
      } else {
        set({
          backupResult: { success: true, path: result.path },
          isBackingUp: false,
        });
      }
    } catch (error) {
      const message = error instanceof IpcResultError || error instanceof Error
        ? error.message
        : String(error);
      set({
        backupResult: { success: false, error: message },
        isBackingUp: false,
      });
    }
  },

  // Restore
  selectRestoreFile: async () => {
    try {
      const result = await unwrap(window.electron.backup.selectFile());
      if (result && result.path) {
        set({
          restoreFilePath: result.path,
          backupMetadata: null,
          validationError: null,
          restoreResult: null,
        });
      }
    } catch (error) {
      console.error('Failed to select file:', error);
    }
  },

  setRestorePassword: (password) => set({
    restorePassword: password,
    backupMetadata: null,
    validationError: null,
  }),
  setRestoreMode: (mode) => set({ restoreMode: mode }),

  validateBackup: async () => {
    const { restoreFilePath, restorePassword } = get();

    if (!restoreFilePath || !restorePassword) {
      set({ validationError: 'Please select a file and enter the password' });
      return;
    }

    set({ isValidating: true, validationError: null, backupMetadata: null });

    try {
      const result = await unwrap(
        window.electron.backup.validate(restoreFilePath, restorePassword)
      );
      if (result.valid && result.metadata) {
        set({ backupMetadata: result.metadata, isValidating: false });
      } else {
        set({ validationError: result.error || 'Invalid backup', isValidating: false });
      }
    } catch (error) {
      set({
        validationError: (error as Error).message,
        isValidating: false,
      });
    }
  },

  startRestore: async () => {
    const { restoreFilePath, restorePassword, restoreMode } = get();

    if (!restoreFilePath || !restorePassword) {
      set({ restoreResult: { success: false, error: 'File and password are required' } });
      return;
    }

    set({ isRestoring: true, restoreResult: null });

    try {
      const result = await unwrap(
        window.electron.backup.restore({
          backupPath: restoreFilePath,
          password: restorePassword,
          mode: restoreMode,
        })
      );
      set({ restoreResult: result, isRestoring: false });
    } catch (error) {
      set({
        restoreResult: { success: false, error: (error as Error).message },
        isRestoring: false,
      });
    }
  },

  resetState: () => set(initialState),
}));
