import { create } from 'zustand';
import { unwrap, IpcResultError } from '../services/ipcResult';
import type { BackupApplyResult, BackupInspection, BackupSummary } from '../../../electron/ipc/backupTypes';

/** Must match `MIN_PASSWORD_LENGTH` in `electron/ipc/backupHandlers.ts`. */
export const MIN_BACKUP_PASSWORD_LENGTH = 10;

/** A failure the dialog can show with a specific message: `code` is a `backup_*` IPC code or a local one. */
export interface BackupFailure {
  code: string;
  message: string;
}

export type RestoreMode = 'merge' | 'replace';

interface BackupStore {
  // Dialog state
  isDialogOpen: boolean;
  activeTab: 'backup' | 'restore';

  // Backup state
  backupPassword: string;
  backupConfirmPassword: string;
  includeHistory: boolean;
  isBackingUp: boolean;
  backupResult: { summary: BackupSummary } | { failure: BackupFailure } | null;
  isExporting: boolean;
  exportResult: { summary: BackupSummary } | { failure: BackupFailure } | null;

  // Restore state
  restoreFilePath: string;
  restorePassword: string;
  /** The chosen file is encrypted and no (correct) password has been given yet. */
  needsPassword: boolean;
  isInspecting: boolean;
  inspection: BackupInspection | null;
  inspectFailure: BackupFailure | null;
  restoreMode: RestoreMode;
  selectedSections: string[];
  isRestoring: boolean;
  restoreResult: { result: BackupApplyResult } | { failure: BackupFailure } | null;

  // Actions
  openDialog: (tab?: 'backup' | 'restore') => void;
  closeDialog: () => void;
  setActiveTab: (tab: 'backup' | 'restore') => void;

  setBackupPassword: (password: string) => void;
  setBackupConfirmPassword: (password: string) => void;
  setIncludeHistory: (include: boolean) => void;
  startBackup: () => Promise<void>;
  startExport: () => Promise<void>;

  selectRestoreFile: () => Promise<void>;
  setRestorePassword: (password: string) => void;
  unlockBackup: () => Promise<void>;
  setRestoreMode: (mode: RestoreMode) => void;
  setSectionSelected: (ids: string[], selected: boolean) => void;
  startRestore: () => Promise<void>;

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
  isExporting: false,
  exportResult: null,
  restoreFilePath: '',
  restorePassword: '',
  needsPassword: false,
  isInspecting: false,
  inspection: null,
  inspectFailure: null,
  restoreMode: 'merge' as RestoreMode,
  selectedSections: [] as string[],
  isRestoring: false,
  restoreResult: null,
};

function failureOf(error: unknown): BackupFailure {
  if (error instanceof IpcResultError) return { code: error.code, message: error.message };
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}

/** Best effort: tell the main process to drop the verified backup it is holding in memory. */
function discard(token: string | undefined): void {
  if (!token) return;
  void Promise.resolve(window.electron.backup.discard(token)).catch(() => undefined);
}

