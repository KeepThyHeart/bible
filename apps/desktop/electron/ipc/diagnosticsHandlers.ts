/**
 * IPC handlers for the diagnostics & issue reporting subsystem.
 *
 * Scope: collection + local queue + minimal crash dialog wiring.
 * No uploader, no report-an-issue dialog, no settings panel yet.
 *
 * Channels follow the existing handler pattern (see handler-helper.ts) and
 * return `Result<T>` envelopes so the renderer can `unwrap` uniformly.
 */

import type { IpcMain } from 'electron';
import log from 'electron-log';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { DiagnosticsService } from '../services/DiagnosticsService';
import type { DiagnosticsPayload } from '../services/DiagnosticsService';
import { DiagnosticsQueue, QueueEntry } from '../services/DiagnosticsQueue';
import { DiagnosticsConfig, DiagnosticsConfigShape } from '../services/DiagnosticsConfig';
import { DiagnosticsUploader, FlushCounts } from '../services/DiagnosticsUploader';

let service: DiagnosticsService | null = null;
let queue: DiagnosticsQueue | null = null;
let config: DiagnosticsConfig | null = null;
let uploader: DiagnosticsUploader | null = null;

export function initializeDiagnosticsService(): {
  service: DiagnosticsService;
  queue: DiagnosticsQueue;
  config: DiagnosticsConfig;
  uploader: DiagnosticsUploader;
} {
  if (!service) service = new DiagnosticsService();
  if (!queue) queue = new DiagnosticsQueue();
  if (!config) config = new DiagnosticsConfig();
  if (!uploader) uploader = new DiagnosticsUploader(config, queue);
  log.info('[diagnostics] service initialized; queue dir:', queue.getQueueDir());
  return { service, queue, config, uploader };
}

export function getDiagnosticsService(): DiagnosticsService | null {
  return service;
}

export function getDiagnosticsQueue(): DiagnosticsQueue | null {
  return queue;
}

export function getDiagnosticsConfig(): DiagnosticsConfig | null {
  return config;
}

export function getDiagnosticsUploader(): DiagnosticsUploader | null {
  return uploader;
}

function requireQueue(): DiagnosticsQueue {
  if (!queue) throw new IpcKnownError('unavailable', 'Diagnostics queue not initialized');
  return queue;
}

function requireService(): DiagnosticsService {
  if (!service) throw new IpcKnownError('unavailable', 'Diagnostics service not initialized');
  return service;
}

function requireConfig(): DiagnosticsConfig {
  if (!config) throw new IpcKnownError('unavailable', 'Diagnostics config not initialized');
  return config;
}

/**
 * What the renderer is told after a report is accepted.
 *
 * Submitting only *enqueues*: the payload is written to
 * `{userData}/diagnostics/queue/` and a background uploader POSTs it later, on
 * a 30-minute tick. That uploader bails immediately when diagnostics is
 * disabled or no endpoint is set - and both are off by default, because
 * configuring a destination for a user's reports is the user's call, not ours.
 *
 * So "we sent it, thanks" is a claim the app is often not entitled to make.
 * `willUpload` is what lets the thank-you say the true thing instead: the
 * report is on this computer and will go out once an endpoint exists.
 */
export interface SubmitReceipt {
  /** Queue filename id, as returned by `DiagnosticsQueue.enqueue`. */
  reportId: string;
  /**
   * True when the background uploader would actually attempt this file -
   * deliberately the same condition `DiagnosticsUploader.tick()` guards on, so
   * the two cannot drift into telling the user different stories. Transient
   * conditions the uploader also checks (offline mode, no connectivity) are
   * excluded on purpose: those resolve by themselves, and a report that is
   * merely waiting for the network really is going to be sent.
   */
  willUpload: boolean;
}

/** Wraps a freshly enqueued report id with whether anything will collect it. */
function submitReceipt(reportId: string): SubmitReceipt {
  const cfg = requireConfig().get();
  return { reportId, willUpload: cfg.enabled && cfg.endpointUrl.trim().length > 0 };
}

