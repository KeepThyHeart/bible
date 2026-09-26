import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBackupStore } from './useBackupStore';

type Mock = ReturnType<typeof vi.fn>;
const ok = <T,>(value: T) => ({ ok: true as const, value });
const err = (code: string, message = 'x') => ({ ok: false as const, error: { code, message } });

const insp = (token = 't') => ({
  token, fileName: 'a.bbk', encrypted: true, source: {}, sections: [], unknownSections: [], extensions: [], noteFiles: 0, historyNoteFiles: 0, warnings: [],
  defaults: { replace: ['a', 'b', 'w'], merge: ['a', 'b'] },
});

let backup: Record<string, Mock>;

beforeEach(() => {
  backup = { create: vi.fn(), exportPlain: vi.fn(), selectFile: vi.fn(), inspect: vi.fn(), apply: vi.fn(), discard: vi.fn().mockResolvedValue(ok(null)) };
  (globalThis as unknown as { window: { electron: unknown } }).window = { electron: { backup } };
  useBackupStore.getState().resetState();
  useBackupStore.setState({ isDialogOpen: true });
});

describe('creating a backup', () => {
  it('validates locally before calling the main process', async () => {
    const s = useBackupStore.getState();
    await s.startBackup();
    expect(useBackupStore.getState().backupResult).toMatchObject({ failure: { code: 'passwordRequired' } });
    s.setBackupPassword('long enough password');
    s.setBackupConfirmPassword('different');
    await s.startBackup();
    expect(useBackupStore.getState().backupResult).toMatchObject({ failure: { code: 'passwordMismatch' } });
    s.setBackupPassword('short');
    s.setBackupConfirmPassword('short');
    await s.startBackup();
    expect(useBackupStore.getState().backupResult).toMatchObject({ failure: { code: 'passwordTooShort' } });
    expect(backup.create).not.toHaveBeenCalled();
  });

  it('creates, clears the passwords on success, and keeps them when the save dialog is cancelled', async () => {
    const s = useBackupStore.getState();
    s.setBackupPassword('long enough password');
    s.setBackupConfirmPassword('long enough password');
    backup.create.mockResolvedValueOnce(ok(null));
    await s.startBackup();
    expect(useBackupStore.getState().backupPassword).toBe('long enough password');
    expect(useBackupStore.getState().backupResult).toBeNull();
    backup.create.mockResolvedValueOnce(ok({ path: '/a.bbk', sizeBytes: 1, createdAt: 'x', sections: 1, warnings: [] }));
    await s.startBackup();
    expect(useBackupStore.getState().backupResult).toMatchObject({ summary: { path: '/a.bbk' } });
    expect(useBackupStore.getState().backupPassword).toBe('');
    expect(backup.create).toHaveBeenLastCalledWith({ password: 'long enough password', includeHistory: false });
  });

  it('surfaces the error code from the main process', async () => {
    const s = useBackupStore.getState();
    s.setBackupPassword('long enough password');
    s.setBackupConfirmPassword('long enough password');
    backup.create.mockResolvedValueOnce(err('internal', 'disk full'));
    await s.startBackup();
    expect(useBackupStore.getState().backupResult).toMatchObject({ failure: { code: 'internal', message: 'disk full' } });
  });

  it('exports unencrypted with the history option', async () => {
    const s = useBackupStore.getState();
    s.setIncludeHistory(true);
    backup.exportPlain.mockResolvedValueOnce(ok({ path: '/e.zip', sizeBytes: 1, createdAt: 'x', sections: 1, warnings: [] }));
    await s.startExport();
    expect(backup.exportPlain).toHaveBeenCalledWith({ includeHistory: true });
    expect(useBackupStore.getState().exportResult).toMatchObject({ summary: { path: '/e.zip' } });
  });
});