export const useBackupStore = create<BackupStore>((set, get) => ({
  ...initialState,

  openDialog: (tab = 'backup') => set({ isDialogOpen: true, activeTab: tab }),
  closeDialog: () => {
    discard(get().inspection?.token);
    set({ ...initialState });
  },
  setActiveTab: (tab) => set({ activeTab: tab }),

  // --- Backup -----------------------------------------------------------------
  setBackupPassword: (password) => set({ backupPassword: password }),
  setBackupConfirmPassword: (password) => set({ backupConfirmPassword: password }),
  setIncludeHistory: (include) => set({ includeHistory: include }),

  startBackup: async () => {
    const { backupPassword, backupConfirmPassword, includeHistory } = get();
    if (!backupPassword) {
      set({ backupResult: { failure: { code: 'passwordRequired', message: 'Password is required' } } });
      return;
    }
    if (backupPassword !== backupConfirmPassword) {
      set({ backupResult: { failure: { code: 'passwordMismatch', message: 'Passwords do not match' } } });
      return;
    }
    if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
      set({ backupResult: { failure: { code: 'passwordTooShort', message: `Password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters` } } });
      return;
    }

    set({ isBackingUp: true, backupResult: null });
    try {
      const summary = await unwrap(window.electron.backup.create({ password: backupPassword, includeHistory }));
      // `null` means the user cancelled the native save dialog.
      set(summary === null
        ? { isBackingUp: false }
        : { backupResult: { summary }, isBackingUp: false, backupPassword: '', backupConfirmPassword: '' });
    } catch (error) {
      set({ backupResult: { failure: failureOf(error) }, isBackingUp: false });
    }
  },

  startExport: async () => {
    set({ isExporting: true, exportResult: null });
    try {
      const summary = await unwrap(window.electron.backup.exportPlain({ includeHistory: get().includeHistory }));
      set(summary === null ? { isExporting: false } : { exportResult: { summary }, isExporting: false });
    } catch (error) {
      set({ exportResult: { failure: failureOf(error) }, isExporting: false });
    }
  },

  // --- Restore ----------------------------------------------------------------
  selectRestoreFile: async () => {
    try {
      const picked = await unwrap(window.electron.backup.selectFile());
      if (!picked?.path) return;
      discard(get().inspection?.token);
      set({
        restoreFilePath: picked.path, restorePassword: '', needsPassword: false, inspection: null, inspectFailure: null,
        restoreResult: null, selectedSections: [],
      });
      await inspect(set, get, undefined);
    } catch (error) {
      set({ inspectFailure: failureOf(error) });
    }
  },

  setRestorePassword: (password) => set({ restorePassword: password, inspectFailure: null }),

  unlockBackup: async () => {
    const { restorePassword } = get();
    if (!restorePassword) return;
    await inspect(set, get, restorePassword);
  },

  setRestoreMode: (mode) => {
    const inspection = get().inspection;
    set({ restoreMode: mode, selectedSections: inspection ? [...inspection.defaults[mode]] : [] });
  },

  setSectionSelected: (ids, selected) => {
    const current = new Set(get().selectedSections);
    for (const id of ids) {
      if (selected) current.add(id);
      else current.delete(id);
    }
    set({ selectedSections: [...current] });
  },

  startRestore: async () => {
    const { inspection, restoreMode, selectedSections } = get();
    if (!inspection || selectedSections.length === 0) return;
    set({ isRestoring: true, restoreResult: null });
    try {
      const result = await unwrap(window.electron.backup.apply({ token: inspection.token, mode: restoreMode, sections: selectedSections }));
      // The verified backup is gone from the main process after an apply.
      set({ restoreResult: { result }, isRestoring: false, inspection: null, needsPassword: false });
    } catch (error) {
      set({ restoreResult: { failure: failureOf(error) }, isRestoring: false });
    }
  },

  resetState: () => set(initialState),
}));

type SetFn = (partial: Partial<BackupStore>) => void;

/** Open and verify the chosen file. Encrypted files ask for a password. */
async function inspect(set: SetFn, get: () => BackupStore, password: string | undefined): Promise<void> {
  const { restoreFilePath, restoreMode } = get();
  set({ isInspecting: true, inspectFailure: null });
  try {
    const inspection = await unwrap(window.electron.backup.inspect({ backupPath: restoreFilePath, password }));
    set({
      inspection, isInspecting: false, needsPassword: false, restorePassword: '',
      selectedSections: [...inspection.defaults[restoreMode]],
    });
  } catch (error) {
    const failure = failureOf(error);
    if (failure.code === 'backup_password_required') set({ isInspecting: false, needsPassword: true });
    else if (failure.code === 'backup_wrong_password') set({ isInspecting: false, needsPassword: true, inspectFailure: failure });
    else set({ isInspecting: false, needsPassword: false, inspectFailure: failure });
  }
}