function requireUploader(): DiagnosticsUploader {
  if (!uploader) throw new IpcKnownError('unavailable', 'Diagnostics uploader not initialized');
  return uploader;
}

export function registerDiagnosticsHandlers(_ipcMain: IpcMain): void {
  // Bootstrap lazily - callers can register handlers before or after init.
  initializeDiagnosticsService();

  ipcHandler<[], QueueEntry[]>('diagnostics:get-queue', () => {
    return requireQueue().list();
  });

  ipcHandler<[string], DiagnosticsPayload | null>('diagnostics:get-report', (id) => {
    return requireQueue().read(id);
  });

  ipcHandler<[string], boolean>('diagnostics:delete-report', (id) => {
    return requireQueue().delete(id);
  });

  ipcHandler<[], number>('diagnostics:delete-all', () => {
    return requireQueue().deleteAll();
  });

  // Attach the user's description to an already-queued crash report and
  // mark it pending send. Actual upload is a later phase.
  ipcHandler<[{ reportId: string; description?: string }], boolean>(
    'diagnostics:submit-crash-report',
    ({ reportId, description }) => {
      const q = requireQueue();
      const existing = q.read(reportId);
      if (!existing) {
        throw new IpcKnownError('not_found', `Report ${reportId} not found`);
      }
      if (existing.type !== 'crash') {
        throw new IpcKnownError(
          'invalid_input',
          `Report ${reportId} is not a crash report`
        );
      }
      existing.user_description = description?.trim() ? description : null;
      existing.pending_send = true;
      return q.update(reportId, existing);
    }
  );

  ipcHandler<[{ description: string; includeDiagnostics: boolean }], SubmitReceipt>(
    'diagnostics:submit-manual-report',
    ({ description, includeDiagnostics }) => {
      if (!description || !description.trim()) {
        throw new IpcKnownError('invalid_input', 'Description is required');
      }
      const payload = requireService().buildManualPayload({
        description,
        includeDiagnostics,
      });
      return submitReceipt(requireQueue().enqueue(payload));
    }
  );

  ipcHandler<[{ description: string }], SubmitReceipt>(
    'diagnostics:submit-feedback',
    ({ description }) => {
      if (!description || !description.trim()) {
        throw new IpcKnownError('invalid_input', 'Description is required');
      }
      const payload = requireService().buildFeedbackPayload({ description });
      return submitReceipt(requireQueue().enqueue(payload));
    }
  );

  ipcHandler<[], ReturnType<DiagnosticsService['getStateSnapshot']>>(
    'diagnostics:get-state-snapshot',
    () => {
      return requireService().getStateSnapshot();
    }
  );

  ipcHandler<[], DiagnosticsConfigShape>('diagnostics:get-config', () => {
    return requireConfig().get();
  });

  ipcHandler<[Partial<DiagnosticsConfigShape>], DiagnosticsConfigShape>(
    'diagnostics:set-config',
    (patch) => {
      const next = requireConfig().set(patch);
      // Diagnostics is opt-IN: the uploader is not started at boot
      // unless enabled, so reflect a runtime toggle here. Starting when already
      // running / stopping when already stopped are both no-ops.
      const up = requireUploader();
      if (next.enabled) {
        up.start();
      } else {
        up.stop();
      }
      return next;
    }
  );

  // Manual uploader trigger, wired to the "Send all now" button in the
  // Preferences -> Diagnostics panel. Returns per-file outcome counts so the
  // UI can show inline feedback like "Sent 3, failed 0, skipped 0".
  ipcHandler<[], FlushCounts>('diagnostics:flush-now', async () => {
    return requireUploader().flushNow();
  });

  // Renderer side reports its own unhandled errors here. We build a crash
  // payload and enqueue it (no dialog is raised for renderer errors - the
  // ErrorBoundary UI already prompts the user in-place, and the dialog is
  // reserved for main-process crashes which have no other UX).
  ipcHandler<[{ message: string; stack?: string; componentStack?: string }], string | null>(
    'diagnostics:report-renderer-error',
    (payload) => {
      const svc = requireService();
      const built = svc.captureRendererError(payload);
      if (!built) return null;
      return requireQueue().enqueue(built);
    }
  );
}
