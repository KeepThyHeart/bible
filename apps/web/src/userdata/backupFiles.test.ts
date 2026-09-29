import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { UserData } from '@bible/core/browser';
import { WebUserData } from './WebUserData';
import { downloadBackup, restoreBackupFile } from './backupFiles';

const { UserDataItem } = UserData;

afterEach(() => vi.restoreAllMocks());

describe('backup files', () => {
  it('downloads a dated .zip and restores it into another store', async () => {
    const a = await WebUserData.open({ indexedDB: new IDBFactory(), channelName: null });
    a.items.put(UserDataItem.json('app:t', 'c', 'k', { v: 1 }));

    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const name = await downloadBackup({ store: a, now: new Date('2026-09-29T12:00:00Z') });
    expect(name).toBe('keep-thy-heart-2026-09-29.zip');
    expect(click).toHaveBeenCalledOnce();

    const b = await WebUserData.open({ indexedDB: new IDBFactory(), channelName: null });
    const report = await restoreBackupFile(blob!, { store: b });
    expect(report.items.added).toBe(1);
    expect(b.items.get('app:t', 'c', 'k')!.parsedValue()).toEqual({ v: 1 });
    a.close();
    b.close();
  });
});