describe('restoring', () => {
  it('opens an unencrypted file straight away, selecting the default sections for the mode', async () => {
    backup.selectFile.mockResolvedValueOnce(ok({ path: '/x.zip' }));
    backup.inspect.mockResolvedValueOnce(ok({ ...insp(), encrypted: false }));
    await useBackupStore.getState().selectRestoreFile();
    const st = useBackupStore.getState();
    expect(backup.inspect).toHaveBeenCalledWith({ backupPath: '/x.zip', password: undefined });
    expect(st.needsPassword).toBe(false);
    expect(st.selectedSections).toEqual(['a', 'b']);
  });

  it('asks for the password of an encrypted file, keeps asking on a wrong one, then opens it', async () => {
    backup.selectFile.mockResolvedValueOnce(ok({ path: '/x.bbk' }));
    backup.inspect.mockResolvedValueOnce(err('backup_password_required'));
    await useBackupStore.getState().selectRestoreFile();
    expect(useBackupStore.getState().needsPassword).toBe(true);
    expect(useBackupStore.getState().inspectFailure).toBeNull();

    useBackupStore.getState().setRestorePassword('wrong');
    backup.inspect.mockResolvedValueOnce(err('backup_wrong_password'));
    await useBackupStore.getState().unlockBackup();
    expect(useBackupStore.getState().needsPassword).toBe(true);
    expect(useBackupStore.getState().inspectFailure).toMatchObject({ code: 'backup_wrong_password' });

    useBackupStore.getState().setRestorePassword('right');
    backup.inspect.mockResolvedValueOnce(ok(insp()));
    await useBackupStore.getState().unlockBackup();
    expect(backup.inspect).toHaveBeenLastCalledWith({ backupPath: '/x.bbk', password: 'right' });
    expect(useBackupStore.getState().inspection?.token).toBe('t');
    expect(useBackupStore.getState().restorePassword).toBe('');
  });

  it('shows other failures (damaged, newer, not a backup) without asking for a password', async () => {
    backup.selectFile.mockResolvedValueOnce(ok({ path: '/x.bbk' }));
    backup.inspect.mockResolvedValueOnce(err('backup_damaged'));
    await useBackupStore.getState().selectRestoreFile();
    expect(useBackupStore.getState().needsPassword).toBe(false);
    expect(useBackupStore.getState().inspectFailure).toMatchObject({ code: 'backup_damaged' });
  });

  it('resets the selection to the mode defaults, and toggles groups', async () => {
    useBackupStore.setState({ inspection: insp() as never, selectedSections: ['a', 'b'] });
    useBackupStore.getState().setRestoreMode('replace');
    expect(useBackupStore.getState().selectedSections).toEqual(['a', 'b', 'w']);
    useBackupStore.getState().setSectionSelected(['w'], false);
    expect(useBackupStore.getState().selectedSections).toEqual(['a', 'b']);
    useBackupStore.getState().setSectionSelected(['w', 'a'], true);
    expect(new Set(useBackupStore.getState().selectedSections)).toEqual(new Set(['a', 'b', 'w']));
  });

  it('applies the selection, and forgets the open backup afterwards', async () => {
    useBackupStore.setState({ inspection: insp('tok') as never, selectedSections: ['a'], restoreMode: 'merge' });
    backup.apply.mockResolvedValueOnce(ok({ report: { ok: true, perTable: [], notes: {}, fileErrors: [] } }));
    await useBackupStore.getState().startRestore();
    expect(backup.apply).toHaveBeenCalledWith({ token: 'tok', mode: 'merge', sections: ['a'] });
    expect(useBackupStore.getState().restoreResult).toMatchObject({ result: { report: { ok: true } } });
    expect(useBackupStore.getState().inspection).toBeNull();
  });

  it('does nothing without a selection, and reports a failed restore', async () => {
    useBackupStore.setState({ inspection: insp() as never, selectedSections: [] });
    await useBackupStore.getState().startRestore();
    expect(backup.apply).not.toHaveBeenCalled();
    useBackupStore.setState({ selectedSections: ['a'] });
    backup.apply.mockResolvedValueOnce(err('backup_restore_failed', 'row 3'));
    await useBackupStore.getState().startRestore();
    expect(useBackupStore.getState().restoreResult).toMatchObject({ failure: { code: 'backup_restore_failed' } });
    expect(useBackupStore.getState().inspection).not.toBeNull();
  });

  it('tells the main process to drop the open backup when the dialog closes', () => {
    useBackupStore.setState({ inspection: insp('tok') as never });
    useBackupStore.getState().closeDialog();
    expect(backup.discard).toHaveBeenCalledWith('tok');
    expect(useBackupStore.getState().isDialogOpen).toBe(false);
  });
});
