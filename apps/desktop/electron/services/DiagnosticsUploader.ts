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
 * - Consent is per report type:
 *   - `feedback` and `manual` reports are eligible as soon as they are queued:
 *     the user wrote them and pressed Send in Give Feedback / Report an
 *     Issue (which then calls `deliver()` to try right away). A `manual`
 *     report carries diagnostic data only because the user ticked "Include
 *     diagnostic information" for that report (the box starts unticked).
 *   - `crash` reports need BOTH the standing opt-in (`cfg.enabled`, "Send
 *     diagnostic reports when errors occur") AND the per-crash `pending_send`
 *     flag, set when the user clicks "Send Report" in the crash dialog.
 *   So `cfg.enabled` gates diagnostics that the app captured by itself; it
 *   does not gate feedback the user typed and asked to send.
 * - Runs whenever the app runs (see main.ts). A tick with nothing eligible
 *   makes no request, so a running uploader contacts nothing on its own.
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

/**
 * Why a report that was asked to go out right now is still in the queue.
 *
 *  - `web-requests-off` - Privacy -> Allow Web Requests is off. Nothing will be
 *    sent until the user turns it on; this is the one the UI must name.
 *  - `no-connection`    - Electron reports no network.
 *  - `unreachable`      - the POST failed (timeout, connection error, 5xx...).
 *  - `rate-limited`     - the endpoint answered 429.
 *  - `no-endpoint`      - this build or user has no destination at all.
 *  - `not-eligible`     - a crash report without the consent it needs.
 */
export type DeliveryQueuedReason =
  | 'web-requests-off'
  | 'no-connection'
  | 'unreachable'
  | 'rate-limited'
  | 'no-endpoint'
  | 'not-eligible';

/**
 * Result of {@link DiagnosticsUploader.deliver}: what happened to ONE report
 * the user just submitted.
 *
 *  - `sent`     - the endpoint accepted it; it is no longer queued.
 *  - `queued`   - still on disk, and the background ticks will retry it.
 *  - `rejected` - the endpoint refused it permanently (400/413) and it was
 *                 dropped from the queue, so "it will be sent later" would be
 *                 untrue.
 */
export type DeliveryResult =
  | { status: 'sent' }
  | { status: 'queued'; reason: DeliveryQueuedReason }
  | { status: 'rejected' };

/** How many per-report outcomes `deliver()` can look back on. */
const OUTCOME_MEMORY = 100;

type RecordedOutcome = AttemptOutcome['kind'] | 'skipped';

export class DiagnosticsUploader {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  /** The tick in progress, if any. Ticks never overlap. */
  private current: Promise<FlushCounts> | null = null;
  private stopped = true;
  /**
   * What the most recent tick did with each report id, so `deliver()` can
   * answer for a report a tick already handled instead of POSTing it twice.
   * Insertion-ordered and capped at {@link OUTCOME_MEMORY}.
   */
  private readonly outcomes = new Map<string, RecordedOutcome>();

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

  /**
   * Try to send one just-submitted report now and say what became of it.
   *
   * This is what lets the Give Feedback / Report an Issue dialog say "sent"
   * only when it was. It does not POST on its own: it runs (or waits for) an
   * ordinary tick, so every consent and offline rule the tick applies holds
   * here too, and a report the submit handler's immediate flush already sent
   * is not sent twice. Whatever the outcome, a report that is still queued
   * stays queued for the background ticks.
   */
  async deliver(reportId: string): Promise<DeliveryResult> {
    const cfg = this.config.get();
    if (!cfg.endpointUrl.trim()) return { status: 'queued', reason: 'no-endpoint' };
    // The app-wide permission model: with web requests off the tick contacts
    // nothing, and neither do we. Say so rather than wait.
    if (this.gateway.isOffline()) return { status: 'queued', reason: 'web-requests-off' };
    if (!this.gateway.isConnected()) return { status: 'queued', reason: 'no-connection' };

    // A tick is usually already running - the submit handler started one.
    // Let it finish; it will have handled this report if it could.
    await this.settle();
    if (!this.outcomes.has(reportId) && this.queue.read(reportId)) {
      // No tick has looked at it yet (or one started before it was queued).
      await this.tick();
      await this.settle();
    }
    return this.resultFor(reportId);
  }

  /** Wait until no tick is in progress. */
  private async settle(): Promise<void> {
    while (this.current) {
      try {
        await this.current;
      } catch {
        /* tick() never rejects, but a wait must not throw either way */
      }
    }
  }

  private resultFor(reportId: string): DeliveryResult {
    const outcome = this.outcomes.get(reportId);
    const stillQueued = this.queue.read(reportId) !== null;
    switch (outcome) {
      case 'sent':
        return { status: 'sent' };
      case 'permanent-failure':
        return { status: 'rejected' };
      case 'rate-limited':
        return { status: 'queued', reason: 'rate-limited' };
      case 'skipped':
        return { status: 'queued', reason: 'not-eligible' };
      case 'transient':
        return { status: 'queued', reason: 'unreachable' };
      default:
        // Nothing recorded. Still on disk: the tick bailed before reaching it
        // (the network went away mid-way) - it is waiting. Gone with no
        // record: deleted from Preferences in the meantime; nothing to send.
        if (stillQueued) {
          if (this.gateway.isOffline()) return { status: 'queued', reason: 'web-requests-off' };
          return { status: 'queued', reason: 'unreachable' };
        }
        return { status: 'rejected' };
    }
  }

  private record(id: string, outcome: RecordedOutcome): void {
    this.outcomes.delete(id);
    this.outcomes.set(id, outcome);
    while (this.outcomes.size > OUTCOME_MEMORY) {
      const oldest = this.outcomes.keys().next().value;
      if (oldest === undefined) break;
      this.outcomes.delete(oldest);
    }
  }

  private tick(): Promise<FlushCounts> {
    if (this.current) {
      // A previous tick is still draining - skip to avoid concurrent POSTs
      // of the same file.
      return Promise.resolve({ sent: 0, failed: 0, skipped: 0 });
    }
    // Set synchronously, before the first await, so a `deliver()` arriving
    // straight after a submit sees this tick and waits for it.
    const run = this.runTick().finally(() => {
      if (this.current === run) this.current = null;
    });
    this.current = run;
    return run;
  }

  private async runTick(): Promise<FlushCounts> {
    const counts: FlushCounts = { sent: 0, failed: 0, skipped: 0 };
    try {
      const cfg = this.config.get();
      if (!cfg.endpointUrl.trim()) return counts;
      // Master offline switch: when the app is in offline mode we make no
      // attempt at all (queued files stay put, uncounted). The gateway would
      // refuse anyway, but bailing here avoids marking files as "failed".
      if (this.gateway.isOffline()) return counts;
      // Cheap DNS/connectivity hint. When offline we bail entirely so queued
      // files aren't counted as "failed".
      if (!this.gateway.isConnected()) return counts;

      const endpoint = cfg.endpointUrl.trim();
      const entries = this.queue.list();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const payload = this.queue.read(entry.id);
        if (!payload) {
          counts.skipped++;
          continue;
        }

        // Crash reports only leave the queue when diagnostics is turned on
        // AND the user clicked "Send Report" in the crash dialog (which sets
        // pending_send). See the consent notes at the top of this file.
        if (payload.type === 'crash' && !(cfg.enabled && payload.pending_send)) {
          this.record(entry.id, 'skipped');
          counts.skipped++;
          continue;
        }

        const outcome = await this.attempt(endpoint, payload);
        // The rest of the queue is untouched after a 429, but it is waiting
        // on the same rate limit - record that, so `deliver()` does not start
        // a second tick straight into it.
        this.record(entry.id, outcome.kind);
        if (outcome.kind === 'rate-limited') {
          for (const rest of entries.slice(i + 1)) this.record(rest.id, 'rate-limited');
        }
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
    // Any 2xx: the web server's /api/desktop-report answers 201 Created.
    if (status >= 200 && status <= 299) {
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
