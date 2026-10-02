/**
 * Desktop pack installers (task 0075): one `module` installer that runs a pack step through the
 * existing module install path (catalog checksum, InstallationService canon/versification gate,
 * keyword index). Desktop modules are NOT on the core AssetManager in this milestone.
 *
 * CANCEL SEMANTICS: PackRun runs with concurrency 1. When a download cancel API is supplied the active
 * module download is aborted immediately and already-installed modules are kept; without it the module
 * install finishes. If the install already succeeded when cancel arrives, the installer returns
 * normally (the module counts as done); PackRun does not start the next step after a cancel.
 *
 * Licence: GPL-3.0-or-later.
 */

import { AssetError } from '@bible/core/browser';
import type { IPackInstaller, PackPlanStep } from '@bible/core/browser';

export interface PackDownloadProgress {
  queueId: number;
  moduleId: string;
  status: string;
  progressBytes: number;
  totalBytes?: number;
}

export interface DesktopPackInstallerDeps {
  /** The store's `installModule`; resolves false on failure. */
  installModule(moduleId: string, catalogId?: number): Promise<boolean>;
  getActiveDownloads(): Promise<readonly PackDownloadProgress[]>;
  /** Optional: aborts the matching queued download. */
  cancelDownload?: (queueId: number) => Promise<void>;
  /** Last store error text, used as the failure message. */
  getLastError?: () => string | null | undefined;
  pollMs?: number;
}

export function createDesktopPackInstallers(deps: DesktopPackInstallerDeps): { module: IPackInstaller } {
  const pollMs = deps.pollMs ?? 750;
  const aborted = (): AssetError => new AssetError('aborted', 'Pack install cancelled');

  const module: IPackInstaller = {
    async install(step: PackPlanStep, ctx): Promise<void> {
      const { signal, onBytes } = ctx;
      if (signal.aborted) throw aborted();
      const id = step.offer.ref.id.toLowerCase();
      let queueId: number | undefined;
      let busy = false;

      const poll = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        try {
          const mine = (await deps.getActiveDownloads()).find((d) => d.moduleId.toLowerCase() === id);
          if (!mine) return;
          queueId = mine.queueId;
          onBytes(mine.progressBytes, mine.totalBytes ?? step.offer.downloadBytes);
        } catch {
          // progress is best effort
        } finally {
          busy = false;
        }
      };

      const timer = setInterval(() => void poll(), pollMs);
      const onAbort = (): void => {
        if (deps.cancelDownload && queueId !== undefined) void deps.cancelDownload(queueId).catch(() => undefined);
      };
      signal.addEventListener('abort', onAbort);
      try {
        let ok = false;
        try {
          ok = await deps.installModule(step.offer.ref.id, step.offer.catalogId);
        } catch (e) {
          if (signal.aborted) throw aborted();
          throw e;
        }
        // A module that finished installing stays installed even if cancel arrived meanwhile.
        if (!ok && signal.aborted) throw aborted();
        if (!ok) throw new Error(deps.getLastError?.() || `Installing ${step.offer.title} failed`);
        onBytes(step.offer.downloadBytes, step.offer.downloadBytes);
      } finally {
        clearInterval(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
  return { module };
}
