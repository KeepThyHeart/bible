/**
 * DiagnosticsUploader - background service that drains the diagnostics queue
 * over HTTPS.
 *
 * ## Design notes
 *
 * - Uses Electron's `net` module (NOT global `fetch`) so the system proxy and
 *   certificate chain are honored without extra configuration.
 * - Serial, not parallel: reports are POSTed one at a time per tick. A server
 *   that rate-limits us only has to tell us once; we break out of the loop on
 *   `429` with `Retry-After` so we don't burn through the queue.
 * - Never retries within a single tick. If a POST fails the file stays queued
 *   and the next tick (30 min later, or triggered by the user via "Send all
 *   now") will pick it up.
 * - Respects the `pending_send` flag on crash reports - those are only sent
 *   after the user clicks "Send Report" in the crash dialog (which flips the
 *   flag via `diagnostics:submit-crash-report`). Manual and feedback reports
 *   are always eligible (they were submitted intentionally).
 */

import { app } from 'electron';
import log from 'electron-log';
import {
  DIAGNOSTICS_UPLOAD_INTERVAL_MS,
  DIAGNOSTICS_UPLOAD_TIMEOUT_MS,
  DIAGNOSTICS_UPLOAD_INITIAL_DELAY_MS,
  DIAGNOSTICS_SHARED_TOKEN,
} from '../config/constants';
import type { DiagnosticsConfig } from './DiagnosticsConfig';
import type { DiagnosticsQueue } from './DiagnosticsQueue';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';
import { BUILD_ID } from './DiagnosticsService';
import type { DiagnosticsPayload } from './DiagnosticsService';

/**
 * The diagnostics endpoint replies with a tiny ack body (or nothing). Cap the
 * buffered response generously so a misconfigured endpoint streaming a large
 * body can't make us buffer it.
 */
const DIAGNOSTICS_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface FlushCounts {
  sent: number;
  failed: number;
  skipped: number;
}

type AttemptOutcome =
  | { kind: 'sent' }
  | { kind: 'permanent-failure'; reason: string }
  | { kind: 'transient' }
  | { kind: 'rate-limited'; retryAfterSeconds: number | null };

export class DiagnosticsUploader {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  private readonly gateway: INetworkGateway;

