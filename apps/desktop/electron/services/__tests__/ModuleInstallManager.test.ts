import { describe, it, expect, vi } from 'vitest';
import type { CatalogModule, InstallationResult, InstallHooks, DownloadProgress } from '@bible/core';
import { ModuleInstallManager, MAX_CONCURRENT_INSTALLS, type InstallController } from '../ModuleInstallManager';

function catalogEntry(id: string, size = 1000): CatalogModule {
  return { module_id: id, abbreviation: id.toUpperCase(), name: `Module ${id}`, download_size_bytes: size } as CatalogModule;
}

interface Pending {
  id: string;
  hooks: InstallHooks;
  resolve: (r: InstallationResult) => void;
  reject: (e: Error) => void;
}

function fakeController(ids: string[]) {
  const pending: Pending[] = [];
  const progress = new Map<number, DownloadProgress>();
  let nextQueue = 100;
  const cancelDownload = vi.fn<(queueId: number) => void>();
  const controller: InstallController = {
    installModule: (id, _catalogId, hooks) =>
      new Promise<InstallationResult>((resolve, reject) => {
        const entry: Pending = { id, hooks: hooks ?? {}, resolve, reject };
        pending.push(entry);
        const queueId = nextQueue++;
        hooks?.onQueued?.(queueId);
        hooks?.onStage?.('downloading');
      }),
    cancelDownload,
    getDownloadProgress: (queueId) => progress.get(queueId),
    getAvailableModules: () => ids.map((i) => catalogEntry(i)),
  };
  return { controller, pending, progress, cancelDownload };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('ModuleInstallManager', () => {
  it('runs at most MAX_CONCURRENT_INSTALLS at once and starts the next when one finishes', async () => {
    const { controller, pending } = fakeController(['a', 'b', 'c', 'd']);
    const manager = new ModuleInstallManager(() => controller);
    for (const id of ['a', 'b', 'c', 'd']) manager.enqueue(id);

    expect(pending).toHaveLength(MAX_CONCURRENT_INSTALLS);
    expect(manager.list().map((j) => j.stage)).toEqual(['downloading', 'downloading', 'queued', 'queued']);

    pending[0]!.resolve({ success: true, moduleId: 7, moduleName: 'A' });
    await flush();
    expect(pending).toHaveLength(MAX_CONCURRENT_INSTALLS + 1);
    const jobs = manager.list();
    expect(jobs[0]).toMatchObject({ stage: 'done', installedModuleId: 7, percent: 100 });
  });

  it('does not start a second install of a module that is already queued or running', () => {
    const { controller, pending } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    const first = manager.enqueue('a');
    const second = manager.enqueue('a');
    expect(second.jobId).toBe(first.jobId);
    expect(pending).toHaveLength(1);
  });

  it('reports stage changes and live download progress', () => {
    const { controller, pending, progress } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    manager.enqueue('a');
    progress.set(100, { queueId: 100, progressBytes: 250, totalBytes: 1000, speedBps: 50 } as DownloadProgress);
    expect(manager.list()[0]).toMatchObject({ stage: 'downloading', percent: 25, bytesDone: 250, bytesTotal: 1000 });

    pending[0]!.hooks.onStage?.('verifying');
    expect(manager.list()[0]!.stage).toBe('verifying');
    pending[0]!.hooks.onStage?.('installing');
    expect(manager.list()[0]!.stage).toBe('installing');
  });

  it('marks a failed install with its error and retries it as a new job', async () => {
    const { controller, pending } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    const job = manager.enqueue('a');
    pending[0]!.resolve({ success: false, error: 'Checksum verification failed' });
    await flush();
    expect(manager.list()[0]).toMatchObject({ stage: 'failed', error: 'Checksum verification failed' });

    const retried = manager.retry(job.jobId);
    expect(retried?.stage).toBe('downloading');
    expect(pending).toHaveLength(2);
    expect(manager.list()).toHaveLength(1);
  });

  it('turns a thrown install into a failed job instead of an unhandled rejection', async () => {
    const { controller, pending } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    manager.enqueue('a');
    pending[0]!.reject(new Error('boom'));
    await flush();
    expect(manager.list()[0]).toMatchObject({ stage: 'failed', error: 'boom' });
  });

  it('cancels a queued job without starting it', () => {
    const { controller, pending } = fakeController(['a', 'b', 'c']);
    const manager = new ModuleInstallManager(() => controller);
    manager.enqueue('a');
    manager.enqueue('b');
    const queued = manager.enqueue('c');
    expect(manager.cancel(queued.jobId)).toBe(true);
    expect(manager.list()[2]!.stage).toBe('cancelled');
    expect(pending).toHaveLength(2);
  });

  it('cancels a downloading job through the download service and ends as cancelled', async () => {
    const { controller, pending, cancelDownload } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    const job = manager.enqueue('a');
    expect(manager.cancel(job.jobId)).toBe(true);
    expect(cancelDownload).toHaveBeenCalledWith(100);
    pending[0]!.resolve({ success: false, error: 'Download cancelled' });
    await flush();
    expect(manager.list()[0]).toMatchObject({ stage: 'cancelled' });
    expect(manager.list()[0]!.error).toBeUndefined();
  });

  it('refuses to cancel once the install is verifying or installing', () => {
    const { controller, pending, cancelDownload } = fakeController(['a']);
    const manager = new ModuleInstallManager(() => controller);
    const job = manager.enqueue('a');
    pending[0]!.hooks.onStage?.('verifying');
    expect(manager.cancel(job.jobId)).toBe(false);
    expect(cancelDownload).not.toHaveBeenCalled();
  });

  it('dismisses a finished job but keeps an active one', async () => {
    const { controller, pending } = fakeController(['a', 'b']);
    const manager = new ModuleInstallManager(() => controller);
    const a = manager.enqueue('a');
    const b = manager.enqueue('b');
    pending[0]!.resolve({ success: false, error: 'x' });
    await flush();
    manager.dismiss(a.jobId);
    manager.dismiss(b.jobId);
    expect(manager.list().map((j) => j.moduleId)).toEqual(['b']);
  });
});
