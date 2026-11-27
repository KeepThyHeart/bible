import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleRow } from '../../stores/module/moduleRows';
import type { InstallJob } from '../../stores/module/moduleAPI';
import { useModuleStore } from '../../stores/useModuleStore';

export interface BatchState {
  /** Rows in the batch, in the order they were started. */
  total: number;
  /** Finished successfully. */
  done: number;
  failed: number;
  cancelled: number;
  running: boolean;
}

const ACTIVE_STAGES = new Set(['queued', 'downloading', 'verifying', 'installing']);

interface BatchItem {
  abbreviation: string;
  kind: 'install' | 'update';
  /** Catalog module id (install) - the key of its background job. */
  catalogId?: string;
  installedId?: number;
}

/**
 * Runs a list of rows through the existing per-module paths, in order: new
 * modules are queued on the background install queue (conformance gates run
 * there, one job per module with its own row progress), updates run one after
 * another through `updateModule`. Overall progress is derived from the jobs.
 */
export function useBatchInstall(installJobs: readonly InstallJob[]) {
  const startInstall = useModuleStore((s) => s.startInstall);
  const cancelInstall = useModuleStore((s) => s.cancelInstall);
  const updateModule = useModuleStore((s) => s.updateModule);

  const [state, setState] = useState<BatchState | null>(null);
  const itemsRef = useRef<BatchItem[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const outcomeRef = useRef<Map<string, 'done' | 'failed' | 'cancelled'>>(new Map());
  const cancelRef = useRef(false);
  const startedRef = useRef(false);

  const recompute = useCallback(() => {
    const items = itemsRef.current;
    let done = 0;
    let failed = 0;
    let cancelled = 0;
    for (const item of items) {
      const outcome = outcomeRef.current.get(item.abbreviation);
      if (outcome === 'done') done += 1;
      else if (outcome === 'failed') failed += 1;
      else if (outcome === 'cancelled') cancelled += 1;
    }
    const settled = done + failed + cancelled;
    setState({
      total: items.length,
      done,
      failed,
      cancelled,
      running: startedRef.current && settled < items.length,
    });
  }, []);

  // Fold job changes into per-item outcomes.
  useEffect(() => {
    if (itemsRef.current.length === 0) return;
    let changed = false;
    for (const item of itemsRef.current) {
      if (item.kind !== 'install' || !item.catalogId) continue;
      if (outcomeRef.current.has(item.abbreviation) && outcomeRef.current.get(item.abbreviation) !== 'failed') continue;
      const job = installJobs.find((j) => String(j.moduleId) === item.catalogId);
      if (job) {
        seenRef.current.add(item.abbreviation);
        const next = job.stage === 'done' ? 'done' : job.stage === 'failed' ? 'failed' : job.stage === 'cancelled' ? 'cancelled' : undefined;
        if (next && outcomeRef.current.get(item.abbreviation) !== next) {
          outcomeRef.current.set(item.abbreviation, next);
          changed = true;
        } else if (!next && ACTIVE_STAGES.has(job.stage) && outcomeRef.current.get(item.abbreviation) === 'failed') {
          // Retried: back in play.
          outcomeRef.current.delete(item.abbreviation);
          changed = true;
        }
      } else if (seenRef.current.has(item.abbreviation) && !outcomeRef.current.has(item.abbreviation)) {
        // A finished job is dropped from the store once the installed list reloads.
        outcomeRef.current.set(item.abbreviation, cancelRef.current ? 'cancelled' : 'done');
        changed = true;
      }
    }
    if (changed) recompute();
  }, [installJobs, recompute]);

  const start = useCallback(
    async (rows: ModuleRow[]) => {
      if (rows.length === 0 || startedRef.current) return;
      const items: BatchItem[] = rows.map((row) =>
        row.installed && row.installedModule
          ? { abbreviation: row.abbreviation, kind: 'update', installedId: row.installedModule.module_id }
          : { abbreviation: row.abbreviation, kind: 'install', catalogId: row.catalogModule ? String(row.catalogModule.module_id) : undefined }
      );
      itemsRef.current = items;
      seenRef.current = new Set();
      outcomeRef.current = new Map();
      cancelRef.current = false;
      startedRef.current = true;
      recompute();

      // Installs go on the background queue in order; it runs them and reports per row.
      for (const item of items.filter((i) => i.kind === 'install')) {
        if (cancelRef.current) break;
        if (!item.catalogId) {
          outcomeRef.current.set(item.abbreviation, 'failed');
          continue;
        }
        await startInstall(item.catalogId);
        const job = useModuleStore.getState().installJobs.find((j) => String(j.moduleId) === item.catalogId);
        if (job) seenRef.current.add(item.abbreviation);
        else outcomeRef.current.set(item.abbreviation, 'failed');
      }
      recompute();

      // Updates run one after another.
      for (const item of items.filter((i) => i.kind === 'update')) {
        if (cancelRef.current) break;
        const ok = await updateModule(item.installedId as number).catch(() => false);
        outcomeRef.current.set(item.abbreviation, ok ? 'done' : 'failed');
        recompute();
      }

      if (cancelRef.current) {
        for (const item of items) {
          if (!outcomeRef.current.has(item.abbreviation) && !seenRef.current.has(item.abbreviation)) {
            outcomeRef.current.set(item.abbreviation, 'cancelled');
          }
        }
        recompute();
      }
    },
    [recompute, startInstall, updateModule]
  );

  /** Stop the rest of the queue: queued jobs are cancelled, running downloads are asked to stop, no further update starts. */
  const cancel = useCallback(() => {
    cancelRef.current = true;
    const jobs = useModuleStore.getState().installJobs;
    for (const item of itemsRef.current) {
      if (item.kind !== 'install' || outcomeRef.current.has(item.abbreviation)) continue;
      const job = jobs.find((j) => String(j.moduleId) === item.catalogId);
      if (job && ACTIVE_STAGES.has(job.stage)) void cancelInstall(job.jobId);
    }
    for (const item of itemsRef.current) {
      if (item.kind === 'update' && !outcomeRef.current.has(item.abbreviation)) {
        outcomeRef.current.set(item.abbreviation, 'cancelled');
      }
    }
    recompute();
  }, [cancelInstall, recompute]);

  const dismiss = useCallback(() => {
    itemsRef.current = [];
    startedRef.current = false;
    setState(null);
  }, []);

  // A batch is over once every item settled: allow starting the next one.
  useEffect(() => {
    if (state && !state.running) startedRef.current = false;
  }, [state]);

  return { batch: state, start, cancel, dismiss };
}