  constructor(
    private readonly config: DiagnosticsConfig,
    private readonly queue: DiagnosticsQueue,
    gateway: INetworkGateway = getNetworkGateway()
  ) {
    this.gateway = gateway;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Kick off one tick shortly after boot so a user who just opened the app
    // doesn't have to wait 30 minutes for the first flush attempt.
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.tick();
    }, DIAGNOSTICS_UPLOAD_INITIAL_DELAY_MS);
    this.timer = setInterval(() => {
      void this.tick();
    }, DIAGNOSTICS_UPLOAD_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Drain the queue immediately and return per-file outcome counts. Safe to
   * invoke from the renderer via `diagnostics:flush-now`.
   */
  async flushNow(): Promise<FlushCounts> {
    return this.tick();
  }

  private async tick(): Promise<FlushCounts> {
    const counts: FlushCounts = { sent: 0, failed: 0, skipped: 0 };
    if (this.running) {
      // A previous tick is still draining - skip to avoid concurrent POSTs
      // of the same file.
      return counts;
    }
    this.running = true;
    try {
      const cfg = this.config.get();
      if (!cfg.enabled || !cfg.endpointUrl.trim()) return counts;
      // Master offline switch: when the app is in offline mode we make no
      // attempt at all (queued files stay put, uncounted). The gateway would
      // refuse anyway, but bailing here avoids marking files as "failed".
      if (this.gateway.isOffline()) return counts;
      // Cheap DNS/connectivity hint. When offline we bail entirely so queued
      // files aren't counted as "failed".
      if (!this.gateway.isConnected()) return counts;

      const endpoint = cfg.endpointUrl.trim();
      const entries = this.queue.list();

      for (const entry of entries) {
        const payload = this.queue.read(entry.id);
        if (!payload) {
          counts.skipped++;
          continue;
        }

        // Crash reports only leave the queue after the user explicitly
        // clicks "Send Report" in the crash dialog (which sets pending_send).
        if (payload.type === 'crash' && !payload.pending_send) {
          counts.skipped++;
          continue;
        }

        const outcome = await this.attempt(endpoint, payload);
        if (outcome.kind === 'sent') {
          this.queue.delete(entry.id);
          counts.sent++;
        } else if (outcome.kind === 'permanent-failure') {
          log.warn(
            `[diagnostics] Dropping ${entry.id} after permanent failure: ${outcome.reason}`
          );
          this.queue.delete(entry.id);
          counts.failed++;
        } else if (outcome.kind === 'rate-limited') {
          log.info(
            `[diagnostics] Rate-limited by endpoint; stopping this cycle (retryAfter=${outcome.retryAfterSeconds ?? 'unset'}s).`
          );
          counts.skipped++;
          break;
        } else {
          counts.failed++;
        }
      }
    } catch (err) {
      log.error('[diagnostics] uploader tick failed:', err);
    } finally {
      this.running = false;
    }
    return counts;
  }

  private async attempt(
    endpoint: string,
    payload: DiagnosticsPayload
  ): Promise<AttemptOutcome> {
    // Generic, de-identified wire metadata. Neither the User-Agent nor any
    // header names say "Bible" - the payload scrubbing in
    // DiagnosticsService already handles the body. `X-Report-*` are opaque.
    //
    // The User-Agent deliberately carries no platform or architecture. A
    // `feedback` report is description-only by design - the Report an Issue
    // dialog promises exactly that when "Include diagnostic information" is
    // left unchecked - and a UA of `App/1.2.3 (win32 x64)` quietly broke that
    // promise on every report regardless of the checkbox. Crash and manual
    // reports still carry `os` and `arch` in the body, where the privacy blurb
    // discloses them and the user has agreed to send them.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': `App/${app.getVersion()}`,
      'X-Report-Type': payload.type,
      'X-Report-Id': payload.report_id,
      'X-App-Version': app.getVersion(),
    };
    if (BUILD_ID) {
      headers['X-Build-Id'] = BUILD_ID;
    }
    if (DIAGNOSTICS_SHARED_TOKEN) {
      headers['X-Report-Token'] = DIAGNOSTICS_SHARED_TOKEN;
    }

    let response;
    try {
      response = await this.gateway.fetchBuffered({
        url: endpoint,
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        maxResponseBytes: DIAGNOSTICS_MAX_RESPONSE_BYTES,
        timeoutMs: DIAGNOSTICS_UPLOAD_TIMEOUT_MS,
        // Classify a 3xx ourselves (transient) rather than following it, and
        // never open a socket if the master switch is engaged.
        maxRedirects: 0,
        context: 'diagnostics upload',
      });
    } catch (err) {
      // Timeout, connection error, or offline mode - leave the file queued and
      // try again next tick.
      log.warn('[diagnostics] upload attempt failed:', err);
      return { kind: 'transient' };
    }

    let retryAfterSeconds: number | null = null;
    const retryAfterRaw = response.headers['retry-after'];
    if (retryAfterRaw) {
      const raw = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
      const n = Number.parseInt(String(raw), 10);
      if (Number.isFinite(n)) retryAfterSeconds = n;
    }

    const status = response.status;
    if (status === 200 || status === 202) {
      return { kind: 'sent' };
    } else if (status === 400 || status === 413) {
      return { kind: 'permanent-failure', reason: `HTTP ${status}` };
    } else if (status === 429) {
      return { kind: 'rate-limited', retryAfterSeconds };
    } else if (status >= 500 && status <= 599) {
      return { kind: 'transient' };
    }
    // Unknown status (incl. a 3xx we chose not to follow) - treat as transient
    // so we don't discard reports due to a misconfigured reverse proxy.
    return { kind: 'transient' };
  }
}
